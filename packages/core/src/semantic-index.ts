import { RelayError } from "./errors.js";
import { MAX_NAME, labelOf, plainLine, type NoteItem } from "./notes.js";
import { CHUNK_VERSION, MAX_CHUNKS, chunkInput, chunkNote, headingAt, headingOf, type Chunk, type ChunkContext, type DocStatus } from "./chunk.js";
import { redactSecrets } from "./redact.js";
import { exactIntent, lexicalIndex, lexicalRank, lowerText, queryTerms, tagsOf, type LexicalHit, type LexicalIndex } from "./text.js";
import { decodeVector, dot } from "./vector.js";
import { FLOOR_MIN_CHUNKS, floorFrom } from "./embedding.js";
import {
  INDEX_DEBOUNCE_MS, LEASE_MS, MAX_ATTEMPTS, MAX_LEASE_TEXTS, PROBE_INDEX, RETRY_AFTER_MS, WORKER_ONLINE_MS, modelKey, sameEmbedding,
  type CardInput, type CardsPending, type ChunkRow, type CommitRequest, type CommitResponse, type EmbeddingModel, type FailRequest, type FallbackReason,
  type IndexPort, type IndexState, type IndexStatus, type IndexSummary, type LeaseJob, type LeaseRequest, type LeaseResponse, type LinkItem, type LinksResponse,
  type CardShown, type MetaRequest, type NoteCard, type NoteMeta, type ProbeRequest, type ProbeResponse, type RegisterRequest, type RegisterResponse, type ReindexRequest,
  type SearchItem, type SearchMatch, type SearchRequest, type SearchResponse, type SemanticLink, type SuggestionItem,
} from "./semantic.js";

// 메모 의미 검색 엔진. 저장은 IndexPort에 맡기고 계산은 모두 여기서 한다(로컬 서버·원격 서버·CLI가 같은 코드를 돈다).
//  - 색인할 일은 따로 쌓아 두지 않는다. 「지금 메모의 입력 해시」와 「색인된 입력 해시」가 다른 메모가 곧 대기 목록이다.
//    벡터가 메모와 같은 DB에 있어 지운 메모는 함께 지워지고, 문서 유형·상태는 검색할 때 붙이므로 따로 맞출 것이 없다.
//  - 조각 나누기와 가리기는 서버가 한다. 워커는 받은 글을 벡터로 바꿔 돌려줄 뿐이라, 가리지 않은 본문이 임베딩 서버로 가지 않는다.
//  - 검색은 낱말(BM25 + 에이전트가 쓴 의미 카드)과 의미(조각 벡터) 두 점수를 무게를 두어 더한다. 질의 벡터가 없으면 낱말 점수만으로 바로 답한다.

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
/** 합친 점수 = 의미의 몫 × (유사도 ÷ 그 질의의 1위 유사도) + 낱말의 몫 × 낱말 점수(1위가 1).
 *  순위만 보는 RRF로 합쳤더니 의미 검색만 쓴 것보다 나빴다(질의 50개, 메모 557개에서 MRR 0.781 대 점수 합 0.884): 자연어 질의의 낱말 순위는
 *  흔한 말이 든 긴 문서로 흐려지는데 순위만 보면 그 차이가 지워지고, 문장을 그대로 물으면 강한 낱말 증거가 묽어진다.
 *  경로·오류 코드처럼 글자 그대로를 찾는 질의와, 질의가 글에 구절째 들어 있는 경우는 낱말 쪽을 더 믿는다. */
const SEMANTIC_SHARE = 0.7, SEMANTIC_SHARE_EXACT = 0.4;
/** 문서 상태에 따라 합친 점수에 곱하는 값. 채택한 문서는 비슷하게 맞은 문서를 앞지를 만큼만 올린다: 위쪽 결과들의 점수 차이가 3~15%라
 *  1.15를 곱하면 순서가 통째로 뒤집혔다(질의 50개 가운데 26개의 위 셋이 바뀌고 MRR이 0.03 떨어졌다). 대체된 문서는 크게 깎아 새 문서 뒤에 둔다. */
