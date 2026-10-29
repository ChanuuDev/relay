import { test, expect, type Page } from "@playwright/test";
import { env, launch, ready, record, stop, useRelayServer } from "./web-helpers";

useRelayServer();

const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`no box for ${selector}`);
  return rect;
};
const region = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).getPropertyValue("app-region"));
const themeColor = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute("content");
/** 메뉴바에 맞춰 잰 제목 표시줄 색. 테마를 바꾸는 순간처럼 아직 고정 테마 색이면 null이다. */
const tone = async (page: Page) => {
  const parts = /^rgb\((\d+), (\d+), (\d+)\)$/.exec((await themeColor(page)) ?? "");
  return parts ? parts.slice(1).map(Number) as [number, number, number] : null;
};
const luminance = (rgb: number[] | null) => (rgb ? 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! : -1);
/** 잰 색이 붉은 쪽(warm)인지 푸른 쪽(cool)인지. */
const hue = async (page: Page) => {
  const rgb = await tone(page);
  return !rgb ? "unmeasured" : rgb[0] > rgb[2] + 20 ? "warm" : rgb[2] > rgb[0] + 20 ? "cool" : "neutral";
};

/** Chromium의 설치 제안 이벤트를 흉내 낸다. prompt()가 불린 횟수를 남기고, 사용자는 outcome대로 답한다. */
function offerInstall(page: Page, outcome: "accepted" | "dismissed") {
  return page.evaluate((outcome) => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { (window as unknown as { prompted: number }).prompted = ((window as unknown as { prompted?: number }).prompted ?? 0) + 1; },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

/** 설치한 앱이 제목 표시줄을 숨기고 그 자리를 쓰는 상태(Window Controls Overlay)를 흉내 낸다.
 *  Windows처럼 오른쪽 138px에 창 조작 버튼이 있고 높이는 33px이다. window.titlebar로 상태를 바꾼다. */
function emulateTitlebarOverlay(page: Page) {
  return page.addInitScript(() => {
    const overlay = Object.assign(new EventTarget(), {
      visible: true,
      getTitlebarAreaRect: () => (overlay.visible ? new DOMRect(0, 0, innerWidth - 138, 33) : new DOMRect(0, 0, 0, 0)),
    });
    Object.defineProperty(Navigator.prototype, "windowControlsOverlay", { configurable: true, get: () => overlay });
    (window as unknown as { titlebar: typeof overlay }).titlebar = overlay;
  });
}

/** 서비스 워커가 셸을 담고 이 화면을 맡을 때까지 기다린다. */
function controlled(page: Page) {
  return page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(navigator.serviceWorker.controller && registration?.active?.state === "activated");
  }, null, { timeout: 15000 });
}

test("Chrome이 매니페스트를 오류 없이 읽고 설치할 수 있는 앱으로 판단한다", async ({ page, context }) => {
  record("manifest", "설치 조건 확인");
  await ready(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.url).toBe(`${env.url}/manifest.webmanifest`);
  expect(manifest.errors).toEqual([]);
  expect(await cdp.send("Page.getInstallabilityErrors")).toEqual({ installabilityErrors: [] });
  // 아이콘은 실제 이미지로 디코딩되고 매니페스트에 적은 크기와 같다.
  const sizes = await page.evaluate(() => Promise.all([192, 512].map(async (size) => {
    const bitmap = await createImageBitmap(await (await fetch(`/icons/app-${size}.png`)).blob());
    return `${bitmap.width}x${bitmap.height}`;
  })));
  expect(sizes).toEqual(["192x192", "512x512"]);
});

