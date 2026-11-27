import { RelayError } from "./errors.js";
import { MAX_BODY, MAX_NAME, noteId as checkId, type NoteBatch, type NoteItem } from "./notes.js";
import { CHUNK_VERSION, DOC_STATUSES, DOC_TYPES, type DocStatus, type DocType } from "./chunk.js";

// 메모 의미 검색의 자료 모양과 API 계약. 로컬 서버(Bun/SQLite)와 원격 서버(NestJS/PostgreSQL)가 같은 엔진(semantic-index.ts)을 돌리고,
// 저장만 IndexPort로 각자 맡는다. 색인(조각·벡터·의미 연결)은 메모에서 다시 만들 수 있는 파생 자료이고, 문서 유형·상태와 사용자가 거절한 제안은 원본 자료다.

/** 문서 유형·상태·출처. 원본 본문에 머리말(frontmatter)을 끼워 넣지 않고 메모 옆에 따로 둔다. */
export type NoteMeta = {
  noteId: string; docType: DocType; docStatus: DocStatus | null; project: string;
  /** Git에서 등록한 문서의 출처. 같은 (sourceRepo, sourcePath)를 다시 등록하면 같은 메모를 고친다. */
  sourceRepo: string | null; sourcePath: string | null; sourceCommit: string | null;
  /** 이 문서를 대신하는 새 문서의 ID. */
  supersededBy: string | null; updatedAt: number;
};
/** 에이전트가 메모를 읽고 쓴 의미 카드: 한 줄 요약, 본문에 없는 같은 뜻의 말(동의어·영문·줄임말), 이 메모가 답하는 질문.
 *  낱말 검색에 무겁게 색인되고 요약은 임베딩 조각의 머리말에 들어간다. contentHash는 카드를 쓸 때 본 메모의 내용 해시다. */
export type NoteCard = { noteId: string; contentHash: string; summary: string; terms: string[]; questions: string[]; author: string; updatedAt: number };
/** 임베딩 모델 하나. key에 모델 이름·차원·입력 형식·조각 규칙 판이 들어 있어, 어느 하나가 바뀌면 다른 모델로 본다. */
export type EmbeddingModel = { key: string; name: string; dimensions: number; prompt: string; chunkVersion: number;
  /** 질의와 조각의 유사도가 이보다 낮으면 관련 없다고 본다(자가 진단에서 잰 값). */ floor: number; active: boolean; createdAt: number };
/** 메모 하나의 색인 상태. inputHash는 색인을 마친 입력의 해시이고, 지금 메모의 입력 해시와 다르면 다시 색인해야 한다. */
export type IndexState = {
  noteId: string; inputHash: string; contentHash: string; chunkCount: number; status: "ready" | "failed" | "pending";
  error: string | null; attempts: number; retryAt: number; leaseToken: string | null; leaseUntil: number; updatedAt: number;
};
/** index가 PROBE_INDEX인 줄은 조각이 아니라 그 메모의 「질의 벡터」다: 제목·요약·첫머리를 질의로 임베딩한 것으로, 이 메모와 뜻이 가까운 다른 메모의 절을 찾는 데 쓴다. */
export const PROBE_INDEX = -1;
export type ChunkRow = { noteId: string; index: number; headingPath: string; lineStart: number; lineEnd: number; charStart: number; charEnd: number;
  hash: string; tokens: number; vector: Float32Array };
/** 미리 계산해 둔 의미 연결. score는 한 메모의 질의 벡터와 다른 메모의 가장 가까운 절 사이의 코사인 유사도(두 방향 가운데 큰 쪽), strength는 그것을 0..1로 옮긴 세기다. */
export type SemanticLink = { source: string; target: string; score: number; strength: number;
  sourceHeading: string; sourceStart: number; sourceEnd: number; targetHeading: string; targetStart: number; targetEnd: number };

