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

test("사무실: 상태 구역 책상에 앉고, 작업 중이면 말풍선으로 말하며, 메뉴·끌어 놓기로 상태를 바꾸고 퇴근하면 로비로 간다", async ({ page }) => {
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

  // 작업 중인 세션은 머리 위에 지금 하는 일을 말한다(숨쉬듯 위아래로 흔들린다).
  const talk = win(page).locator('.office-talk[data-kind="work"]');
  await expect(talk).toHaveCount(1);
  await expect(talk).toBeVisible();
  await expect(talk).toContainText("테스트 통과");
  expect(await talk.evaluate((element) => getComputedStyle(element).animationName)).toBe("office-float");

  // 캐릭터를 고르면(Enter) 상태 메뉴가 열린다. 상태를 바꾸면 그 구역으로 옮겨 간다.
  await agent(page, "막 시작한 세션").focus();
  await page.keyboard.press("Enter");
  const menu = page.locator(".office-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio")).toHaveText(["작업 중", "막힘", "인계 대기", "완료"]);
  await menu.getByRole("menuitemradio", { name: "인계 대기" }).click();
  await expect(win(page).locator(".office-toast")).toContainText("인계 대기로 옮깁니다");
  await expect(agent(page, "막 시작한 세션")).toContainText("인계 대기");
  await expect(legend).toContainText("홀0");

  // 퇴근(작업 종료)은 완료로 표시하고 세션을 끝낸다. 캐릭터는 로비로 가서 1분 머문다.
  await agent(page, "API 응답 검증").focus();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "퇴근 (작업 종료)" }).click();
  await expect(win(page).locator(".office-toast")).toContainText("로비로 갑니다");
  await expect(agent(page, "API 응답 검증")).toContainText("완료, 종료됨");
  const ended = cli(["show", "office-working", "--provider", "anthropic"]);
  expect(ended.session.status).toBe("done");
  expect(ended.session.endedAt).not.toBeNull();

  // 캐릭터를 끌어 다른 방에 놓으면 그 방의 작업 상태가 된다. 끄는 동안 커서는 잡은 손이다.
  const area = await win(page).locator(".office-stage").boundingBox();
  const fitScale = Math.min(area!.width / 1676, area!.height / 938);
  const screen = (x: number, y: number) => ({ x: area!.x + (area!.width - 1676 * fitScale) / 2 + x * fitScale, y: area!.y + (area!.height - 938 * fitScale) / 2 + y * fitScale });
  // 인계 방 책상에 앉은 세션을 잡아 작업 중 방에 놓는다(로비·홀 세션은 돌아다니므로 앉아 있는 세션으로 본다).
  await agent(page, "막 시작한 세션").focus();
  const detail = win(page).locator(".office-bubble");
  await expect(detail).toBeVisible();
  // 방금 인계 대기로 옮겼으니 책상에 닿아 말풍선이 멈출 때까지 기다린다.
  let bubbleBox = await detail.boundingBox();
  await expect.poll(async () => {
    const previous = bubbleBox;
    await page.waitForTimeout(300);
    bubbleBox = await detail.boundingBox();
    // 말풍선은 숨쉬듯 3px 오르내리므로 그보다 크게 움직일 때만(걷는 중) 기다린다.
    return Math.abs(bubbleBox!.x - previous!.x) + Math.abs(bubbleBox!.y - previous!.y) < 8;
  }, { timeout: 15000 }).toBe(true);
  await agent(page, "막 시작한 세션").blur();
  await expect(detail).toHaveCount(0);
  const start = { x: bubbleBox!.x + bubbleBox!.width / 2, y: bubbleBox!.y + bubbleBox!.height + 30 };
  await page.mouse.move(start.x, start.y);
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-hovering", "");
  await page.mouse.down();
  const target = screen(820, 200);
  for (let step = 1; step <= 12; step++) await page.mouse.move(start.x + ((target.x - start.x) * step) / 12, start.y + ((target.y - start.y) * step) / 12);
  await expect(win(page).locator(".office-stage")).toHaveAttribute("data-dragging", "");
  await page.mouse.up();
  await expect(win(page).locator(".office-stage")).not.toHaveAttribute("data-dragging", "");
  await expect(agent(page, "막 시작한 세션")).toContainText("작업 중");
  expect(cli(["show", "office-new", "--provider", "openai"]).session.status).toBe("working");

  // 메뉴의 세션 상세 열기는 세션 창에서 그 세션을 연다.
  await agent(page, "결과 정리").focus();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "세션 상세 열기" }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  await expect(page.locator('.window[data-window="sessions"]')).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("결과 정리");
  expect(errors).toEqual([]);
});
