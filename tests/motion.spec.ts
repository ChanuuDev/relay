import { test, expect, type Page } from "@playwright/test";
import { cli, env, record, ready, useRelayServer } from "./web-helpers";

useRelayServer();

const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const frame = (id: string) => `${win(id)} .window-frame`;

/** 페이지 안에서 눌러 두 프레임 뒤를 본다: 300ms 미만의 과도 상태를 왕복 지연 없이 관측한다. */
function clickAndCount(page: Page, click: string, probe: string) {
  return page.evaluate(({ click, probe }) => {
    document.querySelector<HTMLElement>(click)?.click();
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelectorAll(probe).length)));
    });
  }, { click, probe });
}

/** 같은 방식으로, 텍스트가 일치하는 링크를 누른다. */
function clickTextAndCount(page: Page, selector: string, text: string, probe: string) {
  return page.evaluate(({ selector, text, probe }) => {
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => node.textContent === text)?.click();
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelectorAll(probe).length)));
    });
  }, { selector, text, probe });
}

/** data-pulsing·data-entering이 붙는 순간을 세는 감시자를 심는다(gsap을 전역에 노출하지 않는다). */
async function watchRows(page: Page) {
  await page.evaluate(() => {
    const seen = { pulsing: 0, entering: 0 };
    (window as unknown as { __motionSeen: typeof seen }).__motionSeen = seen;
    new MutationObserver((records) => {
      for (const entry of records) {
        const element = entry.target as HTMLElement;
        if (!element.classList?.contains("session-row")) continue;
        if (entry.attributeName === "data-pulsing" && element.hasAttribute("data-pulsing")) seen.pulsing += 1;
        if (entry.attributeName === "data-entering" && element.hasAttribute("data-entering")) seen.entering += 1;
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-pulsing", "data-entering"] });
  });
}
const rowMarks = (page: Page) => page.evaluate(() => (window as unknown as { __motionSeen: { pulsing: number; entering: number } }).__motionSeen);

const boxOf = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`no box for ${selector}`);
  return rect;
};

test("창 닫기는 종료 트윈을 재생한 뒤 DOM에서 사라진다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("close", "닫기 확인");
  await ready(page);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  const closing = await clickAndCount(page,
    `${win("settings")} .traffic-light[data-light="close"]`, `${win("settings")}[data-closing]`);
  expect(closing).toBe(1);
  await expect(page.locator(win("settings"))).toHaveCount(0, { timeout: 500 });
  // reduced-motion에서는 과도 상태 없이 즉시 사라져도 통과한다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  await page.getByRole("button", { name: "설정 창 닫기" }).click();
  await expect(page.locator(win("settings"))).toHaveCount(0, { timeout: 500 });
  expect(errors).toEqual([]);
});

test("최소화는 Dock으로 접히고 복원은 원래 자리로 되돌린다", async ({ page }) => {
  record("min", "최소화 확인");
  await ready(page);
  const before = await boxOf(page, win("sessions"));
  const minimizing = await clickAndCount(page,
    `${win("sessions")} .traffic-light[data-light="minimize"]`, `${win("sessions")}[data-minimizing]`);
  expect(minimizing).toBe(1);
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-minimized", "", { timeout: 600 });
  await expect(page.locator(dock("세션"))).toHaveAttribute("data-open", "");
  await page.locator(dock("세션")).click();
  await expect(page.locator(win("sessions"))).toBeVisible();
  await page.waitForTimeout(400);
  const after = await boxOf(page, win("sessions"));
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
});

test("최대화는 Flip으로 프레임을 늘린다", async ({ page }) => {
  record("max", "최대화 확인");
  await ready(page);
  const viewport = page.viewportSize()!;
  const start = (await boxOf(page, frame("sessions"))).width;
  await page.getByRole("button", { name: "세션 창 최대화" }).click();
  await page.waitForTimeout(100);
  const middle = (await boxOf(page, frame("sessions"))).width;
  expect(middle).toBeGreaterThan(start);
  expect(middle).toBeLessThan(viewport.width);
  await page.waitForTimeout(500);
  expect(Math.abs((await boxOf(page, frame("sessions"))).width - viewport.width)).toBeLessThanOrEqual(1);
});

test("세션 교체는 클론 오버레이로 크로스페이드된다", async ({ page }) => {
  record("swap-a", "첫 세션", "openai", "codex", "요약 에이");
  record("swap-b", "둘째 세션", "anthropic", "claude-code", "요약 비");
  await ready(page);
  await page.getByRole("link", { name: "첫 세션" }).click();
  await expect(page.locator(".summary")).toHaveText("요약 에이");
  const clones = await clickTextAndCount(page, ".session-name", "둘째 세션", ".detail-clone");
  expect(clones).toBe(1);
  await expect(page.locator(".detail-clone")).toHaveCount(0, { timeout: 500 });
  await expect(page.locator(".summary")).toHaveText("요약 비");
  await expect(page.getByRole("complementary", { name: "세션 상세" })).toBeFocused();
  await expect(page).toHaveURL(/\/sessions\/ses_/);
});

