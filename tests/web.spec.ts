import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { binary, cli, clipboardText, env, hook, launch, record, ready, spawnEnv, stop, useRelayServer, version } from "./web-helpers";

useRelayServer();

test("standalone binary outside source: CLI → table → detail/history → reconnect", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", err => errors.push(err.message));
  expect(spawnSync(binary, ["--version"], { cwd: env.dir, encoding: "utf8", env: spawnEnv }).stdout.trim()).toBe(version);
  expect(spawnSync(binary, ["--help"], { cwd: env.dir, encoding: "utf8", env: spawnEnv }).stdout).toContain("Usage: relay");
  const occupied = spawnSync(binary, ["web", "--data-dir", env.dir, "--port", String(env.port)], { cwd: env.dir, encoding: "utf8", timeout: 5000, env: spawnEnv });
  expect(occupied.status).toBe(6); expect(occupied.stdout).toBe(""); expect(occupied.stderr).toContain("PORT_IN_USE");
  await ready(page); await expect(page.getByText("저장된 세션이 없습니다.", { exact: false })).toBeVisible();
  const created = record("external-session", "CLI에서 시작한 한국어 작업");
  await expect(page.getByRole("link", { name: "CLI에서 시작한 한국어 작업" })).toBeVisible({ timeout: 5000 });
  await page.locator("#list-content .row-summary").first().click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${created.session.id}`));
  cli(["update", "--session-id", "external-session", "--summary", "브라우저 연결 확인\n진행 기록 두 번째 줄"]);
  await expect(page.locator(".summary")).toHaveText("브라우저 연결 확인\n진행 기록 두 번째 줄", { timeout: 5000 });
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(2);
  await page.reload(); await expect(page.locator(".summary")).toContainText("브라우저 연결 확인");
  await stop();
  await expect(page.locator("#connection-state")).toContainText("연결 끊김", { timeout: 10000 });
  await expect(page.locator(".summary")).toContainText("브라우저 연결 확인");
  cli(["update", "--session-id", "external-session", "--summary", "서버 종료 중에도 저장됨"]);
  await launch();
  await expect(page.locator(".summary")).toHaveText("서버 종료 중에도 저장됨", { timeout: 10000 });
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(3);
  await expect(page.locator("#database-path")).toContainText("relay.db");
  await page.screenshot({ path: test.info().outputPath("detail.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a closed session is marked in the list and the detail; an untouched automatic record disappears on close", async ({ page }) => {
  hook("codex", { session_id: "worked", cwd: env.dir });
  hook("codex", { session_id: "idle", cwd: env.dir });
  cli(["update", "--session-id", "worked", "--summary", "작업 맥락 기록"]);
  await ready(page);
  await expect(page.locator("#list-content .session-row")).toHaveCount(2);
  await expect(page.locator(".ended-badge")).toHaveCount(0);
  hook("codex", { session_id: "worked", reason: "prompt_input_exit" }, true);
  hook("codex", { session_id: "idle", reason: "prompt_input_exit" }, true);
  await expect(page.locator("#list-content .session-row")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator("#list-content .ended-badge")).toHaveText("종료");
  await page.locator("#list-content .row-summary").first().click();
  await expect(page.locator("[data-testid=session-end]")).toContainText("prompt_input_exit");
  await expect(page.getByRole("complementary", { name: "세션 상세" }).locator(".ended-badge")).toBeVisible();
  // The host starts the same session again: the end on record clears without a page reload.
  hook("codex", { session_id: "worked", cwd: env.dir });
  await expect(page.locator("[data-testid=session-end]")).toHaveText("기록 없음", { timeout: 5000 });
  await expect(page.locator(".ended-badge")).toHaveCount(0);
});

test("filters, >100 records, pagination, keyboard navigation, parent/child and back state", async ({ page }) => {
  for (let i = 0; i < 105; i++) record(`session-${i}`, `테이블 작업 ${i}`);
  const parent = record("claude-parent", "Claude 이전 작업", "anthropic", "claude-code");
  cli(["update", "--session-id", "claude-parent", "--summary", "작업 인계"]);
  const child = cli(["continue", "claude-parent", "--parent-provider", "anthropic", "--provider", "openai", "--agent", "codex", "--session-id", "child", "--session-name", "Codex 후속 작업", "--summary", "재개"]);
  await ready(page); await expect(page.locator("#list-content .session-row")).toHaveCount(50);
  await page.screenshot({ path: test.info().outputPath("table.png") });
  await expect(page.locator(".pager")).toContainText("총 107건");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/offset=50/); await expect(page.locator("#list-content .session-row")).toHaveCount(50);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(7);
  await page.getByLabel("Provider", { exact: true }).fill("anthropic");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  const a = page.getByRole("link", { name: "Claude 이전 작업" }); await a.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(parent.session.id));
  await page.getByRole("tab", { name: /세션 연결/ }).click();
  await page.locator("#children-content").getByRole("link", { name: "Codex 후속 작업" }).click(); await expect(page).toHaveURL(new RegExp(child.session.id));
  await page.getByRole("tab", { name: /세션 연결/ }).click();
  await page.getByRole("complementary", { name: "세션 상세" }).getByRole("link", { name: "Claude 이전 작업" }).click();
  await page.getByRole("link", { name: "목록으로 돌아가기", exact: false }).click();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("anthropic");
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  await page.getByLabel("검색", { exact: true }).fill("없는 세션"); await page.keyboard.press("Enter");
  await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
});

test("context copy is one shell-safe line handing over the lookup command, never the note itself", async ({ page, context }) => {
  const id = "literal'id; echo untrusted";
  const payload = '<img src=x onerror="window.pwned=1">\n<script>window.pwned=1</script>';
  record(id, "안전한 텍스트 검사", "openai", "codex", payload);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await ready(page);
  await page.getByRole("button", { name: "세션 컨텍스트 복사", exact: true }).click();
  await expect(page).toHaveURL(env.url + "/");
  const listContext = await clipboardText(page);
  // A line break arrives as Enter while the paste is still coming in: the receiving CLI would send
  // the first lines as a message and drop the rest.
  expect(listContext).not.toMatch(/[\r\n]/);
  for (const value of ["relay show", "--provider 'openai'", "--data-dir", env.dir.replaceAll("\\", "/")]) expect(listContext).toContain(value);
  // The ID reaches the command quoted for whichever shell the platform defaults to.
  expect(listContext).toMatch(/literal(''|'"'"')id; echo untrusted/);
  expect(listContext).toMatch(/명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요\.$/);
  // The note stays in the store; the receiving agent reads it with the command.
  expect(listContext).not.toContain(payload);
  await page.getByRole("link", { name: "안전한 텍스트 검사" }).click();
  await expect(page.locator(".summary")).toHaveText(payload);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await expect(page.locator(".summary img, .summary script")).toHaveCount(0);
  const detailPanel = page.getByRole("complementary", { name: "세션 상세" });
  const contextCopy = detailPanel.getByRole("button", { name: "세션 컨텍스트 복사", exact: true });
  await contextCopy.click();
  expect(await clipboardText(page)).toBe(listContext);
  await page.getByText("세션 식별자", { exact: true }).click();
  await page.getByRole("button", { name: "Agent Session ID만 복사", exact: true }).click();
  expect(await clipboardText(page)).toBe(id);
  const command = `relay show 'literal''id; echo untrusted' --provider 'openai' --data-dir '${env.dir.replaceAll("\\", "/")}' --json`;
  await page.getByLabel("조회 명령 셸").selectOption("powershell");
  await page.getByRole("button", { name: "조회 명령 복사" }).click();
  expect(await clipboardText(page)).toBe(command);
  await contextCopy.click();
  expect(await clipboardText(page)).toBe(`이전 세션 맥락은 \`${command}\` 명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요.`);
  await page.getByLabel("조회 명령 셸").selectOption("bash");
  await contextCopy.click();
  const bashContext = await clipboardText(page);
  expect(bashContext).toContain("'literal'\"'\"'id; echo untrusted'");
  expect(bashContext).not.toMatch(/[\r\n]/);
  const latest = "새 진행 기록\n```bash\necho note\n```\n한글 요약 끝";
  cli(["update", "--session-id", id, "--summary", latest]);
  await expect(page.locator(".summary")).toHaveText(latest);
  await contextCopy.click();
  // A multiline note leaves the copy untouched: same command, still one line.
  expect(await clipboardText(page)).toBe(bashContext);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("denied"); } }));
  await contextCopy.click();
  await expect(page.locator("#copy-text")).toHaveValue(bashContext);
  await expect(page.locator("#copy-text")).toBeFocused();
});

