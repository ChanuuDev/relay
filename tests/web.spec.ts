import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "dist", process.platform === "win32" ? "relay.exe" : "relay");
let dir: string;
let port: number;
let server: ChildProcess | undefined;
let url: string;

function cli(args: string[]) {
  const result = spawnSync(binary, [...args, "--data-dir", dir, "--json"], { cwd: dir, encoding: "utf8", timeout: 10000 });
  if (result.status !== 0) throw new Error(`CLI failed: ${result.stderr} ${result.error ?? ""}`);
  return JSON.parse(result.stdout);
}
function start(id: string, name: string, provider = "openai", agent = "codex", summary = "첫 기록") {
  return cli(["start", "--provider", provider, "--agent", agent, "--session-id", id, "--session-name", name, "--cwd", dir, "--summary", summary]);
}
async function launch() {
  server = spawn(binary, ["web", "--data-dir", dir, "--port", String(port)], { cwd: dir, windowsHide: true, stdio: "pipe" });
  let logs = ""; server.stderr?.on("data", chunk => { logs += chunk; });
  await expect.poll(async () => {
    if (server?.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { return (await fetch(`${url}/api/v1/health`)).status; } catch { return 0; }
  }).toBe(200);
}
async function stop() {
  const child = server; server = undefined;
  if (!child || child.exitCode !== null) return;
  const done = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM"); await done;
}
async function ready(page: Page) {
  await page.goto(url);
  await expect(page.locator("#connection-state")).toContainText("연결됨");
}

test.beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "relay-browser-"));
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  url = `http://127.0.0.1:${port}`;
  await launch();
});
test.afterEach(async () => {
  await stop();
  const target = realpathSync(dir);
  if (path.dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() || !path.basename(target).startsWith("relay-browser-")) throw new Error("Unsafe cleanup");
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("standalone binary outside source: CLI → table → detail/history → reconnect", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", err => errors.push(err.message));
  expect(spawnSync(binary, ["--version"], { cwd: dir, encoding: "utf8" }).stdout.trim()).toBe("0.1.0");
  expect(spawnSync(binary, ["--help"], { cwd: dir, encoding: "utf8" }).stdout).toContain("Usage: relay");
  const occupied = spawnSync(binary, ["web", "--data-dir", dir, "--port", String(port)], { cwd: dir, encoding: "utf8", timeout: 5000 });
  expect(occupied.status).toBe(6); expect(occupied.stdout).toBe(""); expect(occupied.stderr).toContain("PORT_IN_USE");
  await ready(page); await expect(page.getByText("저장된 세션이 없습니다.", { exact: false })).toBeVisible();
  const created = start("external-session", "CLI에서 시작한 한국어 작업");
  await expect(page.getByRole("link", { name: "CLI에서 시작한 한국어 작업" })).toBeVisible({ timeout: 5000 });
  await page.locator("#list-content tbody tr td").nth(2).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${created.session.id}`));
  cli(["update", "--session-id", "external-session", "--summary", "브라우저 연결 확인\n진행 기록 두 번째 줄"]);
  await expect(page.locator(".summary")).toHaveText("브라우저 연결 확인\n진행 기록 두 번째 줄", { timeout: 5000 });
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(2);
  await page.reload(); await expect(page.locator(".summary")).toContainText("브라우저 연결 확인");
  await stop();
  await expect(page.locator("#connection-state")).toContainText("연결 끊김", { timeout: 10000 });
  await expect(page.locator(".summary")).toContainText("브라우저 연결 확인");
  cli(["finish", "--session-id", "external-session", "--status", "interrupted", "--summary", "서버 종료 중에도 저장됨"]);
  await launch();
  await expect(page.locator(".summary")).toHaveText("서버 종료 중에도 저장됨", { timeout: 10000 });
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(3);
  await expect(page.locator("#database-path")).toContainText("relay.db");
  await page.screenshot({ path: test.info().outputPath("detail.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("filters, >100 records, pagination, keyboard navigation, parent/child and back state", async ({ page }) => {
  for (let i = 0; i < 105; i++) start(`session-${i}`, `테이블 작업 ${i}`);
  const parent = start("claude-parent", "Claude 이전 작업", "anthropic", "claude-code");
  cli(["finish", "--session-id", "claude-parent", "--status", "interrupted", "--summary", "작업 인계"]);
  const child = cli(["continue", "claude-parent", "--parent-provider", "anthropic", "--provider", "openai", "--agent", "codex", "--session-id", "child", "--session-name", "Codex 후속 작업", "--summary", "재개"]);
  await ready(page); await expect(page.locator("#list-content tbody tr")).toHaveCount(50);
  await page.screenshot({ path: test.info().outputPath("table.png") });
  await expect(page.locator(".pager")).toContainText("총 107건");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/offset=50/); await expect(page.locator("#list-content tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#list-content tbody tr")).toHaveCount(7);
  await page.getByLabel("Provider", { exact: true }).fill("anthropic");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator("#list-content tbody tr")).toHaveCount(1);
  const a = page.getByRole("link", { name: "Claude 이전 작업" }); await a.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(parent.session.id));
  await page.getByRole("link", { name: "Codex 후속 작업" }).click(); await expect(page).toHaveURL(new RegExp(child.session.id));
  await page.getByRole("link", { name: "Claude 이전 작업" }).click();
  await page.getByRole("link", { name: "목록으로 돌아가기", exact: false }).click();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("anthropic");
  await expect(page.locator("#list-content tbody tr")).toHaveCount(1);
  await page.getByLabel("검색", { exact: true }).fill("없는 세션"); await page.keyboard.press("Enter");
  await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
});

test("untrusted HTML stays text; ID/quoted command copy and fallback never execute", async ({ page, context }) => {
  const id = "literal'id; echo untrusted";
  const payload = '<img src=x onerror="window.pwned=1">\n<script>window.pwned=1</script>';
  start(id, "안전한 텍스트 검사", "openai", "codex", payload);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  await ready(page);
  await page.getByRole("button", { name: "복사", exact: true }).click();
  await expect(page).toHaveURL(url + "/");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  await page.getByRole("link", { name: "안전한 텍스트 검사" }).click();
  await expect(page.locator(".summary")).toHaveText(payload);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await expect(page.locator(".summary img, .summary script")).toHaveCount(0);
  await page.getByLabel("조회 명령 셸").selectOption("powershell");
  await page.getByRole("button", { name: "조회 명령 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`relay show 'literal''id; echo untrusted' --provider 'openai' --data-dir '${dir.replaceAll("\\", "/")}' --json`);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("denied"); } }));
  await page.getByRole("button", { name: "Session ID 복사" }).click();
  await expect(page.locator("#copy-text")).toHaveValue(id);
  await expect(page.locator("#copy-text")).toBeFocused();
});

test("polling preserves unsaved filter text, focus and scroll; hidden tabs pause and resume", async ({ page }) => {
  start("a", "필터 유지 작업"); await ready(page);
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

test("partial section failure keeps detail; missing ID and invalid input are not empty state", async ({ page }) => {
  const s = start("a", "부분 실패 검사");
  await page.goto(`${url}/sessions/${s.session.id}`);
  await expect(page.locator(".summary")).toHaveText("첫 기록");
  await page.route("**/api/v1/sessions/*/updates?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, error: { code: "DB_BUSY", message: "이력 잠금" } }) }));
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(page.locator("#updates-error")).toContainText("이력 잠금");
  await expect(page.locator(".summary")).toHaveText("첫 기록");
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(1);
  await page.goto(`${url}/sessions/absent`); await expect(page.locator("#detail-error")).toContainText("세션을 찾을 수 없습니다");
  await expect(page.getByRole("link", { name: "목록으로 돌아가기", exact: false })).toBeVisible();
  await page.goto(`${url}/?status=bad`); await expect(page.locator("#list-error")).toContainText("status");
  await expect(page.getByText("저장된 세션이 없습니다.", { exact: false })).toHaveCount(0);
});

test("narrow layout keeps full detail readable without page overflow", async ({ page }) => {
  const s = start("mobile", "좁은 화면 확인", "openai", "codex", "긴 한국어 요약 ".repeat(80));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/sessions/${s.session.id}`);
  await expect(page.locator(".summary")).toContainText("긴 한국어 요약");
  await page.screenshot({ path: test.info().outputPath("mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("history and child pages beyond 50 remain navigable; detail polling preserves scroll and focus", async ({ page }) => {
  const parent = start("parent", "이력 많은 부모");
  for (let i = 0; i < 52; i++) cli(["update", "--session-id", "parent", "--summary", `진행 ${i}`]);
  cli(["finish", "--session-id", "parent", "--status", "completed", "--summary", "부모 종료"]);
  for (let i = 0; i < 52; i++) cli(["continue", "parent", "--provider", "openai", "--agent", "codex", "--session-id", `child-${i}`, "--session-name", `자식 ${i}`, "--summary", "자식 시작"]);
  await page.goto(`${url}/sessions/${parent.session.id}`);
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(50);
  await expect(page.locator("#children-content li")).toHaveCount(50);
  await page.locator("#updates-content").getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(4);
  await page.locator("#children-content").getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator("#children-content li")).toHaveCount(2);
  await expect(page.locator("#updates-content tbody tr")).toHaveCount(4);
  const childLink = page.locator("#children-content li a").first(); await childLink.click();
  const id = await page.locator("dd").first().textContent();
  const copy = page.getByRole("button", { name: "Session ID 복사" }); await copy.focus();
  await page.evaluate(() => window.scrollTo(0, 450));
  const before = await page.evaluate(() => window.scrollY);
  cli(["update", "--session-id", id!, "--summary", "스크롤 유지 갱신"]);
  await expect(page.locator(".summary")).toHaveText("스크롤 유지 갱신", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Session ID 복사" })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("slow older filter responses cannot replace newer results", async ({ page }) => {
  start("a", "이전 검색 대상", "openai", "codex");
  start("b", "새 검색 대상", "anthropic", "claude-code");
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
