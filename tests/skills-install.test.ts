import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installSkills, skillFiles } from "../src/skills/install";
import { cleanup, root, temporary } from "./helpers";

let dir: string;
beforeEach(() => { dir = temporary(); });
afterEach(() => cleanup(dir));

const home = () => path.join(dir, "home");
const codexHome = () => path.join(home(), ".codex");
const skillDir = (host: string) => path.join(home(), host, "skills", "relay-session");
function install(force = false, codexHomes = [codexHome()]) {
  return installSkills({ homeDirectory: home(), codexHomes, force });
}
function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "install-skills", ...args],
    { cwd: root, env: { ...process.env, RELAY_USER_HOME: home(), CODEX_HOME: undefined }, stdout: "pipe", stderr: "pipe" });
}

test("install-skills writes a real copy for Claude, Grok and Codex and is idempotent", () => {
  const first = install();
  expect(first.schemaVersion).toBe(1);
  expect(first.skill).toBe("relay-session");
  expect(first.targets.map(t => [t.host, t.status])).toEqual([["claude", "added"], ["grok", "added"], ["codex", "added"]]);
  const source = readFileSync(path.join(root, "skills/relay-session/SKILL.md"), "utf8");
  const claude = readFileSync(path.join(skillDir(".claude"), "SKILL.md"), "utf8");
  expect(claude).toContain("argument-hint: codex|claude|grok|cursor");
  expect(claude.replace("argument-hint: codex|claude|grok|cursor\n", "")).toBe(source);
  // The agent must be able to invoke the skill itself; /relay-session stays available either way.
  expect(claude).not.toContain("disable-model-invocation");
  expect(readFileSync(path.join(skillDir(".grok"), "SKILL.md"), "utf8")).toBe(claude);
  expect(readFileSync(path.join(skillDir(".codex"), "SKILL.md"), "utf8")).toBe(source);
  expect(readFileSync(path.join(skillDir(".codex"), "agents/openai.yaml"), "utf8"))
    .toBe(readFileSync(path.join(root, "skills/relay-session/agents/openai.yaml"), "utf8"));
  // Only Codex needs the interface descriptor; the other hosts read the frontmatter.
  expect(existsSync(path.join(skillDir(".claude"), "agents"))).toBe(false);
  expect(existsSync(path.join(skillDir(".grok"), "agents"))).toBe(false);
  expect(lstatSync(skillDir(".claude")).isSymbolicLink()).toBe(false);
  expect(install().targets.every(t => t.status === "unchanged")).toBe(true);
});

test("install-skills replaces a dangling junction with a real copy", () => {
  // The shape agents report as a symlink problem: links into a shared folder that was later removed.
  const vanished = path.join(dir, "agents-skills", "relay-session");
  mkdirSync(vanished, { recursive: true });
  mkdirSync(path.join(home(), ".claude", "skills"), { recursive: true });
  mkdirSync(path.join(codexHome(), "skills"), { recursive: true });
  symlinkSync(vanished, skillDir(".claude"), "junction");
  symlinkSync(vanished, skillDir(".codex"), "junction");
  rmSync(vanished, { recursive: true });
  expect(existsSync(skillDir(".claude"))).toBe(false);
  expect(lstatSync(skillDir(".claude")).isSymbolicLink()).toBe(true);

  const result = install();
  const claude = result.targets.find(t => t.host === "claude")!;
  expect(claude.status).toBe("added");
  expect(claude.detail).toContain("링크를 실제 사본으로 교체");
  expect(lstatSync(skillDir(".claude")).isSymbolicLink()).toBe(false);
  expect(lstatSync(skillDir(".claude")).isDirectory()).toBe(true);
  expect(readFileSync(path.join(skillDir(".claude"), "SKILL.md"), "utf8")).toBe(skillFiles("claude")["SKILL.md"]);
  expect(result.targets.find(t => t.host === "codex")!.status).toBe("added");
  expect(lstatSync(skillDir(".codex")).isSymbolicLink()).toBe(false);
  expect(existsSync(path.join(skillDir(".codex"), "agents/openai.yaml"))).toBe(true);
  expect(existsSync(vanished)).toBe(false);
  expect(install().targets.every(t => t.status === "unchanged")).toBe(true);
});