test("polling preserves unsaved filter text, focus and scroll; hidden tabs pause and resume", async ({ page }) => {
  record("a", "필터 유지 작업"); await ready(page);
  const search = page.getByLabel("검색", { exact: true }); await search.fill("아직 검색하지 않은 입력");
  cli(["update", "--session-id", "a", "--summary", "자동 갱신"]);
  await expect(page.locator("#list-content")).toContainText("자동 갱신", { timeout: 5000 });
  await expect(search).toHaveValue("아직 검색하지 않은 입력"); await expect(search).toBeFocused();
  // Exercise the page's visibility lifecycle deterministically in headless Chromium.
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  let requests = 0; page.on("request", request => { if (request.url().includes("/api/")) requests++; });
  await page.waitForTimeout(3400); expect(requests).toBe(0);
  cli(["update", "--session-id", "a", "--summary", "다시 보이면 즉시 조회"]);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#list-content")).toContainText("다시 보이면 즉시 조회", { timeout: 5000 });
});

test("context falls back to the default store command when storage lookup is unavailable", async ({ page, context }) => {
  record("same-id", "다른 제공자 작업");
  cli(["record", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "same-id",
    "--session-name", "완료된 Claude 작업", "--model", "recorded-model", "--cwd", env.dir, "--summary", "이전 요약"]);
  cli(["update", "--session-id", "same-id", "--provider", "anthropic", "--summary", "검증까지 마친 작업"]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
  await page.route("**/api/v1/health", route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ schemaVersion: 1, error: { message: "저장소 정보 조회 실패" } }) }));
  await page.goto(env.url);
  const row = page.locator(".session-row").filter({ has: page.getByRole("link", { name: "완료된 Claude 작업" }) });
  await row.getByRole("button", { name: "세션 컨텍스트 복사" }).click();
  const copied = await clipboardText(page);
  // Without a known store the command still runs, against the reader's default store.
  for (const value of ["relay show 'same-id'", "--provider 'anthropic'", "--json"]) expect(copied).toContain(value);
  expect(copied).not.toContain("--data-dir");
  expect(copied).not.toContain("'openai'");
  expect(copied).not.toMatch(/[\r\n]/);
});

