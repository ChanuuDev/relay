import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { storageError } from "../errors";
import { GROK_RULE_MARKER, GROK_SESSION_RULE } from "./context";

export type HookChange = "added" | "updated" | "unchanged" | "skipped";
export type HookHost = "claude" | "grok" | "codex" | "cursor";
export type HookEvent = "SessionStart" | "SessionEnd" | "PreCompact";
/** The session hooks Relay registers: the first record when a session opens, the close when it ends, and a note when the host compacts its context. */
export const HOOK_EVENTS: HookEvent[] = ["SessionStart", "SessionEnd", "PreCompact"];
/** Seconds a host waits for a Relay hook. Codex gives SessionEnd hooks one second by default and allows at most three, so its end hook is registered within that limit. */
const HOOK_TIMEOUT = 10;
const CODEX_END_TIMEOUT = 3;
/** The flag that tells `relay hook` which event fired, and the suffix that tells the wrappers apart. */
const EVENT_FLAG: Record<HookEvent, string> = { SessionStart: "", SessionEnd: " --end", PreCompact: " --compact" };
const EVENT_SUFFIX: Record<HookEvent, string> = { SessionStart: "", SessionEnd: "-end", PreCompact: "-compact" };
/** Cursor names the same events in camelCase inside `~/.cursor/hooks.json`. */
export const CURSOR_EVENTS: Record<HookEvent, string> = { SessionStart: "sessionStart", SessionEnd: "sessionEnd", PreCompact: "preCompact" };
/** Hosts whose hook commands go through a `.cmd` wrapper on Windows. */
export const WRAPPED_HOSTS = ["grok", "codex", "cursor"] as const;

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
  instructions: HookInstallEntry[];
}

export interface HookInstallOptions {
  homeDirectory?: string;
  binDirectory?: string;
  executablePath?: string;
  /** Codex home directories to register in; by default `$CODEX_HOME` when set, and `~/.codex`. */
  codexHomes?: string[];
  grokHome?: string;
  cursorHome?: string;
}

type CommandHook = { type: string; command?: unknown; timeout?: unknown; statusMessage?: unknown };
type MatcherGroup = { matcher?: unknown; hooks?: CommandHook[] };
type HookDoc = { hooks?: Record<string, MatcherGroup[]> };
/** Cursor lists the commands of an event directly, without matcher groups, and versions the file. */
type CursorHook = { command?: unknown; timeout?: unknown; type?: unknown };
type CursorDoc = { version?: unknown; hooks?: Record<string, CursorHook[]> };

