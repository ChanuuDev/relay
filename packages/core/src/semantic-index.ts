import { RelayError } from "./errors.js";
import { MAX_NAME, labelOf, plainLine, type NoteItem } from "./notes.js";
import { CHUNK_VERSION, chunkInput, chunkNote, headingAt, headingOf, type Chunk, type ChunkContext, type DocStatus } from "./chunk.js";
import { redactSecrets } from "./redact.js";
import { exactIntent, lexicalIndex, lexicalRank, lowerText, queryTerms, tagsOf, type LexicalHit, type LexicalIndex } from "./text.js";
import { decodeVector, dot } from "./vector.js";
import {
  INDEX_DEBOUNCE_MS, LEASE_MS, MAX_ATTEMPTS, MAX_LEASE_TEXTS, PROBE_INDEX, RETRY_AFTER_MS, WORKER_ONLINE_MS, modelKey,
  type CardInput, type CardsPending, type ChunkRow, type CommitRequest, type CommitResponse, type EmbeddingModel, type FailRequest, type FallbackReason,
  type IndexPort, type IndexState, type IndexStatus, type IndexSummary, type LeaseJob, type LeaseRequest, type LeaseResponse, type LinkItem, type LinksResponse,
  type MetaRequest, type NoteCard, type NoteMeta, type RegisterRequest, type RegisterResponse, type ReindexRequest, type SearchItem, type SearchMatch,
  type SearchRequest, type SearchResponse, type SemanticLink, type SuggestionItem,
} from "./semantic.js";

// 메모 의미 검색 엔진. 저장은 IndexPort에 맡기고 계산은 모두 여기서 한다(로컬 서버·원격 서버·CLI가 같은 코드를 돈다).
//  - 색인할 일은 따로 쌓아 두지 않는다. 「지금 메모의 입력 해시」와 「색인된 입력 해시」가 다른 메모가 곧 대기 목록이다.
//    벡터가 메모와 같은 DB에 있어 지운 메모는 함께 지워지고, 문서 유형·상태는 검색할 때 붙이므로 따로 맞출 것이 없다.
//  - 조각 나누기와 가리기는 서버가 한다. 워커는 받은 글을 벡터로 바꿔 돌려줄 뿐이라, 가리지 않은 본문이 임베딩 서버로 가지 않는다.
//  - 검색은 낱말(BM25 + 에이전트가 쓴 의미 카드)과 의미(조각 벡터) 두 순위를 RRF로 합친다. 질의 벡터가 없으면 낱말 순위만으로 바로 답한다.

type Note = Extract<NoteItem, { kind: "note" }>;
type Doc = { note: Note; path: string; context: ChunkContext; /** 이 메모를 질의로 삼을 때의 글(제목·카드의 요약과 질문·본문 첫머리) */ probe: string; contentHash: string; inputHash: string; empty: boolean; meta: NoteMeta | null; card: NoteCard | null };
type View = { revision: number; docs: Map<string, Doc>; items: Map<string, NoteItem>; lexical?: LexicalIndex; plans: Map<string, Chunk[]> };
/** 서버가 사용자마다 쥐고 있는 캐시. 메모·문서 정보가 바뀌지 않았으면 낱말 색인을, 색인이 바뀌지 않았으면 조각 벡터를 다시 읽지 않는다. */
export type IndexCache = { viewKey?: string; view?: View; chunksKey?: string; chunkRows?: ChunkRow[]; workerAt?: number; urgent?: Set<string> };
export type IndexDeps = {
  sha256(text: string): string; now(): number; id(): string;
  /** 서버가 질의를 직접 임베딩할 수 있을 때(임베딩 서버로 가는 길이 있을 때)만 준다. */
  embedQuery?: (query: string, model: EmbeddingModel) => Promise<Float32Array | { failed: FallbackReason }>;
};

/** 워커가 임대를 손대지 않고 돌려놓을 때 fail의 error에 적는 말. */
export const RELEASED = "released";
const RRF_K = 60;
/** 문서 상태에 따라 곱하는 값. 순위를 매기기 전의 점수(낱말 점수, 유사도)에 곱한다: 비슷하게 맞은 문서 사이에서는 채택한 문서가 앞서고,
 *  훨씬 잘 맞은 문서는 그대로 앞에 남는다. 순위를 합친 값(RRF)에 곱하면 안 된다. 그 값은 맨 위에서 한 칸 차이가 1.6%뿐이라(1/61 대 1/62)
 *  1.15가 열 칸을 뛰어넘고, 채택 문서끼리 점수가 뭉쳐 가장 잘 맞은 문서가 뒤로 밀린다(실제 메모에서 그렇게 됐다).
 *  대체된 문서는 크게 깎아 같은 주제의 새 문서 뒤에 둔다. */
const ADOPTED_WEIGHT = 1.15, SUPERSEDED_WEIGHT = 0.6;
const LINKS_PER_NOTE = 6;
const PROBE_CHARS = 300;
/** 값들의 아래쪽 80%로 잰 평균과 표준편차. 관련 있는 몇 개가 끌어올리지 않은 「배경」 유사도를 어림한다. */
function background(values: number[]): { mean: number; deviation: number } {
  const lower = [...values].sort((a, b) => a - b).slice(0, Math.max(3, Math.floor(values.length * 0.8)));
  const mean = lower.reduce((sum, value) => sum + value, 0) / lower.length;
  return { mean, deviation: Math.sqrt(lower.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lower.length) };
}
const missing = (what: string): never => { throw new RelayError("NOTE_NOT_FOUND", `${what}을(를) 찾을 수 없습니다.`, 3, 404); };

export class SemanticIndex {
  constructor(private port: IndexPort, private deps: IndexDeps, private cache: IndexCache = {}) {}

  // ── 메모 읽기 ────────────────────────────────────────────

