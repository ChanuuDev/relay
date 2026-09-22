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
  for (const [path, type] of [["/wallpaper-dark.jpg", "image/jpeg"], ["/wallpaper-light.jpg", "image/jpeg"],
    ["/icons/sessions.png", "image/png"], ["/fonts/PretendardVariable.woff2", "font/woff2"]] as const) {
    const response = await page.request.get(env.url + path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toBe(type);
  }
  expect(await page.evaluate(() => document.fonts.check('13px "Pretendard Variable"'))).toBe(true);
  const active = page.locator(".wallpaper-image[data-active]");
  await expect(active).toHaveAttribute("src", "/wallpaper-dark.jpg");
  await expect.poll(() => active.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect(active).toHaveAttribute("src", "/wallpaper-light.jpg");
  const widths = await page.locator(".dock-item img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth));
  expect(widths).toHaveLength(4);
  for (const width of widths) expect(width).toBeGreaterThan(0);
});

test("데스크톱 기본 배치: Dock 네 앱, 세션·가이드 창이 열린다", async ({ page }) => {
  record("layout", "기본 배치");
  await ready(page);
  await expect(page.locator(".dock-item")).toHaveCount(4);
  for (const name of ["세션", "가이드", "명령", "설정"]) await expect(page.locator(dock(name))).toBeVisible();
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
  expect(Math.abs(maximized.y + maximized.height - (viewport.height - 88))).toBeLessThanOrEqual(1);
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
  await expect(page.locator(".dock-label")).toHaveCount(4);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  await expect(page.locator(win("sessions"))).toBeHidden();
  await page.locator(dock("세션")).click();
  await expect(page.locator(win("sessions"))).toBeVisible();
  await expect(page.locator(win("settings"))).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