/** 사용자 한 명의 저장소. 엔진은 이 인터페이스만 보고, SQLite와 PostgreSQL이 각각 구현한다. */
export interface IndexPort {
  /** 메모 저장 번호. 메모를 다시 읽을지 정하는 데만 쓰므로 가볍게 답한다. */
  revision(): Promise<number>;
  notes(): Promise<{ revision: number; items: NoteItem[] }>;
  apply(batch: NoteBatch): Promise<{ revision: number }>;
  /** 바뀌면 달라지는 값. docs는 문서 메타·카드, index는 색인·거절 기록이 바뀔 때 달라진다(캐시를 버릴 때를 안다). */
  stamps(): Promise<{ docs: string; index: string }>;
  meta(): Promise<NoteMeta[]>;
  saveMeta(rows: NoteMeta[]): Promise<void>;
  cards(): Promise<NoteCard[]>;
  saveCards(rows: NoteCard[]): Promise<void>;
  models(): Promise<EmbeddingModel[]>;
  saveModel(model: EmbeddingModel): Promise<void>;
  /** key를 검색에 쓰는 모델로 삼고 다른 모델의 색인을 지운다. */
  activate(key: string): Promise<void>;
  states(modelKey: string): Promise<IndexState[]>;
  saveStates(modelKey: string, rows: IndexState[]): Promise<void>;
  /** 색인 상태와 조각을 지워 다시 색인하게 한다. noteIds가 null이면 그 모델의 전부. */
  drop(modelKey: string, noteIds: string[] | null): Promise<void>;
  /** 조각과 질의 벡터(index가 PROBE_INDEX인 줄). */
  chunks(modelKey: string, noteIds?: string[]): Promise<ChunkRow[]>;
  /** 조각·상태·의미 연결을 한 번에 바꾼다. leaseToken이 있으면 그 임대를 쥔 경우에만 쓰고, 아니면 false를 돌려준다. */
  commit(modelKey: string, input: { state: IndexState; leaseToken: string | null; chunks: ChunkRow[]; links: SemanticLink[] }): Promise<boolean>;
  links(modelKey: string): Promise<SemanticLink[]>;
  dismissals(): Promise<Array<{ a: string; b: string }>>;
  dismiss(a: string, b: string, at: number): Promise<void>;
}

// ── API 계약 ───────────────────────────────────────────────

export type SearchMode = "hybrid" | "keyword" | "semantic";
/** 의미 검색을 하지 못해 낱말 검색으로 답한 까닭. */
export type FallbackReason = "no_index" | "embedder_offline" | "embedding_timeout" | "embedding_overloaded" | "embedding_unavailable" | "model_mismatch";
export type SearchFilters = { project?: string; docType?: DocType[]; docStatus?: DocStatus[]; folderId?: string; includeHistory?: boolean;
  /** 지금 일하는 Git 저장소의 이름. 그 저장소에서 등록한 문서의 프로젝트를 앞에 둔다(좁히지는 않는다). project를 주면 쓰지 않는다. */
  sourceRepo?: string };
export type SearchRequest = { query: string; mode: SearchMode; filters: SearchFilters; limit: number;
  /** 질의 벡터(float32 base64). 임베딩 서버가 있는 PC의 CLI·로컬 서버가 계산해 싣는다. modelKey는 그 벡터를 만든 모델이다. */
  queryVector?: string; modelKey?: string };
export type SearchMatch = { headingPath: string; lineStart: number; lineEnd: number; snippet: string; /** 의미로 맞은 절이면 그 유사도 */ score?: number };
export type SearchItem = {
  noteId: string; title: string; path: string; updatedAt: number; docType: DocType; docStatus: DocStatus | null; project: string;
  supersededBy?: { id: string; title: string; status: DocStatus | null };
  /** 0..1 (합친 점수) */ score: number; scores: { keyword?: number; semantic?: number }; terms: string[];
  /** 낱말로는 걸렸지만 뜻으로는 바닥값에 못 미쳤다(관련이 낮을 수 있다). */ weak?: true;
  /** 색인 뒤에 메모가 바뀌었다(위치는 지금 본문에서 다시 찾은 것이다). */ staleIndex: boolean; matches: SearchMatch[];
};
export type SearchResponse = { schemaVersion: 1; query: string; searchMode: SearchMode | "lexical_fallback"; fallbackReason?: FallbackReason;
  modelKey: string | null; total: number; items: SearchItem[];
  /** filters.sourceRepo로 앞에 둔 프로젝트들(그 저장소에서 등록한 문서가 있을 때만). */ preferredProjects?: string[] };
