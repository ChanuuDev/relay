import { test, expect, type Page } from "@playwright/test";
import { cli, ready, record, useRelayServer } from "./web-helpers";

useRelayServer();

const win = (page: Page) => page.locator('.window[data-window="office"]');
const choice = (page: Page, name: string) => win(page).getByRole("radio", { name });

/** 캔버스 가운데 띠의 평균 밝기(0–255). 밤 사옥보다 낮 사옥이 훨씬 밝다. */
const brightness = (page: Page) => win(page).locator(".office-canvas").evaluate((canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d")!;
  const { data } = context.getImageData(0, Math.round(canvas.height * 0.3), canvas.width, Math.round(canvas.height * 0.4));
  let sum = 0, count = 0;
  for (let index = 0; index < data.length; index += 32) { sum += (data[index]! + data[index + 1]! + data[index + 2]!) / 3; count++; }
  return sum / count;
});

test("사무실: 왼쪽 아래 단추로 사옥을 바꾸면 그 사옥의 자리에 모두 다시 앉고, 고른 사옥은 다시 열어도 남는다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  record("hq-working", "사옥 작업", "anthropic", "claude-code", "작업 시작");
  cli(["update", "--session-id", "hq-working", "--status", "working", "--summary", "작업 중"]);
  record("hq-blocked", "사옥 막힘", "openai", "codex", "확인 대기");
  cli(["update", "--session-id", "hq-blocked", "--status", "blocked", "--summary", "사용자 결정 대기"]);

  await ready(page);
  await page.locator('.dock-item[aria-label="사무실"]').click();
  await expect(win(page).locator(".office-stage[data-ready]")).toBeVisible();
  const group = win(page).getByRole("radiogroup", { name: "사옥" });
  await expect(group.getByRole("radio")).toHaveText(["야간 본사", "자작나무 사옥", "오크 사옥"]);
  await expect(choice(page, "야간 본사")).toHaveAttribute("aria-checked", "true");
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-building", "night");
  await expect.poll(() => brightness(page)).toBeGreaterThan(5);
  const night = await brightness(page);

  // 낮 사옥으로 바꾸면 그림이 밝아지고, 캐릭터는 그대로 자기 구역에 있다.
  await choice(page, "자작나무 사옥").click();
  await expect(choice(page, "자작나무 사옥")).toHaveAttribute("aria-checked", "true");
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-building", "birch");
  await expect.poll(() => brightness(page)).toBeGreaterThan(night + 40);
  await expect(win(page).locator("[data-office-agent]")).toHaveCount(2);
  await expect(win(page).locator("[data-office-agent]", { hasText: "사옥 작업" })).toContainText("작업 중");
  await expect(win(page).locator("[data-office-agent]", { hasText: "사옥 막힘" })).toContainText("막힘");
  await expect(win(page).locator(".office-canvas")).toHaveAttribute("data-fade", /odd|even/);

  // 방향키로 다음 사옥을 고르고 초점도 따라간다.
  await choice(page, "자작나무 사옥").focus();
  await page.keyboard.press("ArrowRight");
  await expect(choice(page, "오크 사옥")).toHaveAttribute("aria-checked", "true");
  await expect(choice(page, "오크 사옥")).toBeFocused();
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-building", "oak");

  // 새로 열어도 고른 사옥이 남는다.
  await page.reload();
  await ready(page);
  if (!(await win(page).isVisible())) await page.locator('.dock-item[aria-label="사무실"]').click();
  await expect(win(page).locator(".office-stage[data-ready]")).toBeVisible();
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-building", "oak");
  await expect(choice(page, "오크 사옥")).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});
