import { RelayError } from "./errors.js";
import type { FallbackReason } from "./semantic.js";
import { dot, fit } from "./vector.js";

// 임베딩 모델을 부르는 한 가지 길. llama.cpp의 llama-server, Ollama, LM Studio, OpenAI·Gemini·Voyage 같은 서비스가 모두 받는
// OpenAI 호환 `POST /v1/embeddings`와 Ollama의 `POST /api/embed` 두 모양을 지원한다. 검색 코드는 Embedder만 알면 되므로
// 모델이나 실행 방식을 바꿔도 설정만 고치면 된다.

/** 모델이 요구하는 입력 머리말. 질의와 문서에 다른 머리말을 붙여야 제 성능이 나오는 모델이 많고, 서버가 대신 붙여 주지 않는다. */
export const EMBEDDING_PROMPTS = {
  /** KURE-v3, Nemotron-3-Embed, E5 계열. */
  e5: { query: "query: ", passage: "passage: " },
  /** EmbeddingGemma. */
  gemma: { query: "task: search result | query: ", passage: "title: none | text: " },
  /** 머리말이 없는 모델(OpenAI text-embedding-3, Voyage, Cohere 등). */
  plain: { query: "", passage: "" },
} as const;
export type EmbeddingPrompt = keyof typeof EMBEDDING_PROMPTS;

export type EmbeddingConfig = {
  /** 임베딩 서버 주소. 로컬 서버는 `http://127.0.0.1:<포트>`만 받는다. */
  url: string;
  /** 요청 모양: openai(`/v1/embeddings`) | ollama(`/api/embed`). */
  style: "openai" | "ollama";
  /** 서버에 보내는 모델 이름. */
  model: string;
  /** 색인에 적는 모델 이름(없으면 model). 같은 모델을 다른 서버로 옮겨도 색인을 그대로 쓰게 한다. */
  name?: string;
  /** 저장할 차원. 모델이 더 긴 벡터를 주면 앞에서부터 이만큼만 쓰고 길이를 다시 맞춘다(Matryoshka). */
  dimensions: number;
  prompt: EmbeddingPrompt;
  apiKey?: string;
  /** 한 번에 보내는 글 수(기본 16). */
  batch?: number;
  /** Ollama에 넘기는 컨텍스트 길이(기본 8192). 모델 기본값이 아주 크면 VRAM이 모자라 뜨지 않는다. */
  contextTokens?: number;
  /** 자가 진단에서 잰 유사도 바닥값. */
  floor?: number;
  /** 서버가 꺼져 있으면 이 명령으로 띄운다(로컬 서버). idleMinutes 동안 쓰지 않으면 끈다. */
  launch?: string[];
  idleMinutes?: number;
  /** relay web이 떠 있는 동안 색인 워커를 함께 돌린다(기본 true). */
  auto?: boolean;
};