/** 질의 벡터마다 지금 색인에서 가장 가까운 메모의 점수를 묻는다. 답이 없을 질의를 넣어 「관련 없음」의 높이를 재는 데 쓴다. */
/** apply: 잰 값으로 그 모델의 검색 바닥값을 정해 색인에 남긴다(diagnosed는 자가 진단의 바닥값. 그보다 내려가지 않는다). */
export type ProbeRequest = { modelKey: string; vectors: string[]; apply?: boolean; diagnosed?: number };
/** floor: apply로 정한(또는 거의 같아 그대로 둔) 검색 바닥값. 색인이 작아 재지 않았으면 없다. */
export type ProbeResponse = { schemaVersion: 1; modelKey: string; tops: number[]; chunks: number; floor?: number };
export type CardShown = { schemaVersion: 1; noteId: string; title: string; path: string; state: "fresh" | "stale" | "missing";
  card: { summary: string; terms: string[]; questions: string[]; author: string; updatedAt: number } | null };

export type IndexSummary = { total: number; ready: number; pending: number; failed: number };
export type IndexStatus = {
  schemaVersion: 1; activeModelKey: string | null; models: Array<Pick<EmbeddingModel, "key" | "name" | "dimensions" | "active" | "floor"> & IndexSummary>;
  /** 최근에 색인 워커가 다녀갔는가. */ embedderOnline: boolean; lastWorkerAt: number | null;
  summary: IndexSummary; cards: { total: number; fresh: number; stale: number; missing: number };
  /** 조각 상한에 걸려 뒤가 색인되지 않은 메모 수. */ truncated: number;
  items?: Array<{ noteId: string; status: "ready" | "pending" | "failed"; chunks: number; indexedAt: number | null; error: string | null; card: "fresh" | "stale" | "missing"; truncated: boolean }>;
};
export type LeaseRequest = { workerId: string; model: { name: string; dimensions: number; prompt: string; floor: number }; limit: number };
export type LeaseJob = { noteId: string; leaseToken: string; inputHash: string;
  /** 새로 임베딩할 글만(벡터가 이미 있는 것은 서버가 다시 쓴다). query가 true인 글은 문서가 아니라 질의로 임베딩한다(메모의 질의 벡터). */
  texts: Array<{ hash: string; text: string; query?: true }>; chunks: number };
export type LeaseResponse = { schemaVersion: 1; modelKey: string; active: boolean; jobs: LeaseJob[]; /** 이번에 주지 않고 남은 메모 수 */ remaining: number; leaseMs: number };
export type CommitRequest = { modelKey: string; noteId: string; leaseToken: string; inputHash: string; vectors: Array<{ hash: string; data: string }> };
export type CommitResponse = { schemaVersion: 1; committed: boolean; staleSkipped?: boolean; reused?: number; embedded?: number; activated?: boolean };
export type FailRequest = { modelKey: string; noteId: string; leaseToken: string; error: string; retryable: boolean };
export type ReindexRequest = { scope: "failed" | "note" | "all"; noteId?: string };
export type LinkItem = { a: string; b: string; score: number; strength: number; aHeading: string; aLines: [number, number]; bHeading: string; bLines: [number, number] };
export type LinksResponse = { schemaVersion: 1; modelKey: string | null; items: LinkItem[] };
export type SuggestionItem = { targetNoteId: string; title: string; path: string; score: number; strength: number;
  sourceHeading: string; targetHeading: string; sourceSnippet: string; targetSnippet: string };
