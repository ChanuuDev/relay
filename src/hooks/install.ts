import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { storageError } from "../errors";

export type HookChange = "added" | "updated" | "unchanged" | "skipped";
export type HookHost = "claude" | "grok" | "codex";
export type HookEvent = "SessionStart" | "SessionEnd";
/** The session hooks Relay registers: the first record when a session opens, the close when it ends. */
export const HOOK_EVENTS: HookEvent[] = ["SessionStart", "SessionEnd"];

export interface HookInstallEntry {
  host?: HookHost;
  path: string;
  status: HookChange;
  detail?: string;
}

export interface HookInstallResult {
  schemaVersion: 1;
  binDirectory: string;
  executable: string;
  wrappers: HookInstallEntry[];
  hosts: HookInstallEntry[];
}

export interface HookInstallOptions {
  homeDirectory?: string;
  binDirectory?: string;
  executablePath?: string;
  /** Codex home directories to register in; by default `$CODEX_HOME` when set, and `~/.codex`. */
  codexHomes?: string[];
}

type CommandHook = { type: string; command?: unknown; timeout?: unknown; statusMessage?: unknown };
type MatcherGroup = { matcher?: unknown; hooks?: CommandHook[] };
type HookDoc = { hooks?: Record<string, MatcherGroup[]> };

const VALUE_FLAGS = new Set([
  "--data-dir", "--port", "--cwd", "--provider", "--agent", "--session-id", "--summary",
  "--session-name", "--model", "--query", "--limit", "--offset", "--bin-dir", "--parent-provider",
]);

export function isRelayBinary(execPath = process.execPath) {
  return /^(relay|relay\.exe)$/i.test(path.basename(execPath));
}

export function primaryCommand(argv = process.argv) {
  // Compiled relay.exe puts the subcommand at argv[1]; bun/node keep the script path there.
  for (let i = isRelayBinary(argv[0]) ? 1 : 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") return argv[i + 1];
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    return arg;
  }
}

export function shouldAutoInstallHooks(input: {
  argv?: string[]; execPath?: string; env?: NodeJS.ProcessEnv;
} = {}) {
  const env = input.env ?? process.env;
  if (env.RELAY_SKIP_HOOK_INSTALL === "1" || env.BUN_TEST) return false;
  if (!isRelayBinary(input.execPath ?? process.execPath)) return false;
  return primaryCommand(input.argv ?? process.argv) !== "hook";
}

function homeDirectory(options: HookInstallOptions) {
  return options.homeDirectory ?? process.env.RELAY_USER_HOME ?? homedir();
}

function binDirectory(options: HookInstallOptions, home: string) {
  if (options.binDirectory) return options.binDirectory;
  if (process.env.RELAY_HOOK_BIN_DIR) return process.env.RELAY_HOOK_BIN_DIR;
  if (isRelayBinary(options.executablePath ?? process.execPath)) {
    return path.dirname(options.executablePath ?? process.execPath);
  }
  return path.join(home, ".local", "bin");
}

