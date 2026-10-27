import type { Database } from "bun:sqlite";
import { RelayError, storageError } from "../errors";

/** 폴더와 메모(본문은 Markdown)가 parentId로 트리를 이룬다. null은 최상위다. */
export type NoteItem =
  | { id: string; kind: "folder"; parentId: string | null; name: string; createdAt: number; updatedAt: number }
  | { id: string; kind: "note"; parentId: string | null; title: string; body: string; createdAt: number; updatedAt: number };
export type NoteBatch = { upserts: NoteItem[]; deletes: string[] };

export const MAX_NAME = 200;
export const MAX_BODY = 200_000;
/** 한 번에 받는 항목 수. 브라우저는 고친 항목만 모아 보내므로 넉넉하다. */
const MAX_BATCH = 5000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

type Row = { id: string; kind: "folder" | "note"; parent_id: string | null; name: string; title: string; body: string; created_at: number; updated_at: number };

const time = (value: unknown, fallback: number) =>
  (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
const text = (value: unknown, max: number, field: string) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RelayError("INVALID_ARGUMENT", `${field}은(는) 문자열이어야 합니다.`);
  if (value.length > max) throw new RelayError("INVALID_ARGUMENT", `${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};
const id = (value: unknown, field: string) => {
  if (typeof value !== "string" || !ID.test(value)) throw new RelayError("INVALID_ARGUMENT", `${field}이(가) 올바르지 않습니다.`);
  return value;
};

/** 브라우저가 보낸 저장 묶음을 검사해 모양을 고정한다. 틀리면 아무것도 쓰지 않고 거부한다. */
export function parseBatch(raw: unknown, now = Date.now()): NoteBatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RelayError("INVALID_ARGUMENT", "저장 묶음은 객체여야 합니다.");
  const { upserts = [], deletes = [] } = raw as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) throw new RelayError("INVALID_ARGUMENT", "upserts와 deletes는 배열이어야 합니다.");
  if (upserts.length + deletes.length > MAX_BATCH) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_BATCH}개까지 저장합니다.`);
  const items: NoteItem[] = upserts.map((value, index) => {
    if (!value || typeof value !== "object") throw new RelayError("INVALID_ARGUMENT", `upserts[${index}]는 객체여야 합니다.`);
    const entry = value as Record<string, unknown>;
    const itemId = id(entry.id, `upserts[${index}].id`);
    const parentId = entry.parentId === null || entry.parentId === undefined ? null : id(entry.parentId, `upserts[${index}].parentId`);
    if (parentId === itemId) throw new RelayError("INVALID_ARGUMENT", "항목을 제 안에 넣을 수 없습니다.");
    const createdAt = time(entry.createdAt, now);
    const updatedAt = time(entry.updatedAt, now);
    if (entry.kind === "folder") return { id: itemId, kind: "folder", parentId, name: text(entry.name, MAX_NAME, "폴더 이름").trim() || "새 폴더", createdAt, updatedAt };
    if (entry.kind === "note") return { id: itemId, kind: "note", parentId, title: text(entry.title, MAX_NAME, "제목"), body: text(entry.body, MAX_BODY, "본문"), createdAt, updatedAt };
    throw new RelayError("INVALID_ARGUMENT", `upserts[${index}].kind는 folder 또는 note여야 합니다.`);
  });
  return { upserts: items, deletes: deletes.map((value, index) => id(value, `deletes[${index}]`)) };
}

const toItem = (row: Row): NoteItem => (row.kind === "folder"
  ? { id: row.id, kind: "folder", parentId: row.parent_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
  : { id: row.id, kind: "note", parentId: row.parent_id, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at });

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
        items: (this.db.query("SELECT id, kind, parent_id, name, title, body, created_at, updated_at FROM notes ORDER BY created_at, id").all() as Row[]).map(toItem),
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
        const upsert = this.db.query(`INSERT INTO notes (id, kind, parent_id, name, title, body, created_at, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, parent_id = excluded.parent_id, name = excluded.name, title = excluded.title,
            body = excluded.body, updated_at = excluded.updated_at, revision = excluded.revision`);
        for (const item of batch.upserts) {
          upsert.run(item.id, item.kind, item.parentId, item.kind === "folder" ? item.name : "", item.kind === "note" ? item.title : "",
            item.kind === "note" ? item.body : "", item.createdAt, item.updatedAt, revision);
        }
        this.repair(revision);
        return { schemaVersion: 1 as const, revision };
      })();
    } catch (error) { throw storageError(error); }
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