const ADOPTED_WEIGHT = 1.03, SUPERSEDED_WEIGHT = 0.6;
/** 의미 목록에는 1위 유사도의 이 배수를 넘는 메모만 남긴다(바닥값을 겨우 넘은 메모가 길게 따라 나오지 않게). */
const RELATIVE_CUT = 0.6;
/** 낱말로만 걸린 글은 질의의 낱말을 (드문 낱말을 무겁게 쳐서) 이만큼 담아야 남긴다. 흔한 말 하나만 걸린 글이 결과를 채우지 않게 한다.
 *  뜻으로도 맞은 글(의미 목록에 든 글)은 이미 관련이 확인됐으므로 낱말 점수를 그대로 보탠다. 뜻으로 맞은 글이 하나도 없을 때
 *  (의미 검색을 하지 못했거나, 했는데 바닥값을 넘은 글이 없을 때)는 조금 느슨하게 본다: 뜻이 닿는데도 유사도가 바닥값에 못 미치는 답이 있어서,
 *  그때 0.5를 요구하면 낱말만으로 찾던 글까지 잃는다. */
const COVERAGE_ALONE = 0.5, COVERAGE_LEXICAL = 0.3;
/** 의미 검색을 하지 못했을 때는 포함율이 낮아도 낱말 점수가 가장 높은 이만큼은 남긴다(weak 표시와 함께).
 *  한국어 질의의 활용형(「움직이게」「줄이려고」)은 색인에 없는 낱말이라 무게가 가장 커서, 자연어로 물으면 맞는 글도 포함율이 0.1~0.3에 그친다.
 *  낱말만으로는 그런 글과 흔한 말 하나만 걸린 글을 가를 수 없으므로 위의 몇 개를 표시해 보이고 고르게 한다
 *  (Relay 문서 범위의 낱말 검색: 0.3으로만 거르면 MRR 0.78 → 0.73, 위 셋을 남기면 0.77. 답이 없는 질의는 열 건 대신 세 건 이하를 받는다). */
const KEEP_LEXICAL = 3;
/** 지금 일하는 저장소의 프로젝트 문서에 곱하는 값. 프로젝트마다 같은 종류의 문서(작업 지침·서버 구축·디자인 기준)가 있어,
 *  전체에서 찾으면 다른 프로젝트의 문서가 앞섰다. 좁히지 않고 올리기만 하므로 훨씬 잘 맞은 다른 프로젝트 문서는 그대로 앞에 남는다. */
const PREFERRED_WEIGHT = 1.25;
/** 의미 연결: 두 메모의 유사도가 「그 메모가 자기 자신과 맞는 정도」의 이 비율을 넘어야 잇는다. 절댓값 대신 비율을 쓰는 까닭은
 *  의미 카드가 있고 없음, 모델에 따라 유사도의 크기가 달라서다. 사람이 판정한 37쌍에서 납득되는 쌍은 0.54 이상, 약한 쌍은 0.52 이하였다.
 *  세기는 이 비율이 LINK_RATIO일 때 0.1, LINK_FULL일 때 1이다(앞서는 모든 연결의 세기가 1로 포화했다). */
const LINK_RATIO = 0.53, LINK_FULL = 0.85;
const LINKS_PER_NOTE = 6;
const PROBE_CHARS = 300;
const missing = (what: string): never => { throw new RelayError("NOTE_NOT_FOUND", `${what}을(를) 찾을 수 없습니다.`, 3, 404); };

type Closest = { score: number; rows: Array<{ row: ChunkRow; score: number }> };
/** 질의 벡터에 메모마다 가장 가까운 절 셋과 메모 점수. 같은 메모의 절이 여럿 맞아도 가장 가까운 절이 점수를 정하고, 나머지는 조금만 보탠다
 *  (1 : 0.15 : 0.05. 긴 메모가 절의 수만으로 유리해지지 않게). */
function closest(vector: Float32Array, rows: ChunkRow[]): Map<string, Closest> {
  const out = new Map<string, Closest>();
  for (const row of rows) {
    const score = dot(vector, row.vector);
    let entry = out.get(row.noteId);
    if (!entry) { entry = { score: 0, rows: [] }; out.set(row.noteId, entry); }
    if (entry.rows.length < 3) entry.rows.push({ row, score });
    else if (score > entry.rows[2]!.score) entry.rows[2] = { row, score };
    else continue;
    entry.rows.sort((a, b) => b.score - a.score);
  }
  for (const entry of out.values()) entry.score = entry.rows[0]!.score + 0.15 * (entry.rows[1]?.score ?? 0) + 0.05 * (entry.rows[2]?.score ?? 0);
  return out;
}

