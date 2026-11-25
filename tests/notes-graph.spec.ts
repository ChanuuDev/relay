import { test, expect, type Page } from "@playwright/test";
import { ready, useRelayServer } from "./web-helpers";

useRelayServer();

const KEY = "relay-notes-v1";
const VIEW_KEY = "relay-notes-view-v1";
const GRAPH_KEY = "relay-notes-graph-v1";
const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;

type Seed = { id: string; kind: "folder" | "note"; parentId: string | null; name?: string; title?: string; body?: string; updatedAt?: number };
/** 브라우저 저장소에 메모를 넣고 다시 불러온 뒤 메모 창을 연다(notes.spec.ts와 같은 방법). */
async function seed(page: Page, items: Seed[], extra: Record<string, unknown> = {}) {
  await ready(page);
  const now = Date.parse("2026-10-22T09:30:00+09:00");
  const full = items.map((entry, index) => ({ createdAt: now + index, updatedAt: now + index * 3_600_000 * 7, title: "", body: "", name: "", ...entry }));
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, VIEW_KEY)).toBe(true);
  await page.evaluate(([key, value, view]) => { localStorage.setItem(key, value); localStorage.removeItem(view); },
    [KEY, JSON.stringify({ version: 1, items: full, ...extra }), VIEW_KEY] as const);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("메모")).click();
  await expect(page.locator(win("notes"))).toBeVisible();
}

/** 링크·언급·태그·비슷한 내용이 고루 섞인 메모 묶음. */
const SAMPLE: Seed[] = [
  { id: "f-work", kind: "folder", parentId: null, name: "업무" },
  { id: "f-meet", kind: "folder", parentId: "f-work", name: "회의" },
  { id: "f-proj", kind: "folder", parentId: "f-work", name: "프로젝트" },
  { id: "f-study", kind: "folder", parentId: null, name: "공부" },
  { id: "f-life", kind: "folder", parentId: null, name: "생활" },
  { id: "n-relay", kind: "note", parentId: "f-proj", title: "Relay 출시 계획", body: "[[주간 회의]]에서 정한 일정대로 #출시 준비를 한다.\n서버 배포와 설치 파일 점검, 데스크톱 앱 업데이트." },
  { id: "n-weekly", kind: "note", parentId: "f-meet", title: "주간 회의", body: "Relay 출시 일정과 서버 배포 순서를 정리했다.\n다음 회의까지 설치 파일 점검. #회의" },
  { id: "n-retro", kind: "note", parentId: "f-meet", title: "회고", body: "주간 회의에서 나온 아쉬운 점: 배포 자동화, 테스트 시간 #회의" },
  { id: "n-deploy", kind: "note", parentId: "f-proj", title: "서버 배포 절차", body: "빌드 → 설치 파일 생성 → 서버 재시작 → 상태 확인\n[[Relay 출시 계획]] 참고 #출시" },
  { id: "n-design", kind: "note", parentId: "f-proj", title: "그래프 디자인", body: "지식 그래프 화면: 관계망, 집중, 구조, 주제, 시간 보기.\n애니메이션과 유리 재질 디자인. [[색 팔레트]]" },
  { id: "n-palette", kind: "note", parentId: "f-study", title: "색 팔레트", body: "디자인 색 팔레트 정리: 다크 모드와 라이트 모드 색, 유리 재질, 대비." },
  { id: "n-motion", kind: "note", parentId: "f-study", title: "모션 원칙", body: "애니메이션 원칙: 전환은 짧고 부드럽게, 스프링과 감속 곡선. 디자인 일관성. #디자인" },
  { id: "n-ts", kind: "note", parentId: "f-study", title: "타입스크립트 메모", body: "타입스크립트 제네릭과 유니언 타입 정리.\n테스트 작성 요령과 타입 검사." },
  { id: "n-test", kind: "note", parentId: "f-study", title: "테스트 전략", body: "단위 테스트와 화면 테스트 비율, 테스트 시간 줄이기.\n배포 전 검증, 타입스크립트 타입 검사." },
  { id: "n-books", kind: "note", parentId: "f-life", title: "읽을 책", body: "디자인 책 두 권, 타입스크립트 책 한 권. #독서" },
  { id: "n-shop", kind: "note", parentId: "f-life", title: "장보기", body: "우유, 달걀, 커피 원두" },
  { id: "n-coffee", kind: "note", parentId: "f-life", title: "커피 원두 기록", body: "에티오피아 원두, 산미가 좋다.\n장보기 목록에 원두를 더한다." },
  { id: "n-trip", kind: "note", parentId: "f-life", title: "여행 준비", body: "부산 여행: 숙소, 기차표, 맛집 #여행" },
  { id: "n-busan", kind: "note", parentId: "f-life", title: "부산 맛집", body: "여행 준비 중 찾은 부산 맛집 목록: 돼지국밥, 밀면 #여행" },
  { id: "n-run", kind: "note", parentId: "f-life", title: "운동 계획", body: "주 3회 달리기, 스트레칭" },
  { id: "n-idea", kind: "note", parentId: null, title: "아이디어 모음", body: "메모 앱에 지식 그래프 추가하기 → [[그래프 디자인]]\n회고에서 나온 자동화 아이디어" },
  { id: "n-inbox", kind: "note", parentId: null, title: "", body: "받은 편지함 정리하기\n이번 주 안에" },
];

