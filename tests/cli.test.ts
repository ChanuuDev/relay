import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, cli, root, temporary } from "./helpers";
import { quote } from "../src/web/lib/format";

describe("CLI processes", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));
  const record = (id: string) => ["record", "--provider", "openai", "--agent", "codex", "--session-id", id, "--summary", "첫 기록", "--cwd", root];

  test("persistence across processes and JSON stream/exit contracts", () => {
    expect(cli(dir, record("a")).code).toBe(0);
    expect(cli(dir, ["update", "--session-id", "a", "--summary", "진행"]).stderr).toBe("");
    const result = cli(dir, ["show", "a", "--history"]);
    expect(result.data.updates.length).toBe(2); expect(result.data.session.createdAt).toBeString();
    expect(result.data.session.status).toBeNull(); expect(result.data.session.endedAt).toBeNull();
    expect(cli(dir, ["latest", "codex"]).data.session.providerSessionId).toBe("a");
    const missing = cli(dir, ["latest", "grok"]); expect(missing.stdout).toBe(""); expect(missing.code).toBe(3);
    expect(missing.data.error.code).toBe("SESSION_NOT_FOUND");
    const invalid = cli(dir, ["latest"]); expect(invalid.code).toBe(2); expect(invalid.stdout).toBe("");
    const unknown = cli(dir, ["list", "--nope"]); expect(unknown.code).toBe(2); expect(unknown.data.error.code).toBe("INVALID_ARGUMENT");
    expect(cli(dir, ["web"]).code).toBe(2);
    // 소스에서 실행하면 커밋·빌드 시각이 없다(빌드한 실행 파일만 싣는다).
    expect(cli(dir, ["version"]).data).toEqual({ schemaVersion: 1, version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, revision: null, builtAt: null });
  });

  test("an internal ID suggests an executable lookup in the same store without mutating records", () => {
    const store = path.join(dir, "한글's store"); mkdirSync(store);
    const id = "agent's id; echo unexpected";
    const created = cli(store, record(id)).data.session;
    const before = cli(store, ["show", id, "--history"]).data;
    const result = cli(store, ["show", created.id, "--provider", "openai"]);
    expect(result.code).toBe(3); expect(result.stdout).toBe("");
    expect(result.data.error.code).toBe("SESSION_NOT_FOUND");
    expect(result.data.error.message).toContain("Relay 내부 ID");
    const { command, shell, providerSessionId, provider } = result.data.error.details;
    expect(providerSessionId).toBe(id); expect(provider).toBe("openai");
    expect(command).toStartWith("relay show ");
    expect(command).toContain("--data-dir"); expect(command).not.toMatch(/[\r\n]/);
    expect(shell).toBe(process.platform === "win32" ? "powershell" : "bash");
    // Execute the suggested arguments against this checkout, not the installed relay binary.
    const script = `${shell === "powershell" ? "& " : ""}${quote(process.execPath, shell)} ${quote(path.join(root, "src/index.ts"), shell)} ${command.slice("relay ".length)}`;
    const executed = Bun.spawnSync(shell === "powershell" ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script] : ["bash", "-c", script],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, RELAY_DATA_DIR: dir } });
    expect(executed.exitCode).toBe(0); expect(executed.stderr.toString()).toBe("");
    expect(JSON.parse(executed.stdout.toString()).session.id).toBe(created.id);
    const human = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "show", created.id, "--data-dir", store],
      { stdout: "pipe", stderr: "pipe" });
    expect(human.exitCode).toBe(3); expect(human.stdout.toString()).toBe("");
    expect(human.stderr.toString()).toContain(command);
    expect(cli(store, ["show", id, "--history"]).data).toEqual(before);
    expect(cli(store, ["show", created.id, "--provider", "anthropic"]).data.error).not.toHaveProperty("details");
    expect(cli(store, ["show", "missing"]).data.error).not.toHaveProperty("details");
    cli(store, record(created.id));
    expect(cli(store, ["show", created.id]).data.session.providerSessionId).toBe(created.id);
  });

  test("legacy lifecycle commands stay removed; the declared state, pin and delete are explicit", () => {
    for (const args of [
      ["start", "--provider", "openai", "--agent", "codex", "--session-id", "legacy", "--summary", "기록"],
      ["finish", "--session-id", "legacy", "--summary", "종료", "--status", "completed"],
      ["record", "--provider", "openai", "--agent", "codex", "--session-id", "legacy", "--summary", "기록", "--status", "active"],
      ["list", "--status", "active"],
    ]) {
      const result = cli(dir, args);
      expect(result.code).toBe(2); expect(result.stdout).toBe(""); expect(result.data.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(cli(dir, ["list"]).data.page.total).toBe(0);
    expect(cli(dir, [...record("work"), "--status", "working"]).data.session.status).toBe("working");
    const updated = cli(dir, ["update", "--session-id", "work", "--summary", "남은 일 넘김", "--status", "handoff", "--session-name", "로그인 수정"]).data.session;
    expect(updated.status).toBe("handoff"); expect(updated.sessionName).toBe("로그인 수정");
    expect(cli(dir, ["list", "--status", "handoff"]).data.items.map((s: { providerSessionId: string }) => s.providerSessionId)).toEqual(["work"]);
    expect(cli(dir, ["show", "work", "--history"]).data.updates.map((u: { status: string | null }) => u.status)).toEqual(["handoff", "working"]);
    expect(cli(dir, ["pin", "work"]).data.session.pinned).toBe(true);
    expect(cli(dir, ["list", "--pinned"]).data.page.total).toBe(1);
    expect(cli(dir, ["unpin", "work"]).data.session.pinned).toBe(false);
    expect(cli(dir, ["list", "--pinned"]).data.page.total).toBe(0);
    cli(dir, ["continue", "work", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "next", "--summary", "이어받음"]);
    const refused = cli(dir, ["delete", "work"]);
    expect(refused.code).toBe(4); expect(refused.stdout).toBe(""); expect(refused.data.error.code).toBe("SESSION_LINKED");
    const removed = cli(dir, ["delete", "work", "--force"]);
    expect(removed.code).toBe(0); expect(removed.data.deleted).toBe(true); expect(removed.data.detached).toBe(1);
    expect(cli(dir, ["show", "work"]).code).toBe(3);
    expect(cli(dir, ["show", "next", "--provider", "anthropic"]).data.session.parentSessionId).toBeNull();
  });

  test("chain and handoff read the line of work; a CLI record carries the working tree clue", () => {
    const first = cli(dir, [...record("first"), "--session-name", "첫 작업"]).data.session;
    expect(first.git.branch).toBeString(); expect(first.git.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(first.git.dirty).toBeNumber(); expect(first.git.at).toBeString();
    cli(dir, ["continue", "first", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "second", "--summary", "이어받음", "--status", "handoff"]);
    const chain = cli(dir, ["chain", "second", "--provider", "anthropic"]);
    expect(chain.code).toBe(0); expect(chain.data.truncated).toBe(false);
    expect(chain.data.items.map((n: { providerSessionId: string; depth: number; current: boolean }) => [n.providerSessionId, n.depth, n.current]))
      .toEqual([["first", 0, false], ["second", 1, true]]);
    const handoff = cli(dir, ["handoff", "second", "--provider", "anthropic", "--shell", "bash"]);
    expect(handoff.code).toBe(0); expect(handoff.data.sessionId).toBe(chain.data.session.id);
    const markdown: string = handoff.data.markdown;
    for (const piece of ["# 인계: 첫 작업", "- 작업 상태: 인계 대기", "## 최근 작업 요약", "> 이어받음", "## 세션 흐름", "**현재**",
      "claude --resume 'second'", "relay show 'second' --provider 'anthropic'", "실제 프로젝트 파일도 확인하세요"]) expect(markdown).toContain(piece);
    expect(cli(dir, ["handoff", "second", "--shell", "fish"]).code).toBe(2);
    expect(cli(dir, ["handoff", "missing"]).code).toBe(3);
    // Human output of handoff is the note itself; a chain renders as a flow, never as the table.
    const run = (args: string[]) => Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), ...args, "--data-dir", dir],
      { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, RELAY_NO_TUI: "1", NO_COLOR: "1" } });
    expect(run(["handoff", "second", "--provider", "anthropic"]).stdout.toString()).toStartWith("# 인계: 첫 작업\n");
    const flow = run(["chain", "first"]).stdout.toString();
    expect(flow).toContain("세션 흐름 (2건)"); expect(flow).toContain("▶"); expect(flow).not.toContain("Agent Session ID");
    const removed = run(["delete", "second", "--provider", "anthropic"]);
    expect(removed.exitCode).toBe(0); expect(removed.stdout.toString()).toContain("삭제함");
    // RELAY_NO_GIT turns the reading off, so a record written with it carries no clue.
    const quiet = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), ...record("bare"), "--data-dir", dir, "--json"],
      { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, RELAY_NO_GIT: "1" } });
    expect(JSON.parse(quiet.stdout.toString()).session.git).toBeNull();
  });

  test("JSON output remains uncolored when terminal colors are forced", () => {
    cli(dir, record("color-json"));
    for (const args of [["list"], ["show", "color-json", "--history"]]) {
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), ...args, "--data-dir", dir, "--json"],
        { env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).not.toContain("\x1b");
      expect(JSON.parse(result.stdout.toString()).schemaVersion).toBe(1);
    }
  });

  test("CLI cross-provider continuation, idempotent retry and conflict", () => {
    cli(dir, record("a"));
    const args = ["continue", "a", "--parent-provider", "openai", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "b", "--summary", "재개"];
    const result = cli(dir, args); expect(result.code).toBe(0);
    expect(result.data.parentSession.provider).toBe("openai"); expect(result.data.session.provider).toBe("anthropic");
    expect(cli(dir, args).data.session.id).toBe(result.data.session.id);
    expect(cli(dir, ["show", "b", "--history"]).data.updates.length).toBe(1);
    expect(cli(dir, [...record("a"), "--model", "changed"]).code).toBe(4);
  });

  test("provider shortcuts select the same latest record without changing history", () => {
    for (const [alias, provider, agent] of [["codex", "openai", "codex"], ["claude", "anthropic", "claude-code"], ["grok", "xai", "grok"]] as const) {
      const missing = cli(dir, [`--${alias}`]);
      expect(missing.code).toBe(3); expect(missing.stdout).toBe("");
      expect(missing.data.error.code).toBe("SESSION_NOT_FOUND");
      expect(cli(dir, ["record", "--provider", provider, "--agent", agent, "--session-id", alias, "--summary", `${alias} 요약`, "--cwd", root]).code).toBe(0);
      const before = cli(dir, ["show", alias, "--provider", provider, "--history"]).data;
      const shortcut = cli(dir, [`--${alias}`]);
      expect(shortcut.code).toBe(0); expect(shortcut.stderr).toBe("");
      expect(shortcut.data.scope).toEqual({ cwd: null });
      expect(shortcut.data).toEqual(cli(dir, ["latest", alias]).data);
      expect(cli(dir, [`--${alias}`]).data).toEqual(shortcut.data);
      expect(cli(dir, ["show", alias, "--provider", provider, "--history"]).data).toEqual(before);
    }
    const human = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "--codex", "--data-dir", dir]);
    expect(human.exitCode).toBe(0); expect(human.stderr.toString()).toBe("");
    expect(human.stdout.toString()).toContain("codex 요약");
    expect(human.stdout.toString()).toContain("조회 범위: 전체 프로젝트");
    const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "--data-dir", dir, "--json", "--codex"],
      { env: { ...process.env, RELAY_DATA_DIR: path.join(dir, "other") } });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString()).session.providerSessionId).toBe("codex");
  });

  test("latest reports the requested project scope even when no record matches", () => {
    const session = cli(dir, record("scoped")).data.session;
    const scoped = cli(dir, ["latest", "codex", "--cwd", root]);
    expect(scoped.code).toBe(0);
    expect(scoped.data.scope).toEqual({ cwd: session.workingDirectory });
    const missing = cli(dir, ["latest", "codex", "--cwd", dir]);
    expect(missing.code).toBe(3);
    expect(missing.data.error.details.scope).toEqual({ cwd: dir.replaceAll("\\", "/") });
    expect(missing.data.error.message).toContain(dir.replaceAll("\\", "/"));
    expect(cli(dir, ["latest", "codex"]).data.session.id).toBe(session.id);
    expect(cli(dir, ["latest", "grok"]).data.error.details.scope).toEqual({ cwd: null });
  });

  test("conflicting shortcuts and mixed commands fail before changing data", () => {
    cli(dir, record("a"));
    const before = cli(dir, ["show", "a", "--history"]).data;
    for (const args of [["--codex", "--claude"], ["--claude", "--grok"], ["--codex", "list"],
      ["latest", "claude", "--codex"], ["--codex", ...record("new")],
      ["update", "--session-id", "a", "--summary", "변경 금지", "--grok"]]) {
      const result = cli(dir, args);
      expect(result.code).toBe(2); expect(result.stdout).toBe(""); expect(result.data.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(cli(dir, ["show", "a", "--history"]).data).toEqual(before);
    expect(cli(dir, ["list"]).data.page.total).toBe(1);
  });
});