/** 글의 offset 글자 뒤에 나오는 소제목들(코드 울타리 안은 뺀다). 긴 메모의 카드를 쓸 때 보이지 않는 뒷부분을 알리는 데 쓴다. */
function outlineAfter(text: string, offset: number, limit = 40): string[] {
  const out: string[] = [];
  let at = 0, fence = false;
  for (const line of text.split("\n")) {
    const start = at;
    at += line.length + 1;
    if (/^\s{0,3}(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || start < offset) continue;
    const head = headingOf(line);
    if (head && head[0] <= 3) { out.push(`${"#".repeat(head[0])} ${head[1]}`.slice(0, 80)); if (out.length >= limit) break; }
  }
  return out;
}

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
      rows.push({ key: model.key, name: model.name, dimensions: model.dimensions, active: model.active, floor: model.floor, ...this.summary(view, own, now) });
    }
    const cards = { total: 0, fresh: 0, stale: 0, missing: 0 };
    for (const doc of view.docs.values()) { if (doc.empty) continue; cards.total++; cards[this.cardState(doc)]++; }
    const summary = active ? this.summary(view, states, now) : { total: cards.total, ready: 0, pending: cards.total, failed: 0 };
    const workerAt = this.cache.workerAt ?? null;
    // 조각 상한을 꽉 채운 메모는 뒤가 색인되지 않은 것으로 본다(상한에 딱 맞게 끝난 메모는 드물다).
    const cut = (state: IndexState | undefined) => state?.status === "ready" && state.chunkCount >= MAX_CHUNKS;
    const status: IndexStatus = { schemaVersion: 1, activeModelKey: active?.key ?? null, models: rows, embedderOnline: workerAt !== null && now - workerAt < WORKER_ONLINE_MS,
      lastWorkerAt: workerAt, summary, cards, truncated: [...states.values()].filter((state) => view.docs.has(state.noteId) && cut(state)).length };
    if (noteId !== undefined) {
      const doc = view.docs.get(noteId) ?? missing("메모");
      const state = states.get(noteId);
      const value = doc.empty ? "ready" : this.stateOf(doc, state, now);
      status.items = [{ noteId, status: value === "working" ? "pending" : value, chunks: state?.status === "ready" ? state.chunkCount : 0,
        indexedAt: state?.status === "ready" ? state.updatedAt : null, error: state?.status === "failed" ? state.error : null, card: this.cardState(doc), truncated: Boolean(cut(state)) }];
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
    if (!model) {
      // 바닥값은 모델을 처음 만들 때만 워커의 값(자가 진단)으로 둔다. 그 뒤에는 색인으로 잰 값(probe)이 정한다:
      // 임대할 때마다 워커의 값으로 덮어쓰면, PC가 둘일 때 서로의 값을 번갈아 되돌린다.
      model = { key, name: request.model.name, dimensions: request.model.dimensions, prompt: request.model.prompt, chunkVersion: CHUNK_VERSION,
        floor: request.model.floor, active: !models.some((item) => item.active), createdAt: now };
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
   *  이 메모의 질의 벡터 → 다른 메모의 절, 다른 메모의 질의 벡터 → 이 메모의 절. 각 방향의 유사도를 「질의 벡터가 제 메모와 맞는 정도」로 나눈
   *  비율이 LINK_RATIO를 넘으면 잇고, 가장 가까웠던 절을 근거로 남긴다(좁은 문서가 넓은 문서를 가리키는 한 방향 관계도 잇는다).
   *  두 방향을 모두 보므로 새 메모가 들어오면 옛 메모를 다시 색인하지 않아도 그 쌍이 생긴다. */
  private async nearest(model: EmbeddingModel, view: View, noteId: string, rows: ChunkRow[]): Promise<SemanticLink[]> {
    const probe = rows.find((row) => row.index === PROBE_INDEX), own = rows.filter((row) => row.index >= 0);
    if (!probe || !own.length) return [];
    const all = (await this.chunkRows(model.key)).filter((row) => row.noteId !== noteId && view.docs.has(row.noteId) && row.vector.length === probe.vector.length);
    const probes = new Map<string, Float32Array>();
    for (const row of all) if (row.index === PROBE_INDEX) probes.set(row.noteId, row.vector);
    const self = own.reduce((best, row) => Math.max(best, dot(probe.vector, row.vector)), 0);
    const forward = new Map<string, { score: number; row: ChunkRow }>(), backward = new Map<string, { score: number; row: ChunkRow }>(), opening = new Map<string, ChunkRow>();
    /** 다른 메모의 질의 벡터가 제 메모의 절과 맞는 정도(가장 가까운 절). */
    const selves = new Map<string, number>();
    for (const row of all) {
      if (row.index === PROBE_INDEX) {
        for (const mine of own) { const score = dot(row.vector, mine.vector); if (score > (backward.get(row.noteId)?.score ?? -Infinity)) backward.set(row.noteId, { score, row: mine }); }
        continue;
      }
      if (row.index === 0) opening.set(row.noteId, row);
      const score = dot(probe.vector, row.vector);
      if (score > (forward.get(row.noteId)?.score ?? -Infinity)) forward.set(row.noteId, { score, row });
      const theirs = probes.get(row.noteId);
      if (theirs) { const fit = dot(theirs, row.vector); if (fit > (selves.get(row.noteId) ?? 0)) selves.set(row.noteId, fit); }
    }
    // 유사도 자체가 모델의 바닥값에도 못 미치면 비율이 높아도 잇지 않는다(질의 벡터가 제 메모와도 잘 맞지 않는 빈약한 메모).
    const base = Math.max(model.floor, 0.05);
    const links: Array<SemanticLink & { ratio: number }> = [];
    for (const id of new Set([...forward.keys(), ...backward.keys()])) {
      const out = forward.get(id), back = backward.get(id);
      const score = Math.max(out?.score ?? -1, back?.score ?? -1);
      const ratio = Math.max(out && self > 0 ? out.score / self : 0, back && (selves.get(id) ?? 0) > 0 ? back.score / selves.get(id)! : 0);
      if (ratio < LINK_RATIO || score < base) continue;
      const target = out?.row ?? opening.get(id);
      if (!target) continue;
      // 근거로 보일 이쪽 절: 저쪽의 질의 벡터에 가장 가까운 절, 없으면 저쪽의 그 절과 가장 닮은 절.
      const source = back?.row ?? own.reduce((best, row) => (dot(row.vector, target.vector) > dot(best.vector, target.vector) ? row : best));
      links.push({ source: noteId, target: id, score, ratio, strength: Math.max(0.1, Math.min(1, 0.1 + 0.9 * (ratio - LINK_RATIO) / (LINK_FULL - LINK_RATIO))),
        sourceHeading: source.headingPath, sourceStart: source.lineStart, sourceEnd: source.lineEnd, targetHeading: target.headingPath, targetStart: target.lineStart, targetEnd: target.lineEnd });
    }
    return links.sort((a, b) => b.ratio - a.ratio || b.score - a.score || (a.target < b.target ? -1 : 1)).slice(0, LINKS_PER_NOTE).map(({ ratio: _ratio, ...link }) => link);
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
    /** 메모마다 가장 가까운 절 셋과 메모 점수. 바닥값에 못 미친 메모도 담아 둔다(낱말로 걸린 결과에 「관련이 낮을 수 있음」을 붙이려고). */
    let similar = new Map<string, Closest>();
    let fallbackReason: FallbackReason | undefined;
    let searched = false;
    if (request.mode !== "keyword") {
      let vector: Float32Array | null = null;
      if (!model) fallbackReason = "no_index";
      else if (request.queryVector !== undefined) {
        if (request.modelKey === undefined || !sameEmbedding(request.modelKey, model.key)) fallbackReason = "model_mismatch";
        else if (!(vector = decodeVector(request.queryVector, model.dimensions))) throw new RelayError("INVALID_ARGUMENT", "queryVector가 올바르지 않습니다.");
      } else if (this.deps.embedQuery) {
        const result = await this.deps.embedQuery(request.query, model);
        if (result instanceof Float32Array) vector = result; else fallbackReason = result.failed;
      } else fallbackReason = "embedder_offline";
      if (vector && model) {
        const rows = (await this.chunkRows(model.key)).filter((row) => row.index >= 0 && row.vector.length === vector!.length && view.docs.has(row.noteId));
        if (!rows.length) fallbackReason = "no_index";
        else { similar = closest(vector, rows); searched = true; }
      }
    }
    // 의미 검색만 달라고 했는데 할 수 없으면 낱말로 답한다(빈 결과보다 낫다).
    const usable = fallbackReason !== undefined && request.mode === "semantic" ? lexicalRank(this.lexical(view), request.query) : lexical;
    // 의미: 모델의 바닥값(답이 없을 질의로 잰 「관련 없음」의 높이)과 1위의 RELATIVE_CUT배 가운데 큰 값을 넘는 메모만 남긴다.
    let semanticTop = 0;
    for (const [id, near] of similar) if (allowed(view.docs.get(id)!)) semanticTop = Math.max(semanticTop, near.score);
    const floor = model ? Math.max(model.floor, semanticTop * RELATIVE_CUT) : Infinity;
    const semantic = new Map<string, Closest>();
    for (const [id, near] of similar) if (near.score >= floor && allowed(view.docs.get(id)!)) semantic.set(id, near);
    // 낱말: 질의의 낱말을 충분히 담지 못한 글은 뺀다(뜻으로도 맞은 글과 질의가 구절째 든 글은 남긴다). 남은 것 가운데 가장 높은 점수를 1로 다시 맞춘다.
    // 뜻으로 맞은 글이 있으면 낱말로만 걸린 글에 더 많이 요구하고, 의미 검색을 하지 못했으면 낱말 점수가 가장 높은 몇 개는 포함율과 상관없이 남긴다.
    const keyword = new Map<string, LexicalHit>();
    const gate = semantic.size ? COVERAGE_ALONE : COVERAGE_LEXICAL;
    const candidates = [...usable].filter(([id]) => { const doc = view.docs.get(id); return doc !== undefined && allowed(doc); })
      .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1));
    candidates.forEach(([id, hit], at) => { if (hit.phrase || semantic.has(id) || hit.coverage >= gate || (!searched && at < KEEP_LEXICAL)) keyword.set(id, hit); });
    let keywordTop = 0;
    for (const hit of keyword.values()) keywordTop = Math.max(keywordTop, hit.score);
    const literal = exactIntent(request.query) || [...keyword.values()].some((hit) => hit.phrase);
    const share = !semantic.size ? 0 : !keyword.size ? 1 : literal ? SEMANTIC_SHARE_EXACT : SEMANTIC_SHARE;
    const statusWeight = (status: DocStatus | null | undefined) => (filters.includeHistory ? 1 : status === "adopted" ? ADOPTED_WEIGHT : status === "superseded" ? SUPERSEDED_WEIGHT : 1);
    // 지금 일하는 저장소에서 등록한 문서의 프로젝트(여럿일 수 있다). 그 프로젝트의 문서를 앞에 둔다.
    const preferred = new Map<string, string>();
    if (filters.sourceRepo && !filters.project) {
      const repo = filters.sourceRepo.toLocaleLowerCase("ko-KR");
      for (const doc of view.docs.values()) if (doc.meta?.project && doc.meta.sourceRepo?.toLocaleLowerCase("ko-KR") === repo) preferred.set(doc.meta.project.toLocaleLowerCase("ko-KR"), doc.meta.project);
    }
    const states = model ? new Map((await this.port.states(model.key)).map((state) => [state.noteId, state])) : new Map<string, IndexState>();
    const terms = (() => { const { words, raw } = queryTerms(request.query); return [...new Set([...words, ...raw])]; })();
    const ranked = [...new Set([...keyword.keys(), ...semantic.keys()])].map((id) => {
      const doc = view.docs.get(id)!, hit = keyword.get(id), near = similar.get(id);
      const word = hit && keywordTop > 0 ? hit.score / keywordTop : 0;
      const meaning = near && semanticTop > 0 ? Math.max(0, near.score) / semanticTop : 0;
      const fused = (share * meaning + (1 - share) * word) * statusWeight(doc.meta?.docStatus) * (preferred.has((doc.meta?.project ?? "").toLocaleLowerCase("ko-KR")) ? PREFERRED_WEIGHT : 1);
      // 질의가 구절째 든 글은 그 글을 찾는 것이므로 맨 앞에 둔다(그런 글끼리는 합친 점수로 줄 세운다).
      // 관련이 낮을 수 있는 결과: 뜻으로는 바닥값에 못 미쳤는데 낱말로 걸린 글, 의미 검색 없이 질의의 낱말을 절반도 담지 못한 글.
      const weak = !hit?.phrase && (searched ? near !== undefined && !semantic.has(id) : hit !== undefined && hit.coverage < COVERAGE_ALONE);
      return { doc, order: fused + (hit?.phrase ? 1 : 0), score: hit?.phrase ? 1 : Math.min(1, fused), weak };
    }).sort((a, b) => b.order - a.order || b.doc.note.updatedAt - a.doc.note.updatedAt || (a.doc.note.id < b.doc.note.id ? -1 : 1));

    const items = ranked.slice(0, request.limit).map(({ doc, score, weak }): SearchItem => {
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
      if (matches.length < 2 && keyword.has(id)) {
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
        scores: { ...(keyword.has(id) ? { keyword: Math.round(keyword.get(id)!.score / (keywordTop || 1) * 1000) / 1000 } : {}), ...(semantic.has(id) ? { semantic: Math.round(semantic.get(id)!.score * 1000) / 1000 } : {}) },
        terms: keyword.get(id)?.terms ?? [], ...(weak ? { weak: true as const } : {}), staleIndex: stale, matches };
    });
    const searchMode = request.mode === "keyword" ? "keyword" : fallbackReason !== undefined ? "lexical_fallback" : request.mode;
    return { schemaVersion: 1, query: request.query, searchMode, ...(searchMode === "lexical_fallback" ? { fallbackReason } : {}), modelKey: model?.key ?? null, total: ranked.length, items,
      ...(preferred.size ? { preferredProjects: [...preferred.values()].sort() } : {}) };
  }

  /** 질의 벡터마다 지금 색인에서 가장 가까운 메모의 점수. 답이 없을 질의들을 넣어 「관련 없음」이 얼마나 높이 나오는지 잰다.
   *  apply를 주면 그 값으로 모델의 검색 바닥값을 정해 남긴다(조각이 FLOOR_MIN_CHUNKS개 이상일 때. 거의 같은 값이면 고쳐 쓰지 않는다).
   *  바닥값은 색인에 하나만 둔다: 어느 PC가 재든 모든 PC의 검색이 같은 값을 쓴다. */
  async probe(request: ProbeRequest): Promise<ProbeResponse> {
    const model = (await this.port.models()).find((item) => item.key === request.modelKey) ?? missing("모델");
    const view = await this.view();
    const rows = (await this.chunkRows(model.key)).filter((row) => row.index >= 0 && row.vector.length === model.dimensions && view.docs.has(row.noteId));
    const tops = request.vectors.map((data) => {
      const vector = decodeVector(data, model.dimensions);
      if (!vector) throw new RelayError("INVALID_ARGUMENT", `벡터가 올바르지 않습니다(길이 1인 ${model.dimensions}차원 float32여야 합니다).`);
      let top = 0;
      for (const near of closest(vector, rows).values()) top = Math.max(top, near.score);
      return Math.round(top * 1000) / 1000;
    });
    let floor: number | undefined;
    if (request.apply && rows.length >= FLOOR_MIN_CHUNKS) {
      floor = floorFrom(tops, request.diagnosed ?? 0);
      if (Math.abs(floor - model.floor) > 0.004) await this.port.saveModel({ ...model, floor }); else floor = model.floor;
    }
    return { schemaVersion: 1, modelKey: model.key, tops, chunks: rows.length, ...(floor !== undefined ? { floor } : {}) };
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
        const clipped = whole.length > maxChars;
        // 잘린 뒤에 무엇이 있는지 소제목으로 알린다(앞 6,000자만 보고 쓴 카드는 뒷부분의 내용을 담지 못한다).
        const outline = clipped ? outlineAfter(whole, maxChars) : [];
        return { noteId: doc.note.id, title: labelOf(doc.note), path: doc.path, contentHash: doc.contentHash, stale: Boolean(doc.card), text: whole.slice(0, maxChars), clipped,
          ...(outline.length ? { outline } : {}) };
      }) };
  }

  /** 메모 하나에 저장된 카드. 카드를 쓴 뒤 메모가 바뀌었으면 stale이다. */
  async card(noteId: string): Promise<CardShown> {
    const view = await this.view();
    const doc = view.docs.get(noteId) ?? missing("메모");
    return { schemaVersion: 1, noteId, title: labelOf(doc.note), path: doc.path, state: this.cardState(doc),
      card: doc.card ? { summary: doc.card.summary, terms: doc.card.terms, questions: doc.card.questions, author: doc.card.author, updatedAt: doc.card.updatedAt } : null };
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
    // 새 문서가 옛 문서를 대신한다. 옛 문서가 (여러 단계를 거쳐) 이미 새 문서를 대신하고 있으면 돌고 도는 관계가 되므로 받지 않는다.
    // 본문을 쓰기 전에 본다: 쓴 뒤에 거절하면 거절한 요청의 본문이 메모에 남는다.
    if (request.supersedes !== undefined && this.chained(view, id, request.supersedes)) throw new RelayError("INVALID_ARGUMENT", "대체 관계가 돌고 돕니다. 서로를 대신하는 문서는 만들 수 없습니다.");
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
