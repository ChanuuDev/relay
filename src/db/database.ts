import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { ensureDataDirectory, type Config } from "../config";
import { RelayError, storageError } from "../errors";
import schema from "./migrations/002_init.sql" with { type: "text" };

export const DB_VERSION = 2;

export function checkVersion(db: Database) {
  const v = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (v !== DB_VERSION) throw new RelayError("SCHEMA_MISMATCH", `지원하지 않는 DB 스키마 버전입니다: ${v}`, 5, 503);
}

function version(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tables(db: Database) {
  return db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
}

function migrateV1(db: Database) {
  // The replacement tables are built before the v1 tables are removed. All DDL and
  // copies run in the caller's immediate transaction, so a failed migration leaves v1 intact.
  db.exec("PRAGMA defer_foreign_keys = ON");
  db.exec(`
    CREATE TABLE sessions_v2 (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      agent TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      session_name TEXT,
      model TEXT,
      working_directory TEXT NOT NULL,
      summary TEXT NOT NULL,
      parent_session_id TEXT REFERENCES sessions_v2(id),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_session_id),
      CHECK(parent_session_id IS NULL OR parent_session_id <> id)
    );
    INSERT INTO sessions_v2
      (id, provider, agent, provider_session_id, session_name, model, working_directory,
       summary, parent_session_id, metadata_json, created_at, updated_at)
      SELECT id, provider, agent, provider_session_id, session_name, model, working_directory,
        summary, parent_session_id, metadata_json, started_at, updated_at
      FROM sessions;
    CREATE TABLE session_updates_v2 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions_v2(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence > 0),
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );
    INSERT INTO session_updates_v2 (id, session_id, sequence, summary, created_at)
      SELECT id, session_id, sequence, summary, created_at FROM session_updates;
    DROP TABLE session_updates;
    DROP TABLE sessions;
    ALTER TABLE sessions_v2 RENAME TO sessions;
    ALTER TABLE session_updates_v2 RENAME TO session_updates;
    CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC, id DESC);
    CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
  `);
  if (db.query("PRAGMA foreign_key_check").all().length) {
    throw new RelayError("SCHEMA_MISMATCH", "기존 DB의 세션 연결 또는 이력이 손상되어 전환하지 않았습니다.", 5, 503);
  }
}

function initializeOrMigrate(db: Database) {
  const current = version(db);
  if (current !== 0 && current !== 1) {
    checkVersion(db);
    return;
  }

  // WAL is set before taking the migration transaction. A second initializer waits
  // for the first immediate transaction, rechecks user_version, and then returns.
  db.exec("PRAGMA journal_mode = WAL");
  db.transaction(() => {
    const observed = version(db);
    if (observed === 0) {
      if (tables(db).length) throw new RelayError("SCHEMA_MISMATCH", "버전 없는 기존 DB를 덮어쓰지 않습니다.", 5, 503);
      db.exec(schema);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 1) {
      migrateV1(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else {
      checkVersion(db);
    }
  }).immediate();
  checkVersion(db);
}

export function openDatabase(config: Config, readonly = false): Database {
  ensureDataDirectory(config);
  let db: Database | undefined;
  try {
    db = new Database(config.databasePath, { create: true, strict: true });
    db.exec("PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
    // Initialization and v1 migration are the only writes performed by a read-only
    // connection. The database is reopened as query-only below after this completes.
    initializeOrMigrate(db);
    checkVersion(db);
    if (process.platform !== "win32") chmodSync(config.databasePath, 0o600);
    if (readonly) {
      db.close();
      db = new Database(config.databasePath, { readonly: true, strict: true });
      db.exec("PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA query_only = ON;");
      checkVersion(db);
    }
    return db;
  } catch (error) {
    db?.close();
    throw storageError(error);
  }
}
