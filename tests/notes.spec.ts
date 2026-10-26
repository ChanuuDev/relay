import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { ready, useRelayServer } from "./web-helpers";

useRelayServer();

const KEY = "relay-notes-v1";
const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const item = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY);

type Seed = { id: string; kind: "folder" | "note"; parentId: string | null; name?: string; title?: string; body?: string };
/** 브라우저 저장소에 메모를 넣고 다시 불러온 뒤 메모 창을 연다. */
async function seed(page: Page, items: Seed[], extra: Record<string, unknown> = {}) {
  await ready(page);
  const now = Date.parse("2026-10-22T09:30:00+09:00");
  const full = items.map((entry, index) => ({ createdAt: now + index, updatedAt: now + index * 60000, title: "", body: "", name: "", ...entry }));
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify({ version: 1, items: full, ...extra })] as const);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("메모")).click();
  await expect(page.locator(win("notes"))).toBeVisible();
}

const SAMPLE: Seed[] = [
  { id: "f-work", kind: "folder", parentId: null, name: "업무" },
  { id: "f-meet", kind: "folder", parentId: "f-work", name: "회의" },
  { id: "f-idea", kind: "folder", parentId: null, name: "아이디어" },
  { id: "n-weekly", kind: "note", parentId: "f-meet", title: "주간 회의", body: "Relay 메모장 출시 일정 정리\n- 폴더 트리 정리\n- 끌어서 옮기기" },
  { id: "n-retro", kind: "note", parentId: "f-meet", title: "회고", body: "잘된 점: 세션 인계가 빨라짐\n아쉬운 점: 검색 범위" },
  { id: "n-plan", kind: "note", parentId: "f-work", title: "분기 계획", body: "1. 웹 화면 정리\n2. 훅 안정화" },
  { id: "n-app", kind: "note", parentId: "f-idea", title: "", body: "메모 앱 아이콘 아이디어\n민트색 타일과 연필" },
  { id: "n-root", kind: "note", parentId: null, title: "장보기", body: "우유, 달걀, 커피 원두" },
];

test("메모 창: 폴더를 만들고 그 안에 메모를 여러 개 써서 저장한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await page.locator(dock("메모")).click();
  const notes = page.locator(win("notes"));
  await expect(notes).toBeVisible();
  await expect(notes).toHaveAttribute("data-focused", "");
  await expect(page.locator(".menubar-app")).toHaveText("메모");
  await expect(notes.locator(".notes-empty")).toBeVisible();
  await expect(notes.getByRole("button", { name: "삭제" })).toBeDisabled();

  // 새 폴더는 바로 이름을 고칠 수 있다.
  await notes.getByRole("button", { name: "새 폴더" }).first().click();
  const rename = notes.getByLabel("폴더 이름");
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue("새 폴더");
  await rename.fill("업무");
  await rename.press("Enter");
  await expect(item(page, "업무")).toHaveAttribute("aria-selected", "true");
  await expect(item(page, "업무")).toBeFocused();
  await expect(notes.locator(".folder-head h3")).toHaveText("업무");

  // 고른 폴더 안에 메모가 생기고, 제목에서 Enter를 누르면 본문으로 간다.
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(page.getByLabel("제목", { exact: true })).toBeFocused();
  await page.keyboard.type("회의록");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("본문", { exact: true })).toBeFocused();
  await page.keyboard.type("첫 줄\n둘째 줄");
  await expect(item(page, "회의록")).toHaveAttribute("aria-level", "2");
  await expect(item(page, "업무")).toHaveAttribute("aria-expanded", "true");
  await expect(notes.locator(".notes-crumbs")).toContainText("모든 메모");
  await expect(notes.locator(".notes-crumbs")).toContainText("업무");

  // 두 번째 메모와 하위 폴더.
  await item(page, "업무").click();
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(page.getByLabel("제목", { exact: true })).toBeFocused();
  await page.keyboard.type("할 일");
  await item(page, "업무").click();
  await notes.getByRole("button", { name: "새 폴더" }).first().click();
  await notes.getByLabel("폴더 이름").fill("2026");
  await notes.getByLabel("폴더 이름").press("Enter");
  await expect(item(page, "2026")).toHaveAttribute("aria-level", "2");
  // 폴더가 먼저, 같은 종류끼리는 이름 순.
  await expect(notes.getByRole("treeitem")).toHaveText(["업무2", "2026", "할 일", "회의록"].map((text) => new RegExp(`^${text}$`)));
  await expect(notes.locator(".notes-footer")).toContainText("메모 2개 · 폴더 2개");

  // 빈 메모는 다른 항목으로 옮겨 가면 남지 않는다.
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(notes.getByRole("treeitem", { name: "새 메모" })).toHaveCount(1);
  await item(page, "회의록").click();
  await expect(notes.getByRole("treeitem", { name: "새 메모" })).toHaveCount(0);

  await expect.poll(async () => (await saved(page))?.items?.length).toBe(4);
  const data = await saved(page);
  expect(data.version).toBe(1);
  expect(data.items.find((entry: { title?: string }) => entry.title === "회의록").body).toBe("첫 줄\n\n둘째 줄");

  // 다시 불러와도 창·트리·고른 메모가 그대로다.
  await page.reload();
  await expect(notes).toBeVisible();
  await expect(item(page, "회의록")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#note-body p")).toHaveText(["첫 줄", "둘째 줄"]);
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("회의록");
  // 창을 닫아도 메모는 지워지지 않는다.
  await notes.locator('[data-window-action="close"]').click();
  await expect(notes).toHaveCount(0);
  await page.locator(dock("메모")).click();
  await expect(item(page, "회의록")).toBeVisible();
  expect(errors).toEqual([]);
});

