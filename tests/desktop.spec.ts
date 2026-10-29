import { test, expect, type Page } from "@playwright/test";
import { clipboardText, env, record, ready, useRelayServer } from "./web-helpers";

useRelayServer();

const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const themeClass = (page: Page) => page.evaluate(() => document.documentElement.className);
const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`no box for ${selector}`);
  return rect;
};
/** 여는 애니메이션이 끝나 위치가 멈출 때까지 기다린다. 부하가 크면 애니메이션 도중 잰 자리를 누르다 빗나간다. */
const settled = async (page: Page, selector: string) => {
  let last = "";
  await expect.poll(async () => {
    const now = JSON.stringify(await box(page, selector));
    const same = now === last; last = now; return same;
  }, { intervals: [100] }).toBe(true);
};

test("기본 테마는 다크, 토글과 시스템 모드가 저장된다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("theme", "테마 확인");
  await ready(page);
  expect(await themeClass(page)).toContain("dark");
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
  const luminance = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.querySelector(".menubar")!).backgroundColor.match(/[\d.]+/g)!.map(Number);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  });
  expect(luminance).toBeLessThan(90);
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect.poll(() => themeClass(page)).toContain("light");
  expect(await page.evaluate(() => localStorage.getItem("relay-theme"))).toBe("light");
  await page.reload();
  await expect.poll(() => themeClass(page)).toContain("light");
  // 설정 창의 시스템 옵션은 운영체제 설정을 따른다.
  await page.locator(dock("설정")).click();
  await page.getByLabel("시스템", { exact: true }).check();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => themeClass(page)).toContain("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => themeClass(page)).toContain("light");
  expect(errors).toEqual([]);
});

test("배경화면·Dock 아이콘·서체가 실행 파일에서 제공된다", async ({ page }) => {
  record("assets", "자산 확인");
  await ready(page);
  for (const [path, type] of [["/wallpaper-dark.jpg", "image/jpeg"], ["/wallpaper-light.jpg", "image/jpeg"], ["/wallpapers/aurora.jpg", "image/jpeg"],
    ["/icons/sessions.png", "image/png"], ["/fonts/PretendardVariable.woff2", "font/woff2"], ["/fonts/JetBrainsMono-latin.woff2", "font/woff2"], ["/fonts/JetBrainsMono-latin-italic.woff2", "font/woff2"]] as const) {
    const response = await page.request.get(env.url + path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toBe(type);
  }
  expect(await page.evaluate(() => document.fonts.check('13px "Pretendard Variable"'))).toBe(true);
  // 기본 바탕화면은 그래파이트 색상이라 사진을 켜지 않는다. 낮과 밤을 고르면 테마에 따라 사진이 바뀐다.
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-color", "graphite");
  await expect(page.locator(".wallpaper-image[data-active]")).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("relay-wallpaper", JSON.stringify({ kind: "dynamic" })));
  await page.reload();
  const active = page.locator(".wallpaper-image[data-active]");
  await expect(active).toHaveAttribute("src", "/wallpaper-dark.jpg");
  await expect.poll(() => active.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect(active).toHaveAttribute("src", "/wallpaper-light.jpg");
  const widths = await page.locator(".dock-item img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth));
  expect(widths).toHaveLength(9);
  for (const width of widths) expect(width).toBeGreaterThan(0);
});

test("Dock은 포인터 주변 아이콘을 확대하고 원래 크기로 복귀하며 키보드로 앱을 연다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("dock", "Dock 확대 확인");
  await ready(page);
  const initial = await box(page, dock("가이드"));
  expect(initial.width).toBe(48);
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await expect.poll(async () => (await box(page, dock("가이드"))).width).toBeGreaterThan(76);
  await expect.poll(async () => (await box(page, dock("세션"))).width).toBeGreaterThan(52);
  expect((await box(page, dock("설정"))).width).toBeLessThan((await box(page, dock("세션"))).width);
  const label = page.locator(".dock-tip").filter({ hasText: /^가이드$/ });
  await expect(label).toBeVisible();
  await expect.poll(async () => {
    const icon = await box(page, dock("가이드"));
    const tip = await label.boundingBox();
    return tip ? Math.abs(tip.x + tip.width / 2 - icon.x - icon.width / 2) : Infinity;
  }).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath("dock-magnified-dark.png") });
  await page.mouse.move(0, 0);
  await expect.poll(async () => Math.abs((await box(page, dock("가이드"))).width - 48)).toBeLessThan(.1);
  await expect(label).toHaveCount(0);
  await page.locator(dock("계산기")).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(dock("설정"))).toBeFocused();
  await expect(page.locator(".dock-tip").filter({ hasText: /^설정$/ })).toBeVisible();
  await expect.poll(async () => (await box(page, dock("설정"))).width).toBeGreaterThan(76);
  await page.keyboard.press("Enter");
  await expect(page.locator(win("settings"))).toBeVisible();
  expect(errors).toEqual([]);
});

