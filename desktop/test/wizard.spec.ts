import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

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
  app = await electron.launch({ args: [path.join(root, "desktop")], env: { ...process.env,
    RELAY_DATA_DIR: directory, RELAY_ALLOW_HTTP: "1", RELAY_DESKTOP_NO_INSTALL: "1", RELAY_DESKTOP_RELAY_EXE: path.join(root, "dist", "relay.exe") } });
});
test.afterEach(async () => {
  await app?.close();
  if (remoteServer) { const child = remoteServer; remoteServer = undefined; const ended = new Promise<void>(resolve => child.once("exit", () => resolve())); child.stdin?.end(); await ended; }
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
  const opened = app!.waitForEvent("window");
  await wizard.locator("#open-main").click();
  const main = await opened;
  await expect(main.locator("body")).toContainText("다른 PC에서 남긴 기록");
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
