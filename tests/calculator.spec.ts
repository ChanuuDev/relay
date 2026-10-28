import { test, expect, type Page } from "@playwright/test";
import { launch, ready, stop, useRelayServer, env } from "./web-helpers";

useRelayServer();

const win = (page: Page) => page.locator('.window[data-window="calculator"]');
const key = (page: Page, name: string) => win(page).getByRole("button", { name, exact: true });
/** 서버에 저장된 이력(화면이 보낸 것). */
const saved = (page: Page) => page.evaluate(async () => (await (await fetch("/api/v1/calculator/history", { cache: "no-store" })).json()).items as Array<{ expression: string; result: string }>);

async function openCalculator(page: Page) {
  await ready(page);
  await page.locator('.dock-item[aria-label="계산기"]').click();
  await expect(win(page)).toBeVisible();
  await expect(win(page).locator(".notes-sync")).toHaveText("Relay DB에 저장됨");
}

test("계산기: 키패드와 키보드로 계산하고, 끝낸 계산은 Relay DB 이력에 남아 새로 고쳐도 보인다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openCalculator(page);
  const big = win(page).locator(".calc-big");
  const upper = win(page).locator(".calc-upper");
  await expect(win(page).locator(".calc-empty")).toContainText("계산 기록이 없습니다");
  await expect(key(page, "모두 지우기")).toHaveText("AC");

  // 키패드: 7 × 8 = 56. 고른 연산자는 뒤집혀 보이고, 입력 중에는 지우기 키가 ⌫가 된다.
  for (const name of ["7", "곱하기"]) await key(page, name).click();
  await expect(key(page, "곱하기")).toHaveAttribute("data-active", "");
  await expect(key(page, "지우기")).toBeVisible();
  await key(page, "8").click();
  await expect(upper).toHaveText("= 56");
  await key(page, "계산").click();
  await expect(big).toHaveText("56");
  await expect(upper).toHaveText("7 × 8 =");
  await expect(key(page, "모두 지우기")).toHaveText("AC");

  // 키보드: 결과에 이어 계산하고, `/`는 세션 검색이 아니라 나누기다. 곱셈이 덧셈보다 먼저다.
  await page.keyboard.type("/4+0.1*3");
  await expect(big).toHaveText("56 ÷ 4 + 0.1 × 3");
  await expect(page.locator("#search")).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(big).toHaveText("14.3");
  await page.keyboard.type("1234567");
  await expect(big).toHaveText("1,234,567");
  await page.keyboard.press("Backspace");
  await expect(big).toHaveText("123,456");
  await page.keyboard.press("Escape");
  await expect(big).toHaveText("0");
  await page.keyboard.type("5/0");
  await page.keyboard.press("Enter");
  await expect(big).toHaveText("0으로 나눌 수 없습니다");
  await page.keyboard.press("Escape");

  const entries = win(page).locator(".calc-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("56 ÷ 4 + 0.1 × 3");
  await expect(entries.nth(0)).toContainText("= 14.3");
  await expect(entries.nth(1)).toContainText("7 × 8");
  await expect.poll(() => saved(page)).toEqual([
    expect.objectContaining({ expression: "56 ÷ 4 + 0.1 × 3", result: "14.3" }),
    expect.objectContaining({ expression: "7 × 8", result: "56" }),
  ]);
  await expect(win(page).locator(".calc-history-foot")).toContainText("계산 2개");

  // 새로 고쳐도 이력은 서버에서 다시 오고, 하던 입력도 남는다.
  await page.keyboard.type("9+");
  await page.reload();
  await expect(entries).toHaveCount(2);
  await expect(big).toHaveText("9 +");
  // 새로 고치면 세션 창이 앞에 오므로 Dock으로 계산기를 앞으로 가져온다.
  await page.locator(".dock-item[aria-label=\"계산기\"]").click();
  // 기록을 누르면 연산자 뒤에 결과가 이어 붙는다.
  await entries.nth(1).click();
  await expect(big).toHaveText("9 + 56");
  await page.keyboard.press("Enter");
  await expect(big).toHaveText("65");
  await expect(entries).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("계산기: 기록을 메뉴로 지우고, 확인을 거쳐 모두 지운다", async ({ page }) => {
  await openCalculator(page);
  for (const text of ["2*21", "100-1", "3+4"]) { await page.keyboard.type(text); await page.keyboard.press("Enter"); }
  const entries = win(page).locator(".calc-entry");
  await expect(entries).toHaveCount(3);

  await entries.filter({ hasText: "100 − 1" }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "식 다시 쓰기" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "식 다시 쓰기" }).click();
  await expect(win(page).locator(".calc-big")).toHaveText("100 − 1");
  await entries.filter({ hasText: "100 − 1" }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "삭제" }).click();
  await expect(entries).toHaveCount(2);
  await expect.poll(async () => (await saved(page)).map((item) => item.expression)).toEqual(["3 + 4", "2 × 21"]);

  // 키보드: 행에서 Delete로 지운다.
  await entries.first().focus();
  await page.keyboard.press("Delete");
  await expect(entries).toHaveCount(1);

  await win(page).getByRole("button", { name: "기록 모두 지우기" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("계산 기록을 모두 지울까요?");
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(entries).toHaveCount(1);
  await win(page).getByRole("button", { name: "기록 모두 지우기" }).click();
  await dialog.getByRole("button", { name: "모두 지우기" }).click();
  await expect(win(page).locator(".calc-empty")).toBeVisible();
  await expect.poll(() => saved(page)).toEqual([]);
});

test("계산기: 서버가 꺼진 동안 끝낸 계산은 브라우저에 남았다가 서버가 다시 뜨면 저장된다", async ({ page }) => {
  await openCalculator(page);
  await stop();
  await page.keyboard.type("6*7");
  await page.keyboard.press("Enter");
  await expect(win(page).locator(".calc-entry")).toHaveCount(1);
  await expect(win(page).locator(".notes-sync")).toHaveText("저장 대기 · 다시 시도 중");
  expect(await page.evaluate(() => localStorage.getItem("relay-calculator-pending-v1"))).toContain("6 × 7");
  await launch();
  await expect(win(page).locator(".notes-sync")).toHaveText("Relay DB에 저장됨", { timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem("relay-calculator-pending-v1"))).toBeNull();
  const response = await fetch(`${env.url}/api/v1/calculator/history`);
  expect((await response.json()).items).toEqual([expect.objectContaining({ expression: "6 × 7", result: "42" })]);
});

test("계산기: 좁은 화면에서는 키패드가 먼저 보이고, 기록 단추로 기록과 바꿔 본다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalculator(page);
  await expect(win(page).locator(".calc-pad")).toBeVisible();
  await expect(win(page).locator(".calc-history")).toBeHidden();
  await page.keyboard.type("12*3");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1+");
  const toggle = win(page).getByRole("button", { name: "기록", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(win(page).locator(".calc-pad")).toBeHidden();
  await win(page).locator(".calc-entry").first().click();
  await expect(win(page).locator(".calc-pad")).toBeVisible();
  await expect(win(page).locator(".calc-big")).toHaveText("1 + 36");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