export const embeddingModelName = (config: Pick<EmbeddingConfig, "model" | "name">) => (config.name ?? config.model).replace(/[^A-Za-z0-9._:/-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 80) || "model";

/** 임베딩 설정(이 PC의 embedding.json)을 검사한다. 틀리면 INVALID_CONFIG. */
export function parseEmbeddingConfig(raw: unknown, options: { /** 서버 환경 변수로 준 주소: 사설망·컨테이너 안의 http 주소도 받는다. */ privateNetwork?: boolean } = {}): EmbeddingConfig {
  const fail = (message: string): never => { throw new RelayError("INVALID_CONFIG", `embedding.json: ${message}`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("객체여야 합니다.");
  const value = raw as Record<string, unknown>;
  const known = ["url", "style", "model", "name", "dimensions", "prompt", "apiKey", "batch", "contextTokens", "floor", "launch", "idleMinutes", "auto"];
  for (const key of Object.keys(value)) if (!known.includes(key)) fail(`모르는 항목 ${key}`);
  const text = (key: string, max: number, required = true) => {
    const item = value[key];
    if (item === undefined || item === null) return required ? fail(`${key}이(가) 필요합니다.`) : undefined;
    if (typeof item !== "string" || !item.trim() || item.length > max || /[\r\n]/.test(item)) return fail(`${key}은(는) ${max}자 이하의 한 줄 문자열이어야 합니다.`);
    return item.trim();
  };
  const count = (key: string, fallback: number | undefined, min: number, max: number) => {
    const item = value[key];
    if (item === undefined || item === null) return fallback;
    if (typeof item !== "number" || !Number.isInteger(item) || item < min || item > max) return fail(`${key}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
    return item;
  };
  let url: URL;
  try { url = new URL(text("url", 300)!); } catch { return fail("url 형식을 확인하세요."); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && (local || options.privateNetwork === true)))) {
    fail("url은 https 주소이거나 이 컴퓨터(http://127.0.0.1)여야 하고, 인증 정보나 query를 넣지 않습니다.");
  }
  const style = value.style === undefined ? "openai" : value.style;
  if (style !== "openai" && style !== "ollama") fail("style은 openai 또는 ollama입니다.");
  const prompt = value.prompt === undefined ? "plain" : value.prompt;
  if (typeof prompt !== "string" || !(prompt in EMBEDDING_PROMPTS)) fail(`prompt는 ${Object.keys(EMBEDDING_PROMPTS).join(" | ")} 중 하나입니다.`);
  if (value.floor !== undefined && (typeof value.floor !== "number" || !(value.floor >= -1 && value.floor <= 1))) fail("floor는 -1~1 사이의 수여야 합니다.");
  if (value.auto !== undefined && typeof value.auto !== "boolean") fail("auto는 true 또는 false입니다.");
  let launch: string[] | undefined;
  if (value.launch !== undefined && value.launch !== null) {
    if (!local) fail("launch는 이 컴퓨터의 서버(http://127.0.0.1)에만 씁니다.");
    if (!Array.isArray(value.launch) || !value.launch.length || value.launch.length > 60 || value.launch.some((item) => typeof item !== "string" || !item || item.length > 1000)) {
      fail("launch는 실행 파일과 인자를 차례로 적은 문자열 배열이어야 합니다.");
    }
    launch = value.launch as string[];
  }
  const name = text("name", 80, false), apiKey = text("apiKey", 500, false), batch = count("batch", undefined, 1, 128);
  const contextTokens = count("contextTokens", undefined, 256, 131072), idleMinutes = count("idleMinutes", undefined, 0, 1440);
  return {
    url: url.origin + url.pathname.replace(/\/+$/, ""), style: style as EmbeddingConfig["style"], model: text("model", 200)!, ...(name ? { name } : {}),
    dimensions: count("dimensions", undefined, 16, 4096) ?? fail("dimensions가 필요합니다."), prompt: prompt as EmbeddingPrompt,
    ...(apiKey ? { apiKey } : {}), ...(batch ? { batch } : {}), ...(contextTokens ? { contextTokens } : {}),
    ...(typeof value.floor === "number" ? { floor: value.floor } : {}), ...(launch ? { launch } : {}), ...(idleMinutes !== undefined ? { idleMinutes } : {}),
    ...(value.auto === false ? { auto: false } : {}),
  };
}

export type EmbedFailure = "offline" | "timeout" | "bad_response" | "dimension" | "rejected";
export class EmbeddingError extends RelayError {
  constructor(public reason: EmbedFailure, message: string) { super("EMBEDDING_FAILED", message, 5, 502, { reason }); this.name = "EmbeddingError"; }
}

/** 임베딩 서버를 부른다. 머리말을 붙이고, 받은 벡터를 정한 차원으로 줄여 길이를 1로 맞춘다. 차원이 모자라거나 0-벡터·NaN이 오면 받지 않는다. */
export class Embedder {
  constructor(readonly config: EmbeddingConfig, private send: typeof fetch = fetch) {}

  get batch() { return this.config.batch ?? 16; }

  async embed(texts: string[], kind: "query" | "passage", timeoutMs = 60_000): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const prefix = EMBEDDING_PROMPTS[this.config.prompt][kind];
    const input = texts.map((text) => prefix + text);
    const ollama = this.config.style === "ollama";
    const body = ollama ? { model: this.config.model, input, truncate: true, options: { num_ctx: this.config.contextTokens ?? 8192 } } : { model: this.config.model, input, encoding_format: "float" };
    let response: Response;
    try {
      // 주소가 이미 임베딩 경로면 그대로 쓴다(경로가 다른 OpenAI 호환 서비스: `…/v1beta/openai/embeddings` 등).
      const endpoint = /\/embed(?:dings)?$/.test(this.config.url) ? this.config.url : `${this.config.url}${ollama ? "/api/embed" : "/v1/embeddings"}`;
      response = await this.send(endpoint, { method: "POST", signal: AbortSignal.timeout(timeoutMs), redirect: "error",
        headers: { "Content-Type": "application/json", ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) }, body: JSON.stringify(body) });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError") throw new EmbeddingError("timeout", "임베딩 서버가 제때 답하지 않았습니다.");
      throw new EmbeddingError("offline", "임베딩 서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인하세요.");
    }
    if (!response.ok) {
      // 서버의 오류 글은 길고 내부 경로가 섞일 수 있어 상태 코드만 알린다.
      await response.body?.cancel().catch(() => {});
      throw new EmbeddingError(response.status >= 500 ? "bad_response" : "rejected", `임베딩 서버가 요청을 받지 않았습니다(HTTP ${response.status}). 모델 이름과 서버 설정을 확인하세요.`);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new EmbeddingError("bad_response", "임베딩 서버의 응답을 읽지 못했습니다."); }
    const rows = ollama ? (data as { embeddings?: unknown }).embeddings
      : Array.isArray((data as { data?: unknown }).data) ? [...(data as { data: Array<{ index?: number; embedding?: unknown }> }).data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((row) => row.embedding) : undefined;
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new EmbeddingError("bad_response", "임베딩 서버가 보낸 벡터 수가 요청한 글 수와 다릅니다.");
    return rows.map((row) => {
      if (!Array.isArray(row) || row.length < this.config.dimensions) throw new EmbeddingError("dimension", `모델이 ${this.config.dimensions}차원보다 짧은 벡터를 보냈습니다. dimensions 설정을 확인하세요.`);
      const vector = fit(row as number[], this.config.dimensions);
      if (!vector) throw new EmbeddingError("bad_response", "임베딩 서버가 쓸 수 없는 벡터(0-벡터 또는 NaN)를 보냈습니다.");
      return vector;
    });
  }

  /** 여러 글을 batch씩 나누어 임베딩한다. between은 묶음 사이에 부른다(검색 질의에 차례를 내주려 잠깐 쉴 때). */
  async embedAll(texts: string[], kind: "query" | "passage", between?: () => Promise<void>): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let at = 0; at < texts.length; at += this.batch) {
      if (at && between) await between();
      out.push(...await this.embed(texts.slice(at, at + this.batch), kind));
    }
    return out;
  }
}

/** 검색 질의를 임베딩한다. 같은 질의는 잠시 기억하고, 서버가 답하지 않으면 한동안 부르지 않아 검색이 매번 기다리지 않게 한다. */
export class QueryEmbedder {
  private cache = new Map<string, { at: number; vector: Float32Array }>();
  private failures = 0;
  private openUntil = 0;
  private running = 0;
  constructor(private embedder: Pick<Embedder, "embed">, private options: { ttlMs?: number; max?: number; timeoutMs?: number; failures?: number; cooldownMs?: number; concurrent?: number; now?: () => number } = {}) {}

  /** 서버가 다시 답하는 것을 확인했을 때 부른다. 쉬는 시간을 기다리지 않고 바로 다시 부르게 한다. */
  reset() { this.failures = 0; this.openUntil = 0; }

  /** 서킷이 열려 있는가(연달아 실패해 잠시 부르지 않는 중). */
  get open() { return (this.options.now ?? Date.now)() < this.openUntil; }

  async embed(query: string): Promise<Float32Array | { failed: FallbackReason }> {
    const now = (this.options.now ?? Date.now)();
    const key = query.normalize("NFC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (this.options.ttlMs ?? 30 * 60_000)) { this.cache.delete(key); this.cache.set(key, hit); return hit.vector; }
    if (now < this.openUntil) return { failed: "embedder_offline" };
    if (this.running >= (this.options.concurrent ?? 2)) return { failed: "embedding_overloaded" };
    this.running++;
    try {
      const [vector] = await this.embedder.embed([query], "query", this.options.timeoutMs ?? 2000);
      this.failures = 0;
      this.cache.set(key, { at: now, vector: vector! });
      if (this.cache.size > (this.options.max ?? 500)) this.cache.delete(this.cache.keys().next().value!);
      return vector!;
    } catch (error) {
      const reason = error instanceof EmbeddingError ? error.reason : "bad_response";
      if (++this.failures >= (this.options.failures ?? 2)) this.openUntil = now + (this.options.cooldownMs ?? 45_000);
      return { failed: reason === "timeout" ? "embedding_timeout" : reason === "offline" ? "embedder_offline" : "embedding_unavailable" };
    } finally { this.running--; }
  }
}

// ── 자가 진단 ─────────────────────────────────────────────
// 모델과 실행 프로그램의 짝이 맞지 않으면(풀링·주의 방향·머리말이 어긋나면) 벡터는 나오지만 뜻을 담지 못한다. 오류가 나지 않으므로
// 직접 재 본다: 같은 뜻의 질의와 글(한국어끼리, 영어 질의와 한국어 글)이 다른 주제의 글보다 가까운지.

const PROBE_PASSAGES = [
  "PC가 절전에서 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다. 실패한 작업은 간격을 늘려 가며 다시 시도한다.",
  "이미지를 빌드해 레지스트리에 올리고, 서버에서 새 이미지를 받아 컨테이너를 다시 띄운 뒤 상태를 확인한다.",
  "돼지고기와 묵은지를 볶다가 물을 붓고 두부와 파를 넣어 한소끔 끓인다.",
  "로그인 화면에서 재설정 링크를 메일로 받아 새 암호를 정한다. 링크는 한 시간 뒤에 만료된다.",
  "매달 말일에 지출 내역을 모아 항목별로 나누고, 예산을 넘긴 항목은 다음 달 계획에서 줄인다.",
  "회의는 안건을 먼저 공유하고, 끝나기 전에 결정한 일과 맡은 사람, 기한을 적어 남긴다.",
];
const PROBE_QUERIES: Array<[query: string, passage: number]> = [
  ["절전 복귀 후 동기화가 늦다", 0], ["resume from sleep sync delay", 0],
  ["서버 배포 순서", 1], ["how to deploy the server", 1],
  ["김치찌개 끓이는 법", 2], ["비밀번호를 잊어버렸을 때", 3], ["forgot my password", 3],
  ["가계부 정리 방법", 4], ["회의록에 무엇을 남기나", 5], ["meeting notes action items", 5],
];
export type EmbeddingDiagnosis = {
  ok: boolean; passed: number; total: number;
  /** 맞는 글과 가장 가까운 틀린 글의 유사도 차이(평균). */ margin: number;
  /** 맞는 글·틀린 글의 평균 유사도. */ positive: number; negative: number;
  /** 검색에서 관련 없다고 볼 유사도 바닥값(틀린 글의 평균 + 표준편차). */ floor: number;
  dimensions: number; milliseconds: number;
};

export async function diagnoseEmbedder(embedder: Pick<Embedder, "embed">, now: () => number = Date.now): Promise<EmbeddingDiagnosis> {
  const started = now();
  const passages = await embedder.embed(PROBE_PASSAGES, "passage");
  const queries = await embedder.embed(PROBE_QUERIES.map(([query]) => query), "query");
  let passed = 0, margin = 0, positive = 0;
  const negatives: number[] = [];
  PROBE_QUERIES.forEach(([, target], at) => {
    const scores = passages.map((passage) => dot(queries[at]!, passage));
    const others = scores.filter((_score, index) => index !== target);
    negatives.push(...others);
    positive += scores[target]!;
    margin += scores[target]! - Math.max(...others);
    if (scores[target]! > Math.max(...others)) passed++;
  });
  const total = PROBE_QUERIES.length;
  const negative = negatives.reduce((sum, value) => sum + value, 0) / negatives.length;
  const deviation = Math.sqrt(negatives.reduce((sum, value) => sum + (value - negative) ** 2, 0) / negatives.length);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { ok: passed >= total - 1 && margin / total >= 0.05, passed, total, margin: round(margin / total), positive: round(positive / total), negative: round(negative),
    floor: round(Math.max(0, negative + deviation)), dimensions: queries[0]!.length, milliseconds: now() - started };
}