test("목록 갱신은 Flip으로 재정렬되고 바뀐 행만 밝아진다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("row-1", "첫째 기록");
  record("row-2", "둘째 기록");
  record("row-3", "셋째 기록");
  await ready(page);
  await expect(page.locator("#list-content .session-row")).toHaveCount(3);
  await expect(page.locator(".session-row").first().locator(".session-name")).toHaveText("셋째 기록");
  await watchRows(page);
  cli(["update", "--session-id", "row-2", "--summary", "맨 위로 올라온 갱신"]);
  await expect(page.locator(".session-row").first().locator(".session-name")).toHaveText("둘째 기록", { timeout: 6000 });
  await expect(page.locator("#list-content .session-row")).toHaveCount(3);
  // 갱신된 행에만 pulse가 걸리고, 새 행 진입은 없다.
  await expect.poll(async () => (await rowMarks(page)).pulsing, { timeout: 2000 }).toBeGreaterThanOrEqual(1);
  expect((await rowMarks(page)).entering).toBe(0);
  expect(errors).toEqual([]);
});

test("변화 없는 폴링에서는 아무것도 움직이지 않는다", async ({ page }) => {
  record("quiet", "조용한 기록");
  await ready(page);
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  await page.waitForTimeout(600);
  await watchRows(page);
  await page.waitForTimeout(4000);
  expect(await rowMarks(page)).toEqual({ pulsing: 0, entering: 0 });
});

test("메뉴는 페이드인하고 Esc에 종료 트윈 뒤 사라진다", async ({ page }) => {
  record("menu", "메뉴 확인");
  await ready(page);
  const opacity = await page.evaluate(() => {
    document.querySelector<HTMLElement>(".menubar-mark")?.click();
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const menu = document.querySelector("[role=menu]");
        resolve(menu ? Number(getComputedStyle(menu).opacity) : -1);
      }));
    });
  });
  expect(opacity).toBeGreaterThanOrEqual(0);
  expect(opacity).toBeLessThan(1);
  await page.waitForTimeout(300);
  expect(await page.locator("[role=menu]").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=menu]")).toHaveCount(0, { timeout: 500 });
  await expect(page.locator(".menubar-mark")).toBeFocused();
});

test("복사 토스트는 떠오른 뒤 3.5초 안에 사라진다", async ({ page, context }) => {
  record("toast", "토스트 확인");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await ready(page);
  await page.getByRole("button", { name: "세션 컨텍스트 복사" }).click();
  await expect(page.locator("#copy-status")).toBeVisible();
  await expect(page.locator("#copy-status")).toContainText("복사했습니다.");
  await expect(page.locator("#copy-status")).toHaveCount(0, { timeout: 3500 });
});

test("reduced-motion에서는 열기·닫기·교체가 즉시 반영된다", async ({ page }) => {
  record("rm-a", "첫 세션", "openai", "codex", "요약 에이");
  record("rm-b", "둘째 세션", "anthropic", "claude-code", "요약 비");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.locator(dock("설정")).click();
  await expect(page.locator(win("settings"))).toBeVisible();
  await page.getByRole("button", { name: "설정 창 닫기" }).click();
  await expect(page.locator(win("settings"))).toHaveCount(0, { timeout: 400 });
  await page.getByRole("link", { name: "첫 세션" }).click();
  await expect(page.locator(".summary")).toHaveText("요약 에이");
  expect(await clickTextAndCount(page, ".session-name", "둘째 세션", ".detail-clone")).toBe(0);
  await expect(page.locator(".summary")).toHaveText("요약 비");
  await page.getByRole("button", { name: "세션 창 최소화" }).click();
  await expect(page.locator(win("sessions"))).toHaveAttribute("data-minimized", "", { timeout: 400 });
});

test("감사용 프레임 캡처: 창 열기와 세션 교체", async ({ page }) => {
  record("shot-a", "캡처 세션 에이", "openai", "codex", "요약 에이");
  record("shot-b", "캡처 세션 비", "anthropic", "claude-code", "요약 비");
  await ready(page);
  const frames = async (label: string, run: () => Promise<unknown>) => {
    const started = Date.now();
    await run();
    for (const at of [0, 80, 160, 260]) {
      const wait = at - (Date.now() - started);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: test.info().outputPath(`motion-${label}-${at}.png`) });
    }
  };
  await frames("window-open", () => page.evaluate((selector) => document.querySelector<HTMLElement>(selector)?.click(), dock("설정")));
  await page.getByRole("button", { name: "설정 창 닫기" }).click();
  await expect(page.locator(win("settings"))).toHaveCount(0);
  await page.getByRole("link", { name: "캡처 세션 에이" }).click();
  await expect(page.locator(".summary")).toHaveText("요약 에이");
  await frames("session-swap", () => page.evaluate((text) =>
    Array.from(document.querySelectorAll<HTMLElement>(".session-name")).find((node) => node.textContent === text)?.click(), "캡처 세션 비"));
  await expect(page.locator(".summary")).toHaveText("요약 비");
});
