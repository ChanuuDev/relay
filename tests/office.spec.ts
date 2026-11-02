import { test, expect, type Page } from "@playwright/test";
import { cli, ready, record, useRelayServer } from "./web-helpers";

useRelayServer();

const win = (page: Page) => page.locator('.window[data-window="office"]');
const agent = (page: Page, name: string) => win(page).locator("[data-office-agent]", { hasText: name });

/** 캔버스에서 배경색(#0b1020)과 다른 픽셀의 비율. 사무실 그림이 그려졌는지 본다. */
const painted = (page: Page) => win(page).locator(".office-canvas").evaluate((canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d")!;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let index = 0; index < data.length; index += 16) if (Math.abs(data[index]! - 11) + Math.abs(data[index + 1]! - 16) + Math.abs(data[index + 2]! - 32) > 24) count++;
  return count / (data.length / 16);
});

test("사무실: 세션마다 캐릭터가 상태 구역 책상에 앉고, 상태가 바뀌면 옮겨 가며, 말풍선에 기록 이력이 보인다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  record("office-working", "API 응답 검증", "anthropic", "claude-code", "API 수정 시작");
  cli(["update", "--session-id", "office-working", "--status", "working", "--summary", "테스트 통과"]);
  record("office-blocked", "입력값 확인", "openai", "codex", "입력값을 기다림");
  cli(["update", "--session-id", "office-blocked", "--status", "blocked", "--summary", "사용자 결정 대기"]);
  record("office-done", "결과 정리", "xai", "grok", "정리 끝");
  cli(["update", "--session-id", "office-done", "--status", "done", "--summary", "작업 완료"]);
  record("office-new", "막 시작한 세션");

  await ready(page);
  await page.locator('.dock-item[aria-label="사무실"]').click();
  await expect(win(page)).toBeVisible();
  await expect(win(page).locator(".office-stage[data-ready]")).toBeVisible();
  await expect(win(page).locator("[data-office-agent]")).toHaveCount(4);
  await expect(agent(page, "API 응답 검증")).toContainText("작업 중");
  await expect(agent(page, "입력값 확인")).toContainText("막힘");
  await expect(agent(page, "결과 정리")).toContainText("완료");
  await expect(agent(page, "막 시작한 세션")).toContainText("홀");
  const legend = win(page).locator(".office-legend");
  await expect(legend).toContainText("작업 중1");
  await expect(legend).toContainText("홀1");
  await expect.poll(() => painted(page)).toBeGreaterThan(0.5);

  // 키보드로 캐릭터에 초점을 두면 말풍선이 머리 위에 뜨고, 최근 기록이 오래된 것부터 보인다.
  await agent(page, "API 응답 검증").focus();
  const bubble = win(page).locator(".office-bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.locator(".office-bubble-title")).toHaveText("API 응답 검증");
  await expect(bubble).toContainText("claude-code");
  await expect(bubble.locator(".office-bubble-lines li")).toHaveText([/API 수정 시작/, /테스트 통과/]);
  const stage = await win(page).locator(".office-stage").boundingBox();
  const box = await bubble.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(stage!.y - 1);
  expect(box!.x + box!.width / 2).toBeGreaterThan(stage!.x);
  expect(box!.x + box!.width / 2).toBeLessThan(stage!.x + stage!.width);
  await agent(page, "API 응답 검증").blur();
  await expect(bubble).toHaveCount(0);

  // 상태가 바뀌면 구역이 바뀐다(목록 폴링 3초).
  cli(["update", "--session-id", "office-blocked", "--status", "done", "--summary", "답을 받아 끝냄"]);
  await expect(agent(page, "입력값 확인")).toContainText("완료", { timeout: 10000 });
  await expect(legend).toContainText("완료2");

  // 확대하면 전체 보기 단추가 켜지고, 누르면 처음 배율로 돌아온다.
  const fit = win(page).getByRole("button", { name: "전체 보기" });
  await expect(fit).toBeDisabled();
  await win(page).getByRole("button", { name: "확대" }).click();
  await expect(fit).toBeEnabled();
  await fit.click();
  await expect(fit).toBeDisabled();

  // 캐릭터를 고르면(Enter) 세션 창에서 그 세션 상세가 열린다.
  await agent(page, "결과 정리").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sessions\//);
  await expect(page.locator('.window[data-window="sessions"]')).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("결과 정리");
  expect(errors).toEqual([]);
});