test("Dock 위에서 움직이는 동안 라벨은 하나로 끊기지 않고, 커진 아이콘은 최대화한 창을 덮지 않는다", async ({ page }) => {
  record("dock-label", "라벨 확인");
  await ready(page);
  await page.locator(`${win("sessions")} .window-title`).dblclick();
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-maximized", "");
  const windowBottom = await page.locator(win("sessions")).evaluate((element) => element.getBoundingClientRect().bottom);
  const bar = await box(page, ".dock-bar");
  const y = bar.y + bar.height / 2;
  await page.mouse.move(bar.x + 20, y);
  await expect(page.locator(".dock-tip")).toHaveCount(1);
  // 아이콘 사이 틈을 지나도 라벨은 사라지거나 둘로 겹치지 않고, 가장 가까운 아이콘 이름으로 바뀐다.
  const seen = new Set<string>();
  let highest = Infinity;
  for (let x = bar.x + 20; x <= bar.x + bar.width - 20; x += 9) {
    await page.mouse.move(x, y);
    const state = await page.evaluate(() => ({
      tips: Array.from(document.querySelectorAll<HTMLElement>(".dock-tip")).map((tip) => ({ text: tip.textContent ?? "", opacity: Number(getComputedStyle(tip).opacity) })),
      top: Math.min(...Array.from(document.querySelectorAll(".dock-item img")).map((image) => image.getBoundingClientRect().top)),
    }));
    expect(state.tips).toHaveLength(1);
    seen.add(state.tips[0]!.text);
    highest = Math.min(highest, state.top);
  }
  expect([...seen].sort()).toEqual(["YouTube", "가이드", "계산기", "메모", "명령", "뷰어", "설정", "세션", "파일 탐색기"].sort());
  expect(highest).toBeGreaterThanOrEqual(windowBottom);
  // 라벨은 아래 창 글자가 비치는 유리가 아니다.
  expect(await page.locator(".dock-tip").evaluate((tip) => getComputedStyle(tip).backdropFilter)).toBe("none");
  // 눌러서 생긴 초점은 포인터가 떠나면 라벨을 남기지 않는다.
  await page.locator(dock("설정")).click();
  await page.mouse.move(0, 400);
  await expect(page.locator(".dock-tip")).toHaveCount(0);
});

test("동작 줄이기 설정을 켜면 확대 중인 Dock도 즉시 고정 크기로 돌아간다", async ({ page }) => {
  record("dock-reduced", "Dock 접근성 확인");
  await ready(page);
  const initial = await box(page, dock("가이드"));
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await expect.poll(async () => (await box(page, dock("가이드"))).width).toBeGreaterThan(76);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.locator(".dock-item").evaluateAll(items => items.every(item => item.getBoundingClientRect().width === 48))).toBe(true);
  expect((await box(page, ".dock-row")).height).toBe(64);
  await page.locator(dock("설정")).hover();
  expect((await box(page, dock("설정"))).width).toBe(48);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".dock-item img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width))).toEqual([32, 32, 32, 32, 32, 32, 32, 32, 32]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => page.locator(".dock-item img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width))).toEqual([48, 48, 48, 48, 48, 48, 48, 48, 48]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".dock-row")).not.toHaveAttribute("data-static", "");
  const restored = await box(page, dock("가이드"));
  await page.mouse.move(restored.x + restored.width / 2, restored.y + restored.height / 2);
  await expect.poll(async () => (await box(page, dock("가이드"))).width).toBeGreaterThan(76);
});