type GraphApi = { point: (id: string) => { x: number; y: number; r: number } | null; visibleIds: () => string[]; camera: { x: number; y: number; k: number } };
const graph = (page: Page) => page.locator(".notes-graph");
/** 움직임이 모두 멈출 때까지 기다린다(렌더러가 쉬면 data-settled를 단다). */
const settled = (page: Page) => expect(graph(page)).toHaveAttribute("data-settled", "", { timeout: 25000 });
const pointOf = (page: Page, id: string) => page.evaluate((target) => (document.querySelector(".notes-graph") as HTMLElement & { relayGraph: GraphApi }).relayGraph.point(target), id);
async function openGraph(page: Page) {
  await page.locator("#notes-graph-toggle").click();
  await expect(graph(page)).toBeVisible();
  await settled(page);
}

test("메모 그래프: 그래프 단추로 열면 메모·폴더·태그가 점이 되고 링크·언급·태그·폴더·비슷한 내용이 선이 된다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet", "f-proj"], selected: "n-weekly" });
  const notes = page.locator(win("notes"));
  await notes.locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  const toggle = page.locator("#notes-graph-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await openGraph(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(notes.getByRole("region", { name: "메모 그래프" }).or(notes.locator("section[aria-label='메모 그래프']"))).toBeVisible();
  // 메모 17개 + 폴더 5개 + 태그 5개(출시·회의·디자인·독서·여행).
  const options = notes.getByRole("option");
  await expect(options).toHaveCount(17 + 5 + 5);
  await expect(graph(page)).toHaveAttribute("data-view", "network");
  await page.screenshot({ path: test.info().outputPath("graph-network-dark.png") });

  // 트리에서 고른 메모를 따라가 카드에 연결을 보인다.
  const card = notes.locator(".graph-card");
  await expect(card.locator(".graph-card-title")).toHaveText("주간 회의");
  const links = card.locator(".graph-card-links");
  await expect(links.locator("section").filter({ hasText: "링크" })).toContainText("Relay 출시 계획");
  await expect(links.locator("section").filter({ hasText: "링크" })).toContainText("가리킴 받음");
  await expect(links.locator("section").filter({ hasText: "언급" })).toContainText("회고");
  await expect(links.locator("section").filter({ hasText: "태그" })).toContainText("#회의");
  await expect(links.locator("section").filter({ hasText: "폴더" })).toContainText("회의");
  expect(errors).toEqual([]);
});

test("메모 그래프: 보기 다섯 가지를 오가며 점이 새 자리로 흘러가고 화면에 맞춰진다", async ({ page }) => {
  await seed(page, SAMPLE, { expanded: ["f-work"], selected: "n-design" });
  await page.locator(win("notes")).locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await openGraph(page);
  const names = ["관계망", "집중", "구조", "주제", "시간"];
  const keys = ["network", "focus", "structure", "topics", "timeline"];
  for (const [index, name] of names.entries()) {
    await page.getByRole("radio", { name }).click();
    await expect(page.getByRole("radio", { name })).toHaveAttribute("aria-checked", "true");
    await expect(graph(page)).toHaveAttribute("data-view", keys[index]!);
    // 전환 중에는 움직이고, 끝나면 멈춘다.
    await settled(page);
    await page.screenshot({ path: test.info().outputPath(`graph-${keys[index]}-dark.png`) });
  }
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  for (const key of ["network", "structure", "topics"]) {
    await page.locator(`.graph-views [data-view="${key}"]`).click();
    await settled(page);
    await page.screenshot({ path: test.info().outputPath(`graph-${key}-light.png`) });
  }
});

