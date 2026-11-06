import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { EXPORT_FORMAT, checkImage, imageIdsIn, mergeDecision, noteImageUrl, type NoteApplied, type NoteBatch, type NoteExport, type NoteImage, type NoteImageExport,
  type NoteImageType, type NoteImportResult, type NoteItem, type NoteList } from "@relay/core";
import { DB, lockUser, schema, type Db } from "../db/database.js";

const { notes, notesMeta, noteImages } = schema;
/** 쓰는 메모가 없는 그림을 지우기까지 기다리는 시간. 로컬 서버와 같다. */
export const IMAGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Row = typeof notes.$inferSelect;

const toItem = (row: Row): NoteItem => (row.kind === "folder"
  ? { id: row.id, kind: "folder", parentId: row.parentId, name: row.name, position: row.position, createdAt: row.createdAt, updatedAt: row.updatedAt }
  : { id: row.id, kind: "note", parentId: row.parentId, title: row.title, body: row.body, position: row.position, createdAt: row.createdAt, updatedAt: row.updatedAt });

/** 사용자별 메모 저장소. 묶음마다 revision을 하나 올려, 화면은 그 값만 보고 다시 읽을지 정한다. */
@Injectable()
export class NotesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async revision(userId: string, tx: Db = this.db): Promise<number> {
    const [row] = await tx.select({ revision: notesMeta.revision }).from(notesMeta).where(eq(notesMeta.userId, userId)).limit(1);
    return row?.revision ?? 0;
  }

  private async bump(userId: string, tx: Db): Promise<number> {
    const [row] = await tx.insert(notesMeta).values({ userId, revision: 1 })
      .onConflictDoUpdate({ target: notesMeta.userId, set: { revision: sql`${notesMeta.revision} + 1` } }).returning({ revision: notesMeta.revision });
    return row.revision;
  }

  async list(userId: string): Promise<NoteList> {
    return this.db.transaction(async (tx) => ({
      schemaVersion: 1 as const, revision: await this.revision(userId, tx),
      items: (await tx.select().from(notes).where(eq(notes.userId, userId)).orderBy(asc(notes.createdAt), asc(notes.id))).map(toItem),
    }));
  }

  /** 지우기(하위 항목까지) 뒤 넣기·고치기를 한 트랜잭션으로 적용한다. 부모가 없거나 폴더가 아니거나 순환하면 최상위로 올린다. */
  async apply(userId: string, batch: NoteBatch): Promise<NoteApplied> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const revision = await this.bump(userId, tx);
      for (const target of batch.deletes) {
        await tx.execute(sql`WITH RECURSIVE tree(id) AS (
            SELECT ${target}::text UNION ALL SELECT n.id FROM notes n JOIN tree ON n.parent_id = tree.id WHERE n.user_id = ${userId})
          DELETE FROM notes WHERE user_id = ${userId} AND id IN (SELECT id FROM tree)`);
      }
      await this.write(userId, batch.upserts, revision, tx);
      await this.repair(userId, revision, tx);
      return { schemaVersion: 1 as const, revision };
    });
  }

  /** 다른 환경으로 옮길 파일. 메모가 가리키는 그림을 base64로 담는다(그림이 없으면 images 키를 넣지 않는다). */
  async exportAll(userId: string, now = new Date()): Promise<NoteExport> {
    const { items } = await this.list(userId);
    const ids = [...new Set(items.flatMap((item) => (item.kind === "note" ? imageIdsIn(item.body) : [])))];
    const images: NoteImageExport[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const rows = await this.db.select({ id: noteImages.id, type: noteImages.type, data: noteImages.data }).from(noteImages)
        .where(and(eq(noteImages.userId, userId), inArray(noteImages.id, ids.slice(offset, offset + 100))));
      for (const row of rows) images.push({ id: row.id, type: row.type as NoteImageType, data: Buffer.from(row.data).toString("base64") });
    }
    return { format: EXPORT_FORMAT, schemaVersion: 1, exportedAt: now.toISOString(), items, ...(images.length ? { images } : {}) };
  }

  /** 그림을 저장한다. 같은 내용이면 이미 있는 것을 그대로 쓴다. */
  async saveImage(userId: string, bytes: Uint8Array, now = Date.now()): Promise<NoteImage> {
    const type = checkImage(bytes);
    const id = sha256(bytes);
    await this.db.insert(noteImages).values({ userId, id, type, size: bytes.length, data: bytes, createdAt: now }).onConflictDoNothing();
    return { schemaVersion: 1, id, type, size: bytes.length, url: noteImageUrl(id) };
  }

  async image(userId: string, id: string): Promise<{ type: NoteImageType; data: Uint8Array } | null> {
    const [row] = await this.db.select({ type: noteImages.type, data: noteImages.data }).from(noteImages)
      .where(and(eq(noteImages.userId, userId), eq(noteImages.id, id))).limit(1);
    return row ? { type: row.type as NoteImageType, data: row.data } : null;
  }

  /** 어느 메모도 가리키지 않은 채 IMAGE_GRACE_MS가 지난 그림을 지운다. 지운 수를 돌려준다. */
  async pruneImages(now = Date.now()): Promise<number> {
    const old = await this.db.select({ userId: noteImages.userId, id: noteImages.id }).from(noteImages).where(lt(noteImages.createdAt, now - IMAGE_GRACE_MS));
    let removed = 0;
    for (const userId of new Set(old.map((row) => row.userId))) {
      const used = new Set((await this.db.select({ body: notes.body }).from(notes)
        .where(and(eq(notes.userId, userId), eq(notes.kind, "note"), sql`strpos(${notes.body}, ${"/api/v1/notes/images/"}) > 0`)))
        .flatMap((row) => imageIdsIn(row.body)));
      const unused = old.filter((row) => row.userId === userId && !used.has(row.id)).map((row) => row.id);
      for (let offset = 0; offset < unused.length; offset += 100) {
        const deleted = await this.db.delete(noteImages).where(and(eq(noteImages.userId, userId), inArray(noteImages.id, unused.slice(offset, offset + 100))))
          .returning({ id: noteImages.id });
        removed += deleted.length;
      }
    }
    return removed;
  }

  /** 가져온 그림을 넣는다. 내용의 해시가 id와 다르거나 받지 않는 형식이면 버린다. */
  private async mergeImages(userId: string, images: Array<{ id: string; data: string }>, tx: Db, now = Date.now()) {
    for (const image of images) {
      const bytes = Buffer.from(image.data, "base64");
      let type: NoteImageType;
      try { type = checkImage(bytes); } catch { continue; }
      if (sha256(bytes) !== image.id) continue;
      await tx.insert(noteImages).values({ userId, id: image.id, type, size: bytes.length, data: bytes, createdAt: now }).onConflictDoNothing();
    }
  }

  /** 가져온 항목을 합친다. 없는 항목은 넣고, 있는 항목은 가져온 쪽이 더 최근에 고쳤을 때만 바꾸며, 아무것도 지우지 않는다. */
  async merge(userId: string, items: NoteItem[], images: Array<{ id: string; data: string }> = []): Promise<NoteImportResult> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      await this.mergeImages(userId, images, tx);
      const ids = items.map((item) => item.id);
      const existing = new Map<string, NoteItem>();
      if (ids.length) {
        for (const row of await tx.select().from(notes).where(and(eq(notes.userId, userId), inArray(notes.id, ids)))) existing.set(row.id, toItem(row));
      }
      const changes: NoteItem[] = [];
      let added = 0, kept = 0;
      for (const item of items) {
        const decision = mergeDecision(existing.get(item.id) ?? null, item);
        if (decision === "add") { added++; changes.push(item); }
        else if (decision === "update") changes.push(item);
        else kept++;
      }
      const updated = changes.length - added;
      if (!changes.length) return { schemaVersion: 1 as const, revision: await this.revision(userId, tx), added, updated, kept };
      const revision = await this.bump(userId, tx);
      await this.write(userId, changes, revision, tx);
      await this.repair(userId, revision, tx);
      return { schemaVersion: 1 as const, revision, added, updated, kept };
    });
  }

  private async write(userId: string, items: NoteItem[], revision: number, tx: Db) {
    for (const item of items) {
      const values = { id: item.id, userId, kind: item.kind, parentId: item.parentId, name: item.kind === "folder" ? item.name : "",
        title: item.kind === "note" ? item.title : "", body: item.kind === "note" ? item.body : "", position: item.position,
        createdAt: item.createdAt, updatedAt: item.updatedAt, revision };
      await tx.insert(notes).values(values).onConflictDoUpdate({ target: notes.id,
        set: { kind: values.kind, parentId: values.parentId, name: values.name, title: values.title, body: values.body, position: values.position, updatedAt: values.updatedAt, revision },
        setWhere: eq(notes.userId, userId) });
    }
  }

  /** 트리를 늘 올바르게 둔다: 부모가 없거나 폴더가 아니면, 또는 조상을 따라가다 자기로 돌아오면 최상위로 올린다. */
  private async repair(userId: string, revision: number, tx: Db) {
    const folders = tx.select({ id: notes.id }).from(notes).where(and(eq(notes.userId, userId), eq(notes.kind, "folder")));
    await tx.update(notes).set({ parentId: null, revision }).where(and(eq(notes.userId, userId), isNotNull(notes.parentId), notInArray(notes.parentId, folders)));
    const parents = new Map((await tx.select({ id: notes.id, parentId: notes.parentId }).from(notes).where(and(eq(notes.userId, userId), eq(notes.kind, "folder"))))
      .map((row) => [row.id, row.parentId] as const));
    for (const start of parents.keys()) {
      const seen = new Set<string>();
      for (let current: string | null | undefined = start; current; current = parents.get(current)) {
        if (seen.has(current)) {
          await tx.update(notes).set({ parentId: null, revision }).where(and(eq(notes.userId, userId), eq(notes.id, start)));
          parents.set(start, null);
          break;
        }
        seen.add(current);
      }
    }
  }
}