export type CardInput = { noteId: string; contentHash?: string; summary: string; terms: string[]; questions: string[] };
export type CardsPending = { schemaVersion: 1; total: number; missing: number; stale: number;
  items: Array<{ noteId: string; title: string; path: string; contentHash: string; stale: boolean; text: string; clipped: boolean;
    /** 본문이 길어 잘렸을 때, 보이지 않는 뒷부분의 소제목들. */ outline?: string[] }> };
export type RegisterRequest = {
  noteId?: string; title?: string; body: string; docType: DocType; docStatus?: DocStatus | null; project?: string;
  sourceRepo?: string; sourcePath?: string; sourceCommit?: string; supersedes?: string; folderId?: string | null;
};
export type RegisterResponse = { schemaVersion: 1; action: "created" | "updated" | "unchanged"; noteId: string; revision: number; contentHash: string; superseded?: string };
export type MetaRequest = { noteId: string; docType?: DocType; docStatus?: DocStatus | null; project?: string; supersededBy?: string | null };

export const SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_QUERY = 500;
export const MAX_LEASE = 32;
/** 바닥값을 잴 때 한 번에 보내는 질의 벡터의 상한. */
export const MAX_PROBES = 32;
/** 임대 한 번에 내려 주는 조각 글의 상한(워커 한 묶음이 너무 커지지 않게). */
export const MAX_LEASE_TEXTS = 96;
export const LEASE_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RETRY_AFTER_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** 방금 고친 메모는 잠깐 두었다가 색인한다(글자를 칠 때마다 저장되므로). */
export const INDEX_DEBOUNCE_MS = 3000;
/** 워커가 이 시간 안에 다녀갔으면 임베딩 PC가 켜져 있다고 본다. */
export const WORKER_ONLINE_MS = 90_000;

export const modelKey = (name: string, dimensions: number, prompt: string, chunkVersion = CHUNK_VERSION) => `${name}@${dimensions}/${prompt}/c${chunkVersion}`;
/** 두 모델 키가 같은 임베딩(이름·차원·머리말)을 가리키는가. 조각 규칙의 판(`/c2`)은 글을 나누는 방법일 뿐 질의 벡터와는 무관하다:
 *  조각 규칙이 바뀌어 뒤에서 다시 색인하는 동안에도(새 판의 PC가 옛 판의 색인을, 옛 판의 PC가 새 판의 색인을) 뜻으로 찾을 수 있어야 한다. */
export const sameEmbedding = (a: string, b: string) => a.replace(/\/c\d+$/, "") === b.replace(/\/c\d+$/, "");

