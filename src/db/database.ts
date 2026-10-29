import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { ensureDataDirectory, type Config } from "../config";
import { RelayError, storageError } from "../errors";
import schema from "./migrations/007_init.sql" with { type: "text" };

export const DB_VERSION = 7;

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

// A closed session keeps when and why it ended. Rows written before v3 simply have no end on record.
function migrateV2(db: Database) {
  db.exec("ALTER TABLE sessions ADD COLUMN ended_at TEXT; ALTER TABLE sessions ADD COLUMN end_reason TEXT;");
}

// v4 adds the work state an agent declares, the pin that exempts a record from clean-up, and the state
// each history entry was written in. Older rows carry none of them.
function migrateV3(db: Database) {
  db.exec(`ALTER TABLE sessions ADD COLUMN status TEXT CHECK(status IS NULL OR status IN ('working', 'blocked', 'handoff', 'done'));
    ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1));
    ALTER TABLE session_updates ADD COLUMN status TEXT CHECK(status IS NULL OR status IN ('working', 'blocked', 'handoff', 'done'));`);
}

// v5 adds the desktop notes (folders and Markdown notes in a tree) that the web screen writes. Sessions are untouched.
function migrateV4(db: Database) {
  db.exec(`CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('folder', 'note')),
  parent_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_notes_parent ON notes(parent_id);
CREATE TABLE notes_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO notes_meta (key, value) VALUES ('revision', 0);
`);
}

// v6 adds the calculator's history (each finished calculation as the screen showed it). Sessions and notes are untouched.
function migrateV5(db: Database) {
  db.exec(`CREATE TABLE calculations (
  id TEXT PRIMARY KEY,
  expression TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_calculations_created ON calculations(created_at DESC, id DESC);
`);
}

// v7 lets the notes tree keep the order the user dragged items into. Rows written before v7 have no position
// and keep the old order (folders first, then by name) after the ordered ones.
function migrateV6(db: Database) {
  db.exec("ALTER TABLE notes ADD COLUMN position REAL;");
}

function initializeOrMigrate(db: Database) {
  const current = version(db);
  if (current < 0 || current > 6) {
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
      migrateV2(db);
      migrateV3(db);
      migrateV4(db);
      migrateV5(db);
      migrateV6(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 2) {
      migrateV2(db);
      migrateV3(db);
      migrateV4(db);
      migrateV5(db);
      migrateV6(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 3) {
      migrateV3(db);
      migrateV4(db);
      migrateV5(db);
      migrateV6(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 4) {
      migrateV4(db);
      migrateV5(db);
      migrateV6(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 5) {
      migrateV5(db);
      migrateV6(db);
      db.exec(`PRAGMA user_version = ${DB_VERSION}`);
    } else if (observed === 6) {
      migrateV6(db);
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
