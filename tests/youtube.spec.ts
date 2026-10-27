import { test, expect, type Page } from "@playwright/test";
import { env, ready, useRelayServer } from "./web-helpers";

useRelayServer();

const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** 유튜브로 나가는 요청은 모두 가짜 응답으로 바꿔, 네트워크 없이 창의 동작만 검사한다. */
async function stubYouTube(page: Page, hits: string[]) {
  await page.route(/https:\/\/(www\.)?(youtube(-nocookie)?\.com|i\.ytimg\.com)\//, (route) => {
    const url = route.request().url();
    hits.push(url);
    if (url.includes("/oembed?")) return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ title: "테스트 영상 제목" }) });
    if (url.includes("i.ytimg.com")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>player stub</title><body>player</body>" });
  });
}

test("YouTube 창: 주소를 넣으면 창 안에서 재생하고 뒤로·새로 고침·최근 목록이 동작한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const hits: string[] = [];
  await stubYouTube(page, hits);
  await ready(page);
  await page.locator(dock("YouTube")).click();
  await expect(page.locator(win("youtube"))).toBeVisible();
  await expect(page.locator(win("youtube"))).toHaveAttribute("data-focused", "");
  await expect(page.locator(".menubar-app")).toHaveText("YouTube");
  // 시작 페이지: 주소창에 초점, 탐색 버튼은 비활성.
  const address = page.getByLabel("주소", { exact: true });
  await expect(address).toBeFocused();
  await expect(page.locator(".start-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "뒤로" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "새로 고침" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "YouTube에서 열기" })).toBeDisabled();

  // 긴 주소를 넣으면 nocookie 플레이어가 시작 시각과 함께 열린다.
  await address.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s");
  await address.press("Enter");
  const frame = page.locator(".browser-frame");
  await expect(frame).toHaveAttribute("src", /^http:\/\/localhost:\d+\/youtube\/player\?v=dQw4w9WgXcQ&start=65$/);
  // 플레이어는 localhost 출처의 래퍼 페이지가 띄운다(유튜브가 IP 주소 Referer의 플레이어를 거부하므로).
  await expect.poll(() => page.frames().map((f) => f.url()).filter((u) => /youtube-nocookie\.com\/embed\//.test(u)))
    .toEqual([expect.stringMatching(/\/embed\/dQw4w9WgXcQ\?autoplay=1&rel=0&playsinline=1&start=65$/)]);
  const wrapper = await page.request.get((await frame.getAttribute("src")) ?? "");
  expect(wrapper.status()).toBe(200);
  expect(wrapper.headers()["content-security-policy"]).toContain(`frame-ancestors http://127.0.0.1:${env.port} http://localhost:${env.port}`);
  expect(await wrapper.text()).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;rel=0&amp;playsinline=1&amp;start=65");
  await expect(address).toHaveValue("youtube.com/watch?v=dQw4w9WgXcQ&t=65s");
  await expect(page.locator(".browser-loading")).toHaveCount(0);
  await expect(page.locator(".start-page")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "뒤로" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "YouTube에서 열기" })).toBeEnabled();
  await expect.poll(() => hits.some((url) => url.includes("/oembed?") && url.includes("dQw4w9WgXcQ"))).toBe(true);

  // 짧은 주소와 영상 ID도 받는다. 같은 영상을 다시 열면 이력이 늘지 않는다.
  await address.fill("youtu.be/aqz-KE-bpKQ");
  await address.press("Enter");
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=aqz-KE-bpKQ$/);
  await address.fill("aqz-KE-bpKQ");
  await address.press("Enter");
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=aqz-KE-bpKQ$/);
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=dQw4w9WgXcQ&start=65$/);
  await page.getByRole("button", { name: "앞으로" }).click();
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=aqz-KE-bpKQ$/);

  // 시작 페이지로 돌아가면 최근 본 항목이 oEmbed 제목과 섬네일로 보인다.
  await page.getByRole("button", { name: "시작 페이지" }).click();
  await expect(page.locator(".start-page")).toBeVisible();
  await expect(page.locator(".recent-tile")).toHaveCount(2);
  await expect(page.locator(".recent-caption").first()).toHaveText("테스트 영상 제목");
  await expect(page.locator(".recent-thumb").first()).toHaveAttribute("src", "https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg");
  await page.locator(".recent-open").first().click();
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=aqz-KE-bpKQ$/);

  // 재생목록 주소는 재생목록 플레이어로 연다.
  await address.fill("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  await address.press("Enter");
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf$/);
  await expect.poll(() => page.frames().some((f) => /\/embed\/videoseries\?autoplay=1&rel=0&playsinline=1&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf$/.test(f.url()))).toBe(true);
  await expect(address).toHaveValue("youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");

  // 알아볼 수 없는 입력은 창 안에서 열지 않고 YouTube 검색을 제안한다.
  await address.fill("고양이 영상");
  await address.press("Enter");
  await expect(page.locator(".browser-notice")).toBeVisible();
  await expect(page.getByRole("button", { name: "YouTube에서 검색" })).toBeVisible();
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?list=/);
  await page.getByRole("button", { name: "알림 닫기" }).click();
  await expect(page.locator(".browser-notice")).toHaveCount(0);

  // 최근 목록은 브라우저에 남고, 새로 열면 시작 페이지에서 다시 보인다.
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect(page.locator(win("youtube"))).toBeVisible();
  // 새로 열면 세션 창이 앞에 오므로 Dock에서 YouTube 창을 앞으로 가져온다.
  await page.locator(dock("YouTube")).click();
  await expect(page.locator(win("youtube"))).toHaveAttribute("data-focused", "");
  await expect(page.locator(".start-page")).toBeVisible();
  await expect(page.locator(".recent-tile")).toHaveCount(3);
  await page.locator(".recent-tile").first().hover();
  await page.locator(".recent-remove").first().click();
  await expect(page.locator(".recent-tile")).toHaveCount(2);
  await page.getByRole("button", { name: "모두 지우기" }).click();
  await expect(page.locator(".recent-tile")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("relay-youtube-v1"))).toBeNull();

  // ×로 창을 닫으면 보던 영상·이력·최근 본 항목이 모두 지워진다. 최소화는 재생을 그대로 둔다.
  await address.fill("dQw4w9WgXcQ");
  await address.press("Enter");
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=dQw4w9WgXcQ$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("relay-youtube-v1") ?? "{}").recent?.length)).toBe(1);
  await page.locator(`${win("youtube")} .window-control[data-window-action="minimize"]`).click();
  await expect(page.locator(win("youtube"))).toBeHidden();
  await expect(page.locator(".browser-frame")).toHaveCount(1);
  await page.locator(dock("YouTube")).click();
  await expect(page.locator(win("youtube"))).toBeVisible();
  await expect(frame).toHaveAttribute("src", /\/youtube\/player\?v=dQw4w9WgXcQ$/);
  await page.locator(`${win("youtube")} .window-control[data-window-action="close"]`).click();
  await expect(page.locator(win("youtube"))).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("relay-youtube-v1"))).toBeNull();
  await page.locator(dock("YouTube")).click();
  await expect(page.locator(win("youtube"))).toBeVisible();
  await expect(page.locator(".start-page")).toBeVisible();
  await expect(page.locator(".recent-tile")).toHaveCount(0);
  await expect(page.locator(".browser-frame")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "뒤로" })).toBeDisabled();
  await expect(address).toHaveValue("");
  expect(hits.some((url) => url.startsWith("https://www.youtube.com/watch"))).toBe(false);
  expect(errors).toEqual([]);
});

