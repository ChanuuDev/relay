import { expect, test, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const binary = path.join(root, "dist", process.platform === "win32" ? "relay.exe" : "relay");
export const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
export const spawnEnv = { ...process.env, RELAY_SKIP_HOOK_INSTALL: "1" };

/** 테스트마다 새 저장소·포트·서버를 쓴다. 값은 beforeEach에서 채운다. */
export const env = { dir: "", port: 0, url: "" };
let server: ChildProcess | undefined;

export function cli(args: string[]) {
  const result = spawnSync(binary, [...args, "--data-dir", env.dir, "--json"], { cwd: env.dir, encoding: "utf8", timeout: 10000, env: spawnEnv });
  if (result.status !== 0) throw new Error(`CLI failed: ${result.stderr} ${result.error ?? ""}`);
  return JSON.parse(result.stdout);
}

export function record(id: string, name: string, provider = "openai", agent = "codex", summary = "첫 기록") {
  return cli(["record", "--provider", provider, "--agent", agent, "--session-id", id, "--session-name", name, "--cwd", env.dir, "--summary", summary]);
}

/** What a host session hook sends on stdin, through the same binary the hosts call. */
export function hook(alias: string, payload: Record<string, unknown>, end = false) {
  const result = spawnSync(binary, ["hook", alias, ...(end ? ["--end"] : []), "--data-dir", env.dir],
    { cwd: env.dir, encoding: "utf8", timeout: 10000, env: spawnEnv, input: JSON.stringify(payload) });
  if (result.status !== 0 || result.stdout.trim() !== "{}") throw new Error(`hook failed: ${result.stderr} ${result.error ?? ""}`);
}

export async function launch() {
  server = spawn(binary, ["web", "--data-dir", env.dir, "--port", String(env.port)], { cwd: env.dir, windowsHide: true, stdio: "pipe", env: spawnEnv });
  let logs = ""; server.stderr?.on("data", chunk => { logs += chunk; });
  await expect.poll(async () => {
    if (server?.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { return (await fetch(`${env.url}/api/v1/health`)).status; } catch { return 0; }
  }).toBe(200);
}

export async function stop() {
  const child = server; server = undefined;
  if (!child || child.exitCode !== null) return;
  const done = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM"); await done;
}

export async function ready(page: Page) {
  await page.goto(env.url);
  await expect(page.locator("#connection-state")).toContainText("연결됨");
}

export async function clipboardText(page: Page) {
  // Windows' native clipboard converts LF to CRLF; compare text using LF on every OS.
  return (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");
}

/** 각 테스트 앞뒤로 빈 저장소와 로컬 서버를 준비하고 정리한다. */
export function useRelayServer() {
  test.beforeEach(async () => {
    env.dir = mkdtempSync(path.join(tmpdir(), "relay-browser-"));
    const reservation = net.createServer();
    await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
    env.port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    env.url = `http://127.0.0.1:${env.port}`;
    await launch();
  });
  test.afterEach(async () => {
    await stop();
    const target = realpathSync(env.dir);
    if (path.dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() || !path.basename(target).startsWith("relay-browser-")) throw new Error("Unsafe cleanup");
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
}
