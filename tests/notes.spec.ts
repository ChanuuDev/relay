import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { cli, env, ready, useRelayServer } from "./web-helpers";

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
  // 새 메모·폴더는 그 폴더의 맨 위에 생긴다(나중에 만든 것이 위).
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

test("메모 창: 끌어서·Alt+화살표로 순서를 바꾸면 다시 열어도 남고, 새 메모는 그 폴더 맨 위에 생긴다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-idea"] });
  const notes = page.locator(win("notes"));
  const order = () => notes.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
  // 순서를 정하기 전에는 예전처럼 폴더가 먼저, 같은 종류끼리는 이름 순이다.
  await expect.poll(order).toEqual(["아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "주간 회의", "회고", "분기 계획", "장보기"]);
  const edge = async (name: string, where: "top" | "bottom") => {
    const box = (await item(page, name).boundingBox())!;
    return { x: 60, y: where === "top" ? 2 : box.height - 2 };
  };
  // 행의 위쪽 가장자리에 놓으면 그 앞에, 아래쪽 가장자리에 놓으면 그 뒤에 끼운다. 끄는 동안 놓일 자리에 선이 보인다.
  const source = item(page, "장보기");
  await source.hover();
  await page.mouse.down();
  await item(page, "아이디어").hover({ position: await edge("아이디어", "top") });
  await item(page, "아이디어").hover({ position: { x: 61, y: 2 } });
  await expect(item(page, "아이디어")).toHaveAttribute("data-drop-line", "before");
  await page.mouse.up();
  await expect.poll(order).toEqual(["장보기", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "주간 회의", "회고", "분기 계획"]);
  await item(page, "회고").dragTo(item(page, "주간 회의"), { targetPosition: await edge("주간 회의", "top") });
  await expect.poll(order).toEqual(["장보기", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "회고", "주간 회의", "분기 계획"]);
  // 다른 폴더의 행 경계에 놓으면 그 폴더로 옮겨 그 자리에 들어간다.
  await item(page, "분기 계획").dragTo(item(page, "장보기"), { targetPosition: await edge("장보기", "bottom") });
  await expect.poll(order).toEqual(["장보기", "분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "회고", "주간 회의"]);
  await expect(item(page, "분기 계획")).toHaveAttribute("aria-level", "1");
  // 폴더 가운데에 놓으면 그 폴더의 맨 위로 들어간다.
  await item(page, "장보기").dragTo(item(page, "회의"));
  await expect.poll(order).toEqual(["분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "장보기", "회고", "주간 회의"]);
  // Alt+↑/↓는 같은 폴더 안에서 한 칸씩 옮긴다.
  await item(page, "주간 회의").click();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual(["분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "주간 회의", "장보기", "회고"]);
  await expect(item(page, "주간 회의")).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual(["분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "회의", "주간 회의", "장보기", "회고"]);
  // 고른 폴더 안의 새 메모는 그 폴더 맨 위에 생긴다.
  await item(page, "업무").click();
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(page.getByLabel("제목", { exact: true })).toBeFocused();
  await page.keyboard.type("새 계획");
  await expect.poll(order).toEqual(["분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "새 계획", "회의", "주간 회의", "장보기", "회고"]);
  // 순서는 DB에 남아 다시 열어도 그대로다.
  await expect.poll(async () => ((await saved(page)).items as Array<{ title: string; position: number | null }>).find((entry) => entry.title === "새 계획")?.position ?? null).not.toBeNull();
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect.poll(order).toEqual(["분기 계획", "아이디어", "메모 앱 아이콘 아이디어", "업무", "새 계획", "회의", "주간 회의", "장보기", "회고"]);
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
  // 폴더 안의 메모 위에 놓으면 그 메모 옆(그 메모가 있는 폴더)으로 들어간다.
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
  // 툴팁이 나타나며 움직이는 동안의 좌표 대신, 단추와 떨어진 최종 위치를 확인한다.
  await expect.poll(async () => {
    const [tipBox, toolBox] = await Promise.all([tip.boundingBox(), tableTool.boundingBox()]);
    return !!tipBox && !!toolBox && (tipBox.y + tipBox.height <= toolBox.y || tipBox.y >= toolBox.y + toolBox.height);
  }).toBe(true);
  const toolBox = await tableTool.boundingBox();
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
  await expect(url).toHaveCount(0);
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

type DropFile = { name: string; text?: string; bytes?: number[]; type?: string };
/** 탐색기에서 파일을 끌어 놓듯 element의 (fx, fy) 비율 자리에 dragenter·dragover·drop을 차례로 보낸다. fy가 "line1"이면 글 칸의 첫 줄 높이다.
 *  stop이 "over"면 놓기 전에 멈춘다. */
async function dropFiles(target: Locator, files: DropFile[], at: { fx?: number; fy?: number | "line1" } = {}, stop: "over" | "drop" = "drop") {
  await target.evaluate((element, [list, fx, fy, end]) => {
    const data = new DataTransfer();
    for (const file of list) data.items.add(new File([file.bytes ? new Uint8Array(file.bytes) : file.text ?? ""], file.name, { type: file.type ?? "" }));
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const y = fy === "line1" ? rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 : rect.top + rect.height * fy;
    const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + rect.width * fx, clientY: y };
    element.dispatchEvent(new DragEvent("dragenter", init));
    element.dispatchEvent(new DragEvent("dragover", init));
    if (end === "drop") element.dispatchEvent(new DragEvent("drop", init));
  }, [files, at.fx ?? 0.5, at.fy ?? 0.5, stop] as const);
}

test("메모 창: 트리에 끌어 놓은 txt·md 파일은 그 자리에 메모가 되고, 본문 칸에 놓으면 내용만 들어간다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-idea"] });
  const notes = page.locator(win("notes"));
  const order = () => notes.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => `${row.getAttribute("aria-level")}:${row.getAttribute("aria-label")}`));
  const stored = async (title: string) => ((await saved(page)).items as Array<{ title: string; body: string; parentId: string | null }>).find((entry) => entry.title === title);

  // 폴더 가운데로 끌고 오면 그 폴더가 놓을 곳으로 보이고, 놓으면 파일마다 메모가 그 폴더 맨 위에 파일 순서대로 생긴다.
  // txt는 파일 이름이 제목이고, md가 제목 1로 시작하면 그 줄이 제목이 된다. 첫 메모가 열린다.
  const files: DropFile[] = [
    { name: "할 일.txt", text: "﻿출시 전 점검\r\n- 아이콘 확인\r\n", type: "text/plain" },
    { name: "agenda.md", text: "# 3분기 회의\n\n- 안건 **정리**\n" },
  ];
  await dropFiles(item(page, "회의"), files, {}, "over");
  await expect(item(page, "회의")).toHaveAttribute("data-drop", "");
  await dropFiles(item(page, "회의"), files);
  await expect.poll(order).toEqual(["1:아이디어", "2:메모 앱 아이콘 아이디어", "1:업무", "2:회의", "3:할 일", "3:3분기 회의", "3:주간 회의", "3:회고", "2:분기 계획", "1:장보기"]);
  await expect(item(page, "회의")).not.toHaveAttribute("data-drop", "");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("할 일");
  await expect(notes.locator(".notes-undo")).toContainText("메모 2개를 만들었습니다");
  await expect.poll(async () => await stored("할 일")).toMatchObject({ parentId: "f-meet", body: "출시 전 점검\n- 아이콘 확인" });
  await expect.poll(async () => await stored("3분기 회의")).toMatchObject({ parentId: "f-meet", body: "- 안건 **정리**" });

  // 메모 행의 아래쪽 가장자리에 놓으면 그 뒤에 끼운다. BOM 없는 CP949(Windows 메모장) 파일도 읽고, 글 파일이 아닌 것은 건너뛴다.
  await dropFiles(item(page, "장보기"), [
    { name: "메모장.txt", bytes: [0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xb8, 0xde, 0xb8, 0xf0] },
    { name: "사진.png", bytes: [0x89, 0x50, 0x4e, 0x47], type: "image/png" },
  ], { fx: 0.3, fy: 0.9 });
  await expect.poll(order).toEqual(["1:아이디어", "2:메모 앱 아이콘 아이디어", "1:업무", "2:회의", "3:할 일", "3:3분기 회의", "3:주간 회의", "3:회고", "2:분기 계획", "1:장보기", "1:메모장"]);
  await expect(notes.locator(".notes-undo")).toContainText("‘메모장’ 메모를 만들었습니다 · txt·md가 아닌 파일 1개는 건너뜀");
  await expect.poll(async () => (await stored("메모장"))?.body).toBe("한글 메모");
  // 그림만 끌고 오면 놓을 곳을 보이지 않고, 글 파일이 없는 놓기는 안내만 한다.
  await dropFiles(item(page, "업무"), [{ name: "사진.png", bytes: [0x89, 0x50], type: "image/png" }], {}, "over");
  await expect(item(page, "업무")).not.toHaveAttribute("data-drop", "");
  await dropFiles(item(page, "업무"), [{ name: "보고서.pdf", bytes: [0x25, 0x50, 0x44, 0x46], type: "" }]);
  await expect(notes.locator(".notes-undo")).toContainText("txt·md 파일만 메모로 넣을 수 있습니다.");
  await expect(notes.getByRole("treeitem")).toHaveCount(11);

  // 서식 보기의 본문 칸에 놓으면 파일이 아니라 내용만 놓은 자리에 들어가고, md는 서식으로 보인다.
  await item(page, "장보기").click();
  const prose = notes.locator(".note-prose");
  await expect(prose).toContainText("우유, 달걀, 커피 원두");
  await dropFiles(prose.locator("p").last(), [{ name: "추가.md", text: "# 주말\n\n- **빵**\n- 과일\n" }], { fx: 0.99 });
  await expect(prose.locator("h1")).toHaveText("주말");
  await expect(prose.locator("li strong")).toHaveText("빵");
  await expect(notes.getByRole("treeitem")).toHaveCount(11);
  await expect.poll(async () => (await stored("장보기"))?.body).toMatch(/^우유, 달걀, 커피 원두\n\n# 주말\n\n- \*\*빵\*\*\n- 과일\s*$/);
  await expect(prose).not.toContainText("추가.md");

  // Markdown 보기에서는 놓은 자리(여기서는 첫 줄 끝)에 내용이 글자 그대로 들어간다.
  await notes.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = notes.locator("textarea#note-body");
  await source.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 0); });
  await dropFiles(source, [{ name: "덧붙임.txt", text: " · **두부**\n\n" }], { fx: 0.97, fy: "line1" });
  await expect(source).toHaveValue(/^우유, 달걀, 커피 원두 · \*\*두부\*\*\n\n# 주말/);
  await expect.poll(async () => (await stored("장보기"))?.body).toMatch(/^우유, 달걀, 커피 원두 · \*\*두부\*\*\n\n# 주말/);
  expect(errors).toEqual([]);
});

/** 탐색기에서 파일을 복사해 target에 초점을 두고 Ctrl+V 한 것처럼 paste를 보낸다. */
async function pasteFiles(target: Locator, files: DropFile[]) {
  await target.evaluate((element, list) => {
    const data = new DataTransfer();
    for (const file of list) data.items.add(new File([file.bytes ? new Uint8Array(file.bytes) : file.text ?? ""], file.name, { type: file.type ?? "" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, files);
}

test("메모 창: 탐색기에서 복사한 txt·md 파일을 트리에서 붙여 넣으면 메모가 되고, 본문 칸에서 붙여 넣으면 내용만 들어간다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-idea"] });
  const notes = page.locator(win("notes"));
  const order = () => notes.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => `${row.getAttribute("aria-level")}:${row.getAttribute("aria-label")}`));
  const stored = async (title: string) => ((await saved(page)).items as Array<{ title: string; body: string; parentId: string | null }>).find((entry) => entry.title === title);

  // 폴더를 누르고 붙여 넣으면 그 폴더 맨 위에 파일 순서대로 메모가 생기고 첫 메모가 열린다.
  await item(page, "회의").click();
  await expect(item(page, "회의")).toBeFocused();
  await pasteFiles(item(page, "회의"), [
    { name: "점검.txt", text: "출시 전 점검\r\n- 아이콘\r\n", type: "text/plain" },
    { name: "agenda.md", text: "# 3분기 회의\n\n- 안건\n" },
  ]);
  await expect.poll(order).toEqual(["1:아이디어", "2:메모 앱 아이콘 아이디어", "1:업무", "2:회의", "3:점검", "3:3분기 회의", "3:주간 회의", "3:회고", "2:분기 계획", "1:장보기"]);
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("점검");
  await expect.poll(async () => await stored("점검")).toMatchObject({ parentId: "f-meet", body: "출시 전 점검\n- 아이콘" });
  await expect.poll(async () => await stored("3분기 회의")).toMatchObject({ parentId: "f-meet", body: "- 안건" });

  // 메모를 누르고 붙여 넣으면 그 메모 바로 다음에 생긴다. 글 파일이 아니면 안내만 한다.
  await item(page, "분기 계획").click();
  await pasteFiles(item(page, "분기 계획"), [{ name: "예산.md", text: "예산 초안" }]);
  await expect.poll(order).toEqual(["1:아이디어", "2:메모 앱 아이콘 아이디어", "1:업무", "2:회의", "3:점검", "3:3분기 회의", "3:주간 회의", "3:회고", "2:분기 계획", "2:예산", "1:장보기"]);
  await expect.poll(async () => await stored("예산")).toMatchObject({ parentId: "f-work", body: "예산 초안" });
  await item(page, "장보기").click();
  await pasteFiles(item(page, "장보기"), [{ name: "사진.png", bytes: [0x89, 0x50], type: "image/png" }]);
  await expect(notes.locator(".notes-undo")).toContainText("txt·md 파일만 메모로 넣을 수 있습니다.");
  await expect(notes.getByRole("treeitem")).toHaveCount(11);

  // 서식 보기의 본문 칸에서 붙여 넣으면 파일이 아니라 내용만 커서 자리에 들어가고, md는 서식으로 보인다.
  const prose = notes.locator(".note-prose");
  await expect(prose).toContainText("우유, 달걀, 커피 원두");
  await prose.locator("p").last().click();
  await page.keyboard.press("End");
  await pasteFiles(prose, [{ name: "추가.md", text: "\n- **빵**\n- 과일\n" }]);
  await expect(prose.locator("li strong")).toHaveText("빵");
  await expect.poll(async () => (await stored("장보기"))?.body).toMatch(/^우유, 달걀, 커피 원두\n+- \*\*빵\*\*\n- 과일\s*$/);
  await expect(notes.getByRole("treeitem")).toHaveCount(11);

  // Markdown 보기에서도 커서 자리에 글자 그대로 들어간다.
  await notes.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = notes.locator("textarea#note-body");
  await source.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 0); });
  await pasteFiles(source, [{ name: "머리말.txt", text: "**장보기 목록**\n\n" }]);
  await expect(source).toHaveValue(/^\*\*장보기 목록\*\*우유, 달걀/);
  await expect.poll(async () => (await stored("장보기"))?.body).toMatch(/^\*\*장보기 목록\*\*우유, 달걀, 커피 원두/);
  await expect(notes.getByRole("treeitem")).toHaveCount(11);
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

test("메모 창: 메모·폴더 ID를 복사해 AI 에이전트에 넘기고, 에이전트가 relay memo로 읽어 메모 API로 고친 내용이 열린 편집기에 보인다", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await seed(page, SAMPLE, { selected: "n-weekly", expanded: ["f-work", "f-meet"] });
  await expect.poll(async () => (await saved(page)).items.length).toBe(SAMPLE.length);
  const notes = page.locator(win("notes"));
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  // 왼쪽 트리에서 메모를 우클릭하면 「메모 ID 복사」, 폴더는 「폴더 ID 복사」가 있다. 클립보드에는 참조해 달라는 한 줄과 ID가 들어간다.
  await item(page, "회고").click({ button: "right" });
  await page.getByRole("menuitem", { name: "메모 ID 복사" }).click();
  await expect.poll(clipboard).toBe("Relay 메모를 참조해 주세요. 메모 ID: n-retro");
  await expect(notes.locator(".notes-undo")).toContainText("메모 ID를 복사했습니다");
  await item(page, "회의").click({ button: "right" });
  await page.getByRole("menuitem", { name: "폴더 ID 복사" }).click();
  await expect.poll(clipboard).toBe("Relay 메모 폴더를 참조해 주세요. 폴더 ID: f-meet");
  // 오른쪽 내용 막대의 「ID 복사」 단추와, 막대를 우클릭해 여는 메뉴도 같다.
  await item(page, "주간 회의").click();
  await notes.getByRole("button", { name: "메모 ID 복사" }).click();
  await expect.poll(clipboard).toBe("Relay 메모를 참조해 주세요. 메모 ID: n-weekly");
  await item(page, "업무").click();
  await notes.locator(".folder-view .notes-content-bar").click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("menuitem", { name: "폴더 ID 복사" }).click();
  await expect.poll(clipboard).toBe("Relay 메모 폴더를 참조해 주세요. 폴더 ID: f-work");
  await item(page, "주간 회의").click();

  // 에이전트는 받은 ID로 읽는다. 폴더는 그 아래 메모를 본문까지 함께 받는다.
  const found = cli(["memo", "--find", "n-weekly"]);
  expect(found.item).toMatchObject({ id: "n-weekly", kind: "note", parentId: "f-meet", title: "주간 회의" });
  expect(found.path.map((folder: { name: string }) => folder.name)).toEqual(["업무", "회의"]);
  expect(cli(["memo", "--find", "f-meet"]).items.map((entry: { item: { id: string } }) => entry.item.id).sort()).toEqual(["n-retro", "n-weekly"]);
  expect(cli(["memo", "--search", "세션 인계"]).items.map((hit: { id: string }) => hit.id)).toEqual(["n-retro"]);
  // relay-memo 스킬이 안내하는 요청 그대로 고친다. 열어 둔 편집기는 저장 번호를 보고 몇 초 안에 새 본문을 그린다.
  const response = await request.post(`${env.url}/api/v1/notes`, { headers: { Origin: env.url, "Content-Type": "application/json" },
    data: JSON.stringify({ upserts: [{ ...found.item, body: `${found.item.body}\n- 에이전트가 더한 줄`, updatedAt: Date.now() }], deletes: [] }) });
  expect(response.status()).toBe(200);
  await expect(notes.locator(".note-prose")).toContainText("에이전트가 더한 줄", { timeout: 10000 });
  await expect(notes.locator(".notes-sync")).toHaveText("Relay DB에 저장됨");
  expect((await saved(page)).items.find((entry: { id: string }) => entry.id === "n-weekly").body).toBe(`${found.item.body}\n- 에이전트가 더한 줄`);
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

test("메모 창: 본문이 창보다 길면 내용 패널은 창 안에 머물고 본문 영역이 스크롤된다", async ({ page }) => {
  const body = Array.from({ length: 80 }, (_, index) => `${index + 1}번째 줄: 긴 메모의 본문`).join("\n\n");
  await seed(page, [{ id: "long", kind: "note", parentId: null, title: "긴 메모", body }], { selected: "long" });
  const notes = page.locator(win("notes"));
  const scroll = notes.locator(".note-scroll");
  const last = notes.locator("#note-body p").last();
  await expect(last).toContainText("80번째 줄");
  for (const mode of ["서식", "Markdown"]) {
    await notes.getByRole("button", { name: mode, exact: true }).click();
    // 내용 패널이 본문 높이만큼 늘어나 창 밖으로 잘리지 않는다.
    const [main, content] = await Promise.all([notes.locator("#notes-main").boundingBox(), notes.locator(".notes-content").boundingBox()]);
    expect(content!.y + content!.height).toBeLessThanOrEqual(main!.y + main!.height + 1);
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
    await scroll.hover();
    await page.mouse.wheel(0, 20000);
    await expect.poll(() => scroll.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)).toBe(true);
    await scroll.evaluate((el) => { el.scrollTop = 0; });
  }
  await expect(page.getByLabel("본문", { exact: true })).toHaveValue(/80번째 줄/);
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

/** 캔버스로 그린 PNG를 실제 클립보드에 넣는다. 색이 다르면 다른 그림(다른 id)이다. */
async function copyPicture(page: Page, color: string) {
  await page.evaluate(async (fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d")!;
    context.fillStyle = fill; context.fillRect(0, 0, 320, 180);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob! })]);
  }, color);
}
const IMAGE = /!\[\]\(\/api\/v1\/notes\/images\/[0-9a-f]{64}\)/;

