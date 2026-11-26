import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { bytesVector, vectorBytes, type ChunkRow, type DocStatus, type DocType, type EmbeddingModel, type IndexPort, type IndexState, type NoteBatch, type NoteCard, type NoteMeta,
  type SemanticLink } from "@relay/core";
import { schema, type Db } from "../db/database.js";
import type { NotesService } from "./notes.service.js";

const { notes, noteMeta, noteCards, embeddingModels, noteIndex, noteChunks, noteSemanticLinks, noteLinkDismissals, noteIndexMeta } = schema;
const bytes = (vector: Float32Array) => Buffer.from(vectorBytes(vector));
type StateRow = typeof noteIndex.$inferSelect;
const toState = (row: StateRow): IndexState => ({ noteId: row.noteId, inputHash: row.inputHash, contentHash: row.contentHash, chunkCount: row.chunkCount, status: row.status as IndexState["status"],
  error: row.error, attempts: row.attempts, retryAt: row.retryAt, leaseToken: row.leaseToken, leaseUntil: row.leaseUntil, updatedAt: row.updatedAt });

/** 의미 검색 엔진(@relay/core의 SemanticIndex)의 PostgreSQL 저장소, 사용자 한 명 몫. 계산은 엔진이 하고 여기서는 읽고 쓰기만 한다.
 *  모든 질의에 user_id를 걸고, 메모를 가리키는 줄은 (user_id, note_id) 외래 키로 그 사용자의 메모에만 묶인다. */
export class PgIndexPort implements IndexPort {
  constructor(private readonly db: Db, private readonly userId: string, private readonly store: NotesService) {}

  private bump(tx: Db, column: "docs" | "idx") {
    const next = column === "docs" ? { docs: sql`${noteIndexMeta.docs} + 1` } : { idx: sql`${noteIndexMeta.idx} + 1` };
    return tx.insert(noteIndexMeta).values({ userId: this.userId, docs: column === "docs" ? 1 : 0, idx: column === "idx" ? 1 : 0 }).onConflictDoUpdate({ target: noteIndexMeta.userId, set: next });
  }
  /** 그 사용자의 메모(폴더 아님)인 ID만 남긴다. 그 사이 지워진 메모의 줄을 쓰다가 외래 키 오류로 묶음이 통째로 되돌아가지 않게 한다. */
  private async existing(tx: Db, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    return new Set((await tx.select({ id: notes.id }).from(notes).where(and(eq(notes.userId, this.userId), eq(notes.kind, "note"), inArray(notes.id, ids)))).map((row) => row.id));
  }

  revision() { return this.store.revision(this.userId); }
  notes() { return this.store.list(this.userId); }
  apply(batch: NoteBatch) { return this.store.apply(this.userId, batch); }
  async stamps() {
    const [meta] = await this.db.select().from(noteIndexMeta).where(eq(noteIndexMeta.userId, this.userId)).limit(1);
    // 메모를 지우면 색인도 함께 지워지지만 그때는 번호를 올릴 길이 없으므로, 조각 수를 함께 본다.
    const [count] = await this.db.select({ total: sql<number>`count(*)::int` }).from(noteChunks).where(eq(noteChunks.userId, this.userId));
    return { docs: String(meta?.docs ?? 0), index: `${meta?.idx ?? 0}:${count?.total ?? 0}` };
  }

  async meta(): Promise<NoteMeta[]> {
    return (await this.db.select().from(noteMeta).where(eq(noteMeta.userId, this.userId))).map((row) => ({ noteId: row.noteId, docType: row.docType as DocType, docStatus: row.docStatus as DocStatus | null,
      project: row.project, sourceRepo: row.sourceRepo, sourcePath: row.sourcePath, sourceCommit: row.sourceCommit, supersededBy: row.supersededBy, updatedAt: row.updatedAt }));
  }
  async saveMeta(rows: NoteMeta[]) {
    await this.db.transaction(async (tx) => {
      const known = await this.existing(tx, rows.flatMap((row) => [row.noteId, ...(row.supersededBy ? [row.supersededBy] : [])]));
      for (const row of rows) {
        if (!known.has(row.noteId)) continue;
        const values = { docType: row.docType, docStatus: row.docStatus, project: row.project, sourceRepo: row.sourceRepo, sourcePath: row.sourcePath, sourceCommit: row.sourceCommit,
          supersededBy: row.supersededBy && known.has(row.supersededBy) ? row.supersededBy : null, updatedAt: row.updatedAt };
        await tx.insert(noteMeta).values({ userId: this.userId, noteId: row.noteId, ...values }).onConflictDoUpdate({ target: [noteMeta.userId, noteMeta.noteId], set: values });
      }
      await this.bump(tx, "docs");
    });
  }