test("메모 창: 끌어서·메뉴로 다른 폴더로 옮기고, 지운 폴더를 되살린다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-idea"] });
  const notes = page.locator(win("notes"));
  await expect(item(page, "주간 회의")).toHaveAttribute("aria-level", "3");
  // 제목이 없는 메모는 본문 첫 줄이 이름이 된다.
  await expect(item(page, "메모 앱 아이콘 아이디어")).toHaveAttribute("aria-level", "2");

  // 끌어서 폴더에 놓는다.
  await item(page, "장보기").dragTo(item(page, "아이디어"));
  await expect(item(page, "장보기")).toHaveAttribute("aria-level", "2");
  // 폴더 안의 메모 위에 놓으면 그 메모가 있는 폴더로 들어간다.
  await item(page, "분기 계획").dragTo(item(page, "회고"));
  await expect(item(page, "분기 계획")).toHaveAttribute("aria-level", "3");
  // 폴더를 제 하위 폴더로는 옮길 수 없다.
  await item(page, "업무").dragTo(item(page, "회의"));
  await expect(item(page, "업무")).toHaveAttribute("aria-level", "1");
  await expect(item(page, "회의")).toHaveAttribute("aria-level", "2");

  // 오른쪽 클릭 메뉴 → 다른 폴더로 이동… → 최상위.
  await item(page, "회고").click({ button: "right" });
  await page.getByRole("menuitem", { name: "다른 폴더로 이동…" }).click();
  const target = page.getByRole("menuitemradio", { name: "최상위" });
  await expect(target).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "회의" })).toHaveAttribute("aria-checked", "true");
  await target.click();
  await expect(item(page, "회고")).toHaveAttribute("aria-level", "1");
  await expect(item(page, "회고")).toBeFocused();
  // 폴더를 옮길 때 제 안의 폴더는 고를 수 없다.
  await item(page, "업무").click({ button: "right" });
  await page.getByRole("menuitem", { name: "다른 폴더로 이동…" }).click();
  await expect(page.getByRole("menuitemradio", { name: "회의" })).toBeDisabled();
  await page.getByRole("menuitemradio", { name: "아이디어" }).click();
  await expect(item(page, "업무")).toHaveAttribute("aria-level", "2");
  await expect(item(page, "주간 회의")).toHaveAttribute("aria-level", "4");

  // 폴더를 지우면 안의 메모도 함께 지워지고, 실행 취소로 되살린다.
  await item(page, "아이디어").click();
  await page.keyboard.press("Delete");
  await expect(notes.getByRole("treeitem")).toHaveText([/^회고$/]);
  const undo = notes.locator(".notes-undo");
  await expect(undo).toContainText("‘아이디어’ 폴더와 메모 4개를 삭제했습니다.");
  await undo.getByRole("button", { name: "실행 취소" }).click();
  await expect(undo).toHaveCount(0);
  await expect(item(page, "주간 회의")).toHaveAttribute("aria-level", "4");
  await expect(item(page, "아이디어")).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await saved(page))?.items?.length).toBe(SAMPLE.length);
  expect(errors).toEqual([]);
});

