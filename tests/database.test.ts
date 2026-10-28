import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { loadConfig } from "../src/config";
import { DB_VERSION, openDatabase } from "../src/db/database";
import legacySchema from "../src/db/migrations/001_init.sql" with { type: "text" };
import v2Schema from "../src/db/migrations/002_init.sql" with { type: "text" };
import v3Schema from "../src/db/migrations/003_init.sql" with { type: "text" };
import v4Schema from "../src/db/migrations/004_init.sql" with { type: "text" };
import v5Schema from "../src/db/migrations/005_init.sql" with { type: "text" };
import { CalculatorStore } from "../src/calculator/calculator.store";
import { NoteStore } from "../src/notes/notes.store";
import { SessionRepository } from "../src/session/session.repository";
import { SessionService } from "../src/session/session.service";
import { cleanup, cliAsync, input, root, temporary } from "./helpers";

describe("Database record migration", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));

  function legacy(status = "ACTIVE") {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(legacySchema);
    db.exec("PRAGMA user_version = 1");
    const created = "2026-09-01T00:00:00.000Z";
    const updated = "2026-09-02T00:00:00.000Z";
    const insert = db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id,
      session_name, model, working_directory, status, summary, parent_session_id,
      metadata_json, started_at, updated_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("ses_parent", "openai", "codex", "parent", "기존 작업", "old-model", root,
      status, "마지막 맥락", null, '{"preserved":true}', created, updated, status === "ACTIVE" ? null : updated);
    insert.run("ses_child", "anthropic", "claude-code", "child", "후속 작업", null, root,
      "ACTIVE", "이어받은 맥락", "ses_parent", "{}", updated, updated, null);
    const append = db.query("INSERT INTO session_updates VALUES (?, ?, ?, ?, ?, ?)");
    append.run("upd_first", "ses_parent", 1, "START", "첫 맥락", created);
    append.run("upd_last", "ses_parent", 2, status === "ACTIVE" ? "PROGRESS" : "END", "마지막 맥락", updated);
    append.run("upd_child", "ses_child", 1, "START", "이어받은 맥락", updated);
    return db;
  }

  test.each(["ACTIVE", "INTERRUPTED", "COMPLETED", "ABANDONED"])("v1 %s records keep identity, dates, metadata, links and all history", status => {
    const old = legacy(status);
    // The v1 lifecycle is not carried over: every migrated session starts without an end on record.
    const sessions = old.query(`SELECT id, provider, agent, provider_session_id, session_name, model,
      working_directory, summary, parent_session_id, metadata_json, started_at AS created_at, updated_at,
      NULL AS ended_at, NULL AS end_reason, NULL AS status, 0 AS pinned
      FROM sessions ORDER BY id`).all();
    const updates = old.query("SELECT id, session_id, sequence, summary, created_at, NULL AS status FROM session_updates ORDER BY id").all();
    old.close();
    const config = loadConfig(dir);
    const db = openDatabase(config, true);
    try {
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(db.query("SELECT * FROM sessions ORDER BY id").all()).toEqual(sessions);
      expect(db.query("SELECT * FROM session_updates ORDER BY id").all()).toEqual(updates);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(() => db.exec("DELETE FROM sessions")).toThrow();
      const service = new SessionService(new SessionRepository(db));
      const detail = service.show("parent", "openai", true);
      expect(detail.children[0].providerSessionId).toBe("child");
      expect(detail.updates?.map(update => update.sequence)).toEqual([2, 1]);
      expect(detail.session).not.toHaveProperty("startedAt");
      // The v1 lifecycle state is not the declared work state: every migrated session starts with none.
      expect(detail.session.status).toBeNull(); expect(detail.session.pinned).toBe(false);
      expect(detail.session.endedAt).toBeNull(); expect(detail.session.endReason).toBeNull();
      expect(detail.updates?.[0]).not.toHaveProperty("type");
    } finally { db.close(); }
    const writer = openDatabase(config);
    try {
      const service = new SessionService(new SessionRepository(writer));
      expect(service.update("parent", "추가 맥락").session.summary).toBe("추가 맥락");
      expect(service.record(input("next"), "parent", "openai").session.parentSessionId).toBe("ses_parent");
      expect(service.show("parent", "openai", true).updates?.map(update => update.sequence)).toEqual([3, 2, 1]);
    } finally { writer.close(); }
    const reopened = openDatabase(config, true);
    try { expect(reopened.query("SELECT count(*) AS n FROM session_updates").get()).toEqual({ n: 5 }); }
    finally { reopened.close(); }
  });

  test("v2 records gain the end columns in place and keep every row, link and history entry", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v2Schema);
    db.exec("PRAGMA user_version = 2");
    const at = "2026-09-10T00:00:00.000Z";
    const insert = db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, session_name, model,
      working_directory, summary, parent_session_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("ses_parent", "anthropic", "claude-code", "parent", "이전 작업", null, root, "마지막 맥락", null, "{}", at, at);
    insert.run("ses_child", "openai", "codex", "child", "후속 작업", "gpt-5", root, "이어받음", "ses_parent", "{}", at, at);
    db.query("INSERT INTO session_updates VALUES (?, ?, ?, ?, ?)").run("upd_parent", "ses_parent", 1, "마지막 맥락", at);
    db.query("INSERT INTO session_updates VALUES (?, ?, ?, ?, ?)").run("upd_child", "ses_child", 1, "이어받음", at);
    const before = db.query("SELECT * FROM sessions ORDER BY id").all() as Record<string, unknown>[];
    db.close();

    const config = loadConfig(dir);
    const reader = openDatabase(config, true);
    try {
      expect(reader.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(reader.query("SELECT * FROM sessions ORDER BY id").all()).toEqual(before.map(row => ({ ...row, ended_at: null, end_reason: null, status: null, pinned: 0 })));
      expect(reader.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(reader.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      const service = new SessionService(new SessionRepository(reader));
      expect(service.show("child", "openai").parentSession?.providerSessionId).toBe("parent");
      expect(service.show("parent", "anthropic", true).updates?.length).toBe(1);
    } finally { reader.close(); }
    const writer = openDatabase(config);
    try {
      const service = new SessionService(new SessionRepository(writer));
      const ended = service.end("child", "openai", "logout");
      expect(ended.deleted).toBe(false);
      expect(service.show("child", "openai").session.endReason).toBe("logout");
      expect(service.update("child", "재개").session.endedAt).toBeNull();
    } finally { writer.close(); }
  });

  test("failed migration rolls back schema, version and records", () => {
    const old = legacy();
    old.exec("UPDATE sessions SET parent_session_id='missing' WHERE id='ses_child'");
    const schema = old.query("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    const sessions = old.query("SELECT * FROM sessions ORDER BY id").all();
    const updates = old.query("SELECT * FROM session_updates ORDER BY id").all();
    old.close();
    expect(() => { const migrated = openDatabase(loadConfig(dir)); migrated.close(); }).toThrow("손상");
    const db = new Database(path.join(dir, "relay.db"));
    try {
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      expect(db.query("SELECT name, sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
      expect(db.query("SELECT * FROM sessions ORDER BY id").all()).toEqual(sessions);
      expect(db.query("SELECT * FROM session_updates ORDER BY id").all()).toEqual(updates);
    } finally { db.close(); }
  });

  test("concurrent v1 readers migrate once without duplicating history", async () => {
    legacy().close();
    const results = await Promise.all(Array.from({ length: 4 }, () => cliAsync(dir, ["show", "parent", "--history"])));
    expect(results.map(result => result.code)).toEqual([0, 0, 0, 0]);
    for (const result of results) {
      expect(result.data.session.id).toBe("ses_parent");
      expect(result.data.updates.map((update: { id: string }) => update.id)).toEqual(["upd_last", "upd_first"]);
    }
  });

  test("unversioned existing tables are preserved and rejected", () => {
    const old = legacy(); old.exec("PRAGMA user_version = 0"); old.close();
    expect(() => openDatabase(loadConfig(dir))).toThrow("버전 없는");
    const db = new Database(path.join(dir, "relay.db"));
    try {
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 0 });
      expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 2 });
    } finally { db.close(); }
  });

  test("v5 databases gain the calculator history in place and keep sessions and notes", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v5Schema);
    db.exec("PRAGMA user_version = 5");
    const at = "2026-10-28T00:00:00.000Z";
    db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, working_directory, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("ses_v5", "openai", "codex", "v5", root, "맥락", at, at);
    db.query("INSERT INTO notes (id, kind, parent_id, title, body, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("n", "note", null, "메모", "본문", 1, 1, 1);
    const before = { sessions: db.query("SELECT * FROM sessions").all(), notes: db.query("SELECT * FROM notes").all() };
    db.close();
    const writer = openDatabase(loadConfig(dir));
    try {
      expect(writer.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect({ sessions: writer.query("SELECT * FROM sessions").all(), notes: writer.query("SELECT * FROM notes").all() }).toEqual(before);
      const calculator = new CalculatorStore(writer);
      expect(calculator.list()).toEqual({ schemaVersion: 1, items: [] });
      calculator.apply({ action: "add", item: { id: "c1", expression: "1 + 1", result: "2", createdAt: 5 } });
      expect(calculator.list().items).toEqual([{ id: "c1", expression: "1 + 1", result: "2", createdAt: 5 }]);
      expect(writer.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { writer.close(); }
  });

  test("v4 databases gain the notes tables in place and keep every session", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v4Schema);
    db.exec("PRAGMA user_version = 4");
    const at = "2026-10-27T00:00:00.000Z";
    db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, working_directory, summary, created_at, updated_at, status, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("ses_v4", "anthropic", "claude-code", "v4", root, "맥락", at, at, "done", 1);
    const before = db.query("SELECT * FROM sessions").all();
    db.close();
    const writer = openDatabase(loadConfig(dir));
    try {
      expect(writer.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(writer.query("SELECT * FROM sessions").all()).toEqual(before);
      const notes = new NoteStore(writer);
      expect(notes.list()).toEqual({ schemaVersion: 1, revision: 0, items: [] });
      expect(notes.apply({ upserts: [{ id: "n", kind: "note", parentId: null, title: "첫 메모", body: "본문", createdAt: 1, updatedAt: 1 }], deletes: [] }).revision).toBe(1);
      expect(writer.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { writer.close(); }
  });

  test("v3 records gain the declared state, pin and history state columns in place", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v3Schema);
    db.exec("PRAGMA user_version = 3");
    const at = "2026-10-01T00:00:00.000Z";
    db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, session_name, model, working_directory, summary,
      parent_session_id, metadata_json, created_at, updated_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("ses_v3", "xai", "grok", "v3", "이전 작업", null, root, "마지막 맥락", null, '{"kept":1}', at, at, at, "logout");
    db.query("INSERT INTO session_updates (id, session_id, sequence, summary, created_at) VALUES (?, ?, ?, ?, ?)").run("upd_v3", "ses_v3", 1, "마지막 맥락", at);
    const before = db.query("SELECT * FROM sessions ORDER BY id").all() as Record<string, unknown>[];
    db.close();
    const config = loadConfig(dir);
    const reader = openDatabase(config, true);
    try {
      expect(reader.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(reader.query("SELECT * FROM sessions ORDER BY id").all()).toEqual(before.map(row => ({ ...row, status: null, pinned: 0 })));
      expect(reader.query("SELECT * FROM session_updates").all()).toEqual([{ id: "upd_v3", session_id: "ses_v3", sequence: 1, summary: "마지막 맥락", created_at: at, status: null }]);
      expect(reader.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      const session = new SessionService(new SessionRepository(reader)).show("v3", "xai").session;
      expect(session.status).toBeNull(); expect(session.pinned).toBe(false); expect(session.git).toBeNull(); expect(session.endReason).toBe("logout");
    } finally { reader.close(); }
    const writer = openDatabase(config);
    try {
      const service = new SessionService(new SessionRepository(writer), 0, () => ({ branch: "main", commit: "abc1234", dirty: 0, at }));
      const updated = service.update("v3", "다시 진행", "xai", { status: "working" }).session;
      expect(updated.status).toBe("working"); expect(updated.git?.commit).toBe("abc1234");
      // Metadata written before v4 stays beside the clue, and the store refuses states it does not know.
      expect(JSON.parse(writer.query<{ m: string }, []>("SELECT metadata_json AS m FROM sessions").get()!.m)).toEqual({ kept: 1, git: { branch: "main", commit: "abc1234", dirty: 0, at } });
      expect(() => writer.exec("UPDATE sessions SET status = 'ACTIVE'")).toThrow();
      expect(() => writer.exec("UPDATE sessions SET pinned = 2")).toThrow();
    } finally { writer.close(); }
  });

});