  async cards(): Promise<NoteCard[]> {
    return (await this.db.select().from(noteCards).where(eq(noteCards.userId, this.userId))).map((row) => ({ noteId: row.noteId, contentHash: row.contentHash, summary: row.summary,
      terms: row.terms, questions: row.questions, author: row.author, updatedAt: row.updatedAt }));
  }
  async saveCards(rows: NoteCard[]) {
    await this.db.transaction(async (tx) => {
      const known = await this.existing(tx, rows.map((row) => row.noteId));
      for (const row of rows) {
        if (!known.has(row.noteId)) continue;
        const values = { contentHash: row.contentHash, summary: row.summary, terms: row.terms, questions: row.questions, author: row.author, updatedAt: row.updatedAt };
        await tx.insert(noteCards).values({ userId: this.userId, noteId: row.noteId, ...values }).onConflictDoUpdate({ target: [noteCards.userId, noteCards.noteId], set: values });
      }
      await this.bump(tx, "docs");
    });
  }

  async models(): Promise<EmbeddingModel[]> {
    return (await this.db.select().from(embeddingModels).where(eq(embeddingModels.userId, this.userId)).orderBy(embeddingModels.createdAt, embeddingModels.modelKey))
      .map((row) => ({ key: row.modelKey, name: row.name, dimensions: row.dimensions, prompt: row.prompt, chunkVersion: row.chunkVersion, floor: row.floor, active: row.active, createdAt: row.createdAt }));
  }
  async saveModel(model: EmbeddingModel) {
    await this.db.transaction(async (tx) => {
      if (model.active) await tx.update(embeddingModels).set({ active: false }).where(and(eq(embeddingModels.userId, this.userId), eq(embeddingModels.active, true), ne(embeddingModels.modelKey, model.key)));
      await tx.insert(embeddingModels).values({ userId: this.userId, modelKey: model.key, name: model.name, dimensions: model.dimensions, prompt: model.prompt, chunkVersion: model.chunkVersion,
        floor: model.floor, active: model.active, createdAt: model.createdAt }).onConflictDoUpdate({ target: [embeddingModels.userId, embeddingModels.modelKey], set: { floor: model.floor, active: model.active } });
      await this.bump(tx, "idx");
    });
  }
  async activate(key: string) {
    await this.db.transaction(async (tx) => {
      // 다른 모델의 색인은 외래 키를 따라 함께 지워진다.
      await tx.delete(embeddingModels).where(and(eq(embeddingModels.userId, this.userId), ne(embeddingModels.modelKey, key)));
      await tx.update(embeddingModels).set({ active: true }).where(and(eq(embeddingModels.userId, this.userId), eq(embeddingModels.modelKey, key)));
      await this.bump(tx, "idx");
    });
  }

  async states(modelKey: string): Promise<IndexState[]> {
    return (await this.db.select().from(noteIndex).where(and(eq(noteIndex.userId, this.userId), eq(noteIndex.modelKey, modelKey)))).map(toState);
  }
  private writeState(tx: Db, modelKey: string, state: IndexState) {
    const values = { inputHash: state.inputHash, contentHash: state.contentHash, chunkCount: state.chunkCount, status: state.status, error: state.error, attempts: state.attempts, retryAt: state.retryAt,
      leaseToken: state.leaseToken, leaseUntil: state.leaseUntil, updatedAt: state.updatedAt };
    return tx.insert(noteIndex).values({ userId: this.userId, noteId: state.noteId, modelKey, ...values }).onConflictDoUpdate({ target: [noteIndex.userId, noteIndex.noteId, noteIndex.modelKey], set: values });
  }
  async saveStates(modelKey: string, rows: IndexState[]) {
    await this.db.transaction(async (tx) => {
      const known = await this.existing(tx, rows.map((row) => row.noteId));
      for (const row of rows) if (known.has(row.noteId)) await this.writeState(tx, modelKey, row);
      await this.bump(tx, "idx");
    });
  }
  async drop(modelKey: string, noteIds: string[] | null) {
    await this.db.transaction(async (tx) => {
      const links = and(eq(noteSemanticLinks.userId, this.userId), eq(noteSemanticLinks.modelKey, modelKey));
      const chunks = and(eq(noteChunks.userId, this.userId), eq(noteChunks.modelKey, modelKey));
      const states = and(eq(noteIndex.userId, this.userId), eq(noteIndex.modelKey, modelKey));
      if (noteIds === null) {
        await tx.delete(noteSemanticLinks).where(links);
        await tx.delete(noteChunks).where(chunks);
        await tx.delete(noteIndex).where(states);
      } else if (noteIds.length) {
        await tx.delete(noteSemanticLinks).where(and(links, or(inArray(noteSemanticLinks.sourceNoteId, noteIds), inArray(noteSemanticLinks.targetNoteId, noteIds))));
        await tx.delete(noteChunks).where(and(chunks, inArray(noteChunks.noteId, noteIds)));
        await tx.delete(noteIndex).where(and(states, inArray(noteIndex.noteId, noteIds)));
      }
      await this.bump(tx, "idx");
    });
  }