test("YouTube 창: 모바일에서는 전체 화면이고 주소창이 제목 아래로 내려간다", async ({ page }) => {
  await stubYouTube(page, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator(dock("YouTube")).click();
  await expect(page.locator(win("youtube"))).toBeVisible();
  // 열리는 애니메이션 중에 두 상자를 따로 재면 그 사이 프레임이 바뀔 수 있어, 한 번에 재고 자리 잡을 때까지 다시 본다.
  await expect.poll(() => page.locator(win("youtube")).evaluate((section) => {
    const title = section.querySelector(".window-title")!.getBoundingClientRect();
    const toolbar = section.querySelector(".window-toolbar")!.getBoundingClientRect();
    return toolbar.top > title.bottom - 1;
  })).toBe(true);
  await page.getByLabel("주소", { exact: true }).fill("dQw4w9WgXcQ");
  await page.getByLabel("주소", { exact: true }).press("Enter");
  await expect(page.locator(".browser-frame")).toBeVisible();
  // 창은 화면 너비를 꽉 채우고 플레이어는 창 본문 너비를 따른다(테두리 1px 안쪽).
  await expect.poll(() => page.locator(win("youtube")).evaluate((section) => {
    const frame = section.querySelector(".browser-frame")!.getBoundingClientRect();
    const body = section.querySelector(".window-body")!.getBoundingClientRect();
    const box = section.getBoundingClientRect();
    return [Math.round(box.x), Math.round(box.width), Math.abs(frame.width - body.width) <= 1];
  })).toEqual([0, 390, true]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await page.request.get(env.url);
  expect(response.headers()["content-security-policy"]).toContain(`frame-src 'self' http://localhost:${env.port}`);
});