  private async view(): Promise<View> {
    // 메모가 바뀌지 않았으면 본문을 다시 읽지 않는다(화면이 색인 상태를 자주 묻는다).
    const [stamps, revision] = await Promise.all([this.port.stamps(), this.port.revision()]);
    if (this.cache.view && this.cache.viewKey === `${revision}|${stamps.docs}`) return this.cache.view;
    const [list, metaRows, cardRows] = await Promise.all([this.port.notes(), this.port.meta(), this.port.cards()]);
    const key = `${list.revision}|${stamps.docs}`;
    const items = new Map(list.items.map((item) => [item.id, item]));
    const meta = new Map(metaRows.map((row) => [row.noteId, row])), cards = new Map(cardRows.map((row) => [row.noteId, row]));
    const pathOf = (parentId: string | null) => {
      const names: string[] = [];
      const seen = new Set<string>();
      for (let id = parentId; id && !seen.has(id); id = items.get(id)?.parentId ?? null) {
        seen.add(id);
        const folder = items.get(id);
        if (folder?.kind !== "folder") break;
        names.unshift(folder.name);
      }
      return names.join(" › ");
    };
    const docs = new Map<string, Doc>();
    for (const note of list.items) {
      if (note.kind !== "note") continue;
      const info = meta.get(note.id) ?? null, card = cards.get(note.id) ?? null, path = pathOf(note.parentId);
      const context: ChunkContext = { title: note.title.trim(), path, docType: info?.docType ?? "memo", project: info?.project ?? "", summary: card?.summary ?? "" };
      // 질의로 삼을 글: 사람이 이 메모를 찾을 때 칠 법한 말에 가깝게, 제목과 (있으면) 카드의 요약·질문, 본문 첫머리만 쓴다.
      const opening = note.body.split("\n", 40).map(plainLine).filter(Boolean).join(" ").slice(0, PROBE_CHARS);
      const probe = redactSecrets([note.title.trim(), card?.summary ?? "", ...(card?.questions ?? []).slice(0, 3), opening].filter(Boolean).join("\n")).text.slice(0, 700);
      docs.set(note.id, { note, path, context, probe, meta: info, card, empty: !note.title.trim() && !note.body.trim(),
        contentHash: this.deps.sha256(`${note.title.normalize("NFC")}\0${note.body.normalize("NFC")}`), inputHash: this.deps.sha256(`${chunkInput(note.body, context)}\0${probe}`) });
    }
    const view: View = { revision: list.revision, docs, items, plans: new Map() };
    this.cache.view = view; this.cache.viewKey = key;
    return view;
  }

  private plan(view: View, doc: Doc): Chunk[] {
    let chunks = view.plans.get(doc.note.id);
    if (!chunks) { chunks = chunkNote(doc.note.body, doc.context).chunks; view.plans.set(doc.note.id, chunks); }
    return chunks;
  }

  private lexical(view: View): LexicalIndex {
    return view.lexical ??= lexicalIndex([...view.docs.values()].map((doc) => ({
      id: doc.note.id, title: labelOf(doc.note), text: doc.note.body,
      fields: [[doc.note.title, 3], [doc.path, 1.5], [tagsOf(doc.note.body).join(" "), 2], [doc.note.body.split("\n").map(plainLine).join("\n"), 1],
        [doc.card ? [doc.card.summary, ...doc.card.terms, ...doc.card.questions].join("\n") : "", 2], [doc.meta?.project ?? "", 1.5]] as Array<readonly [string, number]>,
    })));
  }

  private async active(): Promise<EmbeddingModel | null> {
    return (await this.port.models()).find((model) => model.active) ?? null;
  }

  /** 메모 하나가 색인에서 어떤 상태인가. working은 워커가 가져가 계산하는 중이다. */
  private stateOf(doc: Doc, state: IndexState | undefined, now: number): "ready" | "pending" | "failed" | "working" {
    if (state && state.inputHash === doc.inputHash && state.status === "ready") return "ready";
    if (state?.leaseToken && state.leaseUntil > now) return "working";
    if (state?.status === "failed" && state.contentHash === doc.inputHash && state.attempts >= MAX_ATTEMPTS) return "failed";
    return "pending";
  }

  private summary(view: View, states: Map<string, IndexState>, now: number): IndexSummary {
    const out = { total: 0, ready: 0, pending: 0, failed: 0 };
    for (const doc of view.docs.values()) {
      if (doc.empty) continue;
      out.total++;
      const state = this.stateOf(doc, states.get(doc.note.id), now);
      if (state === "ready") out.ready++; else if (state === "failed") out.failed++; else out.pending++;
    }
    return out;
  }

  private cardState(doc: Doc): "fresh" | "stale" | "missing" {
    return !doc.card ? "missing" : doc.card.contentHash === doc.contentHash ? "fresh" : "stale";
  }

  async status(noteId?: string): Promise<IndexStatus> {
    const view = await this.view(), now = this.deps.now();
    const models = await this.port.models();
    const active = models.find((model) => model.active) ?? null;
    const rows: IndexStatus["models"] = [];
    let states = new Map<string, IndexState>();
    for (const model of models) {
      const own = new Map((await this.port.states(model.key)).map((state) => [state.noteId, state]));
      if (model.active) states = own;
      rows.push({ key: model.key, name: model.name, dimensions: model.dimensions, active: model.active, ...this.summary(view, own, now) });
    }
    const cards = { total: 0, fresh: 0, stale: 0, missing: 0 };
    for (const doc of view.docs.values()) { if (doc.empty) continue; cards.total++; cards[this.cardState(doc)]++; }
    const summary = active ? this.summary(view, states, now) : { total: cards.total, ready: 0, pending: cards.total, failed: 0 };
    const workerAt = this.cache.workerAt ?? null;
    const status: IndexStatus = { schemaVersion: 1, activeModelKey: active?.key ?? null, models: rows, embedderOnline: workerAt !== null && now - workerAt < WORKER_ONLINE_MS,
      lastWorkerAt: workerAt, summary, cards };
    if (noteId !== undefined) {
      const doc = view.docs.get(noteId) ?? missing("메모");
      const state = states.get(noteId);
      const value = doc.empty ? "ready" : this.stateOf(doc, state, now);
      status.items = [{ noteId, status: value === "working" ? "pending" : value, chunks: state?.status === "ready" ? state.chunkCount : 0,
        indexedAt: state?.status === "ready" ? state.updatedAt : null, error: state?.status === "failed" ? state.error : null, card: this.cardState(doc) }];
    }
    return status;
  }

  // ── 색인: 임대 → 커밋 ────────────────────────────────────

