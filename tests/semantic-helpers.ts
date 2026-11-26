import { createHash } from "node:crypto";
import { SemanticIndex, encodeVector, unit, type ChunkRow, type EmbeddingModel, type IndexCache, type IndexPort, type IndexState, type NoteBatch, type NoteCard, type NoteItem,
  type NoteMeta, type SemanticLink } from "@relay/core";

// 의미 검색 테스트가 함께 쓰는 것: 메모리 저장소(IndexPort), 뜻을 흉내 내는 임베더, 시계.

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** 메모리에 든 저장소. 메모를 지우면 그 메모의 색인도 함께 지운다(실제 저장소의 외래 키와 같다). */
export class MemoryPort implements IndexPort {
  items = new Map<string, NoteItem>();
  revision_ = 0;
  private revisionNumber() { return this.revision_; }
  metaRows = new Map<string, NoteMeta>();
  cardRows = new Map<string, NoteCard>();
  modelRows = new Map<string, EmbeddingModel>();
  stateRows = new Map<string, Map<string, IndexState>>();
  chunkRows = new Map<string, Map<string, ChunkRow[]>>();
  linkRows = new Map<string, SemanticLink[]>();
  dismissed: Array<{ a: string; b: string }> = [];
  private docs = 0;
  private index = 0;
  /** 조각을 읽은 횟수(캐시가 드는지 본다). */
  chunkReads = 0;

  put(...items: Array<Partial<NoteItem> & { id: string }>) {
    this.revision_++;
    for (const item of items) {
      const before = this.items.get(item.id);
      const base = before ?? { kind: "note", parentId: null, title: "", body: "", position: null, createdAt: 1000, updatedAt: 1000 };
      this.items.set(item.id, { ...base, ...item } as NoteItem);
    }
  }
  remove(id: string) {
    this.revision_++;
    this.items.delete(id);
    this.metaRows.delete(id); this.cardRows.delete(id);
    for (const states of this.stateRows.values()) states.delete(id);
    for (const chunks of this.chunkRows.values()) chunks.delete(id);
    for (const [key, links] of this.linkRows) this.linkRows.set(key, links.filter((link) => link.source !== id && link.target !== id));
    this.dismissed = this.dismissed.filter((pair) => pair.a !== id && pair.b !== id);
    this.index++;
  }

  /** 메모 본문을 읽은 횟수(캐시가 드는지 본다). */
  noteReads = 0;
  async revision() { return this.revisionNumber(); }
  async notes() { this.noteReads++; return { revision: this.revision_, items: [...this.items.values()] }; }
  async apply(batch: NoteBatch) { for (const id of batch.deletes) this.remove(id); this.put(...batch.upserts); return { revision: this.revision_ }; }
  async stamps() { return { docs: String(this.docs), index: String(this.index) }; }
  async meta() { return [...this.metaRows.values()]; }
  async saveMeta(rows: NoteMeta[]) { for (const row of rows) this.metaRows.set(row.noteId, row); this.docs++; }
  async cards() { return [...this.cardRows.values()]; }
  async saveCards(rows: NoteCard[]) { for (const row of rows) this.cardRows.set(row.noteId, row); this.docs++; }
  async models() { return [...this.modelRows.values()]; }
  async saveModel(model: EmbeddingModel) { this.modelRows.set(model.key, model); }
  async activate(key: string) {
    for (const model of this.modelRows.values()) model.active = model.key === key;
    for (const other of [...this.modelRows.keys()].filter((item) => item !== key)) {
      this.modelRows.delete(other); this.stateRows.delete(other); this.chunkRows.delete(other); this.linkRows.delete(other);
    }
    this.index++;
  }
  async states(modelKey: string) { return [...(this.stateRows.get(modelKey)?.values() ?? [])]; }
  async saveStates(modelKey: string, rows: IndexState[]) {
    const own = this.stateRows.get(modelKey) ?? new Map<string, IndexState>();
    for (const row of rows) own.set(row.noteId, row);
    this.stateRows.set(modelKey, own);
    this.index++;
  }
  async drop(modelKey: string, noteIds: string[] | null) {
    for (const id of noteIds ?? [...(this.stateRows.get(modelKey)?.keys() ?? [])]) {
      this.stateRows.get(modelKey)?.delete(id); this.chunkRows.get(modelKey)?.delete(id);
      this.linkRows.set(modelKey, (this.linkRows.get(modelKey) ?? []).filter((link) => link.source !== id && link.target !== id));
    }
    this.index++;
  }
  async chunks(modelKey: string, noteIds?: string[]) {
    this.chunkReads++;
    const own = this.chunkRows.get(modelKey) ?? new Map<string, ChunkRow[]>();
    return (noteIds ?? [...own.keys()]).flatMap((id) => own.get(id) ?? []);
  }
  async commit(modelKey: string, input: { state: IndexState; leaseToken: string | null; chunks: ChunkRow[]; links: SemanticLink[] }) {
    const states = this.stateRows.get(modelKey) ?? new Map<string, IndexState>();
    const id = input.state.noteId;
    if (input.leaseToken !== null && states.get(id)?.leaseToken !== input.leaseToken) return false;
    states.set(id, input.state); this.stateRows.set(modelKey, states);
    const chunks = this.chunkRows.get(modelKey) ?? new Map<string, ChunkRow[]>();
    chunks.set(id, input.chunks); this.chunkRows.set(modelKey, chunks);
    this.linkRows.set(modelKey, [...(this.linkRows.get(modelKey) ?? []).filter((link) => link.source !== id && link.target !== id), ...input.links]);
    this.index++;
    return true;
  }
  async links(modelKey: string) { return this.linkRows.get(modelKey) ?? []; }
  async dismissals() { return this.dismissed; }
  async dismiss(a: string, b: string) { if (!this.dismissed.some((pair) => pair.a === a && pair.b === b)) this.dismissed.push({ a, b }); this.index++; }
}