test("서버가 새 빌드로 다시 뜨면 열린 화면이 스스로 새로 고치고, 입력 중이면 끊지 않고 알린다", async ({ page }) => {
  let build: string | null = null;
  await page.route("**/api/v1/health", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: build ? { ...body, build } : body });
  });
  await ready(page);
  const original = await page.locator('meta[name="relay-build"]').getAttribute("content");
  expect(original).toMatch(/^[0-9a-z]+$/);
  // 입력 중에는 새로 고치지 않고 안내만 띄운다.
  await page.locator("#search").focus();
  build = "next-build-1";
  const notice = page.locator("#update-status");
  await expect(notice).toContainText("새 버전으로 다시 시작됐습니다", { timeout: 10000 });
  await expect(page.locator("#search")).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("update-toast.png"), clip: { x: 360, y: 0, width: 720, height: 120 } });
  // 새로 고침 단추를 누르면 새 화면을 받는다.
  const reloaded = page.waitForEvent("load");
  await notice.getByRole("button", { name: "새로 고침" }).click();
  await reloaded;
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  // 입력 중이 아니면 곧바로 새로 고친다. 같은 빌드로는 한 번만 새로 고친다.
  build = "next-build-2";
  await page.locator("#search").blur();
  await page.waitForEvent("load", { timeout: 10000 });
  let loads = 0; page.on("load", () => { loads += 1; });
  await page.waitForTimeout(4000);
  expect(loads).toBe(0);
  await expect(page.locator("#update-status")).toHaveCount(0);
});

test("데스크톱 기본 배치: Dock 아홉 앱, 세션·가이드 창이 열린다", async ({ page }) => {
  record("layout", "기본 배치");
  await ready(page);
  await expect(page.locator(".dock-item")).toHaveCount(9);
  for (const name of ["세션", "가이드", "명령", "메모", "파일 탐색기", "뷰어", "계산기", "설정", "YouTube"]) await expect(page.locator(dock(name))).toBeVisible();
  await expect(page.locator(win("sessions"))).toBeVisible();
  await expect(page.locator(win("guide"))).toBeVisible();
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-focused", "");
  await expect(page.locator(".menubar-app")).toHaveText("세션");
  await expect(page.locator(dock("세션"))).toHaveAttribute("data-open", "");
  await expect(page.locator(dock("가이드"))).toHaveAttribute("data-open", "");
  await expect(page.locator(dock("명령"))).not.toHaveAttribute("data-open", "");
  const sessions = await box(page, win("sessions"));
  expect(Math.round(sessions.x)).toBe(40);
  expect(Math.round(sessions.y)).toBe(44);
});

test("창 열기·최소화·최대화·닫기가 Dock 표시와 함께 동작한다", async ({ page }) => {
  record("windows", "창 조작");
  await ready(page);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toHaveAttribute("data-focused", "");
  await expect(page.locator(".menubar-app")).toHaveText("설정");
  await page.getByRole("button", { name: "설정 창 최소화" }).click();
  await expect(page.locator(win("settings"))).toBeHidden();
  await expect(page.locator(dock("설정"))).toHaveAttribute("data-open", "");
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  const restored = await box(page, win("settings"));
  await page.getByRole("button", { name: "설정 창 최대화" }).click();
  const viewport = page.viewportSize()!;
  const maximized = await box(page, win("settings"));
  expect(Math.abs(maximized.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(maximized.y - 28)).toBeLessThanOrEqual(1);
  expect(Math.abs(maximized.x + maximized.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(maximized.y + maximized.height - (viewport.height - 104))).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "설정 창 복원" }).click();
  const back = await box(page, win("settings"));
  expect(Math.round(back.x)).toBe(Math.round(restored.x));
  expect(Math.round(back.width)).toBe(Math.round(restored.width));
  await page.getByRole("button", { name: "설정 창 닫기" }).click();
  await expect(page.locator(win("settings"))).toHaveCount(0);
  await expect(page.locator(dock("설정"))).not.toHaveAttribute("data-open", "");
});

