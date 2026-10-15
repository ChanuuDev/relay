import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installHostHooks, isRelayBinary, shouldAutoInstallHooks, wrapperScript } from "../src/hooks/install";
import { GROK_RULE_MARKER, SESSION_START_PROMPT } from "../src/hooks/context";
import { cleanup, cli, root, temporary } from "./helpers";

let dir: string;
beforeEach(() => { dir = temporary(); });
afterEach(() => cleanup(dir));

function home() { return path.join(dir, "home"); }
function bin() { return path.join(dir, "bin"); }
function install(codexHomes = [path.join(home(), ".codex")]) {
  return installHostHooks({ homeDirectory: home(), binDirectory: bin(), executablePath: path.join(bin(), "relay.exe"), codexHomes });
}

test("install-hooks registers Claude, Grok and Codex SessionStart and SessionEnd without clobbering other hooks", () => {
  mkdirSync(path.join(home(), ".claude"), { recursive: true });
  writeFileSync(path.join(home(), ".claude", "settings.json"), JSON.stringify({
    model: "keep-me",
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "C:\\\\orca\\\\claude-hook.cmd", timeout: 10 }] }],
      Stop: [{ hooks: [{ type: "command", command: "keep-stop" }] }],
    },
  }, null, 2));
  mkdirSync(path.join(home(), ".codex"), { recursive: true });
  writeFileSync(path.join(home(), ".codex", "hooks.json"), JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "keep-prompt" }] }] },
  }));

  const first = install();
  expect(first.hosts.map(h => h.status)).toEqual(["added", "added", "added"]);
  if (process.platform === "win32") {
    expect(first.wrappers.map(w => w.status)).toEqual(["added", "added", "added", "added"]);
    expect(readFileSync(path.join(bin(), "relay-hook-grok.cmd"), "utf8")).toBe(wrapperScript("grok"));
    expect(readFileSync(path.join(bin(), "relay-hook-grok-end.cmd"), "utf8")).toBe(wrapperScript("grok", "SessionEnd"));
    expect(wrapperScript("codex", "SessionEnd")).toContain("hook codex --end");
    expect(wrapperScript("codex")).not.toContain("--end");
  }

  const claude = JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8"));
  expect(claude.model).toBe("keep-me");
  expect(claude.hooks.Stop[0].hooks[0].command).toBe("keep-stop");
  expect(claude.hooks.SessionStart[0].hooks[0].command).toContain("claude-hook.cmd");
  expect(claude.hooks.SessionStart[1].hooks[0].command).toContain("hook claude");
  expect(claude.hooks.SessionStart[1].hooks[0].command).not.toContain("--end");
  expect(claude.hooks.SessionEnd).toHaveLength(1);
  expect(claude.hooks.SessionEnd[0].hooks[0].command).toContain("hook claude --end");
  expect(claude.hooks.SessionEnd[0].hooks[0].timeout).toBe(10);

  const grok = JSON.parse(readFileSync(path.join(home(), ".grok", "hooks", "relay.json"), "utf8"));
  const grokCommand = String(grok.hooks.SessionStart[0].hooks[0].command).toLowerCase();
  expect(grokCommand.includes("hook grok") || grokCommand.includes("relay-hook-grok")).toBe(true);
  expect(grokCommand).not.toContain("-end");
  const grokEnd = String(grok.hooks.SessionEnd[0].hooks[0].command).toLowerCase();
  expect(grokEnd.includes("hook grok --end") || grokEnd.includes("relay-hook-grok-end.cmd")).toBe(true);

  const codex = JSON.parse(readFileSync(path.join(home(), ".codex", "hooks.json"), "utf8"));
  expect(codex.hooks.UserPromptSubmit[0].hooks[0].command).toBe("keep-prompt");
  const codexCommand = String(codex.hooks.SessionStart[0].hooks[0].command).toLowerCase();
  expect(codexCommand.includes("hook codex") || codexCommand.includes("relay-hook-codex")).toBe(true);
  expect(codex.hooks.SessionStart[0].hooks[0].statusMessage).toBe("Relay session record");
  const codexEnd = String(codex.hooks.SessionEnd[0].hooks[0].command).toLowerCase();
  expect(codexEnd.includes("hook codex --end") || codexEnd.includes("relay-hook-codex-end.cmd")).toBe(true);
  expect(codex.hooks.SessionEnd[0].hooks[0].statusMessage).toBe("Relay session end");
  expect(codex.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
  // Codex allows SessionEnd hooks at most three seconds.
  expect(codex.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);

  const second = install();
  expect(second.hosts.every(h => h.status === "unchanged")).toBe(true);
  expect(first.instructions[0]!.status).toBe("added");
  expect(second.instructions[0]!.status).toBe("unchanged");
  expect(JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8")).model).toBe("keep-me");
  // Each event holds exactly one Relay entry after any number of runs.
  const settled = JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8"));
  expect(settled.hooks.SessionStart).toHaveLength(2);
  expect(settled.hooks.SessionEnd).toHaveLength(1);
});

