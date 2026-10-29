import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanup, root, temporary } from "./helpers";

let dir: string;
beforeEach(() => { dir = temporary(); });
afterEach(() => cleanup(dir));
function install(agent: string, project = dir) {
  return Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/install-skill.ps1"), "-Agent", agent, "-ProjectDirectory", project], { stdout: "pipe", stderr: "pipe" });
}

test.skipIf(process.platform !== "win32")("project skill installation is idempotent and preserves existing custom instructions", () => {
  expect(install("codex").exitCode).toBe(0);
  const target = path.join(dir, ".agents/skills/relay-session/SKILL.md");
  const original = readFileSync(target, "utf8");
  expect(original).toBe(readFileSync(path.join(root, "skills/relay-session/SKILL.md"), "utf8"));
  expect(original).toContain("relay record");
  expect(original).toContain("relay continue");
  expect(original).not.toMatch(/\brelay start\b/);
  expect(original).not.toMatch(/\brelay finish\b/);
  // The declared work state is an update option, never a lifecycle the skill manages.
  expect(original).toContain("--status working|blocked|handoff|done");
  expect(original).not.toMatch(/--status (active|completed|interrupted|abandoned)\b/);
  expect(install("codex").exitCode).toBe(0);
  writeFileSync(target, original + "\nUser customization\n");
  expect(install("codex").exitCode).not.toBe(0);
  expect(readFileSync(target, "utf8")).toBe(original + "\nUser customization\n");
  expect(install("claude").exitCode).toBe(0);
  const claudeSkill = path.join(dir, ".claude/skills/relay-session/SKILL.md");
  expect(existsSync(claudeSkill)).toBe(true);
  const installed = readFileSync(claudeSkill, "utf8");
  expect(installed).toContain("argument-hint: codex|claude|grok|cursor");
  // The agent must be able to invoke the skill itself; /relay-session stays available either way.
  expect(installed).not.toContain("disable-model-invocation");
  expect(install("grok").exitCode).toBe(0);
  const grokSkill = path.join(dir, ".grok/skills/relay-session/SKILL.md");
  expect(readFileSync(grokSkill, "utf8")).toBe(installed);
  // Only Codex needs the interface descriptor; the other hosts read the frontmatter.
  expect(existsSync(path.join(dir, ".grok/skills/relay-session/agents/openai.yaml"))).toBe(false);
  expect(install("codex", "relative").exitCode).not.toBe(0);
}, 15000);

test.skipIf(process.platform !== "win32")("installer rejects a junction escaping the selected project", () => {
  const outside = temporary();
  try {
    mkdirSync(path.join(dir, ".agents"));
    symlinkSync(outside, path.join(dir, ".agents/skills"), "junction");
    expect(install("codex").exitCode).not.toBe(0);
    expect(existsSync(path.join(outside, "relay-session"))).toBe(false);
  } finally { cleanup(outside); }
});

test.skipIf(process.platform !== "win32")("installer replaces a linked skill folder with a real copy and leaves the link target alone", () => {
  const outside = temporary();
  try {
    writeFileSync(path.join(outside, "keep.txt"), "keep");
    mkdirSync(path.join(dir, ".claude/skills"), { recursive: true });
    const target = path.join(dir, ".claude/skills/relay-session");
    symlinkSync(outside, target, "junction");
    const result = install("claude");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Replaced link with a real copy");
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(target, "SKILL.md"), "utf8")).toContain("argument-hint: codex|claude|grok|cursor");
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("keep");
    expect(existsSync(path.join(outside, "SKILL.md"))).toBe(false);
    // A link whose target has already disappeared is what agents report as a symlink problem; it is replaced the same way.
    const gone = path.join(dir, "gone");
    mkdirSync(gone);
    mkdirSync(path.join(dir, ".grok/skills"), { recursive: true });
    symlinkSync(gone, path.join(dir, ".grok/skills/relay-session"), "junction");
    rmSync(gone, { recursive: true });
    expect(install("grok").exitCode).toBe(0);
    expect(lstatSync(path.join(dir, ".grok/skills/relay-session")).isDirectory()).toBe(true);
    expect(existsSync(path.join(dir, ".grok/skills/relay-session/SKILL.md"))).toBe(true);
  } finally { cleanup(outside); }
}, 15000);

function installCli(source: string, destination: string, ...extra: string[]) {
  return Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/install-cli.ps1"), "-ExecutablePath", source, "-InstallDirectory", destination, "-NoPath", "-NoProtocol", ...extra],
    { stdout: "pipe", stderr: "pipe" });
}
const powershell = (script: string) => Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "pipe" });

