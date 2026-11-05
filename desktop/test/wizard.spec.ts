import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { DesktopApi } from "../src/shared/types";

declare global { interface Window { relayDesktop: DesktopApi } }

let app: ElectronApplication | undefined;
let directory: string;
let remoteServer: ChildProcess | undefined;
const root = path.resolve(__dirname, "../..");
test.beforeEach(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "relay-desktop-test-"));
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  writeFileSync(path.join(directory, "config.json"), JSON.stringify({ schemaVersion: 1, webPort: address.port }));
  app = await electron.launch({ args: [path.join(root, "desktop"), `--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env,
    RELAY_USER_HOME: path.join(directory, "home"), CODEX_HOME: path.join(directory, "home/.codex"), GROK_HOME: path.join(directory, "home/.grok"),
    RELAY_DATA_DIR: directory, RELAY_ALLOW_HTTP: "1", RELAY_DESKTOP_NO_INSTALL: "1", RELAY_DESKTOP_RELAY_EXE: path.join(root, "dist", "relay.exe") } });
});
test.afterEach(async () => {
  // 외부 relay가 Windows의 DevTools 파이프를 잠시 상속할 수 있으므로 실제 앱 종료를 먼저 확인하고 서버를 정리한다.
  const child = app?.process();
  const closing = app?.close();
  if (child) await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull();
  await promisify(execFile)(path.join(root, "dist/relay.exe"), ["web", "--close", "--data-dir", directory], { windowsHide: true, timeout: 10_000, env: { ...process.env, RELAY_ALLOW_HTTP: "1" } }).catch(() => {});
  await closing;
  if (remoteServer) {
    const child = remoteServer; remoteServer = undefined;
    if (child.exitCode === null) {
      const ended = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.stdin?.end();
      const kill = setTimeout(() => child.kill(), 5000);
      await ended; clearTimeout(kill);
    }
  }
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith("relay-desktop-test-")) throw new Error("Unsafe cleanup target");
  rmSync(directory, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});
test("첫 실행 → 로컬 저장 → Relay 화면, 본 화면에는 설정 토큰 IPC가 없다", async () => {
  const wizard = await app!.firstWindow();
  await expect(wizard.locator("#card-local")).toBeVisible();
  await wizard.locator("#card-local").click();
  await expect(wizard.locator("#done-lead")).toContainText("로컬 서버로 저장했습니다");
  const saved = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
  expect(saved.mode).toBe("local"); expect(saved.schemaVersion).toBe(2);
  await wizard.locator("#advanced-settings summary").click();
  await expect(wizard.locator("#storage-directory")).toHaveText(directory);
  const before = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8")).webPort;
  const portServer = createServer(); await new Promise<void>(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = (portServer.address() as { port: number }).port; await new Promise<void>(resolve => portServer.close(() => resolve()));
  await wizard.locator("#web-port").fill(String(port)); await wizard.locator("#save-port").click();
  await expect.poll(() => JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8")).webPort).toBe(port);
  await expect(wizard.locator("#facts")).toContainText(String(port));
  await expect(fetch(`http://127.0.0.1:${before}/api/v1/health`)).rejects.toThrow();
  await wizard.locator("#install-hooks").click();
  await expect(wizard.locator("#maintenance-output")).toContainText('"schemaVersion":1');
  expect(existsSync(path.join(directory, "home/.codex/hooks.json"))).toBe(true);
  await wizard.locator("#install-skills").click();
  await expect(wizard.locator("#maintenance-output")).toContainText('"skill":"relay-session"');
  expect(existsSync(path.join(directory, "home/.codex/skills/relay-session/SKILL.md"))).toBe(true);
  const mainPromise = app!.waitForEvent("window");
  await wizard.locator("#open-main").click();
  const main = await mainPromise;
  await expect(main).toHaveTitle(/Relay/);
  expect(await main.evaluate(() => "relayDesktop" in window)).toBe(false);
  expect(await app!.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin)).toBe(false);
});
test("잘못된 원격 주소·연결 실패는 저장하지 않고 설정 화면에 표시한다", async () => {
  const wizard = await app!.firstWindow();
  await wizard.locator("#card-remote").click();
  await wizard.locator("#url").fill("http://example.test");
  await wizard.locator("#token").fill("test-token");
  await wizard.locator("#test").click();
  await expect(wizard.locator("#report")).toContainText("https://");
  await expect(wizard.locator("#remote-next")).toBeHidden();
  const saved = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
  expect(saved.mode).toBeUndefined(); expect(saved.remote).toBeUndefined();
});

