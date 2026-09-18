import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installHostHooks, isRelayBinary, shouldAutoInstallHooks, wrapperScript } from "../src/hooks/install";
import { cleanup, cli, root, temporary } from "./helpers";

let dir: string;
beforeEach(() => { dir = temporary(); });
afterEach(() => cleanup(dir));

function home() { return path.join(dir, "home"); }
function bin() { return path.join(dir, "bin"); }
function install() {
  return installHostHooks({ homeDirectory: home(), binDirectory: bin(), executablePath: path.join(bin(), "relay.exe") });
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

  const second = install();
  expect(second.hosts.every(h => h.status === "unchanged")).toBe(true);
  expect(JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8")).model).toBe("keep-me");
  // Each event holds exactly one Relay entry after any number of runs.
  const settled = JSON.parse(readFileSync(path.join(home(), ".claude", "settings.json"), "utf8"));
  expect(settled.hooks.SessionStart).toHaveLength(2);
  expect(settled.hooks.SessionEnd).toHaveLength(1);
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
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), RELAY_HOOK_BIN_DIR: bin() }, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout.toString());
  expect(data.schemaVersion).toBe(1);
  expect(data.hosts).toHaveLength(3);
  expect(data.hosts.every((h: { status: string }) => h.status === "added")).toBe(true);
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