test("Grok gets the same session-start guidance through global rules, without changing user instructions", () => {
  mkdirSync(path.join(home(), ".grok", "rules"), { recursive: true });
  const agents = path.join(home(), ".grok", "AGENTS.md");
  const otherRule = path.join(home(), ".grok", "rules", "user.md");
  writeFileSync(agents, "Keep global instructions\r\n");
  writeFileSync(otherRule, "Keep other rules\n");
  const first = install();
  const rule = first.instructions[0]!;
  expect(rule.path).toBe(path.join(home(), ".grok", "rules", "relay-session.md"));
  const prompt = readFileSync(rule.path, "utf8");
  expect(prompt).toContain(SESSION_START_PROMPT);
  expect(prompt).toContain("GROK_SESSION_ID");
  expect(prompt).toContain("provider는 xai, agent는 grok");
  expect(prompt).not.toContain(process.env.CODEX_THREAD_ID ?? "no-test-host-session-id");
  expect(readFileSync(agents, "utf8")).toBe("Keep global instructions\r\n");
  expect(readFileSync(otherRule, "utf8")).toBe("Keep other rules\n");
  writeFileSync(rule.path, `${GROK_RULE_MARKER}\nOld Relay guidance\n`);
  expect(install().instructions[0]!.status).toBe("updated");
  expect(readFileSync(rule.path, "utf8")).toBe(prompt);
  expect(install().instructions[0]!.status).toBe("unchanged");
});

test("Grok instruction conflicts do not overwrite a user's file or stop hook registration", () => {
  const file = path.join(home(), ".grok", "rules", "relay-session.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "My own Relay instructions\n");
  const result = install();
  expect(result.instructions[0]!.status).toBe("skipped");
  expect(result.instructions[0]!.detail).toContain("보존");
  expect(readFileSync(file, "utf8")).toBe("My own Relay instructions\n");
  expect(result.hosts.every(host => host.status === "added")).toBe(true);
});

test("Grok instructions skip a linked rules directory and leave its target alone", () => {
  const outside = path.join(dir, "outside");
  mkdirSync(outside);
  mkdirSync(path.join(home(), ".grok"), { recursive: true });
  symlinkSync(outside, path.join(home(), ".grok", "rules"), process.platform === "win32" ? "junction" : "dir");
  const result = install();
  expect(result.instructions[0]!.status).toBe("skipped");
  expect(existsSync(path.join(outside, "relay-session.md"))).toBe(false);
  expect(result.hosts.find(host => host.host === "grok")!.status).toBe("added");
});

test("install-hooks adds the missing end hook to a file that only has the start hook", () => {
  mkdirSync(path.join(home(), ".claude"), { recursive: true });
  const start = `"${path.join(bin(), "relay.exe").replaceAll("\\", "/")}" hook claude || echo {}`;
  writeFileSync(path.join(home(), ".claude", "settings.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: start, timeout: 10 }] }] },
  }));
  const result = install();
  expect(result.hosts.find(h => h.host === "claude")!.status).toBe("added");
  const claude = JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8"));
  expect(claude.hooks.SessionStart).toHaveLength(1);
  expect(claude.hooks.SessionEnd[0].hooks[0].command).toContain("hook claude --end");
  expect(install().hosts.find(h => h.host === "claude")!.status).toBe("unchanged");
});