  async chunks(modelKey: string, noteIds?: string[]): Promise<ChunkRow[]> {
    if (noteIds && !noteIds.length) return [];
    const rows = await this.db.select().from(noteChunks).where(and(eq(noteChunks.userId, this.userId), eq(noteChunks.modelKey, modelKey), ...(noteIds ? [inArray(noteChunks.noteId, noteIds)] : [])))
      .orderBy(noteChunks.noteId, noteChunks.chunkIndex);
    const out: ChunkRow[] = [];
    for (const row of rows) {
      const vector = bytesVector(row.embedding);
      if (vector) out.push({ noteId: row.noteId, index: row.chunkIndex, headingPath: row.headingPath, lineStart: row.lineStart, lineEnd: row.lineEnd, charStart: row.charStart, charEnd: row.charEnd,
        hash: row.chunkHash, tokens: row.tokenCount, vector });
    }
    return out;
  }

  async commit(modelKey: string, input: { state: IndexState; leaseToken: string | null; chunks: ChunkRow[]; links: SemanticLink[] }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const id = input.state.noteId;
      const where = and(eq(noteIndex.userId, this.userId), eq(noteIndex.noteId, id), eq(noteIndex.modelKey, modelKey));
      // 메모 줄을 잠가, 커밋하는 사이 메모가 지워지거나 다른 워커의 커밋과 엇갈리지 않게 한다.
      const [note] = await tx.select({ id: notes.id }).from(notes).where(and(eq(notes.userId, this.userId), eq(notes.id, id), eq(notes.kind, "note"))).for("update").limit(1);
      if (!note) return false;
      if (input.leaseToken !== null) {
        const [held] = await tx.select({ leaseToken: noteIndex.leaseToken }).from(noteIndex).where(where).limit(1);
        if (held?.leaseToken !== input.leaseToken) return false;
      }
      const mine = and(eq(noteChunks.userId, this.userId), eq(noteChunks.modelKey, modelKey), eq(noteChunks.noteId, id));
      await tx.delete(noteChunks).where(mine);
      for (let at = 0; at < input.chunks.length; at += 50) {
        await tx.insert(noteChunks).values(input.chunks.slice(at, at + 50).map((chunk) => ({ userId: this.userId, noteId: id, modelKey, chunkIndex: chunk.index, headingPath: chunk.headingPath,
          lineStart: chunk.lineStart, lineEnd: chunk.lineEnd, charStart: chunk.charStart, charEnd: chunk.charEnd, chunkHash: chunk.hash, tokenCount: chunk.tokens, embedding: bytes(chunk.vector) })));
      }
      await this.writeState(tx, modelKey, input.state);
      // 이 메모가 바뀌었으니 다른 메모가 이 메모를 가리키던 옛 점수도 함께 걷는다.
      await tx.delete(noteSemanticLinks).where(and(eq(noteSemanticLinks.userId, this.userId), eq(noteSemanticLinks.modelKey, modelKey), or(eq(noteSemanticLinks.sourceNoteId, id), eq(noteSemanticLinks.targetNoteId, id))));
      const known = await this.existing(tx, input.links.map((link) => link.target));
      const links = input.links.filter((link) => known.has(link.target));
      if (links.length) await tx.insert(noteSemanticLinks).values(links.map((link) => ({ userId: this.userId, modelKey, sourceNoteId: link.source, targetNoteId: link.target, score: link.score, strength: link.strength,
        sourceHeading: link.sourceHeading, sourceStart: link.sourceStart, sourceEnd: link.sourceEnd, targetHeading: link.targetHeading, targetStart: link.targetStart, targetEnd: link.targetEnd }))).onConflictDoNothing();
      await this.bump(tx, "idx");
      return true;
    });
  }

  async links(modelKey: string): Promise<SemanticLink[]> {
    return (await this.db.select().from(noteSemanticLinks).where(and(eq(noteSemanticLinks.userId, this.userId), eq(noteSemanticLinks.modelKey, modelKey)))).map((row) => ({
      source: row.sourceNoteId, target: row.targetNoteId, score: row.score, strength: row.strength, sourceHeading: row.sourceHeading, sourceStart: row.sourceStart, sourceEnd: row.sourceEnd,
      targetHeading: row.targetHeading, targetStart: row.targetStart, targetEnd: row.targetEnd }));
  }
  async dismissals() {
    return (await this.db.select({ a: noteLinkDismissals.aNoteId, b: noteLinkDismissals.bNoteId }).from(noteLinkDismissals).where(and(eq(noteLinkDismissals.userId, this.userId), isNotNull(noteLinkDismissals.aNoteId))));
  }
  async dismiss(a: string, b: string, at: number) {
    await this.db.transaction(async (tx) => {
      await tx.insert(noteLinkDismissals).values({ userId: this.userId, aNoteId: a, bNoteId: b, dismissedAt: at }).onConflictDoNothing();
      await this.bump(tx, "idx");
    });
  }
}
