import type { Database } from "bun:sqlite";
import { bytesVector, vectorBytes, type ChunkRow, type DocStatus, type DocType, type EmbeddingModel, type IndexPort, type IndexState, type NoteBatch, type NoteCard, type NoteMeta,
  type SemanticLink } from "@relay/core";
import { storageError } from "../errors";
import { NoteStore } from "./notes.store";

// 의미 검색 엔진(@relay/core의 SemanticIndex)의 SQLite 저장소. 계산은 엔진이 하고 여기서는 읽고 쓰기만 한다.
// 색인 표는 notes를 외래 키로 가리켜, 메모를 지우면 그 메모의 조각·벡터·의미 연결·카드가 함께 지워진다.
// 벡터는 float32 바이트(BLOB)로 둔다. 개인 메모 규모에서는 엔진이 메모리에서 전부 견주는 쪽이 벡터 색인을 두는 것보다 단순하고 정확하다.

type MetaRow = { note_id: string; doc_type: DocType; doc_status: DocStatus | null; project: string; source_repo: string | null; source_path: string | null; source_commit: string | null; superseded_by: string | null; updated_at: number };
type CardRow = { note_id: string; content_hash: string; summary: string; terms_json: string; questions_json: string; author: string; updated_at: number };
type ModelRow = { model_key: string; name: string; dimensions: number; prompt: string; chunk_version: number; floor: number; active: number; created_at: number };
type StateRow = { note_id: string; input_hash: string; content_hash: string; chunk_count: number; status: IndexState["status"]; error: string | null; attempts: number; retry_at: number;
  lease_token: string | null; lease_until: number; updated_at: number };
type ChunkDbRow = { note_id: string; chunk_index: number; heading_path: string; line_start: number; line_end: number; char_start: number; char_end: number; chunk_hash: string; token_count: number; embedding: Uint8Array };
type LinkRow = { source_note_id: string; target_note_id: string; score: number; strength: number; source_heading: string; source_start: number; source_end: number; target_heading: string; target_start: number; target_end: number };

const list = (json: string): string[] => { try { const value = JSON.parse(json); return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; } catch { return []; } };
const toState = (row: StateRow): IndexState => ({ noteId: row.note_id, inputHash: row.input_hash, contentHash: row.content_hash, chunkCount: row.chunk_count, status: row.status, error: row.error,
  attempts: row.attempts, retryAt: row.retry_at, leaseToken: row.lease_token, leaseUntil: row.lease_until, updatedAt: row.updated_at });

export class IndexStore implements IndexPort {
  private notesStore: NoteStore;
  constructor(private db: Database) { this.notesStore = new NoteStore(db); }

  private run<T>(action: () => T): Promise<T> {
    try { return Promise.resolve(action()); } catch (error) { return Promise.reject(storageError(error)); }
  }
  private bump(key: "docs" | "index") { this.db.query("UPDATE note_index_meta SET value = value + 1 WHERE key = ?").run(key); }

  revision() { return this.run(() => this.notesStore.revision()); }
  notes() { return this.run(() => this.notesStore.list()); }
  apply(batch: NoteBatch) { return this.run(() => this.notesStore.apply(batch)); }
  stamps() {
    return this.run(() => {
      const rows = this.db.query("SELECT key, value FROM note_index_meta").all() as Array<{ key: string; value: number }>;
      const value = (key: string) => rows.find((row) => row.key === key)?.value ?? 0;
      // 메모를 지우면 색인도 함께 지워지지만 그때는 번호를 올릴 길이 없으므로, 조각 수를 함께 본다.
      const chunks = (this.db.query("SELECT count(*) AS total FROM note_chunks").get() as { total: number }).total;
      return { docs: String(value("docs")), index: `${value("index")}:${chunks}` };
    });
  }

  meta() {
    return this.run(() => (this.db.query("SELECT * FROM note_meta").all() as MetaRow[]).map((row): NoteMeta => ({ noteId: row.note_id, docType: row.doc_type, docStatus: row.doc_status, project: row.project,
      sourceRepo: row.source_repo, sourcePath: row.source_path, sourceCommit: row.source_commit, supersededBy: row.superseded_by, updatedAt: row.updated_at })));
  }
  saveMeta(rows: NoteMeta[]) {
    return this.run(() => this.db.transaction(() => {
      const upsert = this.db.query(`INSERT INTO note_meta (note_id, doc_type, doc_status, project, source_repo, source_path, source_commit, superseded_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET doc_type = excluded.doc_type, doc_status = excluded.doc_status, project = excluded.project, source_repo = excluded.source_repo,
          source_path = excluded.source_path, source_commit = excluded.source_commit, superseded_by = excluded.superseded_by, updated_at = excluded.updated_at`);
      for (const row of rows) upsert.run(row.noteId, row.docType, row.docStatus, row.project, row.sourceRepo, row.sourcePath, row.sourceCommit, row.supersededBy, row.updatedAt);
      this.bump("docs");
    })());
  }

