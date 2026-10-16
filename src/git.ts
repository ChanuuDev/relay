import type { GitClue } from "./session/session.types";

const TIMEOUT_MS = 1500;

function git(cwd: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore", timeout: TIMEOUT_MS });
    return result.exitCode === 0 ? result.stdout.toString() : null;
  } catch { return null; }
}

/**
 * Where the working tree stands right now: branch, short commit and how many paths differ. It is the
 * clue the next agent asks for first, and never the diff itself. Anything that fails, from a folder
 * outside a repository to a missing git, yields null and the record is written without it.
 */
export function gitClue(cwd: string, now = () => new Date()): GitClue | null {
  if (process.env.RELAY_NO_GIT === "1") return null;
  const status = git(cwd, ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"]);
  if (status === null) return null;
  const lines = status.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  // "main...origin/main [ahead 1]", "No commits yet on main" or "HEAD (no branch)" when detached.
  const named = /^(?:No commits yet on |Initial commit on )?([^\s.]+)/.exec(header)?.[1];
  const branch = !named || header.startsWith("HEAD ") ? null : named;
  const commit = git(cwd, ["rev-parse", "--short", "HEAD"])?.trim() || null;
  return { branch, commit, dirty: lines.length, at: now().toISOString() };
}