test("메모 창: 키보드로 트리를 다루고 검색한다", async ({ page }) => {
  await seed(page, SAMPLE);
  const notes = page.locator(win("notes"));
  // 처음에는 폴더가 접혀 있다.
  await expect(notes.getByRole("treeitem")).toHaveCount(3);
  await item(page, "업무").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "업무")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "회의")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "분기 계획")).toBeFocused();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("분기 계획");
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "업무")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "업무")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("End");
  await expect(item(page, "장보기")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("본문", { exact: true })).toBeFocused();
  // F2로 이름을 고치고 Esc로 취소한다.
  await item(page, "아이디어").click();
  await page.keyboard.press("F2");
  await expect(notes.getByLabel("폴더 이름")).toBeFocused();
  await page.keyboard.type("버릴 이름");
  await page.keyboard.press("Escape");
  await expect(item(page, "아이디어")).toBeFocused();
  await page.keyboard.press("F2");
  await notes.getByLabel("폴더 이름").fill("생각");
  await page.keyboard.press("Enter");
  await expect(item(page, "생각")).toBeFocused();

  // 검색은 제목·본문·폴더 이름에서 찾고 위치를 함께 보인다.
  const search = notes.getByLabel("메모 검색");
  await search.fill("끌어서");
  const results = notes.locator(".notes-result");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("주간 회의");
  await expect(results.first()).toContainText("업무 › 회의");
  await results.first().click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("주간 회의");
  await search.fill("없는 낱말");
  await expect(notes.locator(".notes-tree-empty")).toContainText("일치하는 메모가 없습니다");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(item(page, "주간 회의")).toHaveAttribute("aria-selected", "true");
});

test("메모 창: 깨진 저장본도 열린다(순환·없는 부모·모양이 틀린 항목)", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, [
    { id: "a", kind: "folder", parentId: "b", name: "가" },
    { id: "b", kind: "folder", parentId: "a", name: "나" },
    { id: "lost", kind: "note", parentId: "missing", title: "길 잃은 메모" },
    { id: "under-note", kind: "note", parentId: "lost", title: "메모 아래 메모" },
    { id: "", kind: "note", parentId: null, title: "아이디 없음" },
    { id: "odd", kind: "folder" as "note", parentId: null, name: "" },
  ], { selected: "nope", expanded: ["a", "lost", 3] });
  const notes = page.locator(win("notes"));
  // 순환은 끊겨 하나가 최상위로 오르고, 부모가 없거나 메모인 항목도 최상위로 온다.
  await expect(item(page, "길 잃은 메모")).toHaveAttribute("aria-level", "1");
  await expect(item(page, "메모 아래 메모")).toHaveAttribute("aria-level", "1");
  await expect(notes.getByRole("treeitem", { name: "아이디 없음" })).toHaveCount(0);
  await expect(item(page, "새 폴더")).toHaveAttribute("aria-level", "1");
  const levels = await notes.locator('.tree-item[data-kind="folder"]').evaluateAll((rows) => rows.map((row) => `${row.getAttribute("aria-label")}:${row.getAttribute("aria-level")}`));
  expect(levels.filter((entry) => entry.endsWith(":1")).length).toBeGreaterThanOrEqual(2);
  await expect(notes.locator(".notes-footer")).toContainText("메모 2개 · 폴더 3개");
  expect(errors).toEqual([]);
});