test("partial section failure keeps detail; missing ID and invalid input are not empty state", async ({ page }) => {
  const s = record("a", "부분 실패 검사");
  await page.goto(`${env.url}/sessions/${s.session.id}`);
  await expect(page.locator(".summary")).toHaveText("첫 기록");
  await page.route("**/api/v1/sessions/*/updates?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "DB_BUSY", message: "이력 잠금" } }) }));
  await expect(page.locator(".summary")).toHaveText("첫 기록");
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-error")).toContainText("이력 잠금");
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(1);
  await page.goto(`${env.url}/sessions/absent`); await expect(page.locator("#detail-error")).toContainText("세션을 찾을 수 없습니다");
  await expect(page.getByRole("link", { name: "목록으로 돌아가기", exact: false })).toBeVisible();
  await page.goto(`${env.url}/?status=bad`); await expect(page.locator("#list-error")).toContainText("status");
  await expect(page.getByText("저장된 세션이 없습니다.", { exact: false })).toHaveCount(0);
});

test("narrow layout keeps full detail readable without page overflow", async ({ page }) => {
  const s = record("mobile", "좁은 화면 확인", "openai", "codex", "긴 한국어 요약 ".repeat(80));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${env.url}/sessions/${s.session.id}`);
  await expect(page.locator(".summary")).toContainText("긴 한국어 요약");
  await page.screenshot({ path: test.info().outputPath("mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("history and child pages beyond 50 remain navigable; detail polling preserves scroll and focus", async ({ page }) => {
  const parent = record("parent", "이력 많은 부모");
  for (let i = 0; i < 52; i++) cli(["update", "--session-id", "parent", "--summary", `진행 ${i}`]);
  cli(["update", "--session-id", "parent", "--summary", "부모 종료"]);
  for (let i = 0; i < 52; i++) cli(["continue", "parent", "--provider", "openai", "--agent", "codex", "--session-id", `child-${i}`, "--session-name", `자식 ${i}`, "--summary", "자식 시작"]);
  await page.goto(`${env.url}/sessions/${parent.session.id}`);
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(50);
  await page.locator("#updates-content").getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(4);
  await page.getByRole("tab", { name: /세션 연결/ }).click();
  await expect(page.locator("#children-content li")).toHaveCount(50);
  await page.locator("#children-content").getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#children-content li")).toHaveCount(2);
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.locator("#updates-content [data-testid=history-entry]")).toHaveCount(4);
  await page.getByRole("tab", { name: /세션 연결/ }).click();
  const childLink = page.locator("#children-content li a").first(); await childLink.click();
  await page.getByText("세션 식별자", { exact: true }).click();
  const id = await page.locator("dd").first().textContent();
  const copy = page.getByRole("complementary", { name: "세션 상세" }).getByRole("button", { name: "세션 컨텍스트 복사", exact: true }); await copy.focus();
  await page.evaluate(() => window.scrollTo(0, 450));
  const before = await page.evaluate(() => window.scrollY);
  cli(["update", "--session-id", id!, "--summary", "스크롤 유지 갱신"]);
  await expect(page.locator(".summary")).toHaveText("스크롤 유지 갱신", { timeout: 5000 });
  await expect(page.getByRole("complementary", { name: "세션 상세" }).getByRole("button", { name: "세션 컨텍스트 복사", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("slow older filter responses cannot replace newer results", async ({ page }) => {
  record("a", "이전 검색 대상", "openai", "codex");
  record("b", "새 검색 대상", "anthropic", "claude-code");
  await ready(page);
  let oldStarted!: () => void; const started = new Promise<void>(resolve => { oldStarted = resolve; });
  let releaseOld!: () => void; const released = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route("**/api/v1/sessions?**", async route => {
    const provider = new URL(route.request().url()).searchParams.get("provider");
    if (provider !== "openai") { await route.continue(); return; }
    const response = await route.fetch(); oldStarted(); await released;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel("Provider", { exact: true }).fill("openai");
  await page.getByRole("button", { name: "검색", exact: true }).click(); await started;
  await page.getByLabel("Provider", { exact: true }).fill("anthropic");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("link", { name: "새 검색 대상" })).toBeVisible();
  releaseOld(); await page.waitForTimeout(300);
  await expect(page.getByRole("link", { name: "새 검색 대상" })).toBeVisible();
  await expect(page.getByRole("link", { name: "이전 검색 대상" })).toHaveCount(0);
});

test("record filters, filter chips and browser history keep their scopes without lifecycle controls", async ({ page }) => {
  record("first", "검색할 설계 작업");
  record("second", "검색할 다른 작업", "anthropic", "claude-code");
  await ready(page);
  await expect(page.locator("#list-content .session-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /진행 중|중단됨|완료.*필터|상태 안내/ })).toHaveCount(0);
  await expect(page.locator(".stats-grid, .status-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "상세 필터", exact: true }).click();
  await page.getByLabel("Agent", { exact: true }).fill("codex");
  await page.getByLabel("프로젝트 경로", { exact: true }).fill(env.dir);
  await page.getByLabel("표시 개수", { exact: true }).selectOption("20");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page).toHaveURL(/limit=20/);
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  await page.getByRole("link", { name: "검색할 설계 작업" }).click();
  await expect(page.getByRole("complementary", { name: "세션 상세" })).toBeVisible();
  await expect(page.locator(".selected-row")).toContainText("검색할 설계 작업");
  await page.goBack();
  await expect(page.getByLabel("Agent", { exact: true })).toHaveValue("codex");
  await expect(page.getByLabel("표시 개수", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "agent 필터 해제" }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(2);
  await page.getByRole("button", { name: "전체 초기화", exact: true }).click();
  await expect(page.getByLabel("Agent", { exact: true })).toHaveValue("");
});

test("mobile list, detail tabs and return preserve a searched session without horizontal overflow", async ({ page }) => {
  record("mobile", "모바일 작업 " + "긴이름".repeat(30), "openai", "codex", "공백없는요약".repeat(150));
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByLabel("검색", { exact: true }).fill("모바일 작업");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: /^모바일 작업/ }).click();
  await expect(page.getByRole("complementary", { name: "세션 상세" })).toBeVisible();
  await expect(page.getByRole("region", { name: "세션 목록" })).toBeHidden();
  await page.getByRole("tab", { name: /기록 이력/ }).click();
  await expect(page.getByTestId("history-entry")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "목록으로 돌아가기" }).click();
  await expect(page.getByLabel("검색", { exact: true })).toHaveValue("모바일 작업");
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
});

test("search shortcut and keyboard detail navigation preserve focus and drafts", async ({ page }) => {
  record("keyboard", "키보드로 이어갈 작업");
  await ready(page);
  await page.keyboard.press("/");
  const search = page.getByLabel("검색", { exact: true });
  await expect(search).toBeFocused();
  await search.fill("키보드");
  await page.keyboard.press("/");
  await expect(search).toHaveValue("키보드/");
  await search.fill("키보드");
  await page.keyboard.press("Enter");
  const link = page.getByRole("link", { name: "키보드로 이어갈 작업" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "세션 상세" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "목록으로 돌아가기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(link).toBeFocused();
  await expect(search).toHaveValue("키보드");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
});

test("record discovery and warm responsive workspace stay usable at narrow widths", async ({ page }) => {
  record("resume", "이전 디자인 작업");
  cli(["update", "--session-id", "resume", "--summary", "재개할 작업"]);
  record("active", "다른 작업");
  await ready(page);
  await page.getByRole("button", { name: "이전 기록 찾기" }).click();
  await expect(page.getByLabel("검색", { exact: true })).toBeFocused();
  await page.getByLabel("검색", { exact: true }).fill("이전 디자인");
  await page.keyboard.press("Enter");
  await expect(page.locator("#list-content .session-row")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "이전 디자인 작업" })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1920, 1280, 1024, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("검색", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "이전 디자인 작업" }).click();
    await expect(page.locator(".summary")).toHaveText("재개할 작업");
    const copy = page.getByRole("complementary", { name: "세션 상세" }).getByRole("button", { name: "세션 컨텍스트 복사", exact: true });
    await expect(copy).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`desktop-detail-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "목록으로 돌아가기" }).click();
    await expect(page.getByRole("link", { name: "이전 디자인 작업" })).toBeFocused();
  }
});

test("connection indicator stays neutral until loaded and reflects offline recovery", async ({ page }) => {
  record("connection", "연결 상태 확인");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/health", async route => { await pending; await route.continue(); });
  await page.goto(env.url);
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "pending");
  release();
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "online");
  await stop();
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "offline", { timeout: 10000 });
  await expect(page.getByRole("link", { name: "연결 상태 확인" })).toBeVisible();
  await launch();
  await expect(page.locator("#connection-state .connection-dot")).toHaveAttribute("data-state", "online", { timeout: 10000 });
});
