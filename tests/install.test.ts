import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  expect(installed).toContain("argument-hint: codex|claude|grok");
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
    expect(readFileSync(path.join(target, "SKILL.md"), "utf8")).toContain("argument-hint: codex|claude|grok");
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
    path.join(root, "scripts/install-cli.ps1"), "-ExecutablePath", source, "-InstallDirectory", destination, "-NoPath", ...extra],
    { stdout: "pipe", stderr: "pipe" });
}

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