// 설치한 앱이 서버 없이 열렸을 때 relay://web?port=N 링크로 서버를 켤 수 있도록, 설치는 그 프로토콜을 사용자 레지스트리에 등록한다.
test.skipIf(process.platform !== "win32")("CLI installation registers the relay:// protocol with a windowless launcher that calls relay open-url", () => {
  const source = path.join(dir, "source.exe"); const destination = path.join(dir, "local bin");
  const target = path.join(destination, "relay.exe");
  const key = `HKCU:\\Software\\RelayTest\\${path.basename(dir)}`;
  writeFileSync(source, "relay test executable");
  try {
    const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/install-cli.ps1"), "-ExecutablePath", source, "-InstallDirectory", destination, "-NoPath", "-ProtocolKey", `${key}\\relay`],
      { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Protocol registered: relay:// -> ");
    const read = (sub: string, name: string) => powershell(`(Get-ItemProperty -LiteralPath '${key}\\relay${sub}').'${name}'`).stdout.toString().trim();
    expect(read("", "URL Protocol")).toBe("");
    expect(read("", "(default)")).toBe("URL:Relay");
    expect(read("\\shell\\open", "FriendlyAppName")).toBe("Relay");
    const command = read("\\shell\\open\\command", "(default)");
    expect(command).toBe(`"${path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe")}" //B //Nologo "${path.join(destination, "relay-url.vbs")}" "%1"`);
    const launcher = readFileSync(path.join(destination, "relay-url.vbs"), "utf8");
    expect(launcher).toContain(`"""${target}"" open-url """ & link & """", 0, False`);
    expect(launcher).toContain('LCase(Left(link, 8)) <> "relay://"');
  } finally { powershell(`Remove-Item -LiteralPath '${key}' -Recurse -Force -ErrorAction SilentlyContinue`); }
}, 15000);

test.skipIf(process.platform !== "win32")("CLI installation preserves an existing binary unless replacement is explicit", () => {
  const source = path.join(dir, "source.exe"); const destination = path.join(dir, "local bin");
  const target = path.join(destination, "relay.exe");
  writeFileSync(source, "relay test executable v1");
  expect(installCli(source, destination).exitCode).toBe(0);
  expect(readFileSync(target, "utf8")).toBe("relay test executable v1");
  expect(installCli(source, destination).exitCode).toBe(0);
  writeFileSync(source, "relay test executable v2");
  expect(installCli(source, destination).exitCode).not.toBe(0);
  expect(readFileSync(target, "utf8")).toBe("relay test executable v1");
  expect(installCli(source, destination, "-Force").exitCode).toBe(0);
  expect(readFileSync(target, "utf8")).toBe("relay test executable v2");
  // The parent shell decides whether the variable is stored as Path or PATH; keeping both names would leave the original value in the child.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  env.Path = `${destination};${process.env.Path ?? ""}`;
  const lookup = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "(Get-Command relay -CommandType Application | Select-Object -First 1).Source"],
    { cwd: dir, env });
  expect(lookup.exitCode).toBe(0); expect(lookup.stdout.toString().trim()).toBe(target);
}, 15000);

// 설치한 relay.exe로 떠 있는 웹 서버가 실행 파일을 잠가도, 옛 파일을 옆으로 옮겨 교체하고 그 서버를 새 파일로 다시 띄운다.
const built = path.join(root, "dist", "relay.exe");
test.skipIf(process.platform !== "win32" || !existsSync(built))("CLI installation replaces a running executable and reloads its web server", async () => {
  const destination = path.join(dir, "local bin"); const target = path.join(destination, "relay.exe");
  const data = path.join(dir, "data");
  mkdirSync(destination);
  // 끝에 바이트를 붙인 사본을 "이전 빌드"로 쓴다. 해시가 달라 교체 대상이 된다.
  writeFileSync(target, Buffer.concat([readFileSync(built), Buffer.from("relay-test-older-build")]));
  const env = { ...process.env, RELAY_SKIP_HOOK_INSTALL: "1", RELAY_USER_HOME: path.join(dir, "home"), RELAY_HOOK_BIN_DIR: path.join(dir, "hook-bin"),
    CODEX_HOME: undefined, GROK_HOME: undefined };
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const url = `http://127.0.0.1:${port}/api/v1/health`;
  const pidOf = async () => { try { return Number((await fetch(url, { signal: AbortSignal.timeout(2000) })).headers.get("Relay-Pid")) || 0; } catch { return 0; } };
  const started = Bun.spawnSync([target, "web", "--headless", "--port", String(port), "--data-dir", data], { env, stdout: "pipe", stderr: "pipe" });
  expect(started.exitCode).toBe(0);
  const before = await pidOf();
  expect(before).toBeGreaterThan(0);
  try {
    const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/install-cli.ps1"), "-ExecutablePath", built, "-InstallDirectory", destination, "-NoPath", "-NoProtocol", "-Force"],
      { env, stdout: "pipe", stderr: "pipe", timeout: 60000 });
    const output = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(output).toContain("Replaced the running executable");
    expect(output).toContain(`Web server restarted: relay web --reload --port ${port} --data-dir`);
    expect(readFileSync(target).equals(readFileSync(built))).toBe(true);
    const after = await pidOf();
    expect(after).toBeGreaterThan(0); expect(after).not.toBe(before);
    const body = await (await fetch(url)).json() as { dataDirectory: string };
    expect(path.resolve(body.dataDirectory)).toBe(path.resolve(data));
    // 옛 파일은 그 프로세스가 끝나면 지워진다.
    expect(readdirSync(destination).filter((name) => name.endsWith(".old"))).toEqual([]);
  } finally {
    for (const pid of [before, await pidOf()]) if (pid) try { process.kill(pid); } catch { /* 이미 끝났다 */ }
    // 끝낸 서버의 실행 파일 잠금이 풀린 뒤에야 임시 폴더를 지울 수 있다.
    for (const deadline = Date.now() + 10000; Date.now() < deadline; await Bun.sleep(200)) {
      try { rmSync(target, { force: true }); break; } catch { /* 아직 쓰는 중 */ }
    }
  }
}, 90000);

test.skipIf(process.platform !== "win32")("CLI installation rejects invalid paths and linked targets", () => {
  const source = path.join(dir, "source.exe"); writeFileSync(source, "relay test executable");
  expect(installCli(source, "relative").exitCode).not.toBe(0);
  const separator = path.join(dir, "invalid;path");
  expect(installCli(source, separator).exitCode).not.toBe(0); expect(existsSync(separator)).toBe(false);
  const outside = temporary();
  try {
    const linked = path.join(dir, "linked"); symlinkSync(outside, linked, "junction");
    expect(installCli(source, linked).exitCode).not.toBe(0);
    expect(existsSync(path.join(outside, "relay.exe"))).toBe(false);
  } finally { cleanup(outside); }
}, 15000);
