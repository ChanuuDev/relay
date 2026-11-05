import type { Database } from "bun:sqlite";
import { EXPORT_FORMAT, type NoteBatch, type NoteExport, type NoteImportResult, type NoteItem, mergeDecision } from "@relay/core";
import { storageError } from "../errors";

// 메모 항목의 모양·검사·내보내기 파일 규칙은 원격 서버와 같이 쓰므로 공용 코어에 있다. 여기에는 SQLite 저장소만 남긴다.
export { EXPORT_FORMAT, MAX_BODY, MAX_NAME, exportFileName, parseBatch, parseExport, type NoteBatch, type NoteExport, type NoteItem } from "@relay/core";
export type ImportResult = NoteImportResult;

type Row = { id: string; kind: "folder" | "note"; parent_id: string | null; name: string; title: string; body: string; position: number | null; created_at: number; updated_at: number };

const toItem = (row: Row): NoteItem => (row.kind === "folder"
  ? { id: row.id, kind: "folder", parentId: row.parent_id, name: row.name, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at }
  : { id: row.id, kind: "note", parentId: row.parent_id, title: row.title, body: row.body, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at });

/** 메모 저장소. 묶음마다 revision을 하나 올려, 화면은 그 값만 보고 다시 읽을지 정한다. */
export class NoteStore {
  constructor(private db: Database) {}

  revision(): number {
    try { return (this.db.query("SELECT value FROM notes_meta WHERE key = 'revision'").get() as { value: number } | null)?.value ?? 0; }
    catch (error) { throw storageError(error); }
  }

  list(): { schemaVersion: 1; revision: number; items: NoteItem[] } {
    try {
      return this.db.transaction(() => ({
        schemaVersion: 1 as const,
        revision: this.revision(),
        items: (this.db.query("SELECT id, kind, parent_id, name, title, body, position, created_at, updated_at FROM notes ORDER BY created_at, id").all() as Row[]).map(toItem),
      }))();
    } catch (error) { throw storageError(error); }
  }

  /** 지우기(하위 항목까지) 뒤 넣기·고치기를 한 트랜잭션으로 적용한다. 부모가 없거나 폴더가 아니거나 순환하면 최상위로 올린다. */
  apply(batch: NoteBatch): { schemaVersion: 1; revision: number } {
    try {
      return this.db.transaction(() => {
        const revision = (this.db.query("UPDATE notes_meta SET value = value + 1 WHERE key = 'revision' RETURNING value").get() as { value: number }).value;
        const remove = this.db.query(`WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT notes.id FROM notes JOIN tree ON notes.parent_id = tree.id)
          DELETE FROM notes WHERE id IN (SELECT id FROM tree)`);
        for (const target of batch.deletes) remove.run(target);
        this.write(batch.upserts, revision);
        this.repair(revision);
        return { schemaVersion: 1 as const, revision };
      })();
    } catch (error) { throw storageError(error); }
  }

  /** 다른 환경으로 옮길 파일. 목록과 같은 항목에 표지와 만든 시각을 붙인다. */
  exportAll(now = new Date()): NoteExport {
    return { format: EXPORT_FORMAT, schemaVersion: 1, exportedAt: now.toISOString(), items: this.list().items };
  }

  /** 가져온 항목을 합친다. 없는 항목은 넣고, 있는 항목은 가져온 쪽이 더 최근에 고쳤을 때만 바꾸며, 아무것도 지우지 않는다.
   *  id가 같아도 종류가 다르면 이 환경의 것을 둔다. 바뀐 것이 없으면 저장 번호도 그대로다. */
  merge(items: NoteItem[]): ImportResult {
    try {
      return this.db.transaction(() => {
        const find = this.db.query("SELECT id, kind, parent_id, name, title, body, position, created_at, updated_at FROM notes WHERE id = ?");
        const changes: NoteItem[] = [];
        let added = 0, kept = 0;
        for (const item of items) {
          const row = find.get(item.id) as Row | null;
          const decision = mergeDecision(row ? toItem(row) : null, item);
          if (decision === "add") { added++; changes.push(item); }
          else if (decision === "update") changes.push(item);
          else kept++;
        }
        const updated = changes.length - added;
        if (!changes.length) return { schemaVersion: 1 as const, revision: this.revision(), added, updated, kept };
        const revision = (this.db.query("UPDATE notes_meta SET value = value + 1 WHERE key = 'revision' RETURNING value").get() as { value: number }).value;
        this.write(changes, revision);
        this.repair(revision);
        return { schemaVersion: 1 as const, revision, added, updated, kept };
      })();
    } catch (error) { throw storageError(error); }
  }

  /** 넣거나 고친다. 이미 있는 항목의 만든 시각은 그대로 둔다. */
  private write(items: NoteItem[], revision: number) {
    const upsert = this.db.query(`INSERT INTO notes (id, kind, parent_id, name, title, body, position, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, parent_id = excluded.parent_id, name = excluded.name, title = excluded.title,
        body = excluded.body, position = excluded.position, updated_at = excluded.updated_at, revision = excluded.revision`);
    for (const item of items) {
      upsert.run(item.id, item.kind, item.parentId, item.kind === "folder" ? item.name : "", item.kind === "note" ? item.title : "",
        item.kind === "note" ? item.body : "", item.position, item.createdAt, item.updatedAt, revision);
    }
  }

  /** 트리를 늘 올바르게 둔다: 부모가 없거나 폴더가 아니면, 또는 조상을 따라가다 자기로 돌아오면 최상위로 올린다. */
  private repair(revision: number) {
    this.db.query(`UPDATE notes SET parent_id = NULL, revision = ? WHERE parent_id IS NOT NULL
      AND parent_id NOT IN (SELECT id FROM notes WHERE kind = 'folder')`).run(revision);
    const parents = new Map((this.db.query("SELECT id, parent_id FROM notes WHERE kind = 'folder'").all() as Array<{ id: string; parent_id: string | null }>)
      .map((row) => [row.id, row.parent_id]));
    const detach = this.db.query("UPDATE notes SET parent_id = NULL, revision = ? WHERE id = ?");
    for (const start of parents.keys()) {
      const seen = new Set<string>();
      for (let current: string | null | undefined = start; current; current = parents.get(current)) {
        if (seen.has(current)) { detach.run(revision, start); parents.set(start, null); break; }
        seen.add(current);
      }
    }
  }
}
