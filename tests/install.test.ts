import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
  expect(install("codex").exitCode).toBe(0);
  writeFileSync(target, original + "\nUser customization\n");
  expect(install("codex").exitCode).not.toBe(0);
  expect(readFileSync(target, "utf8")).toBe(original + "\nUser customization\n");
  expect(install("claude").exitCode).toBe(0);
  expect(existsSync(path.join(dir, ".claude/skills/relay-session/SKILL.md"))).toBe(true);
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