/** 낱말을 뜻 갈래로 옮겨 벡터를 만드는 임베더 흉내. 같은 갈래의 한국어·영어 낱말이 같은 차원을 올려, 낱말이 달라도 뜻이 같으면 가깝다. */
const CONCEPTS: string[][] = [
  ["절전", "sleep", "resume", "복귀", "깨어", "wake"],
  ["동기화", "sync", "갱신", "밀린", "재처리", "누락"],
  ["배포", "deploy", "release", "레지스트리", "컨테이너", "compose"],
  ["찌개", "요리", "끓", "두부", "묵은지", "recipe", "cook"],
  ["비밀번호", "암호", "password", "로그인", "login"],
  ["회의", "meeting", "안건", "회의록"],
  ["여행", "trip", "기차", "숙소", "부산"],
  ["디자인", "design", "색", "팔레트", "유리"],
  ["가계부", "지출", "예산", "budget"],
];
export const FAKE_DIMS = 16;
export function fakeVector(text: string): Float32Array {
  const lowered = text.toLowerCase();
  const values = new Array<number>(FAKE_DIMS).fill(0);
  CONCEPTS.forEach((words, at) => { for (const word of words) if (lowered.includes(word)) values[at]! += 1; });
  // 갈래에 들지 않는 글도 0-벡터가 되지 않게, 글자 합으로 뒤쪽 차원을 조금 올린다.
  let sum = 0;
  for (let i = 0; i < lowered.length; i++) sum = (sum + lowered.charCodeAt(i)) % 97;
  values[CONCEPTS.length + sum % (FAKE_DIMS - CONCEPTS.length)]! += 0.15;
  return unit(values)!;
}
export const fakeEmbedder = { embed: async (texts: string[], _kind: "query" | "passage") => texts.map(fakeVector) };

export const FAKE_MODEL = { name: "fake-embed", dimensions: FAKE_DIMS, prompt: "plain", floor: 0.2 };

export function engine(port = new MemoryPort(), start = 1_000_000) {
  const clock = { now: start };
  let ids = 0;
  const cache: IndexCache = {};
  const index = new SemanticIndex(port, { sha256, now: () => clock.now, id: () => `id-${String(++ids).padStart(6, "0")}` }, cache);
  return { port, clock, cache, index };
}

/** 워커가 하는 일을 한 번에: 대기 중인 메모를 받아 임베딩하고 커밋한다. 임베딩한 조각 수와 처리한 메모 수를 돌려준다. */
export async function indexAll(index: SemanticIndex, model = FAKE_MODEL) {
  let embedded = 0, jobs = 0, modelKey = "";
  for (let guard = 0; guard < 50; guard++) {
    const lease = await index.lease({ workerId: "test-worker", model, limit: 8 });
    modelKey = lease.modelKey;
    if (!lease.jobs.length) break;
    for (const job of lease.jobs) {
      const vectors = await fakeEmbedder.embed(job.texts.map((item) => item.text), "passage");
      embedded -= job.texts.filter((item) => item.query).length;
      await index.commit({ modelKey: lease.modelKey, noteId: job.noteId, leaseToken: job.leaseToken, inputHash: job.inputHash,
        vectors: job.texts.map((item, at) => ({ hash: item.hash, data: encodeVector(vectors[at]!) })) });
      embedded += job.texts.length; jobs++;
    }
  }
  return { embedded, jobs, modelKey };
}
