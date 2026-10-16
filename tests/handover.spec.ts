import { expect, test } from "@playwright/test";
import { clipboardText, cli, env, ready, record, root, useRelayServer } from "./web-helpers";

useRelayServer();

test("declared state, pin, git clue, chain and the hand-over copies reach the browser", async ({ page, context }) => {
  // The first session is recorded inside this repository, so its record carries a working tree clue.
  const origin = cli(["record", "--provider", "openai", "--agent", "codex", "--session-id", "origin", "--session-name", "뿌리 작업", "--cwd", root, "--summary", "첫 기록"]);
  cli(["update", "--session-id", "origin", "--summary", "남은 일 넘김", "--status", "handoff"]);
  cli(["continue", "origin", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "taken", "--session-name", "이어받은 작업", "--summary", "이어서 진행", "--status", "blocked"]);
  cli(["pin", "taken", "--provider", "anthropic"]);
  record("plain", "표시 없는 작업");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await ready(page);
  await expect(page.locator("#list-content .session-row")).toHaveCount(3);
  await expect(page.locator("#list-content .status-badge")).toHaveText(["막힘", "인계 대기"]);
  await expect(page.locator("#list-content .pin-mark")).toHaveCount(1);
  await expect(page.locator(".stale-badge")).toHaveCount(0);

  // The advanced row filters by the declared state and by the pin; the chips say it in words.
  await page.getByRole("button", { name: "상세 필터" }).click();
  await page.getByLabel("작업 상태").selectOption("handoff");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  await expect(page.locator(".filter-chips")).toContainText("인계 대기");
  await page.getByLabel("고정", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
  await expect(page.locator(".filter-chips")).toContainText("고정만");
  await page.getByRole("button", { name: "전체 초기화" }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(3);

  await page.locator("#list-content").getByRole("link", { name: "이어받은 작업" }).click();
  const panel = page.getByRole("complementary", { name: "세션 상세" });
  await expect(panel.locator(".detail-topline .status-badge")).toHaveText("막힘");
  await expect(panel.locator(".detail-topline .pin-mark")).toHaveCount(1);
  await expect(page.locator("[data-testid=session-status]")).toHaveText("막힘 · 고정");
  await expect(page.locator("[data-testid=session-git]")).toContainText(" @ ");
  await expect(page.locator("[data-testid=resume-command]")).toHaveText("claude --resume 'taken'");
  await panel.getByRole("button", { name: "원본 세션 재개 명령 복사" }).click();
  expect(await clipboardText(page)).toBe("claude --resume 'taken'");
  await panel.getByRole("button", { name: "인계 문서 복사" }).click();
  const note = await clipboardText(page);
  for (const piece of ["# 인계: 이어받은 작업", "- 작업 상태: 막힘 · 고정", "- Git: ", "> 이어서 진행", "## 세션 흐름", "**현재**", "claude --resume 'taken'",
    "relay show 'taken' --provider 'anthropic'"]) expect(note).toContain(piece);

  // The history carries the state each entry was written in; the chain shows the whole line of work.
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry] .status-badge")).toHaveText(["막힘"]);
  await page.getByRole("tab", { name: /세션 연결/ }).click();
  await expect(page.locator("#chain-content [data-testid=chain-node]")).toHaveCount(2);
  await expect(page.locator("#chain-content [aria-current=true]")).toContainText("이어받은 작업");
  await expect(page.locator("#chain-content [data-testid=chain-node]").first()).toContainText("인계 대기");
  await page.locator("#chain-content").getByRole("link", { name: "뿌리 작업" }).click();
  await expect(page).toHaveURL(new RegExp(origin.session.id));
  await expect(page.getByRole("tab", { name: /세션 연결/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#chain-content [aria-current=true]")).toContainText("뿌리 작업");
  await expect(page.locator("#children-content")).toContainText("이어받은 작업");

  // A session alone has no flow, no state and, for a tool Relay does not know, no resume command.
  await page.getByRole("link", { name: "목록으로 돌아가기", exact: false }).click();
  await page.locator("#list-content").getByRole("link", { name: "표시 없는 작업" }).click();
  await expect(page.locator("#chain-content")).toContainText("이어진 흐름 없음");
  await page.getByRole("tab", { name: /개요/ }).click();
  await expect(page.locator("[data-testid=session-status]")).toHaveText("미기록");
  await expect(page.locator("[data-testid=resume-command]")).toHaveText("codex resume 'plain'");
  // CLI changes land in the open detail: a new state and name show within the polling interval.
  cli(["update", "--session-id", "plain", "--summary", "끝", "--status", "done", "--session-name", "이름 바뀐 작업"]);
  await expect(page.locator("[data-testid=session-status]")).toHaveText("완료", { timeout: 5000 });
  await expect(panel.locator("h2")).toHaveText("이름 바뀐 작업");
  await expect(page.locator("#list-content .status-badge")).toHaveText(["완료", "막힘", "인계 대기"]);
});