test("install-skills replaces a live link but leaves the linked folder untouched", () => {
  const shared = path.join(dir, "shared", "relay-session");
  mkdirSync(shared, { recursive: true });
  writeFileSync(path.join(shared, "SKILL.md"), "shared copy");
  writeFileSync(path.join(shared, "keep.txt"), "keep");
  mkdirSync(path.join(home(), ".grok", "skills"), { recursive: true });
  symlinkSync(shared, skillDir(".grok"), "junction");

  const grok = install().targets.find(t => t.host === "grok")!;
  expect(grok.status).toBe("added");
  expect(grok.detail).toContain("링크");
  expect(lstatSync(skillDir(".grok")).isSymbolicLink()).toBe(false);
  expect(readFileSync(path.join(skillDir(".grok"), "SKILL.md"), "utf8")).toBe(skillFiles("grok")["SKILL.md"]);
  expect(readFileSync(path.join(shared, "SKILL.md"), "utf8")).toBe("shared copy");
  expect(readFileSync(path.join(shared, "keep.txt"), "utf8")).toBe("keep");
});

test("install-skills replaces a linked SKILL.md file inside a real folder", () => {
  const elsewhere = path.join(dir, "elsewhere", "SKILL.md");
  mkdirSync(path.dirname(elsewhere), { recursive: true });
  writeFileSync(elsewhere, "elsewhere");
  mkdirSync(skillDir(".claude"), { recursive: true });
  symlinkSync(elsewhere, path.join(skillDir(".claude"), "SKILL.md"), "file");
  const claude = install().targets.find(t => t.host === "claude")!;
  expect(claude.status).toBe("updated");
  expect(claude.detail).toContain("SKILL.md 링크를 실제 파일로 교체");
  expect(lstatSync(path.join(skillDir(".claude"), "SKILL.md")).isSymbolicLink()).toBe(false);
  expect(readFileSync(path.join(skillDir(".claude"), "SKILL.md"), "utf8")).toBe(skillFiles("claude")["SKILL.md"]);
  expect(readFileSync(elsewhere, "utf8")).toBe("elsewhere");
});

test("install-skills keeps an edited copy unless --force is given", () => {
  install();
  const file = path.join(skillDir(".claude"), "SKILL.md");
  const edited = readFileSync(file, "utf8") + "\nUser customization\n";
  writeFileSync(file, edited);
  const kept = install().targets.find(t => t.host === "claude")!;
  expect(kept.status).toBe("skipped");
  expect(kept.detail).toContain("--force");
  expect(readFileSync(file, "utf8")).toBe(edited);
  // The other hosts are untouched by one host's skip.
  expect(install().targets.find(t => t.host === "grok")!.status).toBe("unchanged");
  expect(install(true).targets.find(t => t.host === "claude")!.status).toBe("updated");
  expect(readFileSync(file, "utf8")).toBe(skillFiles("claude")["SKILL.md"]);
});

test("install-skills covers CODEX_HOME as well as ~/.codex", () => {
  const orca = path.join(dir, "orca-codex-home");
  const result = install(false, [orca, codexHome()]);
  expect(result.targets.filter(t => t.host === "codex").map(t => t.path))
    .toEqual([path.join(orca, "skills", "relay-session"), skillDir(".codex")]);
  expect(existsSync(path.join(orca, "skills", "relay-session", "agents", "openai.yaml"))).toBe(true);
  expect(existsSync(path.join(skillDir(".codex"), "agents", "openai.yaml"))).toBe(true);
});

test("CLI install-skills writes into RELAY_USER_HOME and reports JSON or a table", () => {
  const json = run("--json");
  expect(json.exitCode).toBe(0);
  const data = JSON.parse(json.stdout.toString()) as { schemaVersion: number; skill: string; targets: { host: string; status: string }[] };
  expect(data.schemaVersion).toBe(1);
  expect(data.skill).toBe("relay-session");
  expect(data.targets.map(t => t.host)).toEqual(["claude", "grok", "codex"]);
  expect(data.targets.every(t => t.status === "added")).toBe(true);
  const table = run();
  expect(table.exitCode).toBe(0);
  expect(table.stdout.toString()).toContain("relay-session");
  expect(table.stdout.toString()).toContain("이미 설치됨");
  expect(run("--force").exitCode).toBe(0);
});
