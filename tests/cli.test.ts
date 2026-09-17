import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { age, cleanup, cli, cliAsync, root, temporary } from "./helpers";
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
    expect(result.data.session).not.toHaveProperty("status"); expect(result.data.session).not.toHaveProperty("endedAt");
    expect(cli(dir, ["latest", "codex"]).data.session.providerSessionId).toBe("a");
    const missing = cli(dir, ["latest", "grok"]); expect(missing.stdout).toBe(""); expect(missing.code).toBe(3);
    expect(missing.data.error.code).toBe("SESSION_NOT_FOUND");
    const invalid = cli(dir, ["latest"]); expect(invalid.code).toBe(2); expect(invalid.stdout).toBe("");
    const unknown = cli(dir, ["list", "--nope"]); expect(unknown.code).toBe(2); expect(unknown.data.error.code).toBe("INVALID_ARGUMENT");
    expect(cli(dir, ["web"]).code).toBe(2);
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

  test("state-management commands and status options are removed", () => {
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

  test("concurrent first initialization and progress maintain consistent history", async () => {
    const records = await Promise.all(Array.from({ length: 4 }, (_, i) => cliAsync(dir, record(`s${i}`))));
    expect(records.map(s => s.code)).toEqual([0, 0, 0, 0]);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => cliAsync(dir, ["update", "--session-id", "s0", "--summary", `진행 ${i}`])));
    expect(results.every(s => s.code === 0)).toBe(true);
    const history = cli(dir, ["show", "s0", "--history"]).data;
    expect(history.updates.map((u: { sequence: number }) => u.sequence)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(history.session.summary).toBe(history.updates[0].summary);
    expect(cli(dir, ["show", "s0", "--history"]).data.updates.length).toBe(9);
  });

  test("busy writer returns DB_BUSY after bounded wait, no partial success", () => {
    cli(dir, record("a"));
    const db = new Database(path.join(dir, "relay.db")); db.exec("BEGIN IMMEDIATE");
    try {
      const began = Date.now(); const result = cli(dir, ["update", "--session-id", "a", "--summary", "잠금"]);
      expect(result.code).toBe(5); expect(result.stdout).toBe(""); expect(result.data.error.code).toBe("DB_BUSY");
      expect(Date.now() - began).toBeGreaterThanOrEqual(2800);
      expect(cli(dir, ["show", "a"]).data.session.summary).toBe("첫 기록");
    } finally { db.exec("ROLLBACK"); db.close(); }
  }, 10000);

  test("future schema, incompatible config and inaccessible DB never silently reset", () => {
    cli(dir, record("a")); const db = new Database(path.join(dir, "relay.db")); db.exec("PRAGMA user_version=99"); db.close();
    expect(cli(dir, ["list"]).data.error.code).toBe("SCHEMA_MISMATCH");
    const read = new Database(path.join(dir, "relay.db")); expect(read.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 1 }); read.close();
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ webHost: "0.0.0.0" }));
    expect(cli(dir, ["list"]).data.error.code).toBe("INVALID_CONFIG");
  });

  test("config retentionDays drives automatic deletion and rejects invalid values", () => {
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: 30 }));
    cli(dir, record("old")); cli(dir, record("keep"));
    const aged = new Database(path.join(dir, "relay.db")); age(aged, "old", 31); aged.close();
    expect(cli(dir, ["list"]).data.page.total).toBe(2);
    expect(cli(dir, ["update", "--session-id", "keep", "--summary", "진행"]).code).toBe(0);
    expect(cli(dir, ["show", "old"]).data.error.code).toBe("SESSION_NOT_FOUND");
    expect(cli(dir, ["list"]).data.items.map((s: { providerSessionId: string }) => s.providerSessionId)).toEqual(["keep"]);
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: 0 }));
    const disabled = new Database(path.join(dir, "relay.db")); age(disabled, "keep", 4000); disabled.close();
    cli(dir, record("new"));
    expect(cli(dir, ["list"]).data.page.total).toBe(2);
    for (const value of [-1, 0.5, 3651, "30"]) {
      writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retentionDays: value }));
      expect(cli(dir, ["list"]).data.error.code).toBe("INVALID_CONFIG");
    }
  });

  test("session first-record hook records from stdin and never fails the host session", () => {
    const hook = (payload: string, extra: Record<string, string> = {}, alias = "claude") => {
      // The host session of this test run must not leak into the payload fallback.
      const env: Record<string, string | undefined> = {
        ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, GROK_SESSION_ID: undefined, ...extra,
      };
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", alias, "--data-dir", dir],
        { cwd: root, env, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe" });
      return { code: result.exitCode, stdout: result.stdout.toString().trim() };
    };
    const started = hook(JSON.stringify({ session_id: "hook-session", cwd: root, hook_event_name: "SessionStart", session_source: "startup" }));
    expect(started.code).toBe(0); expect(started.stdout).toBe("{}");
    const stored = cli(dir, ["show", "hook-session"]).data.session;
    expect(stored.provider).toBe("anthropic"); expect(stored.agent).toBe("claude-code");
    expect(stored.sessionName).toBe(path.basename(root)); expect(stored).not.toHaveProperty("status");
    expect(stored.summary).toBe("세션 첫 기록 (훅 자동 기록)");
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
    expect(hook(JSON.stringify({ sessionId: "grok-payload", cwd: root }), {}, "grok").code).toBe(0);
    expect(cli(dir, ["show", "grok-payload", "--provider", "xai"]).data.session.agent).toBe("grok");
    expect(hook("{}", { GROK_SESSION_ID: "grok-env-session" }, "grok").code).toBe(0);
    expect(cli(dir, ["show", "grok-env-session", "--provider", "xai"]).data.session.provider).toBe("xai");
    expect(hook("{}", { CODEX_THREAD_ID: "codex-env-session" }, "codex").code).toBe(0);
    expect(cli(dir, ["show", "codex-env-session", "--provider", "openai"]).data.session.agent).toBe("codex");
  }, 15000);

  test("failed history writes roll back through CLI and error stream", () => {
    cli(dir, record("a")); const db = new Database(path.join(dir, "relay.db"));
    db.exec("CREATE TRIGGER fail BEFORE INSERT ON session_updates BEGIN SELECT RAISE(ABORT, 'injected'); END;"); db.close();
    const failure = cli(dir, ["update", "--session-id", "a", "--summary", "실패"]);
    expect(failure.code).toBe(5); expect(failure.stdout).toBe("");
    expect(cli(dir, ["show", "a", "--history"]).data.updates.length).toBe(1);
  });

  test("separate data directories, precedence and bad storage path", () => {
    cli(dir, record("a"));
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