  /** 워커에게 색인할 메모를 내준다. 조각 글 가운데 벡터가 없는 것만 준다. 벡터가 이미 다 있으면 워커를 거치지 않고 바로 마친다. */
  async lease(request: LeaseRequest): Promise<LeaseResponse> {
    const now = this.deps.now();
    this.cache.workerAt = now;
    const key = modelKey(request.model.name, request.model.dimensions, request.model.prompt);
    const models = await this.port.models();
    let model = models.find((item) => item.key === key);
    if (!model || Math.abs(model.floor - request.model.floor) > 1e-6) {
      model = { key, name: request.model.name, dimensions: request.model.dimensions, prompt: request.model.prompt, chunkVersion: CHUNK_VERSION,
        floor: request.model.floor, active: model?.active ?? !models.some((item) => item.active), createdAt: model?.createdAt ?? now };
      await this.port.saveModel(model);
    }
    const view = await this.view();
    const states = new Map((await this.port.states(key)).map((state) => [state.noteId, state]));
    const urgent = this.cache.urgent ?? new Set<string>();
    const waiting: Doc[] = [];
    const settle: IndexState[] = [];
    for (const doc of view.docs.values()) {
      if (doc.empty) continue;
      const state = states.get(doc.note.id);
      if (this.stateOf(doc, state, now) !== "pending") continue;
      if (state?.status === "failed" && state.contentHash === doc.inputHash && state.retryAt > now) continue;
      if (!urgent.has(doc.note.id) && doc.note.updatedAt > now - INDEX_DEBOUNCE_MS) continue;
      // 임대가 끝났는데 돌아오지 않았다: PC가 꺼졌거나 그 메모에서 워커가 죽었다. 여러 번 되풀이되면 실패로 둔다.
      if (state?.leaseToken && state.leaseUntil <= now && state.attempts + 1 >= MAX_ATTEMPTS) {
        settle.push({ ...state, status: "failed", contentHash: doc.inputHash, error: "lease_expired", attempts: MAX_ATTEMPTS, retryAt: 0, leaseToken: null, leaseUntil: 0, updatedAt: now });
        continue;
      }
      waiting.push(doc);
    }
    waiting.sort((a, b) => Number(urgent.has(b.note.id)) - Number(urgent.has(a.note.id)) || b.note.updatedAt - a.note.updatedAt || (a.note.id < b.note.id ? -1 : 1));
    const picked = waiting.slice(0, request.limit);
    const existing = new Map<string, Map<string, Float32Array>>();
    if (picked.length) for (const row of await this.port.chunks(key, picked.map((doc) => doc.note.id))) {
      const own = existing.get(row.noteId) ?? new Map<string, Float32Array>();
      own.set(row.hash, row.vector); existing.set(row.noteId, own);
    }
    const jobs: LeaseJob[] = [];
    let texts = 0, taken = 0;
    for (const doc of picked) {
      const chunks = this.plan(view, doc), have = existing.get(doc.note.id) ?? new Map<string, Float32Array>();
      const hashed = this.hashed(view, doc);
      const fresh = new Map(hashed.filter((item) => !have.has(item.hash)).map((item) => [item.hash, item]));
      if (jobs.length && texts + fresh.size > MAX_LEASE_TEXTS) break;
      taken++;
      urgent.delete(doc.note.id);
      const previous = states.get(doc.note.id);
      if (!fresh.size) {
        // 조각이 그대로다(자리만 바뀌었거나 다른 PC가 이미 계산했다): 있는 벡터로 바로 마친다.
        await this.store(model, view, doc, hashed, have, null, now);
        continue;
      }
      const leaseToken = this.deps.id().replace(/[^A-Za-z0-9_-]/g, "").padEnd(8, "0");
      settle.push({ noteId: doc.note.id, inputHash: previous?.inputHash ?? "", contentHash: previous?.contentHash ?? "", chunkCount: previous?.chunkCount ?? 0,
        status: previous?.status === "ready" ? "ready" : "pending", error: null, attempts: (previous?.attempts ?? 0) + (previous?.leaseToken ? 1 : 0), retryAt: 0,
        leaseToken, leaseUntil: now + LEASE_MS, updatedAt: previous?.updatedAt ?? now });
      jobs.push({ noteId: doc.note.id, leaseToken, inputHash: doc.inputHash, chunks: chunks.length,
        texts: [...fresh].map(([hash, item]) => ({ hash, text: item.chunk.text, ...(item.chunk.index === PROBE_INDEX ? { query: true as const } : {}) })) });
      texts += fresh.size;
    }
    if (settle.length) await this.port.saveStates(key, settle);
    this.cache.urgent = urgent;
    return { schemaVersion: 1, modelKey: key, active: (await this.active())?.key === key, jobs, remaining: waiting.length - taken, leaseMs: LEASE_MS };
  }

  /** 메모의 조각과 질의 글에 해시를 붙인다. 질의 글은 같은 글의 조각과 섞이지 않게 머리표를 달아 해시한다. */
  private hashed(view: View, doc: Doc): Array<{ chunk: Chunk; hash: string }> {
    const probe: Chunk = { index: PROBE_INDEX, headingPath: "", lineStart: 0, lineEnd: 0, charStart: 0, charEnd: 0, text: doc.probe, tokens: 0 };
    return [...this.plan(view, doc).map((chunk) => ({ chunk, hash: this.deps.sha256(chunk.text) })), ...(doc.probe ? [{ chunk: probe, hash: this.deps.sha256(`query\0${doc.probe}`) }] : [])];
  }

  /** 조각·상태·의미 연결을 쓴다. 벡터는 워커가 새로 준 것과 이미 있던 것을 조각 해시로 맞춘다. */
  private async store(model: EmbeddingModel, view: View, doc: Doc, hashed: Array<{ chunk: Chunk; hash: string }>, vectors: Map<string, Float32Array>, leaseToken: string | null, now: number) {
    const rows: ChunkRow[] = hashed.map(({ chunk, hash }) => {
      const vector = vectors.get(hash);
      if (!vector) throw new RelayError("INVALID_ARGUMENT", "조각의 벡터가 빠졌습니다. 임대를 다시 받아 주세요.");
      return { noteId: doc.note.id, index: chunk.index, headingPath: chunk.headingPath, lineStart: chunk.lineStart, lineEnd: chunk.lineEnd,
        charStart: chunk.charStart, charEnd: chunk.charEnd, hash, tokens: chunk.tokens, vector };
    });
    const links = await this.nearest(model, view, doc.note.id, rows);
    const state: IndexState = { noteId: doc.note.id, inputHash: doc.inputHash, contentHash: doc.contentHash, chunkCount: rows.filter((row) => row.index >= 0).length, status: "ready",
      error: null, attempts: 0, retryAt: 0, leaseToken: null, leaseUntil: 0, updatedAt: now };
    const written = await this.port.commit(model.key, { state, leaseToken, chunks: rows, links });
    // 색인을 여러 메모에 이어서 할 때마다 모든 조각을 다시 읽지 않도록, 쥐고 있는 조각 목록에서 이 메모의 것만 바꿔 넣는다.
    if (written && this.cache.chunkRows && this.cache.chunksKey?.startsWith(`${model.key}|`)) {
      this.cache.chunkRows = [...this.cache.chunkRows.filter((row) => row.noteId !== doc.note.id), ...rows];
      this.cache.chunksKey = `${model.key}|${(await this.port.stamps()).index}`;
    } else this.cache.chunksKey = undefined;
    return written;
  }

