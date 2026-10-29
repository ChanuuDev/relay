import type { Database } from "bun:sqlite";
import { RelayError, storageError } from "../errors";

/** 폴더와 메모(본문은 Markdown)가 parentId로 트리를 이룬다. null은 최상위다.
 *  position은 형제 사이에서 사용자가 끌어 정한 순서(작을수록 위)다. null이면 순서를 정한 항목 뒤에 폴더 먼저·이름 순으로 놓인다. */
export type NoteItem =
  | { id: string; kind: "folder"; parentId: string | null; name: string; position: number | null; createdAt: number; updatedAt: number }
  | { id: string; kind: "note"; parentId: string | null; title: string; body: string; position: number | null; createdAt: number; updatedAt: number };
export type NoteBatch = { upserts: NoteItem[]; deletes: string[] };
/** 다른 환경으로 옮기는 파일. format은 Relay 메모 파일인지 알아보는 표지다. */
export type NoteExport = { format: typeof EXPORT_FORMAT; schemaVersion: 1; exportedAt: string; items: NoteItem[] };
/** 가져오기 결과. kept는 같거나 이 환경 쪽이 더 최근이라 그대로 둔 항목 수다. */
export type ImportResult = { schemaVersion: 1; revision: number; added: number; updated: number; kept: number };

export const MAX_NAME = 200;
export const MAX_BODY = 200_000;
export const EXPORT_FORMAT = "relay-notes";
/** 한 번에 받는 항목 수. 브라우저는 고친 항목만 모아 보내므로 넉넉하다. */
const MAX_BATCH = 5000;
/** 가져오기 한 번에 받는 항목 수. 내보낸 파일 하나를 통째로 받는다. */
const MAX_IMPORT = 50_000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

type Row = { id: string; kind: "folder" | "note"; parent_id: string | null; name: string; title: string; body: string; position: number | null; created_at: number; updated_at: number };

const time = (value: unknown, fallback: number) =>
  (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
const text = (value: unknown, max: number, field: string) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RelayError("INVALID_ARGUMENT", `${field}은(는) 문자열이어야 합니다.`);
  if (value.length > max) throw new RelayError("INVALID_ARGUMENT", `${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};
const position = (value: unknown, field: string) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RelayError("INVALID_ARGUMENT", `${field}은(는) 숫자나 null이어야 합니다.`);
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
  const items = upserts.map((value, index) => parseItem(value, `upserts[${index}]`, now));
  return { upserts: items, deletes: deletes.map((value, index) => id(value, `deletes[${index}]`)) };
}

/** 항목 하나의 모양을 고정한다. field는 오류에 보일 위치다. */
function parseItem(value: unknown, field: string, now: number): NoteItem {
  if (!value || typeof value !== "object") throw new RelayError("INVALID_ARGUMENT", `${field}는 객체여야 합니다.`);
  const entry = value as Record<string, unknown>;
  const itemId = id(entry.id, `${field}.id`);
  const parentId = entry.parentId === null || entry.parentId === undefined ? null : id(entry.parentId, `${field}.parentId`);
  if (parentId === itemId) throw new RelayError("INVALID_ARGUMENT", "항목을 제 안에 넣을 수 없습니다.");
  const createdAt = time(entry.createdAt, now);
  const updatedAt = time(entry.updatedAt, now);
  const order = position(entry.position, `${field}.position`);
  if (entry.kind === "folder") return { id: itemId, kind: "folder", parentId, name: text(entry.name, MAX_NAME, "폴더 이름").trim() || "새 폴더", position: order, createdAt, updatedAt };
  if (entry.kind === "note") return { id: itemId, kind: "note", parentId, title: text(entry.title, MAX_NAME, "제목"), body: text(entry.body, MAX_BODY, "본문"), position: order, createdAt, updatedAt };
  throw new RelayError("INVALID_ARGUMENT", `${field}.kind는 folder 또는 note여야 합니다.`);
}

const pad = (value: number) => String(value).padStart(2, "0");
/** 내보낼 파일 이름. 이 컴퓨터의 날짜를 붙인다. */
export const exportFileName = (date = new Date()) => `relay-notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;

/** 내보낸 파일을 검사한다. 표지·판이 다르거나 항목 하나라도 틀리면 아무것도 쓰지 않고 거부한다. 같은 id가 거듭 나오면 마지막 것을 쓴다. */
export function parseExport(raw: unknown, now = Date.now()): NoteItem[] {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { format?: unknown; schemaVersion?: unknown; items?: unknown } : null;
  if (data?.format !== EXPORT_FORMAT) throw new RelayError("INVALID_ARGUMENT", "Relay에서 내보낸 메모 파일이 아닙니다.");
  if (data.schemaVersion !== 1) throw new RelayError("INVALID_ARGUMENT", "지원하지 않는 메모 파일 판입니다. Relay를 새 버전으로 바꿔 주세요.");
  if (!Array.isArray(data.items)) throw new RelayError("INVALID_ARGUMENT", "items는 배열이어야 합니다.");
  if (data.items.length > MAX_IMPORT) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_IMPORT}개까지 가져옵니다.`);
  const items = new Map<string, NoteItem>();
  data.items.forEach((value, index) => { const item = parseItem(value, `items[${index}]`, now); items.set(item.id, item); });
  return [...items.values()];
}

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
        const find = this.db.query("SELECT kind, parent_id, name, title, body, position, updated_at FROM notes WHERE id = ?");
        const changes: NoteItem[] = [];
        let added = 0, kept = 0;
        for (const item of items) {
          const row = find.get(item.id) as Omit<Row, "id" | "created_at"> | null;
          if (!row) { added++; changes.push(item); continue; }
          const same = row.kind === item.kind && row.parent_id === item.parentId && row.position === item.position
            && (item.kind === "folder" ? row.name === item.name : row.title === item.title && row.body === item.body);
          if (row.kind !== item.kind || same || item.updatedAt <= row.updated_at) kept++;
          else changes.push(item);
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
