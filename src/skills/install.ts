import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storageError } from "../errors";
import { codexHomes, homeDirectory, type HookChange } from "../hooks/install";
import skillSource from "../../skills/relay-session/SKILL.md" with { type: "text" };
import openaiSource from "../../skills/relay-session/agents/openai.yaml" with { type: "text" };

export type SkillHost = "claude" | "grok" | "codex";
export const SKILL_NAME = "relay-session";

export interface SkillInstallEntry {
  host: SkillHost;
  path: string;
  status: HookChange;
  detail?: string;
}

export interface SkillInstallResult {
  schemaVersion: 1;
  skill: typeof SKILL_NAME;
  targets: SkillInstallEntry[];
}

export interface SkillInstallOptions {
  homeDirectory?: string;
  /** Codex home directories to install in; by default `$CODEX_HOME` when set, and `~/.codex`. */
  codexHomes?: string[];
  /** Replace an existing copy whose content differs; without it the host is reported as skipped. */
  force?: boolean;
}

// The skill ships inside the executable, so an installation never depends on a checkout or on a link to one.
const SKILL_TEXT = skillSource as unknown as string;
const OPENAI_TEXT = openaiSource as unknown as string;

/** Claude Code and Grok read argument-hint from the frontmatter; Codex reads agents/openai.yaml instead. */
export function skillFiles(host: SkillHost): Record<string, string> {
  if (host === "codex") return { "SKILL.md": SKILL_TEXT, "agents/openai.yaml": OPENAI_TEXT };
  return { "SKILL.md": SKILL_TEXT.replace(/^---(\r?\n)/, (_match, eol: string) => `---${eol}argument-hint: codex|claude|grok${eol}`) };
}

/** Where each host reads user-level skills from. */
export function skillRoots(options: SkillInstallOptions = {}): { host: SkillHost; root: string }[] {
  const home = homeDirectory(options);
  return [
    { host: "claude", root: path.join(home, ".claude") },
    { host: "grok", root: path.join(home, ".grok") },
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

function installTarget(host: SkillHost, root: string, force: boolean): SkillInstallEntry {
  const dir = path.join(root, "skills", SKILL_NAME);
  try {
    const files = skillFiles(host);
    const notes: string[] = [];
    const top = inspect(dir);
    if (top.kind === "file") return { host, path: dir, status: "skipped", detail: "스킬 폴더 자리에 파일이 있습니다." };
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
      return { host, path: dir, status: "skipped", detail: "기존 스킬 내용이 다릅니다. 확인 후 --force로 교체하세요." };
    }
    for (const s of states) {
      if (s.state === "same") continue;
      if (s.state === "link") { removeLink(s.file); notes.push(`${path.basename(s.file)} 링크를 실제 파일로 교체`); }
      writeFile(s.file, s.content);
    }
    const status: HookChange = states.every(s => s.state === "same") ? "unchanged" : top.kind === "directory" ? "updated" : "added";
    return { host, path: dir, status, ...(notes.length ? { detail: notes.join("; ") } : {}) };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return { host, path: dir, status: "skipped", detail: `파일을 쓸 수 없습니다${code ? ` (${code})` : ""}.` };
  }
}

export function installSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  try {
    const force = options.force === true;
    return { schemaVersion: 1, skill: SKILL_NAME, targets: skillRoots(options).map(({ host, root }) => installTarget(host, root, force)) };
  } catch (error) {
    throw storageError(error);
  }
}