const VALUE_FLAGS = new Set([
  "--data-dir", "--port", "--cwd", "--provider", "--agent", "--session-id", "--summary",
  "--session-name", "--model", "--query", "--limit", "--offset", "--bin-dir", "--parent-provider", "--status", "--shell",
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

export function homeDirectory(options: { homeDirectory?: string }) {
  return options.homeDirectory ?? process.env.RELAY_USER_HOME ?? homedir();
}

export function grokHome(options: { grokHome?: string }, home: string) {
  return options.grokHome ?? process.env.GROK_HOME ?? path.join(home, ".grok");
}

/** Cursor keeps its user hooks and settings in `~/.cursor`; it has no home override of its own. */
export function cursorHome(options: { cursorHome?: string }, home: string) {
  return options.cursorHome ?? path.join(home, ".cursor");
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
export function codexHomes(options: { codexHomes?: string[] }, home: string): string[] {
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

function hookCommand(executable: string, alias: HookHost, event: HookEvent) {
  return `"${executable.replaceAll("\\", "/")}" hook ${alias}${EVENT_FLAG[event]} || echo {}`;
}

export function wrapperName(alias: (typeof WRAPPED_HOSTS)[number], event: HookEvent) {
  return `relay-hook-${alias}${EVENT_SUFFIX[event]}.cmd`;
}

export function wrapperScript(alias: HookHost, event: HookEvent = "SessionStart") {
  return `@echo off\r\nif exist "%~dp0relay.exe" (\r\n  "%~dp0relay.exe" hook ${alias}${EVENT_FLAG[event]}\r\n) else (\r\n  echo {}\r\n)\r\n`;
}

// Every entry names the alias, so the end and compact forms are told apart before the start form is assumed.
function isRelayCommand(command: unknown, alias: string, event: HookEvent) {
  if (typeof command !== "string") return false;
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  const end = normalized.includes(`hook ${alias} --end`) || normalized.includes(`relay-hook-${alias}-end.cmd`);
  const compact = normalized.includes(`hook ${alias} --compact`) || normalized.includes(`relay-hook-${alias}-compact.cmd`);
  if (event === "SessionEnd") return end;
  if (event === "PreCompact") return compact;
  return !end && !compact && (normalized.includes(`hook ${alias}`) || normalized.includes(`relay-hook-${alias}.cmd`));
}

function parseJsonFile(file: string): { missing: true } | { value: Record<string, unknown> } | { error: string } {
  try {
    const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
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

/** Grok ignores SessionStart stdout, but loads user rules before the first model request. */
function installGrokInstructions(root: string): HookInstallEntry {
  const file = path.join(root, "rules", "relay-session.md");
  const entry = { host: "grok" as const, path: file };
  try {
    for (const target of [root, path.dirname(file), file]) {
      let stat;
      try { stat = lstatSync(target); }
      catch (error) { if ((error as { code?: string }).code === "ENOENT") continue; throw error; }
      if (stat.isSymbolicLink() || (target === file ? !stat.isFile() : !stat.isDirectory())) {
        return { ...entry, status: "skipped", detail: "지침 경로가 링크이거나 파일 형식이 다릅니다." };
      }
    }
    if (existsSync(file) && !readFileSync(file, "utf8").startsWith(GROK_RULE_MARKER)) {
      return { ...entry, status: "skipped", detail: "기존 사용자 지침을 보존했습니다. 다른 이름으로 옮긴 뒤 다시 등록하세요." };
    }
    return { ...entry, status: writeText(file, GROK_SESSION_RULE) };
  } catch {
    return { ...entry, status: "skipped", detail: "세션 시작 지침을 쓸 수 없습니다." };
  }
}

function ensureEvent(doc: HookDoc, event: HookEvent, alias: string, command: string, extra: Partial<CommandHook> = {}): HookChange {
  if (!doc.hooks || Array.isArray(doc.hooks) || typeof doc.hooks !== "object") doc.hooks = {};
  const groups = Array.isArray(doc.hooks[event]) ? doc.hooks[event]! : [];
  doc.hooks[event] = groups;
  const wanted: CommandHook = { type: "command", command, timeout: HOOK_TIMEOUT, ...extra };
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) continue;
    const index = group.hooks.findIndex(hook => isRelayCommand(hook?.command, alias, event));
    if (index < 0) continue;
    const current = group.hooks[index]!;
    if (current.command === command && current.timeout === wanted.timeout) return "unchanged";
    group.hooks[index] = { ...current, ...wanted };
    return "updated";
  }
  groups.push({ hooks: [wanted] });
  return "added";
}

function ensureCursorEvent(doc: CursorDoc, event: HookEvent, command: string): HookChange {
  if (!doc.hooks || Array.isArray(doc.hooks) || typeof doc.hooks !== "object") doc.hooks = {};
  const name = CURSOR_EVENTS[event];
  const list = Array.isArray(doc.hooks[name]) ? doc.hooks[name]! : [];
  doc.hooks[name] = list;
  const wanted: CursorHook = { command, timeout: HOOK_TIMEOUT };
  const index = list.findIndex(hook => isRelayCommand(hook?.command, "cursor", event));
  if (index < 0) { list.push(wanted); return "added"; }
  const current = list[index]!;
  if (current.command === command && current.timeout === HOOK_TIMEOUT) return "unchanged";
  list[index] = { ...current, ...wanted };
  return "updated";
}

type HostCommands = Record<HookEvent, { command: string; extra?: Partial<CommandHook> }>;

const settle = (changes: HookChange[]): HookChange => changes.includes("updated") ? "updated" : changes.includes("added") ? "added" : "unchanged";

/** One entry per host file: every event is settled in the same write, and the file reports the larger change. */
function installHostFile(file: string, alias: HookHost, commands: HostCommands): HookInstallEntry {
  const parsed = parseJsonFile(file);
  if ("error" in parsed) return { host: alias, path: file, status: "skipped", detail: parsed.error };
  const doc = ("missing" in parsed ? {} : parsed.value) as HookDoc;
  const before = JSON.stringify(doc);
  const status = settle(HOOK_EVENTS.map(event => ensureEvent(doc, event, alias, commands[event].command, commands[event].extra)));
  if (status === "unchanged" && !("missing" in parsed) && JSON.stringify(doc) === before) {
    return { host: alias, path: file, status };
  }
  writeJson(file, doc);
  return { host: alias, path: file, status: "missing" in parsed ? "added" : status };
}

/** Cursor's file keeps its own shape; other hooks in it, Relay's or not, stay where they are. */
function installCursorFile(file: string, commands: HostCommands): HookInstallEntry {
  const parsed = parseJsonFile(file);
  if ("error" in parsed) return { host: "cursor", path: file, status: "skipped", detail: parsed.error };
  const existing = "missing" in parsed ? undefined : parsed.value as CursorDoc;
  if (existing && existing.version !== undefined && existing.version !== 1) {
    return { host: "cursor", path: file, status: "skipped", detail: `알 수 없는 hooks.json 버전입니다: ${String(existing.version)}` };
  }
  const doc: CursorDoc = { version: 1, ...(existing ?? {}) };
  const before = JSON.stringify(doc);
  const status = settle(HOOK_EVENTS.map(event => ensureCursorEvent(doc, event, commands[event].command)));
  if (status === "unchanged" && existing && JSON.stringify(doc) === before) return { host: "cursor", path: file, status };
  writeJson(file, doc);
  return { host: "cursor", path: file, status: existing ? status : "added" };
}

export function installHostHooks(options: HookInstallOptions = {}): HookInstallResult {
  try {
    const home = homeDirectory(options);
    const bin = binDirectory(options, home);
    const executable = executablePath(options, bin);
    const grok = grokHome(options, home);
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    const wrappers: HookInstallEntry[] = [];
    if (process.platform === "win32") {
      for (const alias of WRAPPED_HOSTS) {
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
      installHostFile(path.join(grok, "hooks", "relay.json"), "grok", commands("grok")),
      ...codexHomes(options, home).map(dir => installHostFile(path.join(dir, "hooks.json"), "codex",
        commands("codex", event => ({
          statusMessage: event === "SessionEnd" ? "Relay session end" : event === "PreCompact" ? "Relay compaction note" : "Relay session record",
          timeout: event === "SessionEnd" ? CODEX_END_TIMEOUT : HOOK_TIMEOUT,
        })))),
      installCursorFile(path.join(cursorHome(options, home), "hooks.json"), commands("cursor")),
    ];
    return { schemaVersion: 1, binDirectory: bin, executable, wrappers, hosts, instructions: [installGrokInstructions(grok)] };
  } catch (error) {
    throw storageError(error);
  }
}

export function autoInstallHostHooks() {
  if (!shouldAutoInstallHooks()) return;
  try { installHostHooks(); } catch { /* 훅 등록 실패가 본 명령을 막지 않는다 */ }
}