const bad = (message: string): never => { throw new RelayError("INVALID_ARGUMENT", message); };
const object = (raw: unknown, what: string) => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : bad(`${what}은(는) 객체여야 합니다.`));
const only = (value: Record<string, unknown>, keys: string[], what: string) => { for (const key of Object.keys(value)) if (!keys.includes(key)) bad(`${what}: 모르는 항목 ${key}`); };
const str = (value: unknown, field: string, max: number, min = 0) => {
  if (typeof value !== "string") return bad(`${field}은(는) 문자열이어야 합니다.`);
  if (value.length > max) return bad(`${field}이(가) 너무 깁니다(최대 ${max}자).`);
  if (value.trim().length < min) return bad(`${field}을(를) 입력하세요.`);
  return value;
};
const optional = (value: unknown, field: string, max: number) => (value === undefined || value === null ? undefined : str(value, field, max));
const whole = (value: unknown, field: string, fallback: number, min: number, max: number) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return bad(`${field}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
  return value;
};
const oneOf = <T extends string>(value: unknown, list: readonly T[], field: string): T => (list.includes(value as T) ? value as T : bad(`${field}: ${list.join(" | ")} 중 하나여야 합니다.`));
const listOf = <T extends string>(value: unknown, list: readonly T[], field: string): T[] | undefined => {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : [value];
  return items.length ? [...new Set(items.map((item) => oneOf(item, list, field)))] : undefined;
};
const HASH = /^[0-9a-f]{64}$/;
const hash = (value: unknown, field: string) => (typeof value === "string" && HASH.test(value) ? value : bad(`${field}이(가) 올바르지 않습니다.`));
const TOKEN = /^[A-Za-z0-9_-]{8,100}$/;

export function parseSearch(raw: unknown): SearchRequest {
  const value = object(raw, "검색 요청");
  only(value, ["query", "mode", "filters", "limit", "queryVector", "modelKey"], "검색 요청");
  const filters = value.filters === undefined || value.filters === null ? {} : object(value.filters, "filters");
  only(filters, ["project", "docType", "docStatus", "folderId", "includeHistory", "sourceRepo"], "filters");
  const repo = optional(filters.sourceRepo, "filters.sourceRepo", 300)?.trim();
  if (repo && /[\s\\]/.test(repo)) bad("filters.sourceRepo는 빈칸과 역슬래시 없는 이름이어야 합니다.");
  if (filters.includeHistory !== undefined && typeof filters.includeHistory !== "boolean") bad("filters.includeHistory는 true 또는 false여야 합니다.");
  const project = optional(filters.project, "filters.project", 200)?.trim();
  const docType = listOf(filters.docType, DOC_TYPES, "filters.docType"), docStatus = listOf(filters.docStatus, DOC_STATUSES, "filters.docStatus");
  const vector = optional(value.queryVector, "queryVector", 40_000), key = optional(value.modelKey, "modelKey", 200);
  if ((vector === undefined) !== (key === undefined)) bad("queryVector와 modelKey는 함께 보냅니다.");
  return {
    query: str(value.query, "query", MAX_QUERY, 1).replace(/\s+/g, " ").trim(),
    mode: value.mode === undefined ? "hybrid" : oneOf(value.mode, ["hybrid", "keyword", "semantic"] as const, "mode"),
    filters: { ...(project ? { project } : {}), ...(docType ? { docType } : {}), ...(docStatus ? { docStatus } : {}),
      ...(filters.folderId === undefined || filters.folderId === null ? {} : { folderId: checkId(filters.folderId, "filters.folderId") }),
      ...(filters.includeHistory === true ? { includeHistory: true } : {}), ...(repo ? { sourceRepo: repo } : {}) },
    limit: whole(value.limit, "limit", SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT),
    ...(vector !== undefined ? { queryVector: vector, modelKey: key! } : {}),
  };
}

export function parseProbe(raw: unknown): ProbeRequest {
  const value = object(raw, "바닥값 재기");
  only(value, ["modelKey", "vectors", "apply", "diagnosed"], "바닥값 재기");
  if (!Array.isArray(value.vectors) || !value.vectors.length || value.vectors.length > MAX_PROBES) bad(`vectors는 1~${MAX_PROBES}개의 배열이어야 합니다.`);
  if (value.apply !== undefined && typeof value.apply !== "boolean") bad("apply는 true 또는 false여야 합니다.");
  if (value.diagnosed !== undefined && (typeof value.diagnosed !== "number" || !(value.diagnosed >= -1 && value.diagnosed <= 1))) bad("diagnosed는 -1~1 사이의 수여야 합니다.");
  return { modelKey: str(value.modelKey, "modelKey", 200, 1), vectors: (value.vectors as unknown[]).map((entry, index) => str(entry, `vectors[${index}]`, 40_000, 1)),
    ...(value.apply === true ? { apply: true } : {}), ...(typeof value.diagnosed === "number" ? { diagnosed: value.diagnosed } : {}) };
}

export function parseLease(raw: unknown): LeaseRequest {
  const value = object(raw, "임대 요청");
  only(value, ["workerId", "model", "limit"], "임대 요청");
  const model = object(value.model, "model");
  only(model, ["name", "dimensions", "prompt", "floor"], "model");
  const name = str(model.name, "model.name", 80, 1).trim(), prompt = str(model.prompt, "model.prompt", 40, 1).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prompt)) bad("model.name과 model.prompt는 영문·숫자와 . _ - 만 씁니다(name은 : / 도).");
  const floor = model.floor === undefined || model.floor === null ? 0 : model.floor;
  if (typeof floor !== "number" || !(floor >= -1 && floor <= 1)) bad("model.floor는 -1~1 사이의 수여야 합니다.");
  const workerId = str(value.workerId, "workerId", 100, 1).trim();
  return { workerId, model: { name, dimensions: whole(model.dimensions, "model.dimensions", 0, 16, 4096), prompt, floor: floor as number }, limit: whole(value.limit, "limit", 8, 1, MAX_LEASE) };
}

export function parseCommit(raw: unknown): CommitRequest {
  const value = object(raw, "커밋 요청");
  only(value, ["modelKey", "noteId", "leaseToken", "inputHash", "vectors"], "커밋 요청");
  if (!Array.isArray(value.vectors) || value.vectors.length > 400) bad("vectors는 400개 이하의 배열이어야 합니다.");
  const vectors = (value.vectors as unknown[]).map((entry, index) => {
    const item = object(entry, `vectors[${index}]`);
    return { hash: hash(item.hash, `vectors[${index}].hash`), data: str(item.data, `vectors[${index}].data`, 40_000, 1) };
  });
  const token = str(value.leaseToken, "leaseToken", 100, 1);
  if (!TOKEN.test(token)) bad("leaseToken이 올바르지 않습니다.");
  return { modelKey: str(value.modelKey, "modelKey", 200, 1), noteId: checkId(value.noteId, "noteId"), leaseToken: token, inputHash: hash(value.inputHash, "inputHash"), vectors };
}

export function parseFail(raw: unknown): FailRequest {
  const value = object(raw, "실패 보고");
  only(value, ["modelKey", "noteId", "leaseToken", "error", "retryable"], "실패 보고");
  const token = str(value.leaseToken, "leaseToken", 100, 1);
  if (!TOKEN.test(token)) bad("leaseToken이 올바르지 않습니다.");
  return { modelKey: str(value.modelKey, "modelKey", 200, 1), noteId: checkId(value.noteId, "noteId"), leaseToken: token,
    error: str(value.error ?? "", "error", 300).replace(/\s+/g, " ").trim() || "unknown", retryable: value.retryable !== false };
}

export function parseReindex(raw: unknown): ReindexRequest {
  const value = object(raw, "다시 색인 요청");
  only(value, ["scope", "noteId"], "다시 색인 요청");
  const scope = oneOf(value.scope, ["failed", "note", "all"] as const, "scope");
  if (scope === "note") return { scope, noteId: checkId(value.noteId, "noteId") };
  if (value.noteId !== undefined) bad("noteId는 scope가 note일 때만 보냅니다.");
  return { scope };
}

const words = (value: unknown, field: string, count: number, max: number) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return bad(`${field}은(는) 배열이어야 합니다.`);
  const out: string[] = [];
  for (const entry of value.slice(0, count * 2)) {
    const item = str(entry, field, max * 4).replace(/\s+/g, " ").trim().slice(0, max);
    if (item && !out.some((existing) => existing.toLocaleLowerCase("ko-KR") === item.toLocaleLowerCase("ko-KR"))) out.push(item);
    if (out.length === count) break;
  }
  return out;
};
export const MAX_CARDS = 200;
export function parseCards(raw: unknown): { author: string; cards: CardInput[] } {
  const value = object(raw, "의미 카드 묶음");
  only(value, ["author", "cards"], "의미 카드 묶음");
  if (!Array.isArray(value.cards) || !value.cards.length || value.cards.length > MAX_CARDS) bad(`cards는 1~${MAX_CARDS}개의 배열이어야 합니다.`);
  const cards = (value.cards as unknown[]).map((entry, index) => {
    const item = object(entry, `cards[${index}]`);
    only(item, ["noteId", "contentHash", "summary", "terms", "questions"], `cards[${index}]`);
    return { noteId: checkId(item.noteId, `cards[${index}].noteId`),
      ...(item.contentHash === undefined || item.contentHash === null ? {} : { contentHash: hash(item.contentHash, `cards[${index}].contentHash`) }),
      summary: str(item.summary, `cards[${index}].summary`, 2000, 1).replace(/\s+/g, " ").trim().slice(0, 400),
      terms: words(item.terms, `cards[${index}].terms`, 24, 60), questions: words(item.questions, `cards[${index}].questions`, 8, 200) };
  });
  return { author: (optional(value.author, "author", 200) ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "agent", cards };
}

const docStatus = (value: unknown, field: string) => (value === null ? null : oneOf(value, DOC_STATUSES, field));
const SOURCE = /^[^\s\\]{1,300}$/;
export function parseRegister(raw: unknown): RegisterRequest {
  const value = object(raw, "문서 등록");
  only(value, ["noteId", "title", "body", "docType", "docStatus", "project", "sourceRepo", "sourcePath", "sourceCommit", "supersedes", "folderId"], "문서 등록");
  const repo = optional(value.sourceRepo, "sourceRepo", 300)?.trim(), file = optional(value.sourcePath, "sourcePath", 300)?.trim(), commit = optional(value.sourceCommit, "sourceCommit", 80)?.trim();
  if (Boolean(repo) !== Boolean(file)) bad("sourceRepo와 sourcePath는 함께 보냅니다.");
  if ((repo && !SOURCE.test(repo)) || (file && (!SOURCE.test(file) || file.startsWith("/") || file.split("/").includes("..")))) bad("sourceRepo·sourcePath는 빈칸과 역슬래시 없는 상대 경로여야 합니다.");
  if (commit && !/^[0-9a-f]{7,64}$/i.test(commit)) bad("sourceCommit은 커밋 해시여야 합니다.");
  const title = optional(value.title, "title", MAX_NAME)?.trim();
  return {
    ...(value.noteId === undefined || value.noteId === null ? {} : { noteId: checkId(value.noteId, "noteId") }),
    ...(title ? { title } : {}), body: str(value.body, "body", MAX_BODY),
    docType: value.docType === undefined ? "design" : oneOf(value.docType, DOC_TYPES, "docType"),
    ...(value.docStatus === undefined ? {} : { docStatus: docStatus(value.docStatus, "docStatus") }),
    ...(value.project === undefined || value.project === null ? {} : { project: str(value.project, "project", 200).trim() }),
    ...(repo && file ? { sourceRepo: repo, sourcePath: file } : {}), ...(commit ? { sourceCommit: commit.toLowerCase() } : {}),
    ...(value.supersedes === undefined || value.supersedes === null ? {} : { supersedes: checkId(value.supersedes, "supersedes") }),
    ...(value.folderId === undefined ? {} : { folderId: value.folderId === null ? null : checkId(value.folderId, "folderId") }),
  };
}

export function parseMeta(raw: unknown): MetaRequest {
  const value = object(raw, "문서 정보");
  only(value, ["noteId", "docType", "docStatus", "project", "supersededBy"], "문서 정보");
  return {
    noteId: checkId(value.noteId, "noteId"),
    ...(value.docType === undefined ? {} : { docType: oneOf(value.docType, DOC_TYPES, "docType") }),
    ...(value.docStatus === undefined ? {} : { docStatus: docStatus(value.docStatus, "docStatus") }),
    ...(value.project === undefined || value.project === null ? {} : { project: str(value.project, "project", 200).trim() }),
    ...(value.supersededBy === undefined ? {} : { supersededBy: value.supersededBy === null ? null : checkId(value.supersededBy, "supersededBy") }),
  };
}

export function parseDismiss(raw: unknown): { a: string; b: string } {
  const value = object(raw, "제안 거절");
  only(value, ["a", "b"], "제안 거절");
  const a = checkId(value.a, "a"), b = checkId(value.b, "b");
  if (a === b) bad("서로 다른 두 메모를 보내세요.");
  return a < b ? { a, b } : { a: b, b: a };
}
