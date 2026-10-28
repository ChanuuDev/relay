import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { ready, useRelayServer } from "./web-helpers";

useRelayServer();

const KEY = "relay-notes-v1";
const VIEW_KEY = "relay-notes-view-v1";
const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const item = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
/** DB에 저장된 메모(화면이 보내 둔 것). */
const saved = (page: Page) => page.evaluate(async () => (await fetch("/api/v1/notes", { cache: "no-store" })).json());

type Seed = { id: string; kind: "folder" | "note"; parentId: string | null; name?: string; title?: string; body?: string };
/** 브라우저 저장소에 메모를 넣고 다시 불러온 뒤 메모 창을 연다. */
async function seed(page: Page, items: Seed[], extra: Record<string, unknown> = {}) {
  await ready(page);
  const now = Date.parse("2026-10-22T09:30:00+09:00");
  const full = items.map((entry, index) => ({ createdAt: now + index, updatedAt: now + index * 60000, title: "", body: "", name: "", ...entry }));
  // 첫 화면은 뜬 뒤 조금 있다가 보기 상태(선택 없음)를 따로 저장하고, 새로 고친 화면은 그 값을 넣어 둔 선택보다 앞세운다.
  // 그 저장이 끝난 뒤에 지워야 PC가 느릴 때도 넣어 둔 선택·펼침이 쓰인다.
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, VIEW_KEY)).toBe(true);
  await page.evaluate(([key, value, view]) => { localStorage.setItem(key, value); localStorage.removeItem(view); },
    [KEY, JSON.stringify({ version: 1, items: full, ...extra }), VIEW_KEY] as const);
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
  expect(data.schemaVersion).toBe(1);
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
  // 툴팁은 화살표 없는 유리 말풍선이라 글자를 덮는 것이 없고, 단추와 겹치지 않게 떨어져 뜬다.
  const tableTool = toolbar.getByRole("button", { name: "표 넣기" });
  await tableTool.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toHaveText("표 넣기");
  await expect(tip.locator("svg")).toHaveCount(0);
  const [tipBox, toolBox] = [await tip.boundingBox(), await tableTool.boundingBox()];
  expect(tipBox!.y + tipBox!.height <= toolBox!.y || tipBox!.y >= toolBox!.y + toolBox!.height).toBe(true);
  // Radix는 트리거를 떠난 뒤의 포인터 이동으로 닫으므로 실제 마우스처럼 여러 번에 나눠 옮긴다.
  await page.mouse.move(toolBox!.x, toolBox!.y + 200, { steps: 8 });
  await expect(tip).toHaveCount(0);

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
  // 링크 칸이 닫히고 편집기가 초점을 되찾은 뒤에 이어서 친다(그 전에 친 키는 링크 칸으로 간다).
  await expect(body).toBeFocused();
  await expect.poll(stored).toContain("[문서](https://tiptap.dev)");
  const markdown = (await stored())!;
  expect(markdown).toContain("# 회의 요약");
  expect(markdown).toContain("**중요** 그리고 *기울임*");
  expect(markdown).toContain("- [ ] 할 일");

  // 표 넣기 → 표 안에서는 행·열 편집 목록.
  // 편집기는 커서 이동을 selectionchange로 늦게 받으므로, 선택(링크 글자)이 접힌 것을 확인한 뒤 줄을 바꾼다.
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await expect(body.locator("a")).toHaveText("문서");
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
  await expect.poll(async () => (await saved(page)).items[0]?.body).toBe(plain);
  await page.waitForTimeout(600);
  expect((await saved(page)).items[0].body).toBe(plain);
});

test("메모 창: 메모는 Relay DB에 저장되어 다른 브라우저에서도 같고, 예전 브라우저 저장본은 DB로 옮긴다", async ({ page, browser }) => {
  // 예전 저장본(브라우저에만 있던 메모)은 처음 연결될 때 DB로 올라가고 원본은 백업으로 남는다.
  await seed(page, SAMPLE.slice(0, 3), { selected: "f-work" });
  await expect.poll(async () => (await saved(page)).items.length).toBe(3);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("relay-notes-v1-backup"))).toContain("f-work");
  await expect(page.locator(win("notes")).locator(".notes-sync")).toHaveText("Relay DB에 저장됨");
  // 다른 브라우저(저장소가 다른 새 컨텍스트)에서도 같은 메모가 보인다.
  const other = await browser.newContext();
  const second = await other.newPage();
  try {
    await ready(second);
    await second.locator(dock("메모")).click();
    await expect(second.getByRole("treeitem", { name: "업무", exact: true })).toBeVisible();
    // 그 브라우저에서 만든 메모가 처음 창에도 나타난다(3초마다 저장 번호를 확인한다).
    await second.locator(win("notes")).getByRole("button", { name: "새 메모" }).first().click();
    await expect(second.getByLabel("제목", { exact: true })).toBeFocused();
    await second.keyboard.type("다른 창에서 쓴 메모");
    await expect(second.locator(win("notes")).locator(".notes-sync")).toHaveText("Relay DB에 저장됨");
    await expect(item(page, "다른 창에서 쓴 메모")).toBeVisible({ timeout: 10000 });
  } finally { await other.close(); }
  // 서버를 다시 띄워도(같은 저장소) 그대로다.
  await page.reload();
  await expect(item(page, "다른 창에서 쓴 메모")).toBeVisible();
});

