import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { EXPORT_FORMAT, checkImage, imageIdsIn, mergeDecision, noteImageUrl, type NoteBatch, type NoteExport, type NoteImage, type NoteImageExport,
  type NoteImageType, type NoteImportResult, type NoteItem } from "@relay/core";
import { storageError } from "../errors";

// 메모 항목의 모양·검사·내보내기 파일 규칙은 원격 서버와 같이 쓰므로 공용 코어에 있다. 여기에는 SQLite 저장소만 남긴다.
export { EXPORT_FORMAT, IMAGE_ID, MAX_BODY, MAX_IMAGE_UPLOAD_BYTES, MAX_NAME, NOTE_IMAGES_PATH, exportFileName, parseBatch, parseExport, parseExportImages, parseImageUpload,
  type NoteBatch, type NoteExport, type NoteItem } from "@relay/core";
export type ImportResult = NoteImportResult;

/** 쓰는 사람이 없는 그림을 지우기까지 기다리는 시간. 지운 메모를 되살리거나 아직 보내지 못한 변경이 그 그림을 다시 가리킬 수 있다. */
export const IMAGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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

  /** 다른 환경으로 옮길 파일. 목록과 같은 항목에 표지와 만든 시각을 붙이고, 메모가 가리키는 그림을 base64로 담는다. */
  exportAll(now = new Date()): NoteExport {
    try {
      return this.db.transaction(() => {
        const { items } = this.list();
        const images = this.exportImages(items);
        const file: NoteExport = { format: EXPORT_FORMAT, schemaVersion: 1, exportedAt: now.toISOString(), items };
        if (images.length) file.images = images;
        return file;
      })();
    } catch (error) { throw storageError(error); }
  }

  /** 메모가 가리키는 그림(저장된 것만). */
  exportImages(items: NoteItem[]): NoteImageExport[] {
    const ids = new Set(items.flatMap((item) => (item.kind === "note" ? imageIdsIn(item.body) : [])));
    const find = this.db.query("SELECT id, type, data FROM note_images WHERE id = ?");
    const images: NoteImageExport[] = [];
    for (const id of ids) {
      const row = find.get(id) as { id: string; type: NoteImageType; data: Uint8Array } | null;
      if (row) images.push({ id: row.id, type: row.type, data: Buffer.from(row.data).toString("base64") });
    }
    return images;
  }

  /** 그림을 저장한다. 같은 내용이면 이미 있는 것을 그대로 쓴다. */
  saveImage(bytes: Uint8Array, now = Date.now()): NoteImage {
    const type = checkImage(bytes);
    const id = sha256(bytes);
    try {
      this.db.query("INSERT INTO note_images (id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(id, type, bytes.length, bytes, now);
    } catch (error) { throw storageError(error); }
    return { schemaVersion: 1, id, type, size: bytes.length, url: noteImageUrl(id) };
  }

  image(id: string): { type: NoteImageType; data: Uint8Array } | null {
    try { return this.db.query("SELECT type, data FROM note_images WHERE id = ?").get(id) as { type: NoteImageType; data: Uint8Array } | null; }
    catch (error) { throw storageError(error); }
  }

  /** 가져온 그림을 넣는다. 내용의 해시가 id와 다르거나 받지 않는 형식이면 버린다. 넣은 수를 돌려준다. */
  mergeImages(images: Array<{ id: string; data: string }>, now = Date.now()): number {
    let added = 0;
    const insert = this.db.query("INSERT INTO note_images (id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING");
    for (const image of images) {
      const bytes = Buffer.from(image.data, "base64");
      let type: NoteImageType;
      try { type = checkImage(bytes); } catch { continue; }
      if (sha256(bytes) !== image.id) continue;
      added += insert.run(image.id, type, bytes.length, bytes, now).changes;
    }
    return added;
  }

  /** 어느 메모도 가리키지 않은 채 IMAGE_GRACE_MS가 지난 그림을 지운다. 지운 수를 돌려준다. */
  pruneImages(now = Date.now()): number {
    try {
      return this.db.transaction(() => {
        const used = new Set((this.db.query("SELECT body FROM notes WHERE kind = 'note' AND instr(body, '/api/v1/notes/images/') > 0").all() as Array<{ body: string }>)
          .flatMap((row) => imageIdsIn(row.body)));
        const remove = this.db.query("DELETE FROM note_images WHERE id = ?");
        let removed = 0;
        for (const { id } of this.db.query("SELECT id FROM note_images WHERE created_at < ?").all(now - IMAGE_GRACE_MS) as Array<{ id: string }>) {
          if (!used.has(id)) removed += remove.run(id).changes;
        }
        return removed;
      })();
    } catch (error) { throw storageError(error); }
  }

  /** 가져온 항목을 합친다. 없는 항목은 넣고, 있는 항목은 가져온 쪽이 더 최근에 고쳤을 때만 바꾸며, 아무것도 지우지 않는다.
   *  id가 같아도 종류가 다르면 이 환경의 것을 둔다. 바뀐 것이 없으면 저장 번호도 그대로다. */
  merge(items: NoteItem[], images: Array<{ id: string; data: string }> = []): ImportResult {
    try {
      return this.db.transaction(() => {
        this.mergeImages(images);
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