test("상단바 드래그로 창을 옮기면 위치가 저장되고, 입력에서는 움직이지 않는다", async ({ page }) => {
  record("drag", "드래그 확인");
  await ready(page);
  const before = await box(page, win("sessions"));
  const title = await box(page, `${win("sessions")} .window-title`);
  const from = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y + 80, { steps: 12 });
  await page.mouse.up();
  const moved = await box(page, win("sessions"));
  expect(Math.round(moved.x - before.x)).toBe(120);
  expect(Math.round(moved.y - before.y)).toBe(80);
  await page.waitForTimeout(400); // 배치 저장 디바운스
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await settled(page, "#search");
  const reloaded = await box(page, win("sessions"));
  expect(Math.round(reloaded.x)).toBe(Math.round(moved.x));
  expect(Math.round(reloaded.y)).toBe(Math.round(moved.y));
  // 상단바 안의 검색 입력에서 끌면 창은 그대로다.
  const search = await box(page, "#search");
  await page.mouse.move(search.x + 20, search.y + search.height / 2);
  await page.mouse.down();
  await page.mouse.move(search.x + 140, search.y + search.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const still = await box(page, win("sessions"));
  expect(Math.round(still.x)).toBe(Math.round(reloaded.x));
  // 상단바 더블클릭은 최대화 토글이다.
  await page.locator(`${win("sessions")} .window-title`).dblclick();
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-maximized", "");
  await page.locator(`${win("sessions")} .window-title`).dblclick();
  await expect(page.locator(win("sessions"))).not.toHaveAttribute("data-maximized", "");
});

test("상세 패널이 있어도 우측 테두리 안팎에서 창 너비를 조절하고 저장한다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  record("resize", "우측 크기 조절 확인");
  await ready(page);
  await page.getByRole("link", { name: "우측 크기 조절 확인", exact: true }).click();
  await expect(page.locator(".detail-header h2")).toHaveText("우측 크기 조절 확인");
  for (const offset of [-2, 8]) {
    const before = await box(page, win("sessions"));
    const x = before.x + before.width + offset, y = before.y + before.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box(page, win("sessions"))).width - before.width)).toBe(60);
    const after = await box(page, win("sessions"));
    expect({ x: after.x, y: after.y, height: after.height }).toEqual({ x: before.x, y: before.y, height: before.height });
  }
  const resized = await box(page, win("sessions"));
  await page.waitForTimeout(400); // 배치 저장 디바운스
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  expect(Math.round((await box(page, win("sessions"))).width)).toBe(Math.round(resized.width));
});

test("가이드 창의 버튼과 / 단축키가 세션 창을 앞으로 가져온다", async ({ page }) => {
  record("guide", "가이드 확인");
  await ready(page);
  await page.locator(dock("가이드")).click();
  await expect(page.locator(win("guide"))).toHaveAttribute("data-focused", "");
  await page.getByRole("button", { name: "이전 기록 찾기" }).click();
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-focused", "");
  await expect(page.locator("#search")).toBeFocused();
  await page.getByRole("button", { name: "세션 창 최소화" }).click();
  await expect(page.locator(win("sessions"))).toBeHidden();
  await page.keyboard.press("/");
  await expect(page.locator(win("sessions"))).toBeVisible();
  await expect(page.locator("#search")).toBeFocused();
});

test("명령 창은 선택한 세션의 조회 명령을 보여 주고 셸 설정을 공유한다", async ({ page, context }) => {
  record("cmd-session", "명령 창 확인");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await ready(page);
  await page.getByRole("link", { name: "명령 창 확인" }).click();
  await page.locator(dock("명령")).click();
  const terminal = page.locator(".terminal-body");
  await expect(terminal).toContainText("relay show 'cmd-session'");
  await expect(terminal).toContainText("--provider");
  await page.getByRole("button", { name: "이 명령 복사" }).click();
  const copied = await clipboardText(page);
  expect(copied).toContain("relay show 'cmd-session'");
  await page.locator(dock("세션")).click();
  await page.getByRole("button", { name: "조회 명령 복사" }).click();
  expect(await clipboardText(page)).toBe(copied);
  await page.locator(dock("명령")).click();
  await page.locator("#command-shell-kind").selectOption("bash");
  await page.locator(dock("세션")).click();
  await expect(page.getByLabel("조회 명령 셸")).toHaveValue("bash");
});