test("메모 창: 모든 메모를 JSON 파일로 내보내고, 다른 PC에서 고친 파일을 가져와 합친다", async ({ page }) => {
  await seed(page, SAMPLE.slice(0, 4), { expanded: ["f-work", "f-meet"] });
  await expect.poll(async () => (await saved(page)).items.length).toBe(4);
  const notes = page.locator(win("notes"));
  const toast = notes.locator(".notes-undo");
  const menu = async () => {
    await notes.getByRole("button", { name: "내보내기·가져오기" }).click();
    await expect(page.getByRole("menuitem", { name: "모든 메모 내보내기" })).toBeVisible();
  };
  await menu();
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath("notes-transfer-menu.png") });
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "모든 메모 내보내기" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^relay-notes-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8")) as { format: string; items: Array<Record<string, unknown>> };
  expect(exported).toMatchObject({ format: "relay-notes", schemaVersion: 1 });
  expect(exported.items.map((entry) => entry.id).sort()).toEqual(["f-idea", "f-meet", "f-work", "n-weekly"]);
  await expect(toast).toContainText(`‘${file.suggestedFilename()}’ 내보내기 완료 · 메모 1개 · 폴더 3개`);
  await expect(notes.getByRole("button", { name: "내보내기·가져오기" })).toBeFocused();

  // 다른 PC에서 주간 회의를 더 나중에 고치고 새 메모를 하나 더한 파일. 폴더 셋은 그대로다.
  const changed = { ...exported, items: [
    ...exported.items.map((entry) => (entry.id === "n-weekly" ? { ...entry, body: "다른 PC에서 고친 본문", updatedAt: Number(entry.updatedAt) + 3_600_000 } : entry)),
    { id: "n-moved", kind: "note", parentId: "f-idea", title: "다른 PC 메모", body: "옮겨 온 메모", createdAt: Date.now(), updatedAt: Date.now() },
  ] };
  await menu();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "메모 가져오기…" }).click();
  await (await chooser).setFiles({ name: "relay-notes-other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(toast).toContainText("‘relay-notes-other.json’ 가져오기 완료 · 추가 1 · 갱신 1 · 그대로 3");
  await item(page, "아이디어").click();
  await expect(item(page, "다른 PC 메모")).toBeVisible();
  await item(page, "주간 회의").click();
  await expect(page.getByLabel("본문", { exact: true })).toContainText("다른 PC에서 고친 본문");
  await page.screenshot({ path: test.info().outputPath("notes-import.png") });

  // 같은 파일을 다시 가져오면 바뀌는 것이 없다. 형식이 틀린 파일은 아무것도 바꾸지 않고 이유를 알린다.
  await page.locator("#notes-import-file").setInputFiles({ name: "again.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(toast).toContainText("‘again.json’의 항목이 이미 모두 있습니다 · 그대로 5");
  await page.locator("#notes-import-file").setInputFiles({ name: "sessions.json", mimeType: "application/json", buffer: Buffer.from('{"schemaVersion":1,"items":[]}') });
  await expect(notes.locator(".notes-undo[data-tone=error]")).toContainText("가져오지 못했습니다: Relay에서 내보낸 메모 파일이 아닙니다.");
  await page.locator("#notes-import-file").setInputFiles({ name: "memo.txt", mimeType: "text/plain", buffer: Buffer.from("그냥 글") });
  await expect(notes.locator(".notes-undo[data-tone=error]")).toContainText("JSON 파일이 아닙니다");
  await page.screenshot({ path: test.info().outputPath("notes-import-error.png") });
  expect((await saved(page)).items).toHaveLength(5);
});

test("메모 창: 빈 메모장에서 다른 PC의 메모 파일을 가져온다", async ({ page }) => {
  await ready(page);
  await page.locator(dock("메모")).click();
  const notes = page.locator(win("notes"));
  await expect(notes.getByRole("button", { name: "가져오기", exact: true })).toBeVisible();
  const now = Date.now();
  const file = { format: "relay-notes", schemaVersion: 1, exportedAt: new Date(now).toISOString(), items: [
    { id: "f-home", kind: "folder", parentId: null, name: "집", createdAt: now, updatedAt: now },
    { id: "n-list", kind: "note", parentId: "f-home", title: "할 일", body: "- [ ] 화분 물 주기", createdAt: now, updatedAt: now },
  ] };
  const chooser = page.waitForEvent("filechooser");
  await notes.getByRole("button", { name: "가져오기", exact: true }).click();
  await (await chooser).setFiles({ name: "home.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(notes.locator(".notes-undo")).toContainText("‘home.json’ 가져오기 완료 · 추가 2 · 갱신 0 · 그대로 0");
  await item(page, "집").click();
  await expect(item(page, "할 일")).toBeVisible();
  expect((await saved(page)).items).toHaveLength(2);
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
