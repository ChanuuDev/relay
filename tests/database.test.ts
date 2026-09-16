import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { loadConfig } from "../src/config";
import { DB_VERSION, openDatabase } from "../src/db/database";
import legacySchema from "../src/db/migrations/001_init.sql" with { type: "text" };
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
    const sessions = old.query(`SELECT id, provider, agent, provider_session_id, session_name, model,
      working_directory, summary, parent_session_id, metadata_json, started_at AS created_at, updated_at
      FROM sessions ORDER BY id`).all();
    const updates = old.query("SELECT id, session_id, sequence, summary, created_at FROM session_updates ORDER BY id").all();
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
      for (const field of ["status", "startedAt", "endedAt"]) expect(detail.session).not.toHaveProperty(field);
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
});