test("메뉴바 메뉴로 테마·창·배치를 키보드로 다룰 수 있다", async ({ page }) => {
  record("menu", "메뉴 확인");
  await ready(page);
  await page.locator(".menubar-mark").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const label of ["Relay 정보…", "설정…", "다크", "라이트", "시스템", "창 배치 초기화"]) await expect(menu).toContainText(label);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(".menubar-mark")).toBeFocused();
  await page.locator(".menubar-mark").click();
  await page.getByRole("menuitemradio", { name: "라이트" }).click();
  await expect.poll(() => themeClass(page)).toContain("light");
  // 창 메뉴의 닫기는 포커스 창을 닫는다.
  await page.locator(".menubar-app").click();
  await page.getByRole("menuitem", { name: "닫기" }).click();
  await expect(page.locator(win("sessions"))).toHaveCount(0);
  await page.locator(dock("세션")).click();
  await settled(page, `${win("sessions")} .window-title`);
  const title = await box(page, `${win("sessions")} .window-title`);
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width / 2 + 90, title.y + title.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  expect(Math.round((await box(page, win("sessions"))).x)).not.toBe(40);
  await page.locator(".menubar-mark").click();
  await page.getByRole("menuitem", { name: "창 배치 초기화" }).click();
  const reset = await box(page, win("sessions"));
  expect(Math.round(reset.x)).toBe(40);
  expect(Math.round(reset.y)).toBe(44);
});

test("모바일에서는 창이 하나씩 최대화되고 Dock이 탭바가 된다", async ({ page }) => {
  record("mobile", "모바일 확인", "openai", "codex", "긴 한국어 요약 ".repeat(40));
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.locator(".desktop")).toHaveAttribute("data-mobile", "");
  const sessions = await box(page, win("sessions"));
  expect(Math.round(sessions.x)).toBe(0);
  expect(Math.round(sessions.width)).toBe(390);
  expect(Math.round(sessions.y)).toBe(28);
  expect(Math.round(sessions.y + sessions.height)).toBe(844 - 64);
  await expect(page.locator(win("guide"))).toHaveCount(0);
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect(page.locator(".dock-label")).toHaveCount(9);
  expect(await page.locator(".dock-item img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width))).toEqual([32, 32, 32, 32, 32, 32, 32, 32, 32]);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  await expect(page.locator(win("sessions"))).toBeHidden();
  await page.locator(dock("세션")).click();
  await expect(page.locator(win("sessions"))).toBeVisible();
  await expect(page.locator(win("settings"))).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Resizing an already mounted dock must update its icon size in both directions.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => page.locator(".dock-item img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width))).toEqual([48, 48, 48, 48, 48, 48, 48, 48, 48]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".dock-item img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width))).toEqual([32, 32, 32, 32, 32, 32, 32, 32, 32]);
});

