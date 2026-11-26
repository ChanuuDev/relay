import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  if (result.status !== 0) throw new Error(`hook failed: ${result.stderr} ${result.error ?? ""}`);
  const output = JSON.parse(result.stdout);
  if (end || alias === "grok") expect(output).toEqual({});
  else {
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain("relay-session");
  }
}

/** fetch와 Chromium이 막는 포트(WHATWG fetch의 bad port 가운데 1024 이상). 이 포트로 뜬 서버는 살아 있어도 테스트와 브라우저가 닿지 못한다
 *  (fetch는 "bad port", Chromium은 ERR_UNSAFE_PORT). 동적 포트 범위를 낮게 잡은 PC에서는 OS가 이 포트를 내준다. */
const BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** 비어 있는 포트 하나. OS가 막힌 포트를 고르면 그 포트를 쥔 채로 다시 고른다(놓고 고르면 같은 포트가 또 나온다). */
export async function freePort(): Promise<number> {
  const held: net.Server[] = [];
  try {
    for (;;) {
      const reservation = net.createServer();
      await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
      held.push(reservation);
      const { port } = reservation.address() as net.AddressInfo;
      if (!BLOCKED_PORTS.has(port)) return port;
    }
  } finally {
    await Promise.all(held.map(reservation => new Promise<void>(resolve => reservation.close(() => resolve()))));
  }
}

/** 서버를 띄우고 health가 200이 될 때까지 wait밀리초 기다린다. 그 안에 뜨지 않으면 false. */
async function start(wait: number): Promise<boolean> {
  const child = spawn(binary, ["web", "--data-dir", env.dir, "--port", String(env.port)], { cwd: env.dir, windowsHide: true, stdio: "pipe", env: spawnEnv });
  server = child;
  let logs = ""; child.stderr?.on("data", chunk => { logs += chunk; });
  for (const deadline = Date.now() + wait; Date.now() < deadline;) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { if ((await fetch(`${env.url}/api/v1/health`, { signal: AbortSignal.timeout(2000) })).status === 200) return true; } catch { /* 아직 뜨지 않았다. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

export async function launch() {
  // 갓 빌드한 exe는 백신 검사나 PC 부하로 처음 뜨는 데 몇 초 더 걸릴 수 있어 넉넉히 기다린다(평소에는 0.2초 안에 뜬다).
  if (await start(12000)) return;
  // 드물게 프로세스는 살아 있는데 응답이 없었다(전체 검증 한 번에 한 건꼴, 매번 다른 테스트). 알아낸 원인은 fetch가 막는 포트였고 이제 freePort가 피한다.
  // 다른 까닭으로 응답이 없을 때를 위해 한 번은 닫고 다시 띄운다.
  await stop();
  if (await start(20000)) return;
  await stop();
  throw new Error(`Server did not answer /api/v1/health on ${env.url} after two starts`);
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

// 화면 테스트는 파일마다 다른 프로세스에서 함께 돈다(playwright.config.ts의 workers). 저장소·포트·서버는 테스트마다 따로지만
// 클립보드는 PC에 하나뿐이라 그대로 두면 서로의 복사가 섞인다. 그래서 화면의 글 복사(writeText·readText)는 테스트마다 따로 둔
// 메모리 클립보드로 돌리고, 진짜 클립보드가 있어야 하는 테스트(그림을 넣고 Ctrl+V)만 realClipboard로 차례를 지켜 쓴다.
const CLIPBOARD_LOCK = path.join(tmpdir(), "relay-test-clipboard.lock");
let holdsClipboard = false;
let realMode = false;

/** 이 테스트의 모든 창에 메모리 클립보드를 건다. 창을 열기 전에 부른다. */
async function fakeClipboard(context: BrowserContext) {
  let memory = "";
  realMode = false;
  await context.exposeFunction("__relayClipboard", (action: string, value?: string) => {
    if (action === "real") return realMode ? "1" : "";
    if (action === "set") memory = String(value ?? "");
    return memory;
  });
  await context.addInitScript(() => {
    const real = navigator.clipboard;
    if (!real) return;
    const bridge = (action: string, value?: string) => (window as unknown as { __relayClipboard(action: string, value?: string): Promise<string> }).__relayClipboard(action, value);
    const fake = {
      writeText: async (value: string) => { if (await bridge("real")) return real.writeText(value); await bridge("set", String(value)); },
      readText: async () => (await bridge("real") ? real.readText() : bridge("get")),
      write: (items: ClipboardItems) => real.write(items),
      read: () => real.read(),
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => fake });
  });
}

/** 클립보드 읽기·쓰기를 허용한다. 글 복사는 메모리 클립보드로 가므로 다른 테스트와 겹치지 않는다. */
export async function grantClipboard(context: BrowserContext) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.url });
}

/** PC의 진짜 클립보드를 쓴다(그림 붙여 넣기). 다른 테스트가 쓰는 중이면 끝나기를 기다리고, 기다린 만큼 이 테스트의 제한 시간을 늘린다. */
export async function realClipboard(context: BrowserContext) {
  const started = Date.now();
  while (!holdsClipboard) {
    try {
      mkdirSync(CLIPBOARD_LOCK);
      writeFileSync(path.join(CLIPBOARD_LOCK, "pid"), String(process.pid));
      holdsClipboard = true;
    } catch {
      // 죽은 프로세스가 남긴 잠금은 걷는다. pid를 아직 쓰지 못한 잠금은 방금 만든 것이라 잠깐 기다린다.
      let owner = 0, age = 0;
      try { owner = Number(readFileSync(path.join(CLIPBOARD_LOCK, "pid"), "utf8")); } catch { /* 아직 쓰는 중이다. */ }
      try { age = Date.now() - statSync(CLIPBOARD_LOCK).mtimeMs; } catch { continue; }
      let alive = owner > 0 || age < 5000;
      if (owner > 0) try { process.kill(owner, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (!alive || age > 180_000) { rmSync(CLIPBOARD_LOCK, { recursive: true, force: true }); continue; }
      if (Date.now() - started > 150_000) throw new Error("다른 테스트가 클립보드를 놓지 않습니다.");
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  const waited = Date.now() - started;
  if (waited > 500) test.setTimeout(test.info().timeout + waited);
  realMode = true;
  await grantClipboard(context);
}

function releaseClipboard() {
  realMode = false;
  if (!holdsClipboard) return;
  holdsClipboard = false;
  rmSync(CLIPBOARD_LOCK, { recursive: true, force: true });
}

export async function clipboardText(page: Page) {
  // Windows' native clipboard converts LF to CRLF; compare text using LF on every OS.
  return (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");
}

/** 각 테스트 앞뒤로 빈 저장소와 로컬 서버를 준비하고 정리한다. */
export function useRelayServer() {
  test.beforeEach(async ({ context }) => {
    await fakeClipboard(context);
    env.dir = mkdtempSync(path.join(tmpdir(), "relay-browser-"));
    env.port = await freePort();
    env.url = `http://127.0.0.1:${env.port}`;
    await launch();
  });
  test.afterEach(async () => {
    releaseClipboard();
    await stop();
    const target = realpathSync(env.dir);
    if (path.dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() || !path.basename(target).startsWith("relay-browser-")) throw new Error("Unsafe cleanup");
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
}
