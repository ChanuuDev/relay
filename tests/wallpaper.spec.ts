import { test, expect, type Page } from "@playwright/test";
import { record, ready, useRelayServer } from "./web-helpers";

useRelayServer();

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const photos = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `photo-${index + 1}.png`, mimeType: "image/png", buffer: png }));
const carousel = (page: Page) => page.getByRole("region", { name: "바탕화면 사진", exact: true });
const gallery = (page: Page) => page.getByRole("dialog", { name: "바탕화면 사진 전체보기" });
const offset = (page: Page, index: number) => carousel(page).locator(".wallpaper-page").nth(index).evaluate(element =>
  Math.abs(element.getBoundingClientRect().left - element.parentElement!.parentElement!.getBoundingClientRect().left));

async function openSettings(page: Page) {
  await page.locator(".menubar-mark").click();
  await page.getByRole("menuitem", { name: "바탕화면 변경…" }).click();
  await expect(carousel(page)).toBeVisible();
}

test("사진 캐러셀은 페이지 버튼·가로 스크롤·키보드로 이동하고 선택한 페이지를 복원한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("carousel", "사진 캐러셀 확인");
  await ready(page); await openSettings(page);
  const rail = carousel(page);
  const count = rail.locator(".wallpaper-page-count");
  await expect(count).toHaveText("1 / 2");
  await expect(rail.getByRole("button", { name: "이전 사진 페이지" })).toBeDisabled();
  await rail.getByRole("button", { name: "다음 사진 페이지" }).click();
  await expect(count).toHaveText("2 / 2");
  await expect(rail.getByRole("button", { name: "다음 사진 페이지" })).toBeDisabled();
  await rail.getByRole("radio", { name: "안개 숲" }).click();
  await expect(page.locator(".wallpaper-photo[data-active]").last()).toHaveAttribute("src", "/wallpapers/forest.jpg");
  await page.reload(); await openSettings(page);
  await expect(count).toHaveText("2 / 2");
  await expect(rail.getByRole("radio", { name: "안개 숲" })).toHaveAttribute("aria-checked", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await rail.focus(); await page.keyboard.press("Home");
  await expect(count).toHaveText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(count).toHaveText("2 / 2");
  await rail.getByRole("button", { name: "사진 1페이지" }).click();
  await expect.poll(() => offset(page, 0)).toBeLessThan(2);
  await rail.locator(".wallpaper-viewport").hover();
  await page.mouse.wheel(600, 0);
  await expect(count).toHaveText("2 / 2");
  expect(await rail.locator(".wallpaper-page").evaluateAll(pages => pages.map(page => (page as HTMLElement).inert))).toEqual([true, false]);
  await page.screenshot({ path: test.info().outputPath("wallpaper-carousel-dark.png") });
  expect(errors).toEqual([]);
});

test("우측 전체보기는 모든 사진을 표시하며 추가·선택·삭제와 닫기 후 초점 복귀를 지원한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  record("gallery", "전체 사진 확인");
  await ready(page); await openSettings(page);
  const trigger = page.getByRole("button", { name: "전체보기", exact: true });
  const header = await trigger.boundingBox();
  const title = await page.locator("#wallpaper-settings h3").boundingBox();
  expect(header!.x).toBeGreaterThan(title!.x + title!.width);
  await expect(trigger.locator("svg")).toHaveCount(1);
  await trigger.click();
  const dialog = gallery(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(5);
  await expect(dialog.getByRole("radio", { name: "기본" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "사진 추가…" }).click();
  await (await chooser).setFiles(photos(7));
  await expect(dialog.getByRole("radio")).toHaveCount(12);
  await expect(dialog.getByRole("radio", { name: "photo-7", exact: true })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "오로라" }).click();
  await expect(dialog.getByRole("radio", { name: "오로라" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "photo-7 지우기" }).click();
  await expect(dialog.getByRole("radio")).toHaveCount(11);
  await page.screenshot({ path: test.info().outputPath("wallpaper-gallery-dark.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(carousel(page).locator(".wallpaper-page-count")).toHaveText("1 / 4");
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await trigger.click();
  await page.screenshot({ path: test.info().outputPath("wallpaper-gallery-light.png") });
  await dialog.getByRole("button", { name: "전체보기 닫기" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator(".wallpaper-dialog-overlay").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("마지막 페이지의 사진 삭제와 창 크기 변경 뒤에도 유효한 페이지와 선택 상태를 유지한다", async ({ page }) => {
  record("gallery-delete", "사진 페이지 경계 확인");
  await ready(page); await openSettings(page);
  await page.locator("#wallpaper-file").setInputFiles(photos(7));
  const rail = carousel(page);
  await expect(rail.locator(".wallpaper-page-count")).toHaveText("4 / 5");
  await rail.getByRole("button", { name: "사진 5페이지" }).click();
  await expect(rail.locator(".wallpaper-page-count")).toHaveText("5 / 5");
  await page.getByRole("button", { name: "전체보기", exact: true }).click();
  await gallery(page).getByRole("button", { name: "photo-1 지우기" }).click();
  await gallery(page).getByRole("button", { name: "전체보기 닫기" }).click();
  await expect(rail.locator(".wallpaper-page-count")).toHaveText("4 / 4");
  await expect.poll(() => offset(page, 3)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => offset(page, 3)).toBeLessThan(2);
  await page.getByRole("button", { name: "전체보기", exact: true }).click();
  await gallery(page).getByRole("button", { name: "photo-7 지우기" }).click();
  await page.keyboard.press("Escape");
  await expect(rail.locator(".wallpaper-page-count")).toHaveText("1 / 4");
  await expect(rail.getByRole("radio", { name: "기본" })).toHaveAttribute("aria-checked", "true");
});

test.describe("모바일 사진 목록", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("터치로 캐러셀을 넘기고 전체 사진을 스크롤하며 좁은 화면에서도 넘치지 않는다", async ({ page }) => {
    record("gallery-mobile", "모바일 사진 목록 확인");
    await ready(page); await openSettings(page);
    const rail = carousel(page);
    const rect = (await rail.locator(".wallpaper-viewport").boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const y = rect.y + rect.height / 2;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + rect.width - 24, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x + rect.width - 24 - step * (rect.width - 48) / 8, y }] });
      await page.waitForTimeout(20);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(rail.locator(".wallpaper-page-count")).toHaveText("2 / 2");
    await page.locator("#wallpaper-file").setInputFiles(photos(20));
    await expect(rail.locator(".wallpaper-page-count")).toHaveText("9 / 9");
    await page.getByRole("button", { name: "전체보기", exact: true }).click();
    const dialog = gallery(page);
    await expect(dialog.getByRole("radio")).toHaveCount(25);
    await dialog.getByRole("radio", { name: "photo-20", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("radio", { name: "photo-20", exact: true })).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("wallpaper-gallery-mobile.png") });
    await page.keyboard.press("Escape");
    await expect(rail.locator(".wallpaper-page-count")).toHaveText("9 / 9");
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(rail.locator(".wallpaper-page-count")).toHaveText("9 / 9");
    await expect.poll(() => offset(page, 8)).toBeLessThan(2);
    await expect(rail.getByRole("radio", { name: "photo-20", exact: true })).toBeInViewport();
    await expect.poll(() => rail.locator(".wallpaper-viewport").evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("wallpaper-carousel-320.png") });
  });
});