test("메모 그래프: 점을 누르면 카드가 열리고, 연결을 눌러 옮겨 가며, 두 번 누르거나 Enter로 그 메모를 편집기에 연다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, SAMPLE, { expanded: ["f-work", "f-meet"] });
  const notes = page.locator(win("notes"));
  await notes.locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await openGraph(page);
  const card = notes.locator(".graph-card");
  await expect(card).toHaveCount(0);

  // 마우스를 올리면 이름표가 뜨고, 누르면 카드가 열리며 트리도 그 메모를 고른다.
  const weekly = (await pointOf(page, "n-weekly"))!;
  await page.mouse.move(weekly.x, weekly.y);
  await expect(notes.locator(".graph-tip")).toContainText("주간 회의");
  await page.mouse.click(weekly.x, weekly.y);
  await expect(card.locator(".graph-card-title")).toHaveText("주간 회의");
  await expect(graph(page)).toHaveAttribute("data-active", "n-weekly");
  await expect(page.getByRole("treeitem", { name: "주간 회의", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(notes.getByRole("option", { name: /^주간 회의 · 메모/ })).toHaveAttribute("aria-selected", "true");

  // 카드의 연결을 누르면 그 점으로 옮겨 간다.
  await card.locator(".graph-card-links button", { hasText: "Relay 출시 계획" }).click();
  await expect(card.locator(".graph-card-title")).toHaveText("Relay 출시 계획");
  await expect(card).toContainText("#출시");
  await settled(page);

  // 빈 곳을 누르면 카드를 닫는다.
  const box = (await graph(page).boundingBox())!;
  const empty = await page.evaluate(({ x, y, w, h }) => {
    const api = (document.querySelector(".notes-graph") as HTMLElement & { relayGraph: GraphApi }).relayGraph;
    const points = api.visibleIds().map((id) => api.point(id)!);
    for (let gy = y + 90; gy < y + h - 90; gy += 20) for (let gx = x + 40; gx < x + w - 340; gx += 20) {
      if (points.every((p) => Math.hypot(p.x - gx, p.y - gy) > 40)) return { x: gx, y: gy };
    }
    return null;
  }, { x: box.x, y: box.y, w: box.width, h: box.height });
  await page.mouse.click(empty!.x, empty!.y);
  await expect(card).toHaveCount(0);

  // 키보드: 그래프에 초점을 두고 화살표로 점을 고른 뒤 Esc로 놓는다.
  await page.locator(".graph-stage").focus();
  await page.keyboard.press("ArrowRight");
  await expect(graph(page)).toHaveAttribute("data-active", /.+/);
  await expect(page.locator(".graph-stage")).toHaveAttribute("aria-activedescendant", /graph-node-/);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // 두 번 누르면 그 점 속으로 다가간 뒤 편집기로 그 메모를 연다.
  const retro = (await pointOf(page, "n-retro"))!;
  await page.mouse.dblclick(retro.x, retro.y);
  await expect(graph(page)).toHaveCount(0);
  await expect(notes.locator("#note-title")).toHaveValue("회고");
  await expect(page.locator("#notes-graph-toggle")).toHaveAttribute("aria-pressed", "false");

  // 다시 열면 고른 메모가 그대로 골라져 있고, Enter로 연다.
  await openGraph(page);
  await expect(graph(page)).toHaveAttribute("data-active", "n-retro");
  await page.locator(".graph-stage").focus();
  await page.keyboard.press("Enter");
  await expect(graph(page)).toHaveCount(0);
  await expect(notes.locator("#note-title")).toHaveValue("회고");
  expect(errors).toEqual([]);
});

test("메모 그래프: 찾기·보일 연결 고르기·집중 보기 다시 가운데 두기, 고른 설정은 새로 고쳐도 남는다", async ({ page }) => {
  await seed(page, SAMPLE, { expanded: ["f-work"] });
  const notes = page.locator(win("notes"));
  await notes.locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await openGraph(page);

  // 찾기: 제목·본문과 태그(그 태그를 쓴 메모 포함)를 밝힌다. Enter는 가장 많이 이어진 것을 고른다.
  const search = notes.getByLabel("그래프에서 찾기");
  await search.fill("여행");
  await expect(notes.locator(".graph-search-count")).toHaveText("3");
  await search.press("Enter");
  await expect(notes.locator(".graph-card-title")).toHaveText(/#여행|여행 준비|부산 맛집/);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(notes.locator(".graph-search-count")).toHaveCount(0);

  // 보일 연결 고르기.
  const before = Number(await graph(page).getAttribute("data-edges"));
  await notes.getByRole("button", { name: "보일 연결과 점" }).click();
  const menu = page.locator(".graph-filters");
  await expect(menu).toBeVisible();
  await menu.getByRole("switch", { name: /비슷한 내용/ }).click();
  await expect(menu.getByRole("switch", { name: /비슷한 내용/ })).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => Number(await graph(page).getAttribute("data-edges"))).toBeLessThan(before);
  await menu.getByRole("switch", { name: /^폴더/ }).click();
  await expect(notes.getByRole("option")).toHaveCount(17 + 5);
  await page.screenshot({ path: test.info().outputPath("graph-filters-dark.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key) ?? "{}", GRAPH_KEY))).toMatchObject({ folders: false, links: { similar: false } });

  // 새로 고쳐도 남고, 기본값으로 되돌린다.
  await page.reload();
  await page.locator(dock("메모")).click();
  await openGraph(page);
  await expect(notes.getByRole("option")).toHaveCount(17 + 5);
  await notes.getByRole("button", { name: "보일 연결과 점" }).click();
  await page.locator(".graph-filters").getByRole("button", { name: "기본값으로" }).click();
  await expect(notes.getByRole("option")).toHaveCount(17 + 5 + 5);
  await page.keyboard.press("Escape");

  // 집중 보기: 고른 메모가 가운데에 오고, 다른 점을 누르면 그 점을 가운데로 다시 놓는다.
  await page.getByRole("treeitem", { name: "아이디어 모음" }).click();
  await notes.getByRole("radio", { name: "집중" }).click();
  await settled(page);
  await expect(graph(page)).toHaveAttribute("data-active", "n-idea");
  const offCenter = async (id: string) => {
    const point = (await pointOf(page, id))!;
    const area = (await graph(page).boundingBox())!;
    // 카드 폭(304)과 위 막대·아래 범례를 뺀 안전 영역의 가운데와 비교한다.
    return Math.hypot(point.x - (area.x + 24 + (area.width - 24 - 304) / 2), point.y - (area.y + 64 + (area.height - 64 - 60) / 2));
  };
  expect(await offCenter("n-idea")).toBeLessThan(40);
  const design = (await pointOf(page, "n-design"))!;
  await page.mouse.click(design.x, design.y);
  await expect(graph(page)).toHaveAttribute("data-active", "n-design");
  await settled(page);
  expect(await offCenter("n-design")).toBeLessThan(40);
  await expect(page.getByRole("treeitem", { name: "그래프 디자인" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: test.info().outputPath("graph-focus-recentered.png") });

  // 숫자 키로 보기를 바꾼다.
  await page.locator(".graph-stage").focus();
  await page.keyboard.press("3");
  await expect(graph(page)).toHaveAttribute("data-view", "structure");
  expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key) ?? "{}", GRAPH_KEY))).toMatchObject({ view: "structure" });
});

test("메모 그래프: 닫으면 물러나고 편집기가 떠오르며, 움직임 줄이기·좁은 창에서도 쓸 수 있다", async ({ page }) => {
  await seed(page, SAMPLE, { expanded: ["f-work"], selected: "n-relay" });
  const notes = page.locator(win("notes"));
  await openGraph(page);
  // 그래프 단추를 다시 누르면 닫히고 편집기가 다시 떠오른다.
  await page.locator("#notes-graph-toggle").click();
  await expect(graph(page)).toHaveCount(0);
  await expect(notes.locator(".notes-content")).toHaveAttribute("data-arrive", "");
  await expect(notes.locator("#note-title")).toHaveValue("Relay 출시 계획");
  await expect(notes.locator(".notes-content")).not.toHaveAttribute("data-arrive", "");

  // 움직임 줄이기: 전환은 바로 끝난다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#notes-graph-toggle").click();
  await expect(graph(page)).toHaveAttribute("data-settled", "", { timeout: 2000 });
  await notes.getByRole("radio", { name: "주제" }).click();
  await expect(graph(page)).toHaveAttribute("data-view", "topics");
  await expect(graph(page)).toHaveAttribute("data-settled", "", { timeout: 1000 });
  await page.locator("#notes-graph-toggle").click();
  await expect(graph(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // 좁은 창: 보기 이름은 아이콘만, 카드는 아래에서 올라오고, 목록으로 돌아갈 수 있다.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#notes-graph-toggle").click();
  await settled(page);
  await expect(notes.locator(".notes-sidebar")).toBeHidden();
  await expect(notes.getByRole("radio", { name: "관계망" })).toBeVisible();
  // 열 때 골라 둔 메모의 카드가 아래를 덮으므로, 그래프 전체는 카드 위쪽에 맞춰진다.
  await expect(notes.locator(".graph-card-title")).toHaveText("Relay 출시 계획");
  const sheet = (await notes.locator(".graph-card").boundingBox())!;
  for (const id of await page.evaluate(() => (document.querySelector(".notes-graph") as HTMLElement & { relayGraph: GraphApi }).relayGraph.visibleIds())) {
    expect((await pointOf(page, id))!.y).toBeLessThan(sheet.y);
  }
  await page.locator(".graph-stage").focus();
  await page.keyboard.press("Escape");
  await expect(notes.locator(".graph-card")).toHaveCount(0);
  const point = (await pointOf(page, "n-weekly"))!;
  await page.mouse.click(point.x, point.y);
  await expect(notes.locator(".graph-card-title")).toHaveText("주간 회의");
  await page.waitForTimeout(500);
  const card = (await notes.locator(".graph-card").boundingBox())!;
  const area = (await graph(page).boundingBox())!;
  expect(card.y + card.height).toBeGreaterThan(area.y + area.height - 80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("graph-mobile.png") });
  await notes.getByRole("button", { name: "목록", exact: true }).click();
  await expect(notes.locator(".notes-sidebar")).toBeVisible();
});

test("메모 그래프: 메모가 없으면 쓰는 방법을 알리고, 새 메모를 쓰면 점이 생긴다", async ({ page }) => {
  await ready(page);
  await page.locator(dock("메모")).click();
  const notes = page.locator(win("notes"));
  await page.locator("#notes-graph-toggle").click();
  await expect(notes.locator(".graph-empty")).toContainText("아직 그릴 메모가 없습니다");
  await expect(notes.getByRole("option")).toHaveCount(0);
  // 새 메모를 만들면 그래프를 닫고 편집기로 간다.
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(graph(page)).toHaveCount(0);
  await expect(notes.locator("#note-title")).toBeFocused();
  await page.keyboard.type("첫 메모");
  await page.locator("#notes-graph-toggle").click();
  await expect(notes.getByRole("option", { name: /^첫 메모/ })).toHaveCount(1);
  await expect(notes.locator(".graph-empty")).toHaveCount(0);

  // 서식 편집기에서 [[제목]]을 쓰면(저장은 대괄호를 이스케이프한 모양) 두 메모 사이에 링크 선이 생긴다.
  await notes.getByRole("button", { name: "새 메모" }).first().click();
  await expect(notes.locator("#note-title")).toBeFocused();
  await page.keyboard.type("둘째 메모");
  await notes.locator(".note-prose").click();
  await page.keyboard.type("[[첫 메모]]를 이어 쓴다 #시작");
  await page.locator("#notes-graph-toggle").click();
  await settled(page);
  await expect(notes.getByRole("option", { name: /^#시작 · 태그/ })).toHaveCount(1);
  await expect(notes.locator(".graph-card-title")).toHaveText("둘째 메모");
  const link = notes.locator(".graph-card-links section").filter({ hasText: "링크" });
  await expect(link).toContainText("첫 메모");
  await expect(link).toContainText("가리킴");
});

test("감사용 스크린샷: 메모 그래프 전환 프레임", async ({ page }) => {
  await seed(page, SAMPLE, { expanded: ["f-work"] });
  await page.locator(win("notes")).locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  // 처음 피어나는 장면.
  await page.locator("#notes-graph-toggle").click();
  for (const [index, wait] of [120, 300, 400].entries()) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: test.info().outputPath(`graph-enter-${index}.png`) });
  }
  await settled(page);
  // 관계망 → 구조 전환 중간.
  await page.getByRole("radio", { name: "구조" }).click();
  for (const [index, wait] of [220, 280].entries()) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: test.info().outputPath(`graph-morph-${index}.png`) });
  }
  await settled(page);
  // 마우스를 올린 점과 이웃만 밝다.
  const point = (await pointOf(page, "n-weekly"))!;
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath("graph-hover-structure.png") });
});