  cards() {
    return this.run(() => (this.db.query("SELECT * FROM note_cards").all() as CardRow[]).map((row): NoteCard => ({ noteId: row.note_id, contentHash: row.content_hash, summary: row.summary,
      terms: list(row.terms_json), questions: list(row.questions_json), author: row.author, updatedAt: row.updated_at })));
  }
  saveCards(rows: NoteCard[]) {
    return this.run(() => this.db.transaction(() => {
      const upsert = this.db.query(`INSERT INTO note_cards (note_id, content_hash, summary, terms_json, questions_json, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, terms_json = excluded.terms_json, questions_json = excluded.questions_json,
          author = excluded.author, updated_at = excluded.updated_at`);
      for (const row of rows) upsert.run(row.noteId, row.contentHash, row.summary, JSON.stringify(row.terms), JSON.stringify(row.questions), row.author, row.updatedAt);
      this.bump("docs");
    })());
  }

  models() {
    return this.run(() => (this.db.query("SELECT * FROM embedding_models ORDER BY created_at, model_key").all() as ModelRow[]).map((row): EmbeddingModel => ({ key: row.model_key, name: row.name,
      dimensions: row.dimensions, prompt: row.prompt, chunkVersion: row.chunk_version, floor: row.floor, active: row.active === 1, createdAt: row.created_at })));
  }
  saveModel(model: EmbeddingModel) {
    return this.run(() => this.db.transaction(() => {
      if (model.active) this.db.query("UPDATE embedding_models SET active = 0 WHERE active = 1 AND model_key <> ?").run(model.key);
      this.db.query(`INSERT INTO embedding_models (model_key, name, dimensions, prompt, chunk_version, floor, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model_key) DO UPDATE SET floor = excluded.floor, active = excluded.active`).run(model.key, model.name, model.dimensions, model.prompt, model.chunkVersion, model.floor, model.active ? 1 : 0, model.createdAt);
      this.bump("index");
    })());
  }
  activate(key: string) {
    return this.run(() => this.db.transaction(() => {
      // 다른 모델의 색인은 외래 키를 따라 함께 지워진다.
      this.db.query("DELETE FROM embedding_models WHERE model_key <> ?").run(key);
      this.db.query("UPDATE embedding_models SET active = 1 WHERE model_key = ?").run(key);
      this.bump("index");
    })());
  }

  states(modelKey: string) {
    return this.run(() => (this.db.query(`SELECT note_id, input_hash, content_hash, chunk_count, status, error, attempts, retry_at, lease_token, lease_until, updated_at
      FROM note_index WHERE model_key = ?`).all(modelKey) as StateRow[]).map(toState));
  }
  private writeState(modelKey: string, state: IndexState) {
    this.db.query(`INSERT INTO note_index (note_id, model_key, input_hash, content_hash, chunk_count, status, error, attempts, retry_at, lease_token, lease_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id, model_key) DO UPDATE SET input_hash = excluded.input_hash, content_hash = excluded.content_hash, chunk_count = excluded.chunk_count, status = excluded.status,
        error = excluded.error, attempts = excluded.attempts, retry_at = excluded.retry_at, lease_token = excluded.lease_token, lease_until = excluded.lease_until, updated_at = excluded.updated_at`)
      .run(state.noteId, modelKey, state.inputHash, state.contentHash, state.chunkCount, state.status, state.error, state.attempts, state.retryAt, state.leaseToken, state.leaseUntil, state.updatedAt);
  }
  saveStates(modelKey: string, rows: IndexState[]) {
    return this.run(() => this.db.transaction(() => {
      // 그 사이 지워진 메모의 상태는 쓰지 않는다(외래 키 오류로 묶음 전체가 되돌아가지 않게).
      const exists = this.db.query("SELECT 1 FROM notes WHERE id = ? AND kind = 'note'");
      for (const row of rows) if (exists.get(row.noteId)) this.writeState(modelKey, row);
      this.bump("index");
    })());
  }
  drop(modelKey: string, noteIds: string[] | null) {
    return this.run(() => this.db.transaction(() => {
      if (noteIds === null) {
        for (const table of ["note_semantic_links", "note_chunks", "note_index"]) this.db.query(`DELETE FROM ${table} WHERE model_key = ?`).run(modelKey);
      } else for (const id of noteIds) {
        this.db.query("DELETE FROM note_semantic_links WHERE model_key = ? AND (source_note_id = ? OR target_note_id = ?)").run(modelKey, id, id);
        this.db.query("DELETE FROM note_chunks WHERE model_key = ? AND note_id = ?").run(modelKey, id);
        this.db.query("DELETE FROM note_index WHERE model_key = ? AND note_id = ?").run(modelKey, id);
      }
      this.bump("index");
    })());
  }