test("메모 창: 붙여 넣은 그림은 서버에 올려 본문에 넣고, Mermaid 코드 블록은 다이어그램으로 그린다", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await ready(page);
  await page.locator(dock("메모")).click();
  const notes = page.locator(win("notes"));
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(page.getByLabel("제목", { exact: true })).toBeFocused();
  await page.keyboard.type("그림과 다이어그램");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("본문", { exact: true })).toBeFocused();
  await page.keyboard.type("캡처");
  await page.keyboard.press("Enter");

  // 화면 캡처처럼 그림만 든 클립보드를 붙여 넣으면 그 자리에 그림이 들어가고, 커서는 그림 다음 줄에 남는다.
  await copyPicture(page, "#0f9478");
  await page.keyboard.press("Control+V");
  const image = notes.locator(".note-prose img.note-image");
  await expect(image).toHaveAttribute("src", /^\/api\/v1\/notes\/images\/[0-9a-f]{64}$/);
  await expect(notes.locator(".note-image-uploading")).toHaveCount(0);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(320);
  await page.keyboard.type("다음 줄");
  const body = async () => ((await saved(page)).items as Array<{ title: string; body: string }>).find((entry) => entry.title === "그림과 다이어그램")?.body ?? "";
  await expect.poll(body).toMatch(new RegExp(`^캡처\\n\\n${IMAGE.source}\\n\\n다음 줄`));
  const src = (await image.getAttribute("src"))!;
  const served = await page.request.get(env.url + src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");

  // 도구 단추로 넣은 다이어그램은 코드가 열린 채 그려지고, Esc로 코드를 닫는다.
  await page.keyboard.press("Enter");
  await notes.getByRole("button", { name: "Mermaid 다이어그램 넣기" }).click();
  const diagram = notes.locator(".note-diagram");
  await expect(diagram).toHaveAttribute("data-state", "ready", { timeout: 30000 });
  await expect(diagram.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(diagram.locator("img")).toHaveAttribute("alt", "Mermaid 다이어그램 (flowchart LR)");
  await expect(diagram).toHaveClass(/is-editing/);
  await expect(diagram.locator(".note-diagram-source")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(diagram).not.toHaveClass(/is-editing/);
  await expect(diagram.locator(".note-diagram-source")).toBeHidden();
  await expect.poll(body).toContain("```mermaid\nflowchart LR\n  A[아이디어] --> B{검토}");

  // 다이어그램을 누르면 코드가 다시 열리고, 문법이 틀리면 오류를 보이며 고치면 다시 그린다.
  await diagram.locator(".note-diagram-preview").click();
  await expect(diagram).toHaveClass(/is-editing/);
  await page.keyboard.type(" -->");
  await expect(diagram).toHaveAttribute("data-state", "error", { timeout: 15000 });
  await expect(diagram.getByRole("alert")).toContainText(/Parse error|error/i);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  await expect(diagram).toHaveAttribute("data-state", "ready", { timeout: 15000 });

  // Markdown 보기에서도 그림을 붙여 넣으면 커서 자리에 그림 한 줄이 들어가고, 서식 보기로 돌아오면 그림 둘과 다이어그램이 보인다.
  await notes.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = notes.locator("textarea#note-body");
  await source.focus();
  await source.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await copyPicture(page, "#3a6ff7");
  await page.keyboard.press("Control+V");
  await expect(source).toHaveValue(new RegExp(`\`\`\`\\n+${IMAGE.source}\\n$`));
  await notes.getByRole("button", { name: "서식", exact: true }).click();
  await expect(image).toHaveCount(2);
  await expect(diagram).toHaveAttribute("data-state", "ready", { timeout: 30000 });

  // 새로 고쳐도 그림과 다이어그램이 남는다.
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("메모")).click();
  await item(page, "그림과 다이어그램").click();
  await expect(image).toHaveCount(2);
  await expect(diagram).toHaveAttribute("data-state", "ready", { timeout: 30000 });
  await expect.poll(() => image.first().evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
  expect(errors).toEqual([]);
});

test("메모 창: 글과 그림이 함께 든 클립보드는 글을 붙이고, 그림 단추로 고른 파일은 커서 자리에 넣는다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await seed(page, [{ id: "n", kind: "note", parentId: null, title: "표", body: "첫 줄" }], { selected: "n" });
  const notes = page.locator(win("notes"));
  await page.locator(".note-prose").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  // 엑셀처럼 글과 그 글을 찍은 그림을 함께 넣으면 글이 들어간다.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 10; canvas.height = 10;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob!, "text/plain": new Blob(["가\t나"], { type: "text/plain" }) })]);
  });
  await page.keyboard.press("Control+V");
  await expect(notes.locator(".note-prose")).toContainText("가");
  await expect(notes.locator(".note-prose img.note-image")).toHaveCount(0);
  // 그림 넣기 단추는 파일 고르기 창을 연다.
  const chooser = page.waitForEvent("filechooser");
  await notes.getByRole("button", { name: "그림 넣기" }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(notes.locator(".note-prose img.note-image")).toHaveCount(1);
  await expect.poll(async () => ((await saved(page)).items as Array<{ id: string; body: string }>).find((entry) => entry.id === "n")?.body).toMatch(IMAGE);
  // 받지 않는 파일(글)은 안내만 보인다.
  const again = page.waitForEvent("filechooser");
  await notes.getByRole("button", { name: "그림 넣기" }).click();
  await (await again).setFiles({ name: "note.png", mimeType: "image/png", buffer: Buffer.from("not really a picture") });
  await expect(notes.locator(".notes-undo[role=alert]")).toContainText("그림을 넣지 못했습니다");
  await expect(notes.locator(".note-prose img.note-image")).toHaveCount(1);
});

