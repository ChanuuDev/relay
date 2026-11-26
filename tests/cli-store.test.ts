import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { age, cleanup, cli, cliAsync, root, temporary } from "./helpers";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";
import { NoteStore } from "../src/notes/notes.store";

describe("CLI store", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));
  const record = (id: string) => ["record", "--provider", "openai", "--agent", "codex", "--session-id", id, "--summary", "첫 기록", "--cwd", root];

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

  test("notes export writes a file that notes import merges into another store, and bad files change nothing", () => {
    const db = openDatabase(loadConfig(dir));
    new NoteStore(db).apply({ upserts: [
      { id: "f1", kind: "folder", parentId: null, name: "업무", position: null, createdAt: 1, updatedAt: 1 },
      { id: "n1", kind: "note", parentId: "f1", title: "회의", body: "본문", position: null, createdAt: 2, updatedAt: 3 },
    ], deletes: [] });
    db.close();
    const other = temporary();
    try {
      const file = path.join(other, "옮길 메모.json");
      expect(cli(dir, ["notes", "export", file]).data).toEqual({ schemaVersion: 1, path: file, notes: 1, folders: 1 });
      const saved = readFileSync(file, "utf8");
      expect(JSON.parse(saved)).toMatchObject({ format: "relay-notes", schemaVersion: 1, items: [{ id: "f1" }, { id: "n1", parentId: "f1" }] });
      expect(cli(other, ["notes", "import", file]).data).toEqual({ schemaVersion: 1, revision: 1, added: 2, updated: 0, kept: 0 });
      // Windows PowerShell의 Out-File이 만든 UTF-16 파일도 읽는다. 같은 내용이라 그대로 둔다.
      const utf16 = path.join(other, "utf16.json");
      writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(saved, "utf16le")]));
      expect(cli(other, ["notes", "import", utf16]).data).toEqual({ schemaVersion: 1, revision: 1, added: 0, updated: 0, kept: 2 });
      const human = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "notes", "import", file, "--data-dir", other], { stdout: "pipe", stderr: "pipe" });
      expect(human.exitCode).toBe(0); expect(human.stdout.toString()).toBe("메모를 가져왔습니다: 추가 0 · 갱신 0 · 그대로 2\n");

      const missing = cli(other, ["notes", "import", path.join(other, "없음.json")]);
      expect(missing.code).toBe(3); expect(missing.stdout).toBe(""); expect(missing.data.error.code).toBe("FILE_NOT_FOUND");
      const broken = path.join(other, "broken.json"); writeFileSync(broken, "{");
      const sessions = path.join(other, "sessions.json"); writeFileSync(sessions, JSON.stringify({ schemaVersion: 1, items: [] }));
      for (const bad of [broken, sessions]) {
        const result = cli(other, ["notes", "import", bad]);
        expect(result.code).toBe(2); expect(result.data.error.code).toBe("INVALID_ARGUMENT");
      }
      expect(cli(dir, ["notes", "export", path.join(other, "없는 폴더", "x.json")]).data.error.code).toBe("FILE_WRITE_FAILED");
      expect(cli(other, ["notes", "export", file]).data).toMatchObject({ notes: 1, folders: 1 });
    } finally { cleanup(other); }
  });
});
