import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storageError } from "../errors";
import { codexHomes, grokHome, homeDirectory, type HookChange } from "../hooks/install";
import sessionSource from "../../skills/relay-session/SKILL.md" with { type: "text" };
import sessionOpenai from "../../skills/relay-session/agents/openai.yaml" with { type: "text" };
import memoSource from "../../skills/relay-memo/SKILL.md" with { type: "text" };
import memoOpenai from "../../skills/relay-memo/agents/openai.yaml" with { type: "text" };

export type SkillHost = "claude" | "grok" | "codex";
/** 세션 기록(relay-session)과 메모 읽기·쓰기(relay-memo). 둘 다 같은 규칙으로 설치한다. */
export const SKILL_NAMES = ["relay-session", "relay-memo"] as const;
export type SkillName = typeof SKILL_NAMES[number];
export const SKILL_NAME: SkillName = "relay-session";

export interface SkillInstallEntry {
  skill: SkillName;
  host: SkillHost;
  path: string;
  status: HookChange;
  detail?: string;
}

export interface SkillInstallResult {
  schemaVersion: 1;
  skills: SkillName[];
  targets: SkillInstallEntry[];
}

export interface SkillInstallOptions {
  homeDirectory?: string;
  /** Codex home directories to install in; by default `$CODEX_HOME` when set, and `~/.codex`. */
  codexHomes?: string[];
  grokHome?: string;
  /** Replace an existing copy whose content differs; without it the host is reported as skipped. */
  force?: boolean;
}

/** The aliases a reader may pass to relay-session. Cursor reads the Claude and Codex copies, so it gets no copy of its own. */
export const ARGUMENT_HINT = "argument-hint: codex|claude|grok|cursor";
/** What a reader passes to relay-memo: the ID the notes app copied, or words to search for. ASCII so the PowerShell installer can write it as is. */
export const MEMO_ARGUMENT_HINT = "argument-hint: <memo-id|folder-id|query>";

// The skills ship inside the executable, so an installation never depends on a checkout or on a link to one.
const SOURCES: Record<SkillName, { skill: string; openai: string; hint: string }> = {
  "relay-session": { skill: sessionSource as unknown as string, openai: sessionOpenai as unknown as string, hint: ARGUMENT_HINT },
  "relay-memo": { skill: memoSource as unknown as string, openai: memoOpenai as unknown as string, hint: MEMO_ARGUMENT_HINT },
};

/** Claude Code and Grok read argument-hint from the frontmatter; Codex reads agents/openai.yaml instead. */
export function skillFiles(host: SkillHost, skill: SkillName = SKILL_NAME): Record<string, string> {
  const source = SOURCES[skill];
  if (host === "codex") return { "SKILL.md": source.skill, "agents/openai.yaml": source.openai };
  return { "SKILL.md": source.skill.replace(/^---(\r?\n)/, (_match, eol: string) => `---${eol}${source.hint}${eol}`) };
}

/** Where each host reads user-level skills from. */
export function skillRoots(options: SkillInstallOptions = {}): { host: SkillHost; root: string }[] {
  const home = homeDirectory(options);
  return [
    { host: "claude", root: path.join(home, ".claude") },
    { host: "grok", root: grokHome(options, home) },
    ...codexHomes(options, home).map(root => ({ host: "codex" as const, root })),
  ];
}

type Entry = { kind: "missing" } | { kind: "link"; target: string | null } | { kind: "file" } | { kind: "directory" };

// lstat never follows the link, so a dangling junction or symlink is still seen as a link rather than as nothing.
function inspect(file: string): Entry {
  let stat;
  try { stat = lstatSync(file); } catch { return { kind: "missing" }; }
  if (stat.isSymbolicLink()) {
    let target: string | null = null;
    try { target = readlinkSync(file).replace(/^\\\\\?\\/, ""); } catch { /* 대상을 읽지 못해도 링크는 교체한다 */ }
    return { kind: "link", target };
  }
  return stat.isDirectory() ? { kind: "directory" } : { kind: "file" };
}

/** Removes the link entry only; whatever it pointed to is never touched. */
function removeLink(file: string) {
  try { unlinkSync(file); }
  catch { rmdirSync(file); }
  if (inspect(file).kind !== "missing") throw new Error(`link not removed: ${file}`);
}

function writeFile(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.relay-tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, file);
}

function installTarget(skill: SkillName, host: SkillHost, root: string, force: boolean): SkillInstallEntry {
  const dir = path.join(root, "skills", skill);
  try {
    const files = skillFiles(host, skill);
    const notes: string[] = [];
    const top = inspect(dir);
    if (top.kind === "file") return { skill, host, path: dir, status: "skipped", detail: "스킬 폴더 자리에 파일이 있습니다." };
    // A skill folder that is itself a link breaks as soon as its target moves, so the link gives way to a real copy.
    if (top.kind === "link") {
      removeLink(dir);
      notes.push(`링크를 실제 사본으로 교체 (이전 대상: ${top.target ?? "알 수 없음"})`);
    }
    const states = Object.entries(files).map(([relative, content]) => {
      const file = path.join(dir, relative);
      const entry = inspect(file);
      if (entry.kind === "link") return { file, content, state: "link" as const };
      if (entry.kind === "missing") return { file, content, state: "missing" as const };
      if (entry.kind === "directory") throw new Error(`directory in place of file: ${file}`);
      return { file, content, state: readFileSync(file, "utf8") === content ? "same" as const : "differs" as const };
    });
    // Compare everything before writing anything, so a user-edited copy is kept unless replacement is explicit.
    if (!force && states.some(s => s.state === "differs")) {
      return { skill, host, path: dir, status: "skipped", detail: "기존 스킬 내용이 다릅니다. 확인 후 --force로 교체하세요." };
    }
    for (const s of states) {
      if (s.state === "same") continue;
      if (s.state === "link") { removeLink(s.file); notes.push(`${path.basename(s.file)} 링크를 실제 파일로 교체`); }
      writeFile(s.file, s.content);
    }
    const status: HookChange = states.every(s => s.state === "same") ? "unchanged" : top.kind === "directory" ? "updated" : "added";
    return { skill, host, path: dir, status, ...(notes.length ? { detail: notes.join("; ") } : {}) };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return { skill, host, path: dir, status: "skipped", detail: `파일을 쓸 수 없습니다${code ? ` (${code})` : ""}.` };
  }
}

/** Every skill on every host, skill by skill, so the relay-session rows come first as they always have. */
export function installSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  try {
    const force = options.force === true;
    const roots = skillRoots(options);
    return { schemaVersion: 1, skills: [...SKILL_NAMES],
      targets: SKILL_NAMES.flatMap(skill => roots.map(({ host, root }) => installTarget(skill, host, root, force))) };
  } catch (error) {
    throw storageError(error);
  }
}