/** GitHub Markdown 양식을 고루 담은 본문. 바깥 그림(배지)은 테스트에서 가짜 응답으로 채운다. */
const GFM = [
  "# 양식 견본",
  "",
  "[![CI](https://badge.example/ci.svg)](https://github.com) ![License](https://badge.example/license.svg)",
  "",
  "## 글자",
  "",
  "<kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>형광</mark>, <ins>밑줄</ins> :rocket: 색 `#0969DA`",
  "",
  "> [!WARNING]",
  "> 경고 알림입니다.",
  "",
  "### 정렬한 표",
  "",
  "| 왼쪽 | 가운데 | 오른쪽 |",
  "| :--- | :---: | ---: |",
  "| a | b | c |",
  "",
  "수식 $E = mc^2$ 와 $`\\sqrt{2}`$ 그리고 돈 $5 와 $10",
  "",
  "$$",
  "\\frac{1}{3}",
  "$$",
  "",
  "각주가 있는 문장[^note].",
  "",
  "<details>",
  "<summary>펼쳐 보기</summary>",
  "",
  "접힌 **내용**",
  "",
  "</details>",
  "",
  "<p align=\"center\"><b>가운데</b></p>",
  "",
  "<div align=\"center\">",
  "",
  "#### 감싼 제목",
  "",
  "</div>",
  "",
  "<!-- 숨은 주석 -->",
  "",
  "```geojson",
  "{\"type\":\"Point\",\"coordinates\":[126.97,37.56]}",
  "```",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "[^note]: 각주 설명 [표로 가기](#정렬한-표)",
].join("\n");