test("install-hooks lowers a Codex end hook that was registered with the ten second timeout", () => {
  const codexHome = path.join(home(), ".codex");
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(path.join(codexHome, "hooks.json"), JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: path.join(bin(), "relay-hook-codex.cmd"), timeout: 10, statusMessage: "Relay session record" }] }],
      SessionEnd: [{ hooks: [{ type: "command", command: path.join(bin(), "relay-hook-codex-end.cmd"), timeout: 10, statusMessage: "Relay session end" }] }],
    },
  }));
  expect(install().hosts.find(h => h.host === "codex")!.status).toBe("updated");
  const doc = JSON.parse(readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  expect(doc.hooks.SessionEnd).toHaveLength(1);
  expect(doc.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
  expect(doc.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
  expect(install().hosts.find(h => h.host === "codex")!.status).toBe("unchanged");
});

test("install-hooks updates a moved relay path and skips invalid JSON", () => {
  mkdirSync(path.join(home(), ".claude"), { recursive: true });
  writeFileSync(path.join(home(), ".claude", "settings.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "\"C:/old/relay.exe\" hook claude || echo {}", timeout: 10 }] }] },
  }));
  mkdirSync(path.join(home(), ".grok", "hooks"), { recursive: true });
  writeFileSync(path.join(home(), ".grok", "hooks", "relay.json"), "not json");

  const result = install();
  const claude = result.hosts.find(h => h.host === "claude")!;
  const grok = result.hosts.find(h => h.host === "grok")!;
  expect(claude.status).toBe("updated");
  const moved = JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8"));
  expect(moved.hooks.SessionStart[0].hooks[0].command).toContain(bin().replaceAll("\\", "/"));
  expect(moved.hooks.SessionStart).toHaveLength(1);
  expect(moved.hooks.SessionEnd[0].hooks[0].command).toContain(bin().replaceAll("\\", "/"));
  expect(grok.status).toBe("skipped");
  expect(readFileSync(path.join(home(), ".grok", "hooks", "relay.json"), "utf8")).toBe("not json");
});

test("CLI install-hooks writes into RELAY_USER_HOME and --bin-dir", () => {
  const result = Bun.spawnSync(
    [process.execPath, path.join(root, "src/index.ts"), "install-hooks", "--bin-dir", bin(), "--json"],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), RELAY_HOOK_BIN_DIR: bin(), CODEX_HOME: undefined }, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout.toString());
  expect(data.schemaVersion).toBe(1);
  expect(data.hosts).toHaveLength(3);
  expect(data.hosts.every((h: { status: string }) => h.status === "added")).toBe(true);
  expect(data.instructions[0].status).toBe("added");
  expect(data.skills.map((skill: { host: string }) => skill.host)).toEqual(["claude", "grok", "codex"]);
  for (const agent of ["claude", "grok", "codex"]) {
    expect(readFileSync(path.join(home(), `.${agent}`, "skills", "relay-session", "SKILL.md"), "utf8")).toContain("relay update");
  }
});

test("CLI hook registration follows GROK_HOME for hooks, start guidance and skills", () => {
  const grokHome = path.join(dir, "custom-grok");
  const result = Bun.spawnSync(
    [process.execPath, path.join(root, "src/index.ts"), "install-hooks", "--bin-dir", bin(), "--json"],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), GROK_HOME: grokHome, CODEX_HOME: undefined }, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout.toString());
  expect(data.hosts.find((item: { host: string }) => item.host === "grok").path).toBe(path.join(grokHome, "hooks", "relay.json"));
  expect(data.instructions[0].path).toBe(path.join(grokHome, "rules", "relay-session.md"));
  expect(readFileSync(path.join(grokHome, "skills", "relay-session", "SKILL.md"), "utf8")).toContain("relay update");
  expect(existsSync(path.join(home(), ".grok"))).toBe(false);
});