test("서버가 꺼져도 설치한 앱 화면이 열리고, 서버를 켜면 저절로 다시 연결된다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  record("offline", "앱 창에서 보던 작업");
  await ready(page);
  await expect(page.getByRole("link", { name: "앱 창에서 보던 작업" })).toBeVisible();
  await controlled(page);
  // 화면을 여는 데 필요한 정적 자산만 담고 세션 데이터(/api/)는 담지 않는다.
  const saved = await page.evaluate(async () => (await (await caches.open("relay-shell-v1")).keys()).map((request) => new URL(request.url).pathname));
  expect(saved).toEqual(expect.arrayContaining(["/", "/app.js", "/style.css", "/theme.js", "/fonts/PretendardVariable.woff2", "/icons/app-192.png"]));
  expect(saved.filter((path) => path.startsWith("/api/"))).toEqual([]);

  await stop();
  await page.reload();
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "offline", { timeout: 10000 });
  await expect(page.locator(".menubar")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dock" })).toBeVisible();
  await expect(page.locator("#list-error")).toContainText("Relay 서버에 연결할 수 없습니다. 설치한 Relay를 자동으로 켜는 중입니다(브라우저가 물으면 열기)");
  await expect(page.locator("#list-error")).toContainText(`터미널에서 relay web --headless --port ${env.port}로 서버를 켜세요`);
  // 화면은 Windows에 등록한 relay:// 링크로 설치한 relay에게 서버를 켜 달라고 한다. 외부 프로토콜이라 화면은 그대로 남는다.
  await expect(page.locator("html")).toHaveAttribute("data-server-launch", `relay://web?port=${env.port}`);
  await expect(page.locator("#list-error").getByRole("button", { name: "서버 켜기" })).toBeVisible();
  expect(await page.evaluate(() => document.fonts.check('13px "Pretendard Variable"'))).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("offline-shell.png") });

  await launch();
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "online", { timeout: 10000 });
  await expect(page.getByRole("link", { name: "앱 창에서 보던 작업" })).toBeVisible();
  await expect(page.locator("#list-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("브라우저가 설치를 제안하면 설정 창과 Relay 메뉴에서 앱으로 설치한다", async ({ page }) => {
  record("install", "설치 제안 확인");
  await ready(page);
  await page.locator(dock("설정")).click();
  const app = page.locator("#app-settings");
  await expect(app).toContainText("브라우저 탭에서 보는 중");
  await page.locator(".menubar-mark").click();
  await expect(page.getByRole("menu")).toContainText("설정…");
  await expect(page.getByRole("menuitem", { name: "앱으로 설치…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 설정 창의 버튼: 사용자가 설치 창을 닫으면 버튼이 사라지고 원래 안내로 돌아간다.
  await offerInstall(page, "dismissed");
  await app.getByRole("button", { name: "앱으로 설치" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  await expect(app.getByRole("button", { name: "앱으로 설치" })).toHaveCount(0);
  await expect(app).toContainText("브라우저 탭에서 보는 중");

  // Relay 메뉴: 다시 제안이 오면 메뉴에도 나타나고, 수락하면 설치 완료를 알린다.
  await offerInstall(page, "accepted");
  await page.locator(".menubar-mark").click();
  await page.getByRole("menuitem", { name: "앱으로 설치…" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(2);
  await expect(app).toContainText("설치했습니다");
  await expect(app).toContainText("시작 메뉴나 작업 표시줄에서 Relay를 여세요");
});

test("설치한 앱 창 안에서는 설치 안내 대신 실행 중임을 알린다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => query !== "(display-mode: standalone)" ? original(query)
      : Object.assign(new EventTarget(), { matches: true, media: query, onchange: null, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
  });
  const created = record("standalone", "앱 창 확인");
  await ready(page);
  await offerInstall(page, "accepted");
  await page.locator(dock("설정")).click();
  const app = page.locator("#app-settings");
  await expect(app).toContainText("앱 창에서 실행 중");
  await expect(app.getByRole("button", { name: "앱으로 설치" })).toHaveCount(0);
  await page.locator(".menubar-mark").click();
  await expect(page.getByRole("menu")).toContainText("설정…");
  await expect(page.getByRole("menuitem", { name: "앱으로 설치…" })).toHaveCount(0);
  // 앱 창 제목에는 운영체제가 앱 이름을 붙이므로 세션 이름만 둔다.
  await page.goto(`${env.url}/sessions/${created.session.id}`);
  await expect(page).toHaveTitle("앱 창 확인");
});

test("설치한 앱의 제목 표시줄 색은 메뉴바 유리에 비친 바탕화면 색을 따른다", async ({ page }) => {
  const created = record("tone", "제목 표시줄 색 확인");
  await ready(page);
  // 밤 사진 위 어두운 유리: 고정 테마 색 대신 잰 값이 들어간다.
  await expect.poll(() => themeColor(page)).toMatch(/^rgb\(/);
  expect(luminance(await tone(page))).toBeLessThan(90);
  await page.locator(dock("설정")).click();
  const picker = page.getByRole("radiogroup", { name: "바탕화면" });
  await picker.getByRole("radio", { name: "선셋" }).click();
  await expect.poll(() => hue(page)).toBe("warm");
  await picker.getByRole("radio", { name: "미드나이트" }).click();
  await expect.poll(() => hue(page)).toBe("cool");
  const midnight = luminance(await tone(page));
  // 라이트 테마는 밝은 유리라 제목 표시줄도 밝아진다.
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect.poll(async () => luminance(await tone(page))).toBeGreaterThan(midnight + 60);
  // 브라우저 탭에서는 다른 탭과 구분되도록 앱 이름을 붙인다.
  await page.goto(`${env.url}/sessions/${created.session.id}`);
  await expect(page).toHaveTitle("제목 표시줄 색 확인 · Relay");
});

test("설치한 앱이 제목 표시줄을 숨기면 메뉴바가 그 자리를 쓰고 창 조작 버튼 자리를 비운다", async ({ page }) => {
  await emulateTitlebarOverlay(page);
  record("titlebar", "제목 표시줄 통합 확인");
  await ready(page);
  const viewport = page.viewportSize()!;
  await expect(page.locator("html")).toHaveAttribute("data-titlebar", "overlay");
  const bar = await box(page, ".menubar");
  expect(bar.height).toBe(33);
  // 오른쪽 끝 항목도 창 조작 버튼 자리(오른쪽 138px)에 들어가지 않는다.
  const clock = await box(page, ".menubar-clock");
  expect(clock.x + clock.width).toBeLessThanOrEqual(viewport.width - 138 - 8);
  // 빈 곳은 앱 창을 옮기는 손잡이이고, 단추는 그대로 눌린다.
  expect(await region(page, ".menubar")).toBe("drag");
  for (const selector of [".menubar-mark", ".menubar-app", ".menubar-icon", ".menubar-clock"]) expect(await region(page, selector)).toBe("no-drag");
  await page.locator(".menubar-mark").click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await region(page, ".menu-overlay")).toBe("no-drag");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: test.info().outputPath("titlebar-overlay.png") });

  // 창은 높아진 메뉴바 아래에서 시작한다.
  await page.getByRole("button", { name: "세션 창 최대화" }).click();
  await expect.poll(async () => Math.round((await box(page, win("sessions"))).y)).toBe(33);

  // 창 조작 버튼 바탕은 제목 표시줄 색으로 칠해지므로, 버튼이 놓이는 오른쪽 끝의 색을 잰다(미드나이트는 오른쪽 위가 더 어둡다).
  await page.locator(dock("설정")).click();
  await page.getByRole("radiogroup", { name: "바탕화면" }).getByRole("radio", { name: "미드나이트" }).click();
  await expect.poll(() => hue(page)).toBe("cool");
  const overlayTone = luminance(await tone(page));

  // 제목 표시줄을 다시 보이면 원래 메뉴바로 돌아가고, 제목 표시줄 색은 메뉴바 전체 폭에서 잰다.
  await page.evaluate(() => {
    const overlay = (window as unknown as { titlebar: EventTarget & { visible: boolean } }).titlebar;
    overlay.visible = false;
    overlay.dispatchEvent(new Event("geometrychange"));
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-titlebar", "overlay");
  expect((await box(page, ".menubar")).height).toBe(28);
  expect(await region(page, ".menubar")).toBe("none");
  await expect.poll(async () => Math.round((await box(page, win("sessions"))).y)).toBe(28);
  await expect.poll(async () => luminance(await tone(page))).toBeGreaterThan(overlayTone + 5);
});