test("메모 창: 위쪽 서식 도구로 서식을 넣으면 아래 입력 창에 보이고 Markdown으로 저장된다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // CSP 위반(편집기가 인라인 <style>을 넣는 등)도 콘솔 오류로 잡는다.
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await seed(page, [
    { id: "n", kind: "note", parentId: null, title: "서식 연습", body: "" },
    { id: "untitled", kind: "note", parentId: null, title: "", body: "## 굵은 **제목** 메모\n\n- [ ] 첫 할 일" },
  ], { selected: "n" });
  const notes = page.locator(win("notes"));
  const toolbar = notes.getByRole("toolbar", { name: "서식" });
  const body = page.locator("#note-body");
  const stored = async () => (await saved(page))?.items?.find((entry: { id: string }) => entry.id === "n")?.body as string | undefined;
  // 트리 이름은 Markdown 기호를 걷어 낸 첫 줄이다.
  await expect(item(page, "굵은 제목 메모")).toBeVisible();
  // 서식 도구는 입력 창 위에 있다.
  await expect(toolbar).toBeVisible();
  const bar = await toolbar.boundingBox();
  const input = await body.boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(input!.y);

  await body.click();
  const heading = toolbar.getByRole("button", { name: "제목 1" });
  await expect(toolbar.getByRole("button", { name: "본문 텍스트" })).toHaveAttribute("aria-pressed", "true");
  await heading.click();
  await page.keyboard.type("회의 요약");
  await expect(body.locator("h1")).toHaveText("회의 요약");
  await expect(heading).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  const bold = toolbar.getByRole("button", { name: "굵게" });
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("중요");
  await bold.click();
  await page.keyboard.type(" 그리고 ");
  await page.keyboard.press("Control+i");
  await page.keyboard.type("기울임");
  await page.keyboard.press("Control+i");
  await expect(body.locator("strong")).toHaveText("중요");
  await expect(body.locator("em")).toHaveText("기울임");
  await page.keyboard.press("Enter");
  await toolbar.getByRole("button", { name: "체크리스트" }).click();
  await page.keyboard.type("할 일");
  await expect(body.locator('ul[data-type="taskList"] > li')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  // 글자를 고르고 링크를 넣는다. 프로토콜이 없으면 https를 붙인다.
  await page.keyboard.type("문서");
  await page.keyboard.press("Shift+Home");
  await toolbar.getByRole("button", { name: "링크" }).click();
  const url = page.getByLabel("링크 주소");
  await expect(url).toBeFocused();
  await url.fill("tiptap.dev");
  await url.press("Enter");
  await expect(body.locator("a")).toHaveAttribute("href", "https://tiptap.dev");
  await expect(body).toBeFocused();
  // Ctrl+K도 링크 칸을 연다.
  await page.keyboard.press("Control+k");
  await expect(url).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(url).toHaveCount(0);
  await expect.poll(stored).toContain("[문서](https://tiptap.dev)");
  const markdown = (await stored())!;
  expect(markdown).toContain("# 회의 요약");
  expect(markdown).toContain("**중요** 그리고 *기울임*");
  expect(markdown).toContain("- [ ] 할 일");

  // 표 넣기 → 표 안에서는 행·열 편집 목록.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await toolbar.getByRole("button", { name: "표 넣기" }).click();
  await expect(body.locator("table tr")).toHaveCount(3);
  await toolbar.getByRole("button", { name: "표 편집" }).click();
  await page.getByRole("menuitem", { name: "아래에 행 추가" }).click();
  await expect(body.locator("table tr")).toHaveCount(4);
  await toolbar.getByRole("button", { name: "표 편집" }).click();
  await page.getByRole("menuitem", { name: "표 삭제" }).click();
  await expect(body.locator("table")).toHaveCount(0);

  // Markdown 보기: 원문을 직접 고치고 서식 보기로 돌아오면 그대로 보인다. 보기만 바꿔서는 원문이 바뀌지 않는다.
  await toolbar.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.locator("textarea#note-body");
  await expect(source).toHaveValue(/\[문서\]\(https:\/\/tiptap\.dev\)/);
  await expect(bold).toBeDisabled();
  const raw = "## 원문에서 고침\n\n- [x] 끝난 일\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```";
  await source.fill(raw);
  await expect.poll(stored).toBe(raw);
  await toolbar.getByRole("button", { name: "서식", exact: true }).click();
  await expect(body.locator("h2")).toHaveText("원문에서 고침");
  await expect(body.locator('ul[data-type="taskList"] input[type="checkbox"]')).toBeChecked();
  await expect(body.locator("table th")).toHaveText(["가", "나"]);
  await expect(body.locator("pre code")).toHaveText("const a = 1;");
  expect(await stored()).toBe(raw);
  // 체크 상자를 누르면 원문도 바뀐다.
  await body.locator('ul[data-type="taskList"] input[type="checkbox"]').click();
  await expect.poll(stored).toContain("- [ ] 끝난 일");

  // .md 파일로 내려받으면 제목이 맨 위 제목 1로 들어간다.
  const [download] = await Promise.all([page.waitForEvent("download"), toolbar.getByRole("button", { name: "Markdown 파일로 저장" }).click()]);
  expect(download.suggestedFilename()).toBe("서식 연습.md");
  const file = readFileSync((await download.path())!, "utf8");
  expect(file.startsWith("# 서식 연습\n\n## 원문에서 고침\n")).toBe(true);
  // 편집기가 인라인 <style>을 넣지 않는다(CSP style-src 'self').
  expect(await page.locator("style[data-tiptap-style]").count()).toBe(0);
  expect(errors).toEqual([]);
});