  /** 이 메모와 뜻이 가까운 메모들. 조각끼리 견주면 길이나 말투가 닮은 메모가 가깝게 나오므로(실측), 검색과 같은 방향으로 잰다:
   *  이 메모의 질의 벡터 → 다른 메모의 절, 다른 메모의 질의 벡터 → 이 메모의 절. 둘 중 큰 값이 바닥값을 넘으면 잇고, 가장 가까웠던 절을 근거로 남긴다.
   *  두 방향을 모두 보므로 새 메모가 들어오면 옛 메모를 다시 색인하지 않아도 그 쌍이 생긴다. */
  private async nearest(model: EmbeddingModel, view: View, noteId: string, rows: ChunkRow[]): Promise<SemanticLink[]> {
    const probe = rows.find((row) => row.index === PROBE_INDEX), own = rows.filter((row) => row.index >= 0);
    if (!probe || !own.length) return [];
    const forward = new Map<string, { score: number; row: ChunkRow }>(), backward = new Map<string, { score: number; row: ChunkRow }>(), opening = new Map<string, ChunkRow>();
    for (const row of await this.chunkRows(model.key)) {
      if (row.noteId === noteId || !view.docs.has(row.noteId) || row.vector.length !== probe.vector.length) continue;
      if (row.index === PROBE_INDEX) {
        for (const mine of own) { const score = dot(row.vector, mine.vector); if (score > (backward.get(row.noteId)?.score ?? -Infinity)) backward.set(row.noteId, { score, row: mine }); }
        continue;
      }
      if (row.index === 0) opening.set(row.noteId, row);
      const score = dot(probe.vector, row.vector);
      if (score > (forward.get(row.noteId)?.score ?? -Infinity)) forward.set(row.noteId, { score, row });
    }
    // 바닥값: 모델마다 잰 값에 여유를 두고(잇기 제안은 검색보다 엄격하게), 메모가 넉넉하면 이 메모의 배경 유사도보다 뚜렷이 높은 것만 남긴다.
    const base = Math.max(model.floor, 0.05);
    const scores = [...forward.values()].map((item) => item.score);
    const noise = scores.length >= 8 ? background(scores) : null;
    const floor = Math.max(base * 1.5, noise ? noise.mean + 3 * noise.deviation : -1);
    const links: SemanticLink[] = [];
    for (const id of new Set([...forward.keys(), ...backward.keys()])) {
      const out = forward.get(id), back = backward.get(id);
      const score = Math.max(out?.score ?? -1, back?.score ?? -1);
      if (score < floor) continue;
      const target = out?.row ?? opening.get(id);
      if (!target) continue;
      // 근거로 보일 이쪽 절: 저쪽의 질의 벡터에 가장 가까운 절, 없으면 저쪽의 그 절과 가장 닮은 절.
      const source = back?.row ?? own.reduce((best, row) => (dot(row.vector, target.vector) > dot(best.vector, target.vector) ? row : best));
      links.push({ source: noteId, target: id, score, strength: Math.max(0.1, Math.min(1, score / (base * 4))),
        sourceHeading: source.headingPath, sourceStart: source.lineStart, sourceEnd: source.lineEnd, targetHeading: target.headingPath, targetStart: target.lineStart, targetEnd: target.lineEnd });
    }
    return links.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1)).slice(0, LINKS_PER_NOTE);
  }

  async commit(request: CommitRequest): Promise<CommitResponse> {
    const now = this.deps.now();
    this.cache.workerAt = now;
    const models = await this.port.models();
    const model = models.find((item) => item.key === request.modelKey) ?? missing("모델");
    const view = await this.view();
    const doc = view.docs.get(request.noteId);
    const state = (await this.port.states(model.key)).find((item) => item.noteId === request.noteId);
    if (!state || state.leaseToken !== request.leaseToken) return { schemaVersion: 1, committed: false, staleSkipped: true };
    // 계산하는 사이에 메모가 지워졌거나 바뀌었다: 버리고, 바뀐 메모는 다음 임대에서 다시 계산한다.
    if (!doc || doc.empty || doc.inputHash !== request.inputHash) {
      await this.port.saveStates(model.key, [{ ...state, leaseToken: null, leaseUntil: 0 }]);
      return { schemaVersion: 1, committed: false, staleSkipped: true };
    }
    const vectors = new Map<string, Float32Array>();
    for (const row of await this.port.chunks(model.key, [doc.note.id])) vectors.set(row.hash, row.vector);
    for (const item of request.vectors) {
      const vector = decodeVector(item.data, model.dimensions);
      if (!vector) throw new RelayError("INVALID_ARGUMENT", `벡터가 올바르지 않습니다(길이 1인 ${model.dimensions}차원 float32여야 합니다).`);
      vectors.set(item.hash, vector);
    }
    const hashed = this.hashed(view, doc);
    // 사람에게 알릴 수는 조각만 센다(메모의 질의 벡터는 빼고).
    const pieces = hashed.filter((item) => item.chunk.index >= 0);
    const embedded = pieces.filter((item) => request.vectors.some((vector) => vector.hash === item.hash)).length;
    if (!(await this.store(model, view, doc, hashed, vectors, request.leaseToken, now))) return { schemaVersion: 1, committed: false, staleSkipped: true };
    // 조각 규칙만 새로워진 같은 모델이 모든 메모를 다 색인했으면 그 모델로 넘어간다(다른 모델로 바꾸는 것은 사용자가 정한다).
    let activated = false;
    const active = models.find((item) => item.active);
    if (!model.active && (!active || (active.name === model.name && active.dimensions === model.dimensions && active.prompt === model.prompt && active.chunkVersion < model.chunkVersion))) {
      const summary = this.summary(view, new Map((await this.port.states(model.key)).map((item) => [item.noteId, item])), now);
      if (!active || summary.ready === summary.total) { await this.port.activate(model.key); activated = true; }
    }
    return { schemaVersion: 1, committed: true, reused: pieces.length - embedded, embedded, ...(activated ? { activated } : {}) };
  }

  async fail(request: FailRequest): Promise<{ schemaVersion: 1; nextRetryAt: number | null }> {
    const now = this.deps.now();
    this.cache.workerAt = now;
    const view = await this.view();
    const state = (await this.port.states(request.modelKey)).find((item) => item.noteId === request.noteId);
    if (!state || state.leaseToken !== request.leaseToken) return { schemaVersion: 1, nextRetryAt: null };
    // 임베딩 서버가 꺼져 있어 손대지 못하고 돌려놓는 경우: 메모의 잘못이 아니므로 시도 횟수를 세지 않는다.
    if (request.error === RELEASED) { await this.port.saveStates(request.modelKey, [{ ...state, leaseToken: null, leaseUntil: 0 }]); return { schemaVersion: 1, nextRetryAt: null }; }
    const attempts = request.retryable ? state.attempts + 1 : MAX_ATTEMPTS;
    const retryAt = attempts >= MAX_ATTEMPTS ? 0 : now + RETRY_AFTER_MS[Math.min(attempts, RETRY_AFTER_MS.length) - 1]!;
    // 실패한 입력을 contentHash 자리에 적어 둔다. 메모를 고치면 입력 해시가 달라져 바로 다시 시도한다.
    await this.port.saveStates(request.modelKey, [{ ...state, status: "failed", contentHash: view.docs.get(request.noteId)?.inputHash ?? "", error: request.error, attempts, retryAt, leaseToken: null, leaseUntil: 0, updatedAt: now }]);
    return { schemaVersion: 1, nextRetryAt: retryAt || null };
  }

  /** 다시 색인하게 한다. failed는 실패한 메모를 다시 시도하고, note·all은 그 메모(전부)의 벡터를 버리고 새로 계산한다. */
  async reindex(request: ReindexRequest): Promise<{ schemaVersion: 1; queued: number }> {
    const view = await this.view();
    let queued = 0;
    const urgent = this.cache.urgent ??= new Set<string>();
    for (const model of await this.port.models()) {
      if (request.scope === "failed") {
        const failed = (await this.port.states(model.key)).filter((state) => state.status === "failed");
        if (failed.length) await this.port.saveStates(model.key, failed.map((state) => ({ ...state, attempts: 0, retryAt: 0 })));
        if (model.active) queued += failed.length;
      } else if (request.scope === "note") {
        if (!view.docs.has(request.noteId!)) missing("메모");
        await this.port.drop(model.key, [request.noteId!]);
        this.cache.chunksKey = undefined;
        if (model.active) queued++;
      } else {
        await this.port.drop(model.key, null);
        this.cache.chunksKey = undefined;
        if (model.active) queued += [...view.docs.values()].filter((doc) => !doc.empty).length;
      }
    }
    if (request.scope === "note") urgent.add(request.noteId!);
    return { schemaVersion: 1, queued };
  }

  async activate(key: string): Promise<{ schemaVersion: 1; activeModelKey: string }> {
    if (!(await this.port.models()).some((model) => model.key === key)) missing("모델");
    await this.port.activate(key);
    this.cache.chunksKey = undefined;
    return { schemaVersion: 1, activeModelKey: key };
  }

  // ── 검색 ─────────────────────────────────────────────────

  private async chunkRows(key: string): Promise<ChunkRow[]> {
    const stamp = `${key}|${(await this.port.stamps()).index}`;
    if (this.cache.chunkRows && this.cache.chunksKey === stamp) return this.cache.chunkRows;
    const rows = await this.port.chunks(key);
    this.cache.chunkRows = rows; this.cache.chunksKey = stamp;
    return rows;
  }

  /** 본문에서 보일 한 토막. 질의 낱말이 든 줄을 먼저, 없으면 그 절의 첫 글줄을 쓴다. 비밀로 보이는 값은 가린다. */
  private snippet(lines: string[], start: number, end: number, terms: string[]): string {
    return this.shown(lines, start, end, terms).text;
  }

  /** snippet과 같되, 보인 첫 줄의 번호도 돌려준다(그 줄이 든 절의 소제목을 적는 데 쓴다). */
  private shown(lines: string[], start: number, end: number, terms: string[]): { text: string; line: number } {
    const picked: string[] = [];
    let fallback = "", fallbackAt = start, pickedAt = 0;
    for (let at = Math.max(1, start); at <= Math.min(lines.length, end) && picked.length < 2; at++) {
      const raw = lines[at - 1]!;
      if (headingOf(raw)) continue;
      const line = plainLine(raw.replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1"));
      if (!line) continue;
      if (!fallback) { fallback = line; fallbackAt = at; }
      const lowered = lowerText(line);
      if (terms.some((term) => lowered.includes(term))) { if (!picked.length) pickedAt = at; picked.push(line); }
    }
    const text = (picked.length ? picked.join(" … ") : fallback).replace(/\s+/g, " ");
    return { text: redactSecrets(text.length > 220 ? `${text.slice(0, 219)}…` : text).text, line: picked.length ? pickedAt : fallbackAt };
  }

  /** 조각 안에서 그 소제목의 절이 시작하는 줄. 짧은 절 여럿이 한 조각으로 묶였을 때 맞는 절을 가리키게 한다. */
  private sectionLine(lines: string[], start: number, end: number, heading: string): number {
    const name = heading.split(" > ").pop();
    if (!name) return start;
    for (let at = Math.max(1, start); at <= Math.min(lines.length, end); at++) if (headingOf(lines[at - 1]!)?.[1] === name) return at;
    return start;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const view = await this.view(), now = this.deps.now();
    const model = await this.active();
    const { filters } = request;
    const under = (doc: Doc, folderId: string) => { for (let id = doc.note.parentId, guard = 0; id && guard < 1000; id = view.items.get(id)?.parentId ?? null, guard++) if (id === folderId) return true; return false; };
    const allowed = (doc: Doc) => (!filters.project || (doc.meta?.project ?? "").toLocaleLowerCase("ko-KR") === filters.project.toLocaleLowerCase("ko-KR"))
      && (!filters.docType || filters.docType.includes(doc.meta?.docType ?? "memo"))
      && (!filters.docStatus || (doc.meta?.docStatus != null && filters.docStatus.includes(doc.meta.docStatus)))
      && (!filters.folderId || under(doc, filters.folderId));

    const lexical: Map<string, LexicalHit> = request.mode === "semantic" ? new Map() : lexicalRank(this.lexical(view), request.query);
    const semantic = new Map<string, { score: number; rows: Array<{ row: ChunkRow; score: number }> }>();
    let fallbackReason: FallbackReason | undefined;
    if (request.mode !== "keyword") {
      let vector: Float32Array | null = null;
      if (!model) fallbackReason = "no_index";
      else if (request.queryVector !== undefined) {
        if (request.modelKey !== model.key) fallbackReason = "model_mismatch";
        else if (!(vector = decodeVector(request.queryVector, model.dimensions))) throw new RelayError("INVALID_ARGUMENT", "queryVector가 올바르지 않습니다.");
      } else if (this.deps.embedQuery) {
        const result = await this.deps.embedQuery(request.query, model);
        if (result instanceof Float32Array) vector = result; else fallbackReason = result.failed;
      } else fallbackReason = "embedder_offline";
      if (vector && model) {
        const rows = (await this.chunkRows(model.key)).filter((row) => row.index >= 0 && row.vector.length === vector!.length && view.docs.has(row.noteId));
        if (!rows.length) fallbackReason = "no_index";
        else {
          const scores = rows.map((row) => dot(vector!, row.vector));
          // 관련 없는 질의에 억지 결과를 내지 않는다: 모델마다 잰 바닥값과, 이 질의의 배경 유사도(아래쪽 80%)보다 뚜렷이 높은 값만 남긴다.
          // 전체 평균으로 재면 가장 잘 맞은 조각이 기준을 끌어올려 그다음으로 맞은 메모까지 잘린다(실측).
          const noise = rows.length >= 8 ? background(scores) : null;
          const floor = Math.max(model.floor, noise ? noise.mean + 3 * noise.deviation : -1);
          rows.forEach((row, at) => {
            if (scores[at]! < floor) return;
            const entry = semantic.get(row.noteId) ?? { score: 0, rows: [] };
            entry.rows.push({ row, score: scores[at]! }); semantic.set(row.noteId, entry);
          });
          // 같은 메모의 절이 여럿 맞아도 가장 가까운 절이 점수를 정하고, 나머지는 조금만 보탠다(긴 메모가 유리해지지 않게).
          for (const entry of semantic.values()) {
            entry.rows.sort((a, b) => b.score - a.score);
            entry.score = entry.rows[0]!.score + 0.15 * (entry.rows[1]?.score ?? 0) + 0.05 * (entry.rows[2]?.score ?? 0);
          }
        }
      }
    }
    // 의미 검색만 달라고 했는데 할 수 없으면 낱말로 답한다(빈 결과보다 낫다).
    const usable = fallbackReason !== undefined && request.mode === "semantic" ? lexicalRank(this.lexical(view), request.query) : lexical;
    const statusWeight = (status: DocStatus | null | undefined) => (filters.includeHistory ? 1 : status === "adopted" ? ADOPTED_WEIGHT : status === "superseded" ? SUPERSEDED_WEIGHT : 1);
    const rank = (entries: Array<[string, number]>) => new Map(entries.filter(([id]) => allowed(view.docs.get(id)!))
      .map(([id, score]): [string, number] => [id, score * statusWeight(view.docs.get(id)!.meta?.docStatus)])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id], at) => [id, at + 1]));
    const keywordRank = rank([...usable].filter(([, hit]) => hit.score >= (semantic.size ? 0.12 : 0.02)).map(([id, hit]) => [id, hit.score]));
    const semanticRank = rank([...semantic].map(([id, hit]) => [id, hit.score]));
    const keywordWeight = exactIntent(request.query) ? 1.4 : 1;
    const best = (keywordRank.size ? keywordWeight : 0) / (RRF_K + 1) + (semanticRank.size ? 1 : 0) / (RRF_K + 1);
    const states = model ? new Map((await this.port.states(model.key)).map((state) => [state.noteId, state])) : new Map<string, IndexState>();
    const terms = (() => { const { words, raw } = queryTerms(request.query); return [...new Set([...words, ...raw])]; })();
    const ranked = [...new Set([...keywordRank.keys(), ...semanticRank.keys()])].map((id) => {
      const doc = view.docs.get(id)!;
      const fused = (keywordRank.has(id) ? keywordWeight / (RRF_K + keywordRank.get(id)!) : 0) + (semanticRank.has(id) ? 1 / (RRF_K + semanticRank.get(id)!) : 0);
      return { doc, score: Math.min(1, fused / (best || 1)) };
    }).sort((a, b) => b.score - a.score || b.doc.note.updatedAt - a.doc.note.updatedAt || (a.doc.note.id < b.doc.note.id ? -1 : 1));

    const items = ranked.slice(0, request.limit).map(({ doc, score }): SearchItem => {
      const id = doc.note.id, lines = doc.note.body.split("\n"), state = states.get(id);
      const stale = semantic.has(id) && this.stateOf(doc, state, now) !== "ready";
      const matches: SearchMatch[] = [];
      for (const { row, score: similarity } of semantic.get(id)?.rows.slice(0, 2) ?? []) {
        let start = row.lineStart, end = row.lineEnd, heading = row.headingPath;
        if (stale) {
          // 색인 뒤에 본문이 바뀌었다: 옛 줄 번호를 믿지 않고, 같은 소제목의 절을 지금 본문에서 다시 찾는다. 없으면 이 절은 보이지 않는다.
          const current = this.plan(view, doc).find((chunk) => chunk.headingPath === row.headingPath);
          if (!current) continue;
          start = current.lineStart; end = current.lineEnd; heading = current.headingPath;
        }
        start = this.sectionLine(lines, start, end, heading);
        if (matches.some((match) => match.lineStart === start)) continue;
        // 짧은 절 여럿이 한 조각이면, 보이는 줄이 든 절의 소제목을 적는다.
        const seen = this.shown(lines, start, end, terms);
        matches.push({ headingPath: headingAt(doc.note.body, seen.line) || heading, lineStart: start, lineEnd: end, snippet: seen.text, score: Math.round(similarity * 1000) / 1000 });
      }
      if (matches.length < 2 && usable.has(id)) {
        // 낱말이 든 줄을 보탠다(의미로 맞은 절과 겹치지 않는 것만).
        for (let at = 1; at <= lines.length && matches.length < 2; at++) {
          const lowered = lowerText(lines[at - 1]!);
          if (!terms.some((term) => lowered.includes(term)) || matches.some((match) => at >= match.lineStart && at <= match.lineEnd)) continue;
          const text = this.snippet(lines, at, at, terms);
          if (text) matches.push({ headingPath: headingAt(doc.note.body, at), lineStart: at, lineEnd: at, snippet: text });
        }
      }
      if (!matches.length) { const text = this.snippet(lines, 1, Math.min(lines.length, 12), terms); if (text) matches.push({ headingPath: "", lineStart: 1, lineEnd: 1, snippet: text }); }
      const newer = doc.meta?.docStatus === "superseded" && doc.meta.supersededBy ? view.docs.get(doc.meta.supersededBy) : undefined;
      return { noteId: id, title: labelOf(doc.note), path: doc.path, updatedAt: doc.note.updatedAt, docType: doc.meta?.docType ?? "memo", docStatus: doc.meta?.docStatus ?? null,
        project: doc.meta?.project ?? "", ...(newer ? { supersededBy: { id: newer.note.id, title: labelOf(newer.note), status: newer.meta?.docStatus ?? null } } : {}),
        score: Math.round(score * 1000) / 1000,
        scores: { ...(usable.has(id) ? { keyword: Math.round(usable.get(id)!.score * 1000) / 1000 } : {}), ...(semantic.has(id) ? { semantic: Math.round(semantic.get(id)!.score * 1000) / 1000 } : {}) },
        terms: usable.get(id)?.terms ?? [], staleIndex: stale, matches };
    });
    const searchMode = request.mode === "keyword" ? "keyword" : fallbackReason !== undefined ? "lexical_fallback" : request.mode;
    return { schemaVersion: 1, query: request.query, searchMode, ...(searchMode === "lexical_fallback" ? { fallbackReason } : {}), modelKey: model?.key ?? null, total: ranked.length, items };
  }

  // ── 의미 연결 ────────────────────────────────────────────

  /** 그래프에 그릴 의미 연결. 방향을 합쳐 쌍마다 하나만, 사용자가 거절한 쌍은 뺀다. */
  async links(): Promise<LinksResponse> {
    const model = await this.active();
    if (!model) return { schemaVersion: 1, modelKey: null, items: [] };
    const view = await this.view();
    const dismissed = new Set((await this.port.dismissals()).map((pair) => `${pair.a}\n${pair.b}`));
    const pairs = new Map<string, LinkItem>();
    for (const link of await this.port.links(model.key)) {
      if (!view.docs.has(link.source) || !view.docs.has(link.target)) continue;
      const forward = link.source < link.target;
      const item: LinkItem = forward
        ? { a: link.source, b: link.target, score: link.score, strength: link.strength, aHeading: link.sourceHeading, aLines: [link.sourceStart, link.sourceEnd], bHeading: link.targetHeading, bLines: [link.targetStart, link.targetEnd] }
        : { a: link.target, b: link.source, score: link.score, strength: link.strength, aHeading: link.targetHeading, aLines: [link.targetStart, link.targetEnd], bHeading: link.sourceHeading, bLines: [link.sourceStart, link.sourceEnd] };
      const key = `${item.a}\n${item.b}`;
      if (dismissed.has(key)) continue;
      const existing = pairs.get(key);
      if (!existing || item.strength > existing.strength) pairs.set(key, item);
    }
    const items = [...pairs.values()].map((item) => ({ ...item, score: Math.round(item.score * 1000) / 1000, strength: Math.round(item.strength * 1000) / 1000 }))
      .sort((x, y) => y.strength - x.strength || y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1));
    return { schemaVersion: 1, modelKey: model.key, items };
  }

  /** 메모 하나의 연결 제안과 그 근거가 된 두 절의 글. 어느 쪽에서 계산한 연결이든 함께 본다(새 메모가 옛 메모의 제안에 바로 나온다). */
  async suggestions(noteId: string): Promise<{ schemaVersion: 1; noteId: string; items: SuggestionItem[] }> {
    const view = await this.view();
    const self = view.docs.get(noteId) ?? missing("메모");
    const lines = self.note.body.split("\n");
    const items = (await this.links()).items.filter((item) => item.a === noteId || item.b === noteId).map((item): SuggestionItem => {
      const mine = item.a === noteId;
      const other = view.docs.get(mine ? item.b : item.a)!;
      const [ownLines, theirLines] = mine ? [item.aLines, item.bLines] : [item.bLines, item.aLines];
      return { targetNoteId: other.note.id, title: labelOf(other.note), path: other.path, score: item.score, strength: item.strength,
        sourceHeading: mine ? item.aHeading : item.bHeading, targetHeading: mine ? item.bHeading : item.aHeading,
        sourceSnippet: this.snippet(lines, ownLines[0], ownLines[1], []), targetSnippet: this.snippet(other.note.body.split("\n"), theirLines[0], theirLines[1], []) };
    });
    return { schemaVersion: 1, noteId, items };
  }

  async dismiss(a: string, b: string): Promise<{ schemaVersion: 1; dismissed: true }> {
    const view = await this.view();
    if (!view.docs.has(a) || !view.docs.has(b)) missing("메모");
    await this.port.dismiss(a < b ? a : b, a < b ? b : a, this.deps.now());
    return { schemaVersion: 1, dismissed: true };
  }

  // ── 에이전트가 쓰는 의미 카드 ─────────────────────────────

  /** 카드가 없거나 카드를 쓴 뒤에 고쳐진 메모. 에이전트가 읽고 카드를 쓰도록 가린 본문을 함께 준다. 최근에 고친 것부터. */
  async cardsPending(limit: number, maxChars = 6000): Promise<CardsPending> {
    const view = await this.view();
    const waiting = [...view.docs.values()].filter((doc) => !doc.empty && this.cardState(doc) !== "fresh")
      .sort((a, b) => Number(Boolean(a.card)) - Number(Boolean(b.card)) || b.note.updatedAt - a.note.updatedAt || (a.note.id < b.note.id ? -1 : 1));
    return { schemaVersion: 1, total: [...view.docs.values()].filter((doc) => !doc.empty).length, missing: waiting.filter((doc) => !doc.card).length, stale: waiting.filter((doc) => doc.card).length,
      items: waiting.slice(0, limit).map((doc) => {
        const whole = redactSecrets(doc.note.body.replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, (_match, alt: string) => (alt ? `[그림: ${alt}]` : "[그림]")).replace(/\s+$/, "")).text;
        return { noteId: doc.note.id, title: labelOf(doc.note), path: doc.path, contentHash: doc.contentHash, stale: Boolean(doc.card), text: whole.slice(0, maxChars), clipped: whole.length > maxChars };
      }) };
  }

  /** 카드를 저장한다. 없는 메모의 카드, 읽은 뒤에 메모가 바뀐 카드(contentHash가 다름)는 건너뛴다. 카드 글에서도 비밀로 보이는 값은 가린다. */
  async cardsSave(author: string, cards: CardInput[]): Promise<{ schemaVersion: 1; saved: number; skipped: Array<{ noteId: string; reason: "not_found" | "changed" }> }> {
    const view = await this.view(), now = this.deps.now();
    const rows: NoteCard[] = [];
    const skipped: Array<{ noteId: string; reason: "not_found" | "changed" }> = [];
    const clean = (text: string) => redactSecrets(text).text;
    for (const card of cards) {
      const doc = view.docs.get(card.noteId);
      if (!doc || doc.empty) { skipped.push({ noteId: card.noteId, reason: "not_found" }); continue; }
      if (card.contentHash !== undefined && card.contentHash !== doc.contentHash) { skipped.push({ noteId: card.noteId, reason: "changed" }); continue; }
      rows.push({ noteId: card.noteId, contentHash: doc.contentHash, summary: clean(card.summary), terms: card.terms.map(clean), questions: card.questions.map(clean), author, updatedAt: now });
    }
    if (rows.length) { await this.port.saveCards(rows); this.cache.viewKey = undefined; }
    return { schemaVersion: 1, saved: rows.length, skipped };
  }

  // ── 문서 등록과 문서 정보 ─────────────────────────────────

  private metaOf(view: View, noteId: string, now: number): NoteMeta {
    return view.docs.get(noteId)?.meta ?? { noteId, docType: "memo", docStatus: null, project: "", sourceRepo: null, sourcePath: null, sourceCommit: null, supersededBy: null, updatedAt: now };
  }

  /** 대체 관계가 돌아오지 않는지 본다: from을 대신하는 문서를 따라가다 to에 닿으면 안 된다. */
  private chained(view: View, from: string, to: string): boolean {
    const seen = new Set<string>();
    for (let id: string | null | undefined = from; id && !seen.has(id); id = view.docs.get(id)?.meta?.supersededBy) { if (id === to) return true; seen.add(id); }
    return false;
  }

  /** Git 설계서·결정 기록을 메모로 등록하거나 고친다. 같은 (저장소, 경로)를 다시 올리면 같은 메모를 고쳐, 그 메모를 가리키던 링크가 끊기지 않는다. 본문은 받은 그대로 둔다. */
  async register(request: RegisterRequest): Promise<RegisterResponse> {
    const now = this.deps.now();
    let view = await this.view();
    const bySource = request.sourceRepo ? [...view.docs.values()].find((doc) => doc.meta !== null && doc.meta.sourceRepo === request.sourceRepo && doc.meta.sourcePath === request.sourcePath) : undefined;
    const existing = request.noteId !== undefined ? view.docs.get(request.noteId) ?? missing("메모") : bySource;
    if (request.folderId != null && view.items.get(request.folderId)?.kind !== "folder") missing("폴더");
    if (request.supersedes !== undefined && (!view.docs.has(request.supersedes) || request.supersedes === existing?.note.id)) missing("대신할 문서");
    const firstHeading = request.body.split("\n").map((line) => headingOf(line)).find((head) => head?.[0] === 1)?.[1];
    const title = (request.title ?? existing?.note.title ?? firstHeading ?? "제목 없음").slice(0, MAX_NAME);
    const id = existing?.note.id ?? this.deps.id();
    let action: RegisterResponse["action"] = existing ? "unchanged" : "created";
    let revision = view.revision;
    if (!existing || existing.note.title !== title || existing.note.body !== request.body) {
      if (existing) action = "updated";
      revision = (await this.port.apply({ deletes: [], upserts: [{ id, kind: "note", parentId: existing ? existing.note.parentId : request.folderId ?? null, title, body: request.body,
        position: existing?.note.position ?? null, createdAt: existing?.note.createdAt ?? now, updatedAt: now }] })).revision;
    }
    const before = this.metaOf(view, id, now);
    const rows: NoteMeta[] = [{ ...before, docType: request.docType, docStatus: request.docStatus === undefined ? before.docStatus ?? (request.docType === "design" || request.docType === "decision" ? "draft" : null) : request.docStatus,
      project: request.project ?? before.project, sourceRepo: request.sourceRepo ?? before.sourceRepo, sourcePath: request.sourcePath ?? before.sourcePath,
      sourceCommit: request.sourceCommit ?? before.sourceCommit, updatedAt: now }];
    if (request.supersedes !== undefined) {
      // 새 문서가 옛 문서를 대신한다. 옛 문서가 (여러 단계를 거쳐) 이미 새 문서를 대신하고 있으면 돌고 도는 관계가 되므로 받지 않는다.
      if (this.chained(view, id, request.supersedes)) throw new RelayError("INVALID_ARGUMENT", "대체 관계가 돌고 돕니다. 서로를 대신하는 문서는 만들 수 없습니다.");
      rows.push({ ...this.metaOf(view, request.supersedes, now), docStatus: "superseded", supersededBy: id, updatedAt: now });
    }
    await this.port.saveMeta(rows);
    this.cache.viewKey = undefined;
    view = await this.view();
    return { schemaVersion: 1, action, noteId: id, revision, contentHash: view.docs.get(id)?.contentHash ?? "", ...(request.supersedes !== undefined ? { superseded: request.supersedes } : {}) };
  }

  /** 이미 있는 메모의 문서 유형·상태·프로젝트·대체 관계를 고친다. 본문은 건드리지 않는다. */
  async setMeta(request: MetaRequest): Promise<{ schemaVersion: 1; meta: NoteMeta }> {
    const view = await this.view(), now = this.deps.now();
    if (!view.docs.has(request.noteId)) missing("메모");
    if (request.supersededBy != null) {
      if (!view.docs.has(request.supersededBy) || request.supersededBy === request.noteId) missing("대신하는 문서");
      if (this.chained(view, request.supersededBy, request.noteId)) throw new RelayError("INVALID_ARGUMENT", "대체 관계가 돌고 돕니다. 서로를 대신하는 문서는 만들 수 없습니다.");
    }
    const before = this.metaOf(view, request.noteId, now);
    const meta: NoteMeta = { ...before, ...(request.docType ? { docType: request.docType } : {}), ...(request.docStatus !== undefined ? { docStatus: request.docStatus } : {}),
      ...(request.project !== undefined ? { project: request.project } : {}), ...(request.supersededBy !== undefined ? { supersededBy: request.supersededBy } : {}), updatedAt: now };
    if (request.supersededBy != null && request.docStatus === undefined) meta.docStatus = "superseded";
    await this.port.saveMeta([meta]);
    this.cache.viewKey = undefined;
    return { schemaVersion: 1, meta };
  }

  async metaList(): Promise<{ schemaVersion: 1; items: NoteMeta[] }> {
    const view = await this.view();
    return { schemaVersion: 1, items: [...view.docs.values()].flatMap((doc) => (doc.meta ? [doc.meta] : [])) };
  }
}
