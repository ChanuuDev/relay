import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { age, cleanup, cli, cliAsync, root, temporary } from "./helpers";

describe("CLI processes", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));
  const start = (id: string) => ["start", "--provider", "openai", "--agent", "codex", "--session-id", id, "--summary", "시작", "--cwd", root];

  test("persistence across processes and JSON stream/exit contracts", () => {
    expect(cli(dir, start("a")).code).toBe(0);
    expect(cli(dir, ["update", "--session-id", "a", "--summary", "진행"]).stderr).toBe("");
    expect(cli(dir, ["finish", "--session-id", "a", "--status", "completed", "--summary", "완료"]).code).toBe(0);
    const result = cli(dir, ["show", "a", "--history"]);
    expect(result.data.updates.length).toBe(3); expect(result.data.session.status).toBe("COMPLETED");
    expect(cli(dir, ["latest", "codex"]).data.session.providerSessionId).toBe("a");
    const missing = cli(dir, ["latest", "grok"]); expect(missing.stdout).toBe(""); expect(missing.code).toBe(3);
    expect(missing.data.error.code).toBe("SESSION_NOT_FOUND");
    const invalid = cli(dir, ["latest"]); expect(invalid.code).toBe(2); expect(invalid.stdout).toBe("");
    const unknown = cli(dir, ["list", "--nope"]); expect(unknown.code).toBe(2); expect(unknown.data.error.code).toBe("INVALID_ARGUMENT");
    expect(cli(dir, ["web"]).code).toBe(2);
  });

  test("CLI cross-provider continuation, idempotent retry and conflict", () => {
    cli(dir, start("a")); cli(dir, ["finish", "--session-id", "a", "--status", "interrupted", "--summary", "중단"]);
    const args = ["continue", "a", "--parent-provider", "openai", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "b", "--summary", "재개"];
    const result = cli(dir, args); expect(result.code).toBe(0);
    expect(result.data.parentSession.provider).toBe("openai"); expect(result.data.session.provider).toBe("anthropic");
    expect(cli(dir, args).data.session.id).toBe(result.data.session.id);
    expect(cli(dir, ["show", "b", "--history"]).data.updates.length).toBe(1);
    expect(cli(dir, [...start("a"), "--model", "changed"]).code).toBe(4);
  });

  test("provider shortcuts select the same latest record without changing history", () => {
    for (const [alias, provider, agent] of [["codex", "openai", "codex"], ["claude", "anthropic", "claude-code"], ["grok", "xai", "grok"]] as const) {
      const missing = cli(dir, [`--${alias}`]);
      expect(missing.code).toBe(3); expect(missing.stdout).toBe("");
      expect(missing.data.error.code).toBe("SESSION_NOT_FOUND");
      expect(cli(dir, ["start", "--provider", provider, "--agent", agent, "--session-id", alias, "--summary", `${alias} 요약`, "--cwd", root]).code).toBe(0);
      const before = cli(dir, ["show", alias, "--provider", provider, "--history"]).data;
      const shortcut = cli(dir, [`--${alias}`]);
      expect(shortcut.code).toBe(0); expect(shortcut.stderr).toBe("");
      expect(shortcut.data).toEqual(cli(dir, ["latest", alias]).data);
      expect(cli(dir, [`--${alias}`]).data).toEqual(shortcut.data);
      expect(cli(dir, ["show", alias, "--provider", provider, "--history"]).data).toEqual(before);
    }
    const human = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "--codex", "--data-dir", dir]);
    expect(human.exitCode).toBe(0); expect(human.stderr.toString()).toBe("");
    expect(human.stdout.toString()).toContain("codex 요약");
    const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "--data-dir", dir, "--json", "--codex"],
      { env: { ...process.env, RELAY_DATA_DIR: path.join(dir, "other") } });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString()).session.providerSessionId).toBe("codex");
  });

  test("conflicting shortcuts and mixed commands fail before changing data", () => {
    cli(dir, start("a"));
    const before = cli(dir, ["show", "a", "--history"]).data;
    for (const args of [["--codex", "--claude"], ["--claude", "--grok"], ["--codex", "list"],
      ["latest", "claude", "--codex"], ["--codex", ...start("new")],
      ["update", "--session-id", "a", "--summary", "변경 금지", "--grok"]]) {
      const result = cli(dir, args);
      expect(result.code).toBe(2); expect(result.stdout).toBe(""); expect(result.data.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(cli(dir, ["show", "a", "--history"]).data).toEqual(before);
    expect(cli(dir, ["list"]).data.page.total).toBe(1);
  });

  test("concurrent first initialization and progress maintain consistent history", async () => {
    const starts = await Promise.all(Array.from({ length: 4 }, (_, i) => cliAsync(dir, start(`s${i}`))));
    expect(starts.map(s => s.code)).toEqual([0, 0, 0, 0]);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => cliAsync(dir, ["update", "--session-id", "s0", "--summary", `진행 ${i}`])));
    expect(results.every(s => s.code === 0)).toBe(true);
    const history = cli(dir, ["show", "s0", "--history"]).data;
    expect(history.updates.map((u: { sequence: number }) => u.sequence)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(history.session.summary).toBe(history.updates[0].summary);
    const finish = await Promise.all(["completed", "interrupted"].map(status => cliAsync(dir, ["finish", "--session-id", "s0", "--summary", status, "--status", status])));
    expect(finish.map(s => s.code).sort()).toEqual([0, 4]);
    expect(cli(dir, ["show", "s0", "--history"]).data.updates.length).toBe(10);
  });

  test("busy writer returns DB_BUSY after bounded wait, no partial success", () => {
    cli(dir, start("a"));
    const db = new Database(path.join(dir, "relay.db")); db.exec("BEGIN IMMEDIATE");
    try {
      const began = Date.now(); const result = cli(dir, ["update", "--session-id", "a", "--summary", "잠금"]);
      expect(result.code).toBe(5); expect(result.stdout).toBe(""); expect(result.data.error.code).toBe("DB_BUSY");
      expect(Date.now() - began).toBeGreaterThanOrEqual(2800);
      expect(cli(dir, ["show", "a"]).data.session.summary).toBe("시작");
    } finally { db.exec("ROLLBACK"); db.close(); }
  }, 10000);

  test("future schema, incompatible config and inaccessible DB never silently reset", () => {
    cli(dir, start("a")); const db = new Database(path.join(dir, "relay.db")); db.exec("PRAGMA user_version=99"); db.close();
    expect(cli(dir, ["list"]).data.error.code).toBe("SCHEMA_MISMATCH");
    const read = new Database(path.join(dir, "relay.db")); expect(read.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 1 }); read.close();
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ webHost: "0.0.0.0" }));
    expect(cli(dir, ["list"]).data.error.code).toBe("INVALID_CONFIG");
  });

  test("config retentionDays drives automatic deletion and rejects invalid values", () => {
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: 30 }));
    cli(dir, start("old")); cli(dir, start("keep"));
    const aged = new Database(path.join(dir, "relay.db")); age(aged, "old", 31); aged.close();
    expect(cli(dir, ["list"]).data.page.total).toBe(2);
    expect(cli(dir, ["update", "--session-id", "keep", "--summary", "진행"]).code).toBe(0);
    expect(cli(dir, ["show", "old"]).data.error.code).toBe("SESSION_NOT_FOUND");
    expect(cli(dir, ["list"]).data.items.map((s: { providerSessionId: string }) => s.providerSessionId)).toEqual(["keep"]);
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: 0 }));
    const disabled = new Database(path.join(dir, "relay.db")); age(disabled, "keep", 4000); disabled.close();
    cli(dir, start("new"));
    expect(cli(dir, ["list"]).data.page.total).toBe(2);
    for (const value of [-1, 0.5, 3651, "30"]) {
      writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: value }));
      expect(cli(dir, ["list"]).data.error.code).toBe("INVALID_CONFIG");
    }
  });

  test("session start hook records from stdin and never fails the host session", () => {
    const hook = (payload: string, extra: Record<string, string> = {}) => {
      // The host session of this test run must not leak into the payload fallback.
      const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, ...extra };
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", "claude", "--data-dir", dir],
        { cwd: root, env, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe" });
      return { code: result.exitCode, stdout: result.stdout.toString().trim() };
    };
    const started = hook(JSON.stringify({ session_id: "hook-session", cwd: root, hook_event_name: "SessionStart", session_source: "startup" }));
    expect(started.code).toBe(0); expect(started.stdout).toBe("{}");
    const stored = cli(dir, ["show", "hook-session"]).data.session;
    expect(stored.provider).toBe("anthropic"); expect(stored.agent).toBe("claude-code");
    expect(stored.sessionName).toBe(path.basename(root)); expect(stored.status).toBe("ACTIVE");
    // Resume fires the hook again with the same payload and must not duplicate history or fail.
    expect(hook(JSON.stringify({ session_id: "hook-session", cwd: root, session_source: "resume" })).code).toBe(0);
    expect(cli(dir, ["show", "hook-session", "--history"]).data.updates.length).toBe(1);
    // Subagents and unusable payloads stay silent instead of breaking the session.
    expect(hook(JSON.stringify({ session_id: "sub", cwd: root, agent_id: "agent-1" })).code).toBe(0);
    for (const payload of ["", "not json", "[]", JSON.stringify({ cwd: root })]) {
      const result = hook(payload);
      expect(result.code).toBe(0); expect(result.stdout).toBe("{}");
    }
    expect(cli(dir, ["list"]).data.page.total).toBe(1);
    // A host that omits the id from the payload is still recorded from its session environment variable.
    expect(hook("{}", { CLAUDE_CODE_SESSION_ID: "env-session" }).code).toBe(0);
    expect(cli(dir, ["show", "env-session"]).data.session.providerSessionId).toBe("env-session");
  }, 15000);

  test("failed history writes roll back through CLI and error stream", () => {
    cli(dir, start("a")); const db = new Database(path.join(dir, "relay.db"));
    db.exec("CREATE TRIGGER fail BEFORE INSERT ON session_updates BEGIN SELECT RAISE(ABORT, 'injected'); END;"); db.close();
    const failure = cli(dir, ["update", "--session-id", "a", "--summary", "실패"]);
    expect(failure.code).toBe(5); expect(failure.stdout).toBe("");
    expect(cli(dir, ["show", "a", "--history"]).data.updates.length).toBe(1);
  });

  test("separate data directories, precedence and bad storage path", () => {
    cli(dir, start("a"));
    const other = temporary();
    try {
      expect(cli(other, ["list"]).data.page.total).toBe(0);
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "--data-dir", dir, "list", "--json"], { env: { ...process.env, RELAY_DATA_DIR: other } });
      expect(JSON.parse(result.stdout.toString()).page.total).toBe(1);
      const nested = path.join(other, "nested"); mkdirSync(nested); mkdirSync(path.join(nested, "relay.db"));
      expect(cli(nested, ["list"]).data.error.code).toBe("STORAGE_ERROR");
    } finally { cleanup(other); }
  });
});