  chunks(modelKey: string, noteIds?: string[]) {
    return this.run(() => {
      const columns = "note_id, chunk_index, heading_path, line_start, line_end, char_start, char_end, chunk_hash, token_count, embedding";
      const rows: ChunkDbRow[] = [];
      if (noteIds === undefined) rows.push(...this.db.query(`SELECT ${columns} FROM note_chunks WHERE model_key = ? ORDER BY note_id, chunk_index`).all(modelKey) as ChunkDbRow[]);
      else {
        const find = this.db.query(`SELECT ${columns} FROM note_chunks WHERE model_key = ? AND note_id = ? ORDER BY chunk_index`);
        for (const id of noteIds) rows.push(...find.all(modelKey, id) as ChunkDbRow[]);
      }
      const out: ChunkRow[] = [];
      for (const row of rows) {
        const vector = bytesVector(row.embedding);
        if (vector) out.push({ noteId: row.note_id, index: row.chunk_index, headingPath: row.heading_path, lineStart: row.line_start, lineEnd: row.line_end, charStart: row.char_start, charEnd: row.char_end,
          hash: row.chunk_hash, tokens: row.token_count, vector });
      }
      return out;
    });
  }
  commit(modelKey: string, input: { state: IndexState; leaseToken: string | null; chunks: ChunkRow[]; links: SemanticLink[] }) {
    return this.run(() => this.db.transaction(() => {
      const id = input.state.noteId;
      if (!this.db.query("SELECT 1 FROM notes WHERE id = ? AND kind = 'note'").get(id)) return false;
      if (input.leaseToken !== null) {
        const held = this.db.query("SELECT lease_token FROM note_index WHERE note_id = ? AND model_key = ?").get(id, modelKey) as { lease_token: string | null } | null;
        if (held?.lease_token !== input.leaseToken) return false;
      }
      this.db.query("DELETE FROM note_chunks WHERE model_key = ? AND note_id = ?").run(modelKey, id);
      const insert = this.db.query(`INSERT INTO note_chunks (note_id, model_key, chunk_index, heading_path, line_start, line_end, char_start, char_end, chunk_hash, token_count, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const chunk of input.chunks) insert.run(id, modelKey, chunk.index, chunk.headingPath, chunk.lineStart, chunk.lineEnd, chunk.charStart, chunk.charEnd, chunk.hash, chunk.tokens, vectorBytes(chunk.vector));
      this.writeState(modelKey, input.state);
      // 이 메모가 바뀌었으니 다른 메모가 이 메모를 가리키던 옛 점수도 함께 걷는다.
      this.db.query("DELETE FROM note_semantic_links WHERE model_key = ? AND (source_note_id = ? OR target_note_id = ?)").run(modelKey, id, id);
      const link = this.db.query(`INSERT OR REPLACE INTO note_semantic_links (model_key, source_note_id, target_note_id, score, strength, source_heading, source_start, source_end, target_heading, target_start, target_end)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM notes WHERE id = ?)`);
      for (const item of input.links) link.run(modelKey, item.source, item.target, item.score, item.strength, item.sourceHeading, item.sourceStart, item.sourceEnd, item.targetHeading, item.targetStart, item.targetEnd, item.target);
      this.bump("index");
      return true;
    })());
  }

  links(modelKey: string) {
    return this.run(() => (this.db.query(`SELECT source_note_id, target_note_id, score, strength, source_heading, source_start, source_end, target_heading, target_start, target_end
      FROM note_semantic_links WHERE model_key = ?`).all(modelKey) as LinkRow[]).map((row): SemanticLink => ({ source: row.source_note_id, target: row.target_note_id, score: row.score, strength: row.strength,
      sourceHeading: row.source_heading, sourceStart: row.source_start, sourceEnd: row.source_end, targetHeading: row.target_heading, targetStart: row.target_start, targetEnd: row.target_end })));
  }
  dismissals() {
    return this.run(() => (this.db.query("SELECT a_note_id, b_note_id FROM note_link_dismissals").all() as Array<{ a_note_id: string; b_note_id: string }>).map((row) => ({ a: row.a_note_id, b: row.b_note_id })));
  }
  dismiss(a: string, b: string, at: number) {
    return this.run(() => { this.db.query("INSERT INTO note_link_dismissals (a_note_id, b_note_id, dismissed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(a, b, at); this.bump("index"); });
  }
}