test("다른 프로그램이 쓰는 포트로 바꾸면 기존 서버와 설정을 유지한다", async () => {
  const wizard = await app!.firstWindow();
  await wizard.locator("#card-local").click();
  await expect(wizard.locator("#done-lead")).toContainText("로컬 서버로 저장했습니다");
  const before = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
  const health = () => fetch(`http://127.0.0.1:${before.webPort}/api/v1/health`);
  const pid = (await health()).headers.get("relay-pid");
  const occupied = createHttpServer((_request, response) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"schemaVersion":1}'); });
  await new Promise<void>(resolve => occupied.listen(0, "127.0.0.1", resolve));
  try {
    const port = (occupied.address() as { port: number }).port;
    await wizard.locator("#advanced-settings summary").click();
    await wizard.locator("#web-port").fill(String(port));
    await wizard.locator("#save-port").click();
    await expect(wizard.locator("#error")).toBeVisible();
    expect(JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"))).toEqual(before);
    expect((await health()).headers.get("relay-pid")).toBe(pid);
    await expect(wizard.evaluate(() => window.relayDesktop.setPort(0))).rejects.toThrow("1~65535");
  } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
});

test("원격 서버가 응답하지 않아도 로컬 화면 서버는 시작한다", async () => {
  const wizard = await app!.firstWindow();
  const unavailable = createHttpServer(() => {});
  await new Promise<void>(resolve => unavailable.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(unavailable.address() as { port: number }).port}`;
    await wizard.evaluate(url => window.relayDesktop.saveMode({ mode: "remote",
      remote: { url, token: "test-token", deviceId: null, deviceName: "offline-test" } }), url);
    const status = await wizard.evaluate(() => window.relayDesktop.getStatus());
    expect(status.running).toBe(true);
    expect(status.remote?.reachable).toBe(false);
  } finally { unavailable.closeAllConnections(); await new Promise<void>(resolve => unavailable.close(() => resolve())); }
});

test("첫 실행의 포트 충돌을 설정 화면에서 복구한다", async () => {
  const wizard = await app!.firstWindow();
  const { webPort } = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
  const occupied = createHttpServer((_request, response) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"schemaVersion":1}'); });
  await new Promise<void>(resolve => occupied.listen(webPort, "127.0.0.1", resolve));
  try {
    await wizard.locator("#card-local").click();
    await expect(wizard.locator("#error")).toBeVisible();
    await wizard.locator("#advanced-settings summary").click();
    const available = createServer();
    await new Promise<void>(resolve => available.listen(0, "127.0.0.1", resolve));
    const port = (available.address() as { port: number }).port;
    await new Promise<void>(resolve => available.close(() => resolve()));
    await wizard.locator("#web-port").fill(String(port));
    await wizard.locator("#save-port").click();
    await expect(wizard.locator("#status-chip")).toContainText("서버 켜짐");
    const mainPromise = app!.waitForEvent("window");
    await wizard.locator("#card-local").click();
    await wizard.locator("#open-main").click();
    await expect(await mainPromise).toHaveTitle(/Relay/);
  } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
});

test("원격 연결·기기 등록 → 이전 미리 보기 → 화면에서 서버 세션과 파일 확인", async () => {
  remoteServer = spawn(process.execPath, [path.join(root, "tests/support/remote-server.mjs"), directory], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    let text = "", errors = "";
    remoteServer!.stdout!.on("data", chunk => { text += chunk; if (text.includes("ready")) resolve(); });
    remoteServer!.stderr!.on("data", chunk => { errors += chunk; });
    remoteServer!.once("exit", code => { if (code !== 0) reject(new Error(errors || "fixture failed")); });
    remoteServer!.once("error", reject);
  });
  const remote = JSON.parse(readFileSync(path.join(directory, "fixture.json"), "utf8"));
  await promisify(execFile)(path.join(root, "dist/relay.exe"), ["web", "--headless", "--data-dir", directory], { windowsHide: true });
  const wizard = await app!.firstWindow();
  await wizard.locator("#card-remote").click();
  await wizard.locator("#url").fill(remote.url);
  await wizard.locator("#token").fill(remote.token);
  await wizard.locator("#test").click();
  await expect(wizard.locator("#report")).toContainText("기기 등록");
  await expect(wizard.locator("#remote-next")).toBeVisible();
  await wizard.locator("#to-migrate").click();
  await expect(wizard.locator("#migrate-output")).toContainText('"dryRun":true');
  await wizard.locator("#skip-migrate").click();
  await expect(wizard.locator("#done-lead")).toContainText("원격 서버로 저장했습니다");
  await wizard.locator("#advanced-settings summary").click();
  await expect(wizard.locator("#remote-status")).toContainText("대기 0건");
  const outbox = path.join(directory, "outbox"); mkdirSync(outbox, { recursive: true });
  writeFileSync(path.join(outbox, "pending.json"), JSON.stringify({ key: randomUUID(),
    destination: createHash("sha256").update(remote.url + "\n" + remote.token).digest("hex"), route: "/api/v1/sessions",
    body: { provider: "openai", agent: "codex", sessionId: "queued-session", summary: "대기열에서 전송한 기록", cwd: "C:/fixture" }, createdAt: new Date().toISOString() }));
  await expect(wizard.locator("#remote-status")).toContainText("대기 1건");
  await wizard.locator("#flush-outbox").click();
  await expect(wizard.locator("#maintenance-output")).toContainText('"pending":[]');
  await expect(wizard.locator("#remote-status")).toContainText("대기 0건");
  const delivered = await fetch(remote.url + "/api/v1/sessions", { headers: { Authorization: `Bearer ${remote.token}` } });
  expect(await delivered.text()).toContain("대기열에서 전송한 기록");
  const opened = app!.waitForEvent("window");
  await wizard.locator("#open-main").click();
  const main = await opened;
  await expect(main.locator("body")).toContainText("다른 PC에서 남긴 기록");
  await expect(main.locator(".local-label")).toHaveText("원격 서버");
  await main.locator('.dock-item[aria-label="파일 탐색기"]').click();
  await main.getByRole("button", { name: "경로 직접 입력 (Ctrl+L)" }).click();
  await main.getByRole("textbox", { name: "경로", exact: true }).fill("remote:/");
  await main.keyboard.press("Enter");
  await expect(main.locator('.files-row').filter({ hasText: "remote-note.txt" })).toBeVisible();
  await main.locator('.files-row').filter({ hasText: "remote-note.txt" }).click({ button: "right" });
  await expect(main.getByRole("menuitem", { name: "탐색기에서 보기", exact: true })).toHaveCount(0);
  await main.keyboard.press("Escape");
  await main.getByLabel("원격 서버에 파일 올리기").setInputFiles({ name: "uploaded.txt", mimeType: "text/plain", buffer: Buffer.from("uploaded") });
  await expect(main.locator('.files-row').filter({ hasText: "uploaded.txt" })).toBeVisible();
  expect(readFileSync(path.join(directory, "remote-files", "uploaded.txt"), "utf8")).toBe("uploaded");
});