// Codex reads its hooks from `$CODEX_HOME` when a host such as Orca sets it, and from `~/.codex` otherwise.
// Both are registered so the hook runs however Codex is launched.
function codexHomes(options: HookInstallOptions, home: string): string[] {
  if (options.codexHomes) return options.codexHomes;
  const seen = new Set<string>();
  return [process.env.CODEX_HOME, path.join(home, ".codex")]
    .filter((dir): dir is string => typeof dir === "string" && dir.trim().length > 0)
    .filter(dir => {
      const key = process.platform === "win32" ? path.resolve(dir).toLowerCase() : path.resolve(dir);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function executablePath(options: HookInstallOptions, bin: string) {
  if (options.executablePath) return options.executablePath;
  if (isRelayBinary()) return process.execPath;
  return path.join(bin, process.platform === "win32" ? "relay.exe" : "relay");
}

const endFlag = (event: HookEvent) => event === "SessionEnd" ? " --end" : "";

function hookCommand(executable: string, alias: HookHost, event: HookEvent) {
  return `"${executable.replaceAll("\\", "/")}" hook ${alias}${endFlag(event)} || echo {}`;
}

export function wrapperName(alias: "grok" | "codex", event: HookEvent) {
  return `relay-hook-${alias}${event === "SessionEnd" ? "-end" : ""}.cmd`;
}

export function wrapperScript(alias: HookHost, event: HookEvent = "SessionStart") {
  return `@echo off\r\nif exist "%~dp0relay.exe" (\r\n  "%~dp0relay.exe" hook ${alias}${endFlag(event)}\r\n) else (\r\n  echo {}\r\n)\r\n`;
}

// Both entries name the alias, so the end form is told apart before the start form is assumed.
function isRelayCommand(command: unknown, alias: string, event: HookEvent) {
  if (typeof command !== "string") return false;
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  const end = normalized.includes(`hook ${alias} --end`) || normalized.includes(`relay-hook-${alias}-end.cmd`);
  if (event === "SessionEnd") return end;
  return !end && (normalized.includes(`hook ${alias}`) || normalized.includes(`relay-hook-${alias}.cmd`));
}

function parseJsonFile(file: string): { missing: true } | { value: Record<string, unknown> } | { error: string } {
  try {
    const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return { error: "JSON 객체가 아닙니다." };
    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { missing: true };
    return { error: "JSON을 읽을 수 없습니다." };
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.relay-tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

function writeText(file: string, content: string): HookChange {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existed = existsSync(file);
  if (existed && readFileSync(file, "utf8") === content) return "unchanged";
  const temp = `${file}.relay-tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, file);
  return existed ? "updated" : "added";
}

function ensureEvent(doc: HookDoc, event: HookEvent, alias: string, command: string, extra: Partial<CommandHook> = {}): HookChange {
  if (!doc.hooks || Array.isArray(doc.hooks) || typeof doc.hooks !== "object") doc.hooks = {};
  const groups = Array.isArray(doc.hooks[event]) ? doc.hooks[event]! : [];
  doc.hooks[event] = groups;
  const wanted: CommandHook = { type: "command", command, timeout: 10, ...extra };
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) continue;
    const index = group.hooks.findIndex(hook => isRelayCommand(hook?.command, alias, event));
    if (index < 0) continue;
    const current = group.hooks[index]!;
    if (current.command === command && current.timeout === 10) return "unchanged";
    group.hooks[index] = { ...current, ...wanted };
    return "updated";
  }
  groups.push({ hooks: [wanted] });
  return "added";
}

type HostCommands = Record<HookEvent, { command: string; extra?: Partial<CommandHook> }>;

/** One entry per host file: both events are settled in the same write, and the file reports the larger change. */
function installHostFile(file: string, alias: HookHost, commands: HostCommands): HookInstallEntry {
  const parsed = parseJsonFile(file);
  if ("error" in parsed) return { host: alias, path: file, status: "skipped", detail: parsed.error };
  const doc = ("missing" in parsed ? {} : parsed.value) as HookDoc;
  const before = JSON.stringify(doc);
  const changes = HOOK_EVENTS.map(event => ensureEvent(doc, event, alias, commands[event].command, commands[event].extra));
  const status: HookChange = changes.includes("updated") ? "updated" : changes.includes("added") ? "added" : "unchanged";
  if (status === "unchanged" && !("missing" in parsed) && JSON.stringify(doc) === before) {
    return { host: alias, path: file, status };
  }
  writeJson(file, doc);
  return { host: alias, path: file, status: "missing" in parsed ? "added" : status };
}

export function installHostHooks(options: HookInstallOptions = {}): HookInstallResult {
  try {
    const home = homeDirectory(options);
    const bin = binDirectory(options, home);
    const executable = executablePath(options, bin);
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    const wrappers: HookInstallEntry[] = [];
    if (process.platform === "win32") {
      for (const alias of ["grok", "codex"] as const) {
        for (const event of HOOK_EVENTS) {
          const file = path.join(bin, wrapperName(alias, event));
          wrappers.push({ path: file, status: writeText(file, wrapperScript(alias, event)) });
        }
      }
    }
    const commands = (alias: HookHost, extra?: (event: HookEvent) => Partial<CommandHook>) => Object.fromEntries(HOOK_EVENTS.map(event => [event, {
      command: alias !== "claude" && process.platform === "win32" ? path.join(bin, wrapperName(alias, event)) : hookCommand(executable, alias, event),
      extra: extra?.(event),
    }])) as HostCommands;
    const hosts = [
      installHostFile(path.join(home, ".claude", "settings.json"), "claude", commands("claude")),
      installHostFile(path.join(home, ".grok", "hooks", "relay.json"), "grok", commands("grok")),
      ...codexHomes(options, home).map(dir => installHostFile(path.join(dir, "hooks.json"), "codex",
        commands("codex", event => ({ statusMessage: event === "SessionEnd" ? "Relay session end" : "Relay session record" })))),
    ];
    return { schemaVersion: 1, binDirectory: bin, executable, wrappers, hosts };
  } catch (error) {
    throw storageError(error);
  }
}

export function autoInstallHostHooks() {
  if (!shouldAutoInstallHooks()) return;
  try { installHostHooks(); } catch { /* 훅 등록 실패가 본 명령을 막지 않는다 */ }
}