test("메모 창: GitHub Markdown 양식(알림·정렬 표·수식·각주·접기·HTML·이모지·지도·배지)을 그리고 원문 그대로 저장한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="#4c1"/></svg>';
  await page.route("https://badge.example/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg }));
  await seed(page, [{ id: "g", kind: "note", parentId: null, title: "GFM", body: GFM }], { selected: "g" });
  const prose = page.locator(".note-prose");
  // 링크 건 배지와 바깥(https) 그림
  await expect(prose.locator('a[href="https://github.com"] img.note-image')).toHaveAttribute("src", "https://badge.example/ci.svg");
  await expect.poll(() => prose.locator("img.note-image").nth(1).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(60);
  // 글자 서식·이모지·색상 견본
  await expect(prose.locator("kbd").first()).toHaveText("Ctrl");
  await expect(prose.locator("sub")).toHaveText("2");
  await expect(prose.locator("sup").filter({ hasText: "2" })).toHaveCount(1);
  await expect(prose.locator("mark")).toHaveText("형광");
  await expect(prose.locator("ins")).toHaveText("밑줄");
  await expect(prose.locator(".md-emoji")).toHaveText("🚀");
  await expect(prose.locator(".md-swatch")).toHaveCount(1);
  // 알림 상자·정렬한 표·제목 앵커
  await expect(prose.locator('.md-alert[data-alert="warning"] .md-alert-title')).toHaveText("경고");
  await expect(prose.locator('td[align="center"]')).toHaveText("b");
  await expect(prose.locator('th[align="right"]')).toHaveText("오른쪽");
  await expect(prose.locator("h3")).toHaveAttribute("id", "md-정렬한-표");
  // 수식(돈 표시는 수식이 아니다)·각주·접기·HTML
  await expect(prose.locator(".md-math math")).toHaveCount(2);
  await expect(prose.locator(".md-math-display math")).toHaveCount(1);
  await expect(prose).toContainText("돈 $5 와 $10");
  await expect(prose.locator('.md-fnref[data-index="1"]')).toHaveCount(1);
  await expect(prose.locator('.md-footnote[data-index="1"]')).toContainText("각주 설명");
  await expect(prose.locator('[data-type="details"] summary')).toHaveText("펼쳐 보기");
  await expect(prose.locator('[data-type="detailsContent"]')).toBeHidden();
  await prose.locator('[data-type="details"] > button').click();
  await expect(prose.locator('[data-type="detailsContent"] strong')).toHaveText("내용");
  await expect(prose.locator('.md-html p[align="center"] b')).toHaveText("가운데");
  await expect(prose.locator(".md-html-chip")).toHaveText("HTML 주석");
  // <div align="center"> 안의 Markdown은 그 정렬을 따른다.
  await expect(prose.locator('.md-container-body[align="center"] h4')).toHaveText("감싼 제목");
  await expect.poll(() => prose.locator(".md-container-body h4").evaluate((node) => getComputedStyle(node).textAlign)).toMatch(/center$/);
  await expect(prose.locator('.note-diagram[data-kind="geojson"] svg circle')).toHaveCount(1);
  await expect(prose.locator('pre[data-language="ts"] .hljs-keyword')).toHaveText("const");

  // 각주 번호를 누르면 설명으로, 설명 안의 #링크를 Ctrl과 함께 누르면 그 제목으로 옮긴다.
  await prose.locator(".md-fnref").click();
  await expect(prose.locator(".md-footnote")).toBeInViewport();
  await expect(prose.locator("h3")).not.toBeInViewport();
  await prose.locator(".md-footnote").getByRole("link", { name: "표로 가기" }).click({ modifiers: ["Control"] });
  await expect(prose.locator("h3")).toBeInViewport();
  // 부드럽게 옮기는 동안 누르지 않도록 멈출 때까지 기다린다.
  await expect.poll(async () => { const top = await prose.locator("h3").evaluate((node) => node.getBoundingClientRect().top); await page.waitForTimeout(120); return top === await prose.locator("h3").evaluate((node) => node.getBoundingClientRect().top); }).toBe(true);

  // 저장한 원문은 같은 양식 그대로 남고, 다시 읽어 다시 써도 같다.
  await prose.locator("h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  const body = async () => ((await saved(page)).items as Array<{ id: string; body: string }>).find((entry) => entry.id === "g")?.body ?? "";
  await expect.poll(body).toContain("# 양식 견본!");
  const first = await body();
  for (const piece of ["[![CI](https://badge.example/ci.svg)](https://github.com)", "<kbd>Ctrl</kbd>", "H<sub>2</sub>O", "<mark>형광</mark>", ":rocket:", "> [!WARNING]", "| :", ":---:",
    "$E = mc^2$", "$`\\sqrt{2}`$", "$$\n\\frac{1}{3}\n$$", "[^note]", "[^note]: 각주 설명 [표로 가기](#정렬한-표)", "<details open>\n<summary>펼쳐 보기</summary>", "<p align=\"center\"><b>가운데</b></p>", "<div align=\"center\">\n\n#### 감싼 제목\n\n</div>", "<!-- 숨은 주석 -->", "```geojson", "```ts"]) {
    expect(first, piece).toContain(piece);
  }
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("메모")).click();
  await item(page, "GFM").click();
  await expect(page.locator(".md-alert")).toHaveCount(1);
  await page.locator(".note-prose h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type("?");
  await expect.poll(body).toBe(first.replace("# 양식 견본!", "# 양식 견본!?"));
  expect(errors).toEqual([]);
});

test("메모 창: 더 넣기 메뉴로 알림 상자·수식·접기·각주를 넣고, 표 열을 정렬한다", async ({ page }) => {
  await seed(page, [{ id: "m", kind: "note", parentId: null, title: "넣기", body: "첫 줄" }], { selected: "m" });
  const notes = page.locator(win("notes"));
  const prose = notes.locator(".note-prose");
  // 문서 끝(맨 끝의 빈 줄)으로 커서를 옮긴다.
  const toEnd = () => page.evaluate(() => (document.querySelector("#note-body") as HTMLElement & { editor: { commands: { focus: (at: string) => void } } }).editor.commands.focus("end"));
  await prose.locator("p").first().click();
  await expect(page.getByLabel("본문", { exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(prose.locator("p")).toHaveCount(2);
  const insert = async (label: string) => {
    await notes.getByRole("button", { name: "더 넣기" }).click();
    await page.getByRole("menuitem", { name: label }).click();
  };
  await insert("알림 상자 · 참고");
  await page.keyboard.type("참고할 내용");
  await expect(prose.locator('.md-alert[data-alert="note"]')).toContainText("참고할 내용");
  // 제목을 누르면 종류가 차례로 바뀐다.
  await prose.locator(".md-alert-title").click();
  await expect(prose.locator(".md-alert")).toHaveAttribute("data-alert", "tip");
  await prose.locator(".md-alert-body p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await insert("각주");
  await page.keyboard.type("설명");
  await expect(prose.locator('.md-footnote[data-footnote="1"]')).toContainText("설명");
  await toEnd();
  await insert("인라인 수식");
  const input = prose.locator(".md-math-input");
  await expect(input).toBeFocused();
  await input.fill("\\alpha^2");
  await input.press("Enter");
  await expect(prose.locator(".md-math math")).toHaveCount(1);
  await insert("접기 블록");
  await page.keyboard.type("요약");
  await page.keyboard.press("Enter");
  await page.keyboard.type("안쪽");
  await expect(prose.locator('[data-type="detailsContent"]')).toContainText("안쪽");
  // 글을 치다 $…$로 닫으면 수식, :이름:은 이모지가 된다.
  await toEnd();
  await page.keyboard.type("값 $x_1$ 과 :tada: 끝");
  await expect(prose.locator(".md-math")).toHaveCount(2);
  await expect(prose.locator(".md-emoji")).toHaveText("🎉");
  await page.keyboard.press("Enter");
  await notes.getByRole("button", { name: "표 넣기" }).click();
  await page.keyboard.type("머리");
  await notes.getByRole("button", { name: "표 편집" }).click();
  await page.getByRole("menuitem", { name: "열 오른쪽 정렬" }).click();
  await expect(prose.locator('th[align="right"]')).toHaveText("머리");
  const body = async () => ((await saved(page)).items as Array<{ id: string; body: string }>).find((entry) => entry.id === "m")?.body ?? "";
  await expect.poll(body).toContain("---:");
  const text = await body();
  for (const piece of ["> [!TIP]\n> 참고할 내용", "[^1]", "[^1]: 설명", "$\\alpha^2$", "<details open>\n<summary>요약</summary>", "안쪽", "값 $x_1$ 과 :tada: 끝"]) expect(text, piece).toContain(piece);
  // Markdown 보기에서도 같은 메뉴가 원문을 넣는다.
  await notes.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = notes.locator("textarea#note-body");
  await source.focus();
  await source.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await insert("알림 상자 · 주의");
  await expect(source).toHaveValue(/> \[!CAUTION\]\n> 내용을 입력하세요\n$/);
});
