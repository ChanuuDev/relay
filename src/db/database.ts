import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { ensureDataDirectory, type Config } from "../config";
import { RelayError, storageError } from "../errors";
import schema from "./migrations/001_init.sql" with { type: "text" };

export const DB_VERSION = 1;

export function checkVersion(db: Database) {
  const v = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (v !== DB_VERSION) throw new RelayError("SCHEMA_MISMATCH", `지원하지 않는 DB 스키마 버전입니다: ${v}`, 5, 503);
}

export function openDatabase(config: Config, readonly = false): Database {
  ensureDataDirectory(config);
  let db: Database | undefined;
  try {
    db = new Database(config.databasePath, { create: true, strict: true });
    db.exec("PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
    const v = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (v !== 0 && v !== DB_VERSION) checkVersion(db);
    // Do not acquire a writer lock on every read-only CLI invocation.
    if (v === 0) {
      const connection = db;
      connection.exec("PRAGMA journal_mode = WAL");
      connection.transaction(() => {
        const current = (connection.query("PRAGMA user_version").get() as { user_version: number }).user_version;
        if (current === 0) {
          const tables = connection.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
          if (tables.length) throw new RelayError("SCHEMA_MISMATCH", "버전 없는 기존 DB를 덮어쓰지 않습니다.", 5, 503);
          connection.exec(schema);
          connection.exec(`PRAGMA user_version = ${DB_VERSION}`);
        } else checkVersion(connection);
      }).immediate();
    }
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