test("CLI hook registration preserves an edited skill while installing the start guidance", () => {
  const skill = path.join(home(), ".claude", "skills", "relay-session", "SKILL.md");
  mkdirSync(path.dirname(skill), { recursive: true });
  writeFileSync(skill, "User-customized skill\n");
  const result = Bun.spawnSync(
    [process.execPath, path.join(root, "src/index.ts"), "install-hooks", "--bin-dir", bin(), "--json"],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), GROK_HOME: undefined, CODEX_HOME: undefined }, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout.toString());
  expect(data.skills.find((item: { host: string }) => item.host === "claude").status).toBe("skipped");
  expect(readFileSync(skill, "utf8")).toBe("User-customized skill\n");
  expect(data.instructions[0].status).toBe("added");
});

test("install-hooks registers Codex in CODEX_HOME as well as ~/.codex, once when they are the same folder", () => {
  const orca = path.join(dir, "orca-codex-home");
  const both = install([orca, path.join(home(), ".codex")]);
  expect(both.hosts.filter(h => h.host === "codex").map(h => h.path)).toEqual([path.join(orca, "hooks.json"), path.join(home(), ".codex", "hooks.json")]);
  for (const file of [path.join(orca, "hooks.json"), path.join(home(), ".codex", "hooks.json")]) {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(String(doc.hooks.SessionStart[0].hooks[0].command).toLowerCase()).toContain("relay-hook-codex");
    expect(String(doc.hooks.SessionEnd[0].hooks[0].command).toLowerCase()).toContain("relay-hook-codex");
  }
  // The environment variable is what Codex itself reads, so the CLI follows it without a flag.
  const result = Bun.spawnSync(
    [process.execPath, path.join(root, "src/index.ts"), "install-hooks", "--bin-dir", bin(), "--json"],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), RELAY_HOOK_BIN_DIR: bin(), CODEX_HOME: orca }, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout.toString()) as { hosts: { host: string; path: string; status: string }[] };
  expect(data.hosts.filter(h => h.host === "codex").map(h => h.status)).toEqual(["unchanged", "unchanged"]);
  const same = Bun.spawnSync(
    [process.execPath, path.join(root, "src/index.ts"), "install-hooks", "--bin-dir", bin(), "--json"],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), RELAY_HOOK_BIN_DIR: bin(), CODEX_HOME: path.join(home(), ".codex") }, stdout: "pipe", stderr: "pipe" },
  );
  expect((JSON.parse(same.stdout.toString()) as { hosts: { host: string }[] }).hosts.filter(h => h.host === "codex")).toHaveLength(1);
});

test("shouldAutoInstallHooks skips bun, tests, hook invocations and the skip flag", () => {
  expect(isRelayBinary(process.execPath)).toBe(false);
  expect(shouldAutoInstallHooks({ execPath: process.execPath })).toBe(false);
  expect(shouldAutoInstallHooks({ execPath: path.join(bin(), "relay.exe"), env: { BUN_TEST: "1" } })).toBe(false);
  expect(shouldAutoInstallHooks({ execPath: path.join(bin(), "relay.exe"), env: { RELAY_SKIP_HOOK_INSTALL: "1" } })).toBe(false);
  expect(shouldAutoInstallHooks({
    execPath: path.join(bin(), "relay.exe"), argv: ["relay.exe", "hook", "grok"], env: {},
  })).toBe(false);
  expect(shouldAutoInstallHooks({
    execPath: path.join(bin(), "relay.exe"), argv: ["relay.exe", "hook", "claude", "--end"], env: {},
  })).toBe(false);
  expect(shouldAutoInstallHooks({
    execPath: path.join(bin(), "relay.exe"), argv: ["relay.exe", "list"], env: {},
  })).toBe(true);
});

test("source CLI invocations do not auto-install host hooks", () => {
  expect(shouldAutoInstallHooks()).toBe(false);
  expect(cli(dir, ["list"]).code).toBe(0);
});