test("감사용 스크린샷: 다크·라이트·상세·모바일", async ({ page }) => {
  record("shot-1", "스크린샷 세션", "anthropic", "claude-code", "다음 대화에 넘길 작업 맥락 요약");
  record("shot-2", "두 번째 세션", "openai", "codex", "터미널에서 이어가는 작업");
  await ready(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("desktop-dark.png") });
  await page.getByRole("link", { name: "스크린샷 세션" }).click();
  await expect(page.locator(".summary")).toContainText("다음 대화에 넘길");
  await page.screenshot({ path: test.info().outputPath("desktop-detail-1440.png") });
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("desktop-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("mobile-light.png") });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("mobile-dark.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("설정의 바탕화면에서 사진·색상·내 사진을 고르면 즉시 바뀌고 다시 열어도 유지된다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("wallpaper", "바탕화면 확인");
  await ready(page);
  // 창 배치 저장은 200ms 뒤에 이뤄지므로, 새로고침 뒤에는 메뉴로 설정 창을 다시 연다.
  const openPicker = async () => {
    await page.locator(".menubar-mark").click();
    await page.getByRole("menuitem", { name: "바탕화면 변경…" }).click();
    await expect(picker).toBeVisible();
  };
  const picker = page.getByRole("radiogroup", { name: "바탕화면" });
  await openPicker();
  await expect(picker.getByRole("radio", { name: "그래파이트" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-color", "graphite");
  await picker.getByRole("radio", { name: "오로라" }).click();
  await expect(page.locator(".wallpaper-photo[data-active]")).toHaveAttribute("src", "/wallpapers/aurora.jpg");
  await expect(page.locator(".wallpaper-image[data-layer][data-active]")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("relay-wallpaper"))).toBe('{"kind":"preset","id":"aurora"}');
  await page.reload();
  await expect(page.locator(".wallpaper-photo[data-active]")).toHaveAttribute("src", "/wallpapers/aurora.jpg");
  await openPicker();
  await picker.getByRole("radio", { name: "미드나이트" }).click();
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-color", "midnight");
  await expect(page.locator(".wallpaper-photo")).toHaveCount(0);
  // 1×1 PNG 두 장을 내 사진으로 올리면 마지막 장이 blob: 주소로 보이고, 브라우저 저장소에 남아 새로 열어도 둘 다 유지된다.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.locator("#wallpaper-file").setInputFiles([{ name: "first.png", mimeType: "image/png", buffer: png }, { name: "second.png", mimeType: "image/png", buffer: png }]);
  await expect(picker.getByRole("radio", { name: "second" })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("radio", { name: "first" })).toHaveAttribute("aria-checked", "false");
  // 크로스페이드 중에는 이전 사진도 잠시 켜져 있으므로 맨 위 레이어만 본다.
  await expect(page.locator(".wallpaper-photo[data-active]").last()).toHaveAttribute("src", /^blob:/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("relay-wallpaper")!))).toMatchObject({ kind: "custom", id: expect.stringMatching(/^img-/) });
  await page.reload();
  await expect(page.locator(".wallpaper-photo[data-active]")).toHaveAttribute("src", /^blob:/);
  await openPicker();
  await expect(picker.getByRole("radio", { name: "first" })).toHaveCount(1);
  await expect(picker.getByRole("radio", { name: "second" })).toHaveAttribute("aria-checked", "true");
  await picker.getByRole("radio", { name: "first" }).click();
  await expect(picker.getByRole("radio", { name: "first" })).toHaveAttribute("aria-checked", "true");
  await page.locator("#wallpaper-file").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.locator(".settings-error")).toContainText("이미지 파일만");
  // 보고 있던 사진을 지우면 기본(그래파이트)으로 돌아가고, 다른 사진은 남는다.
  await page.getByRole("button", { name: "first 지우기" }).click();
  await expect(picker.getByRole("radio", { name: "first" })).toHaveCount(0);
  await expect(picker.getByRole("radio", { name: "second" })).toHaveCount(1);
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-color", "graphite");
  await expect(picker.getByRole("radio", { name: "그래파이트" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "second 지우기" }).click();
  await expect(picker.getByRole("radio", { name: "second" })).toHaveCount(0);
  await page.reload();
  await openPicker();
  await expect(picker.getByRole("radio", { name: /first|second/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("설정의 글자 크기는 창 안의 글자·줄 높이·줄바꿈 기준을 함께 키우고, 메뉴바·메뉴는 그대로 두며 다시 열어도 유지된다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("font-size", "글자 크기 확인", "anthropic", "claude-code", "두 줄로 넘어가는 긴 요약 ".repeat(8));
  await ready(page);
  const metrics = (selector: string) => page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight), height: element.getBoundingClientRect().height };
  });
  const toolbarWrap = () => page.locator(`${win("sessions")} .titlebar`).evaluate((element) => getComputedStyle(element).flexWrap);
  // 창 배치 저장은 200ms 뒤에 이뤄지므로, 새로고침 뒤에는 메뉴로 설정 창을 다시 연다.
  const openSettings = async () => {
    await page.locator(".menubar-mark").click();
    expect((await metrics(".menu-item")).size).toBe(13);
    await page.getByRole("menuitem", { name: "설정…" }).click();
  };
  // 글자 크기는 shadcn Select로 고른다. 목록은 body 포털에 뜨는 listbox다.
  const select = page.getByRole("combobox", { name: "글자 크기" });
  const listbox = page.getByRole("listbox");
  await openSettings();
  await expect(select).toHaveText("13px (기본)");
  await select.click();
  await expect(listbox.getByRole("option")).toHaveText(["12px", "13px (기본)", "14px", "15px", "16px", "17px", "18px"]);
  await expect(listbox.getByRole("option", { name: "13px (기본)" })).toHaveAttribute("data-state", "checked");
  expect(await metrics(".session-name")).toMatchObject({ size: 13, line: 20 });
  await listbox.getByRole("option", { name: "18px" }).click();
  await expect(listbox).toHaveCount(0);
  await expect(select).toHaveText("18px");
  await expect.poll(async () => (await metrics(".session-name")).size).toBe(18);
  expect(await page.evaluate(() => localStorage.getItem("relay-font-size"))).toBe("18");
  // 미리보기는 줄 높이와 함께 커져 두 줄 고정을 지키고, 한 줄짜리 버튼은 위아래 여백을 지킨 채 자란다.
  expect((await metrics(".session-name")).line).toBeCloseTo(20 * 18 / 13, 1);
  const summary = await metrics(".row-summary");
  expect(summary.size).toBeCloseTo(12 * 18 / 13, 1);
  expect(summary.height).toBeCloseTo(summary.line * 2, 0);
  const button = await metrics(`${win("settings")} [data-slot="button"][data-size="sm"]`);
  expect(button.height).toBeCloseTo(button.size + 15, 0);
  // 메뉴바는 운영체제 화면처럼 크기를 고정한다.
  expect((await metrics(".menubar-app")).size).toBe(13);
  expect((await metrics("#connection-state")).size).toBe(11);
  await page.screenshot({ path: test.info().outputPath("font-size-18.png") });
  // 툴바 줄바꿈 기준도 글자를 따라 넓어진다: 760px 창이 18px에서는 두 줄, 13px에서는 한 줄이다.
  await page.setViewportSize({ width: 760, height: 900 });
  await page.locator(dock("세션")).click();
  await expect.poll(toolbarWrap).toBe("wrap");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect.poll(async () => (await metrics(".session-name")).size).toBe(18);
  await openSettings();
  await expect(select).toHaveText("18px");
  // 키보드로도 연다. 목록 글자도 커지고, 열린 목록에서는 / 검색 단축키가 동작하지 않으며, Esc로 닫으면 버튼으로 초점이 돌아온다.
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(listbox).toBeVisible();
  expect((await metrics('[data-slot="select-item"]')).size).toBe(18);
  await page.keyboard.press("/");
  await expect(page.locator("#search")).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(select).toBeFocused();
  await select.click();
  await listbox.getByRole("option", { name: "13px (기본)" }).click();
  await expect.poll(async () => (await metrics(".session-name")).size).toBe(13);
  await page.setViewportSize({ width: 760, height: 900 });
  await page.locator(dock("세션")).click();
  await expect.poll(toolbarWrap).toBe("nowrap");
  expect(errors).toEqual([]);
});

test("세션·메모·파일 탐색기의 왼쪽 패널은 경계를 끌어 넓히고, 다시 열어도 남으며, 두 번 누르면 기본 폭으로 돌아간다", async ({ page }) => {
  record("split", "패널 폭 확인");
  await ready(page);
  const cases = [
    { app: "세션", id: "sessions", side: ".list-panel", base: 340 },
    { app: "메모", id: "notes", side: ".notes-sidebar", base: 256 },
    { app: "파일 탐색기", id: "files", side: ".files-sidebar", base: 240 },
  ];
  const width = async (id: string, side: string) => Math.round((await box(page, `${win(id)} ${side}`)).width);
  // 픽셀 반올림 차이는 1px까지 같은 폭으로 본다.
  const near = async (id: string, side: string, value: number) => Math.abs((await width(id, side)) - value) <= 1;
  for (const { app, id, side, base } of cases) {
    await page.locator(dock(app)).click();
    await expect(page.locator(win(id))).toHaveAttribute("data-focused", "");
    // 창이 떠오르는 동안은 크기가 작으므로 다 뜰 때까지 기다린다.
    await expect.poll(() => near(id, side, base)).toBe(true);
    const handle = page.locator(`${win(id)} .split-handle`);
    await expect(handle).toHaveAttribute("role", "separator");
    const edge = await box(page, `${win(id)} .split-handle`);
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + 60, edge.y + edge.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => near(id, side, base + 60)).toBe(true);
  }
  // 창마다 따로 기억한다.
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  for (const { app, id, side, base } of cases) {
    await page.locator(dock(app)).click();
    await expect.poll(() => near(id, side, base + 60)).toBe(true);
  }
  // 창 크기를 바꿔도 왼쪽 폭은 그대로다.
  await page.locator(`${win("files")} .window-title`).dblclick();
  await expect(page.locator(win("files"))).toHaveAttribute("data-maximized", "");
  await expect.poll(() => near("files", ".files-sidebar", 300)).toBe(true);
  // 키보드로도 옮기고, 두 번 누르면 기본 폭
  await page.locator(`${win("files")} .split-handle`).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width("files", ".files-sidebar")).toBeLessThan(300);
  await page.locator(`${win("files")} .split-handle`).dblclick();
  await expect.poll(() => near("files", ".files-sidebar", 240)).toBe(true);
  // 최소 폭 아래로는 줄지 않는다.
  const edge = await box(page, `${win("files")} .split-handle`);
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x - 300, edge.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => near("files", ".files-sidebar", 168)).toBe(true);
});