test("메모 창: 예전 평문 메모는 줄바꿈을 지키고, 열어 보기만 해서는 원문이 바뀌지 않는다", async ({ page }) => {
  const plain = "잘된 점: 세션 인계가 빨라짐\n아쉬운 점: 검색 범위\n- 다음에 할 일";
  await seed(page, [{ id: "old", kind: "note", parentId: null, title: "회고", body: plain }], { selected: "old" });
  const body = page.locator("#note-body");
  await expect(body.locator("br")).toHaveCount(1);
  await expect(body.locator("p").first()).toContainText("잘된 점: 세션 인계가 빨라짐");
  await expect(body.locator("ul li")).toHaveText(["다음에 할 일"]);
  await page.waitForTimeout(400);
  expect((await saved(page)).items[0].body).toBe(plain);
});

test("메모 창: 좁은 화면에서는 목록과 내용을 번갈아 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, SAMPLE, { expanded: ["f-work"] });
  const notes = page.locator(win("notes"));
  await expect(notes.locator(".notes-sidebar")).toBeVisible();
  await expect(notes.locator(".notes-content")).toBeHidden();
  await item(page, "분기 계획").click();
  await expect(notes.locator(".notes-sidebar")).toBeHidden();
  await expect(page.getByLabel("본문", { exact: true })).toBeVisible();
  await notes.getByRole("button", { name: "목록", exact: true }).click();
  await expect(notes.locator(".notes-sidebar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("notes-mobile.png") });
});

test("감사용 스크린샷: 메모 창 다크·라이트", async ({ page }) => {
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-idea"], selected: "n-weekly" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(win("notes")).locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("notes-dark.png") });
  await item(page, "업무").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: test.info().outputPath("notes-folder-dark.png") });
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await item(page, "주간 회의").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("notes-light.png") });
  await item(page, "회의").click({ button: "right" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("notes-menu-light.png") });
  await page.keyboard.press("Escape");
  // 보통 크기 창: 사이드바 유리 너머로 바탕화면이 비친다.
  await page.locator(win("notes")).locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("notes-window-light.png") });
});

test("감사용 스크린샷: 서식 편집기와 Markdown 원문", async ({ page }) => {
  const body = "## 이번 주 목표\n\n**Relay 메모장**을 Markdown으로 바꾸고 *서식 도구*를 붙인다. `getMarkdown()`으로 저장.\n\n- 폴더 트리 정리\n- 끌어서 옮기기\n  - 하위 항목\n\n1. 첫째\n2. 둘째\n\n- [x] 서식 도구\n- [ ] 원문 보기\n\n> 인용문은 이렇게 보인다.\n\n```ts\nconst editor = useEditor({ extensions });\n```\n\n| 항목 | 상태 |\n| --- | --- |\n| 굵게 | 완료 |\n| 링크 | [문서](https://tiptap.dev) |";
  await seed(page, [{ id: "n", kind: "note", parentId: null, title: "주간 회의", body }], { selected: "n" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(win("notes")).locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("notes-rich-dark.png") });
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("notes-rich-light.png") });
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: test.info().outputPath("notes-source-light.png") });
});
