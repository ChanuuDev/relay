import { describe, expect, test } from "bun:test";
import { CHUNK_MAX_TOKENS, Embedder, MAX_ATTEMPTS, MAX_CHUNKS, QueryEmbedder, RELEASED, chunkNote, decodeVector, diagnoseEmbedder, dot, encodeVector, estimateTokens, exactIntent, fit,
  lexicalIndex, lexicalRank, modelKey, parseCards, parseCommit, parseEmbeddingConfig, parseLease, parseRegister, parseSearch, queryTerms, unit, type SearchRequest } from "@relay/core";
import { FAKE_DIMS, FAKE_MODEL, engine, fakeEmbedder, fakeVector, indexAll, sha256 } from "./semantic-helpers";

const search = (query: string, extra: Partial<SearchRequest> = {}): SearchRequest => ({ query, mode: "hybrid", filters: {}, limit: 10, ...extra });
const withVector = (query: string, key: string, extra: Partial<SearchRequest> = {}) => search(query, { queryVector: encodeVector(fakeVector(query)), modelKey: key, ...extra });

describe("메모를 절로 나누기", () => {
  test("소제목 경로를 따라 나누고, 코드 울타리 안의 #은 소제목으로 보지 않으며, 줄·글자 위치를 기억한다", () => {
    const filler = (name: string) => Array.from({ length: 8 }, (_unused, at) => `${name} 설계의 ${at + 1}번째 문장으로, 절이 충분히 길어지도록 설명을 덧붙인다.`).join("\n");
    const body = ["# 증분 동기화 설계", "", filler("머리말"), "", "## 누락된 작업 재처리", "", filler("재처리"), "", "```sh", "# 주석이지 소제목이 아니다", "relay sync --all", "```", "",
      "### 백오프", "", filler("백오프"), "", "## 배포", "", filler("배포")].join("\n");
    const { chunks, truncated } = chunkNote(body, { title: "증분 동기화 설계", path: "설계 › 서버", docType: "design", project: "relay" });
    expect(truncated).toBe(false);
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual(["증분 동기화 설계", "증분 동기화 설계 > 누락된 작업 재처리", "증분 동기화 설계 > 누락된 작업 재처리 > 백오프", "증분 동기화 설계 > 배포"]);
    // 머리말: 유형·프로젝트·폴더와 제목 > 절. 제목과 같은 H1은 되풀이하지 않는다.
    expect(chunks[1]!.text.split("\n").slice(0, 2)).toEqual(["[유형: 설계서] [프로젝트: relay] [폴더: 설계 › 서버]", "# 증분 동기화 설계 > 누락된 작업 재처리"]);
    expect(chunks[1]!.text).toContain("# 주석이지 소제목이 아니다");
    expect(chunks.every((chunk) => chunk.tokens <= CHUNK_MAX_TOKENS * 1.3)).toBe(true);
    const lines = body.split("\n");
    for (const chunk of chunks) {
      expect(body.slice(chunk.charStart, chunk.charEnd)).toBe(lines.slice(chunk.lineStart - 1, chunk.lineEnd).join("\n"));
      expect(chunk.index).toBe(chunks.indexOf(chunk));
    }
    expect(lines[chunks[2]!.lineStart - 1]).toBe("### 백오프");
  });

  test("짧은 절은 다음 절과 묶고, 긴 절은 문단·줄·문장으로 나누며 이어지는 조각은 조금 겹친다", () => {
    const short = chunkNote("# 메모\n\n## 할 일\n\n- 우유 사기\n\n## 연락\n\n- 치과 예약", { title: "메모" });
    expect(short.chunks).toHaveLength(1);
    expect(short.chunks[0]!.text).toContain("우유 사기");
    expect(short.chunks[0]!.text).toContain("치과 예약");

    const paragraph = (at: number) => `${at}번째 문단이다. ${"동기화 설계에 관한 문장을 길게 적는다. ".repeat(12)}`;
    const long = chunkNote(Array.from({ length: 12 }, (_unused, at) => paragraph(at + 1)).join("\n\n"), { title: "긴 메모" });
    expect(long.chunks.length).toBeGreaterThan(2);
    expect(long.chunks.every((chunk) => chunk.tokens <= CHUNK_MAX_TOKENS * 1.3)).toBe(true);
    // 두 번째 조각은 첫 조각의 마지막 문단에서 시작한다(겹침).
    expect(long.chunks[1]!.lineStart).toBeLessThanOrEqual(long.chunks[0]!.lineEnd);
    expect(long.chunks.at(-1)!.text).toContain("12번째 문단이다.");

    // 줄바꿈 없는 아주 긴 한 줄도 상한 아래 조각들이 된다.
    const line = chunkNote("가나다라마바사 아자차카타파하. ".repeat(600), { title: "한 줄" });
    expect(line.chunks.length).toBeGreaterThan(3);
    expect(line.chunks.every((chunk) => chunk.tokens <= CHUNK_MAX_TOKENS * 1.3 && chunk.lineStart === 1)).toBe(true);
  });

  test("빈 메모는 조각이 없고, 제목만 있으면 머리말 조각 하나이며, 그림 주소와 비밀로 보이는 값은 조각에 싣지 않는다", () => {
    expect(chunkNote("", { title: "" }).chunks).toEqual([]);
    expect(chunkNote("   \n", { title: "" }).chunks).toEqual([]);
    const only = chunkNote("", { title: "제목만 있는 메모", path: "생활" }).chunks;
    expect(only).toHaveLength(1);
    expect(only[0]!.text).toBe("[폴더: 생활]\n# 제목만 있는 메모");
    const image = `![배포 흐름](/api/v1/notes/images/${"a".repeat(64)})`;
    const secret = chunkNote(`서버 접속\n\n비밀번호: hunter2-XYZ!\n${image}\n토큰은 sk-abcdefghijklmnopqrstuvwx 이다.`, { title: "접속 정보", summary: "서버 접속 방법" }).chunks[0]!.text;
    expect(secret).not.toContain("hunter2");
    expect(secret).not.toContain("sk-abcdefghij");
    expect(secret).not.toContain("a".repeat(64));
    expect(secret).toContain("[그림: 배포 흐름]");
    expect(secret).toContain("요약: 서버 접속 방법");
    expect(estimateTokens(secret)).toBeLessThan(120);
  });
});

describe("끊긴 표와 코드, 긴 메모", () => {
  test("표가 조각 사이에서 끊기면 이어지는 조각 앞에 머리 줄과 구분 줄을 다시 붙인다", () => {
    const rows = Array.from({ length: 60 }, (_unused, at) => `| 항목 ${at} | 값은 ${"가나다라마바사 ".repeat(6)}${at} | 비고 ${at} |`);
    const body = ["# 표 문서", "", "머리 글이다.", "", "| 이름 | 설명 | 비고 |", "|---|---|---|", ...rows, "", "끝 글이다."].join("\n");
    const { chunks } = chunkNote(body, { title: "표 문서" });
    expect(chunks.length).toBeGreaterThan(2);
    const continued = chunks.filter((chunk) => body.split("\n")[chunk.lineStart - 1]!.startsWith("| 항목"));
    expect(continued.length).toBeGreaterThan(1);
    for (const chunk of continued) {
      // 머리말(# 표 문서) 다음에 표의 머리 줄·구분 줄·그 조각의 첫 줄이 이어진다.
      const lines = chunk.text.split("\n");
      const at = lines.indexOf("| 이름 | 설명 | 비고 |");
      expect(at).toBeGreaterThan(0);
      expect(lines[at + 1]).toBe("|---|---|---|");
      expect(lines[at + 2]).toBe(body.split("\n")[chunk.lineStart - 1]!);
    }
    // 표가 시작하는 조각에는 머리 줄을 한 번만 싣는다.
    expect(chunks[0]!.text.split("| 이름 | 설명 | 비고 |").length - 1).toBe(1);
    // 위치는 원문의 줄 그대로다(다시 붙인 머리 줄은 세지 않는다).
    for (const chunk of chunks) expect(body.slice(chunk.charStart, chunk.charEnd)).toBe(body.split("\n").slice(chunk.lineStart - 1, chunk.lineEnd).join("\n"));
  });

  test("코드 울타리 안에서 끊기면 여는 줄을 다시 붙이고, 닫히기 전에 끝나는 조각은 닫아 준다", () => {
    const code = Array.from({ length: 220 }, (_unused, at) => `const value${at} = compute(${at}); // 설명 ${"가나다 ".repeat(4)}`);
    const body = ["# 코드 문서", "", "```ts", ...code, "```", "", "끝 글이다."].join("\n");
    const { chunks } = chunkNote(body, { title: "코드 문서" });
    expect(chunks.length).toBeGreaterThan(3);
    const fenced = (text: string) => text.split("\n").filter((line) => /^(```|~~~)/.test(line)).length;
    for (const chunk of chunks) {
      // 울타리가 짝이 맞는다: 코드가 든 조각은 ```ts로 열고 ```로 닫는다.
      expect(fenced(chunk.text) % 2).toBe(0);
      if (chunk.text.includes("const value")) expect(chunk.text).toContain("```ts\nconst value");
    }
    expect(chunks.at(-1)!.text.endsWith("끝 글이다.")).toBe(true);
  });

  test("조각 상한은 본문 상한의 메모도 담을 만큼이고, 넘으면 잘렸음을 알린다", () => {
    expect(MAX_CHUNKS).toBe(300);
    const section = (at: number) => `## 절 ${at}\n\n${Array.from({ length: 6 }, (_unused, line) => `절 ${at}의 ${line + 1}번째 문장으로 조각이 따로 서도록 충분히 길게 쓴다.`).join("\n")}`;
    const fits = chunkNote(Array.from({ length: 200 }, (_unused, at) => section(at)).join("\n\n"), { title: "긴 문서" });
    expect(fits).toMatchObject({ truncated: false });
    expect(fits.chunks.length).toBeGreaterThan(120);
    const over = chunkNote(Array.from({ length: MAX_CHUNKS + 40 }, (_unused, at) => section(at)).join("\n\n"), { title: "더 긴 문서" });
    expect(over.truncated).toBe(true);
    expect(over.chunks).toHaveLength(MAX_CHUNKS);
  });

  test("토큰 어림은 임베딩 모델의 토크나이저에 맞춘 값이다", () => {
    // 영문·숫자·기호는 3.5자, 한글은 1.2자에 토큰 하나(실제 메모의 조각 500개로 맞춤).
    expect(estimateTokens("a".repeat(35))).toBe(10);
    expect(estimateTokens("가".repeat(12))).toBe(10);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("낱말 검색의 문턱", () => {
  const index = lexicalIndex([
    { id: "deploy", title: "서버 배포 절차", text: "이미지를 올리고 컨테이너를 다시 띄운다. 배포 절차는 점검표를 따른다.", fields: [["서버 배포 절차", 3], ["이미지를 올리고 컨테이너를 다시 띄운다. 배포 절차는 점검표를 따른다.", 1]] },
    { id: "meet", title: "주간 회의", text: "배포 일정을 이야기했다. 회의록은 바로 남긴다.", fields: [["주간 회의", 3], ["배포 일정을 이야기했다. 회의록은 바로 남긴다.", 1]] },
    { id: "cook", title: "김치찌개", text: "두부를 넣고 끓인다. how to cook it well.", fields: [["김치찌개", 3], ["두부를 넣고 끓인다. how to cook it well.", 1]] },
    { id: "trip", title: "여행 계획", text: "기차표를 예매한다.", fields: [["여행 계획", 3], ["기차표를 예매한다.", 1]] },
  ]);

  test("뜻 없는 말은 띄어 쓴 덩어리에서도 빼고, 두 글자 약어는 남긴다", () => {
    expect(queryTerms("how to bake sourdough bread").raw).toEqual(["bake", "sourdough", "bread"]);
    expect(queryTerms("DB 이전은 어떻게 해?").raw).toEqual(["db", "이전은"]);
    // 뜻 없는 말만 겹치는 글은 걸리지 않는다(앞서는 how·to가 든 글이 모두 걸렸다).
    expect([...lexicalRank(index, "how to bake sourdough bread").keys()]).toEqual([]);
  });

  test("질의의 낱말을 얼마나 담았는지와, 질의가 구절째 들어 있는지를 함께 알린다", () => {
    const hits = lexicalRank(index, "양자역학 배포 강의");
    // 「배포」만 걸렸다: 색인에 없는 낱말(양자역학·강의)이 질의의 무게를 거의 다 차지하므로 담은 비율이 낮다.
    expect(hits.get("meet")!.coverage).toBeLessThan(0.3);
    expect(lexicalRank(index, "배포 절차").get("deploy")!.coverage).toBe(1);
    const phrase = lexicalRank(index, "컨테이너를 다시 띄운다");
    expect(phrase.get("deploy")).toMatchObject({ phrase: true });
    // 짧은 질의는 구절로 보지 않는다(낱말 하나가 든 글이 모두 맨 앞에 서지 않게).
    expect(lexicalRank(index, "배포").get("deploy")).toMatchObject({ phrase: false });
  });
});

describe("벡터와 임베딩 서버", () => {
  test("벡터는 길이 1로 맞추고, 앞 차원만 남겨 다시 맞추며, base64로 주고받을 때 틀린 값은 받지 않는다", () => {
    expect(unit([0, 0, 0])).toBeNull();
    expect(unit([1, Number.NaN])).toBeNull();
    const vector = unit([3, 4, 0, 0])!;
    expect([...vector].map((value) => Math.round(value * 10) / 10)).toEqual([0.6, 0.8, 0, 0]);
    expect(dot(fit([3, 4, 12, 0], 2)!, unit([3, 4])!)).toBeCloseTo(1, 5);
    expect(fit([1, 2], 4)).toBeNull();
    const back = decodeVector(encodeVector(vector), 4)!;
    expect([...back]).toEqual([...vector]);
    expect(decodeVector(encodeVector(vector), 8)).toBeNull();
    expect(decodeVector("%%%", 4)).toBeNull();
    expect(decodeVector(encodeVector(new Float32Array([9, 9, 9, 9])), 4)).toBeNull();
    expect(decodeVector(encodeVector(new Float32Array([0, 0, 0, 0])), 4)).toBeNull();
  });

  test("OpenAI 호환·Ollama 두 모양으로 부르고, 머리말을 붙이며, 긴 벡터는 정한 차원으로 줄인다", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const server = (reply: (body: { input: string[] }) => unknown, status = 200) => (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), body, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(reply(body)), { status });
    }) as typeof fetch;
    const openai = new Embedder({ url: "http://127.0.0.1:18434", style: "openai", model: "kure", dimensions: 4, prompt: "e5", apiKey: "k-123" },
      server((body) => ({ data: body.input.map((_text, index) => ({ index, embedding: [index + 1, 2, 0, 0, 5, 5] })).reverse() })));
    const vectors = await openai.embed(["가", "나"], "query");
    expect(calls[0]).toEqual({ url: "http://127.0.0.1:18434/v1/embeddings", body: { model: "kure", input: ["query: 가", "query: 나"], encoding_format: "float" }, auth: "Bearer k-123" });
    expect(vectors.map((vector) => vector.length)).toEqual([4, 4]);
    // index 순서로 되돌리고(서버가 뒤섞어 보내도), 앞 4차원으로 줄여 길이를 맞춘다.
    expect(vectors[0]![0]! / vectors[0]![1]!).toBeCloseTo(0.5, 5);
    expect(dot(vectors[1]!, vectors[1]!)).toBeCloseTo(1, 5);

    const ollama = new Embedder({ url: "http://127.0.0.1:11434", style: "ollama", model: "embeddinggemma", dimensions: 2, prompt: "gemma", contextTokens: 2048 }, server((body) => ({ embeddings: body.input.map(() => [1, 1]) })));
    await ollama.embed(["문서"], "passage");
    expect(calls[1]!.url).toBe("http://127.0.0.1:11434/api/embed");
    expect(calls[1]!.body).toEqual({ model: "embeddinggemma", input: ["title: none | text: 문서"], truncate: true, options: { num_ctx: 2048 } });

    const failing = (reply: unknown, status = 200) => new Embedder({ url: "http://127.0.0.1:1", style: "openai", model: "m", dimensions: 4, prompt: "plain" }, server(() => reply, status));
    await expect(failing({ data: [{ index: 0, embedding: [1, 2] }] }).embed(["x"], "query")).rejects.toMatchObject({ code: "EMBEDDING_FAILED", reason: "dimension" });
    await expect(failing({ data: [] }).embed(["x"], "query")).rejects.toMatchObject({ reason: "bad_response" });
    await expect(failing({ data: [{ index: 0, embedding: [0, 0, 0, 0] }] }).embed(["x"], "query")).rejects.toMatchObject({ reason: "bad_response" });
    await expect(failing({ error: "no such model" }, 404).embed(["x"], "query")).rejects.toMatchObject({ reason: "rejected" });
    const down = new Embedder({ url: "http://127.0.0.1:1", style: "openai", model: "m", dimensions: 4, prompt: "plain" }, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    await expect(down.embed(["x"], "query")).rejects.toMatchObject({ reason: "offline" });
    // 여러 글은 batch씩 나눠 보낸다.
    calls.length = 0;
    const batched = new Embedder({ url: "http://127.0.0.1:2", style: "openai", model: "m", dimensions: 2, prompt: "plain", batch: 2 }, server((body) => ({ data: body.input.map((_text, index) => ({ index, embedding: [1, 0] })) })));
    expect(await batched.embedAll(["a", "b", "c", "d", "e"], "passage")).toHaveLength(5);
    expect(calls.map((call) => (call.body.input as string[]).length)).toEqual([2, 2, 1]);
  });

  test("질의 임베딩은 같은 질의를 기억하고, 연달아 실패하면 한동안 부르지 않으며, 동시에 둘까지만 부른다", async () => {
    let now = 0, calls = 0, mode: "ok" | "offline" | "slow" = "ok";
    const release: Array<() => void> = [];
    const embedder = { embed: async (texts: string[]) => {
      calls++;
      if (mode === "offline") throw Object.assign(new Error("down"), { reason: "offline" });
      if (mode === "slow") await new Promise<void>((resolve) => release.push(resolve));
      return texts.map(fakeVector);
    } };
    const queries = new QueryEmbedder(embedder as never, { now: () => now, ttlMs: 1000, cooldownMs: 5000, failures: 2 });
    expect(await queries.embed("절전 복귀")).toBeInstanceOf(Float32Array);
    expect(await queries.embed("  절전   복귀 ")).toBeInstanceOf(Float32Array);
    expect(calls).toBe(1);
    now = 2000;
    await queries.embed("절전 복귀");
    expect(calls).toBe(2);

    mode = "offline";
    expect(await queries.embed("새 질의 1")).toEqual({ failed: "embedding_unavailable" });
    expect(await queries.embed("새 질의 2")).toEqual({ failed: "embedding_unavailable" });
    expect(queries.open).toBe(true);
    // 서킷이 열린 동안에는 부르지 않고 바로 알린다. 기억해 둔 질의는 그대로 답한다.
    expect(await queries.embed("새 질의 3")).toEqual({ failed: "embedder_offline" });
    expect(calls).toBe(4);
    expect(await queries.embed("절전 복귀")).toBeInstanceOf(Float32Array);
    now = 8000; mode = "ok";
    expect(await queries.embed("새 질의 3")).toBeInstanceOf(Float32Array);
    expect(queries.open).toBe(false);

    mode = "slow";
    const first = queries.embed("느린 질의 1"), second = queries.embed("느린 질의 2");
    expect(await queries.embed("느린 질의 3")).toEqual({ failed: "embedding_overloaded" });
    release.forEach((done) => done());
    expect(await first).toBeInstanceOf(Float32Array);
    expect(await second).toBeInstanceOf(Float32Array);
  });

  test("자가 진단은 뜻을 담는 임베더와 담지 못하는 임베더를 가른다", async () => {
    const good = await diagnoseEmbedder(fakeEmbedder);
    expect(good.ok).toBe(true);
    expect(good.passed).toBe(good.total);
    expect(good.margin).toBeGreaterThan(0.3);
    expect(good.floor).toBeGreaterThanOrEqual(0);
    expect(good.dimensions).toBe(FAKE_DIMS);
    // 글의 길이만 보는 임베더: 벡터는 나오지만 뜻과 무관하다.
    const blind = { embed: async (texts: string[]) => texts.map((text) => unit([1, text.length % 7, text.length % 3, 1])!) };
    expect((await diagnoseEmbedder(blind)).ok).toBe(false);
  });

  test("embedding 설정은 주소·모양·차원·머리말을 검사한다", () => {
    expect(parseEmbeddingConfig({ url: "http://127.0.0.1:18434/", model: "kure-v3", dimensions: 1024, prompt: "e5", launch: ["llama-server", "--embeddings"], idleMinutes: 10 }))
      .toEqual({ url: "http://127.0.0.1:18434", style: "openai", model: "kure-v3", dimensions: 1024, prompt: "e5", launch: ["llama-server", "--embeddings"], idleMinutes: 10 });
    const bad = (value: unknown) => { try { parseEmbeddingConfig(value); return "ok"; } catch (error) { return (error as { code: string }).code; } };
    expect(bad({ url: "http://example.com", model: "m", dimensions: 8 })).toBe("INVALID_CONFIG");
    expect(bad({ url: "https://user:pw@example.com", model: "m", dimensions: 64 })).toBe("INVALID_CONFIG");
    expect(bad({ url: "https://example.com", model: "m", dimensions: 64, launch: ["x"] })).toBe("INVALID_CONFIG");
    expect(bad({ url: "http://127.0.0.1:1", model: "m", dimensions: 64, prompt: "unknown" })).toBe("INVALID_CONFIG");
    expect(bad({ url: "http://127.0.0.1:1", model: "m" })).toBe("INVALID_CONFIG");
    expect(bad({ url: "http://127.0.0.1:1", model: "m", dimensions: 64, extra: 1 })).toBe("INVALID_CONFIG");
    expect(bad({ url: "https://api.example.com/v1x", model: "m", dimensions: 64, apiKey: "secret" })).toBe("ok");
  });
});

const NOTES = [
  { id: "f-design", kind: "folder" as const, name: "설계" },
  { id: "n-sync", parentId: "f-design", title: "증분 동기화 설계", body: "# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 켜지면 밀린 변경을 다시 받아 순서대로 적용한다.\n\n## 충돌\n\n같은 항목을 두 곳에서 고치면 나중 것을 남긴다." },
  { id: "n-deploy", parentId: "f-design", title: "서버 배포 절차", body: "이미지를 레지스트리에 올리고 compose.yml로 컨테이너를 다시 띄운다.\n\n오류 코드 PARENT_CONFLICT는 /api/v1/sessions에서 난다." },
  { id: "n-cook", title: "김치찌개", body: "묵은지와 두부를 넣고 끓인다." },
  { id: "n-trip", title: "부산 여행", body: "기차와 숙소를 예약한다." },
  { id: "n-meet", title: "주간 회의", body: "안건: 배포 일정. 회의록은 끝나고 바로 남긴다." },
  { id: "n-login", title: "로그인 문제", body: "비밀번호: hunter2-XYZ!\n암호를 잊으면 재설정 링크를 받는다." },
  { id: "n-empty", title: "", body: "" },
];
function seeded() {
  const made = engine();
  made.port.put(...NOTES);
  return made;
}

describe("색인: 임대와 커밋", () => {
  test("워커가 다녀가면 모든 메모가 준비되고, 고친 절만 다시 임베딩하며, 자리만 바뀐 메모는 다시 하지 않는다", async () => {
    const { port, index, clock } = seeded();
    const before = await index.status();
    expect(before).toMatchObject({ activeModelKey: null, embedderOnline: false, summary: { total: 6, ready: 0, pending: 6, failed: 0 }, cards: { total: 6, missing: 6 } });

    const first = await indexAll(index);
    expect(first.modelKey).toBe(modelKey("fake-embed", FAKE_DIMS, "plain"));
    expect(first.jobs).toBe(6);
    const after = await index.status("n-sync");
    expect(after).toMatchObject({ activeModelKey: first.modelKey, embedderOnline: true, summary: { total: 6, ready: 6, pending: 0, failed: 0 } });
    expect(after.items![0]).toMatchObject({ noteId: "n-sync", status: "ready", card: "missing" });
    expect(after.items![0]!.chunks).toBeGreaterThanOrEqual(1);
    expect((await index.status("n-empty")).items![0]).toMatchObject({ status: "ready", chunks: 0 });

    // 끌어서 순서만 바꾼 메모는 대기 목록에 들지 않는다.
    port.put({ id: "n-cook", position: 3 }, { id: "n-trip", position: 4 });
    expect((await index.status()).summary.pending).toBe(0);
    expect((await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs).toEqual([]);

    // 긴 문서의 한 절만 고치면 그 절만 다시 임베딩한다.
    const section = (name: string) => `## ${name}\n\n${`${name}에 관한 설명을 충분히 길게 적어 절 하나가 조각 하나가 되게 한다. `.repeat(6)}`;
    port.put({ id: "n-long", title: "긴 설계서", body: ["알파", "베타", "감마", "델타", "엡실론"].map(section).join("\n\n"), updatedAt: clock.now - 10_000 });
    expect((await indexAll(index)).embedded).toBe(5);
    port.put({ id: "n-long", body: ["알파", "베타 고침", "감마", "델타", "엡실론"].map(section).join("\n\n"), updatedAt: clock.now - 10_000 });
    expect((await index.status("n-long")).items![0]!.status).toBe("pending");
    expect((await indexAll(index)).embedded).toBe(1);
    expect((await index.status("n-long")).items![0]).toMatchObject({ status: "ready", chunks: 5 });

    // 폴더 이름이 바뀌면 그 아래 메모의 머리말이 달라져 다시 색인한다. 방금 고친 메모는 잠깐 미룬다.
    port.put({ id: "f-design", name: "아키텍처" });
    expect((await index.status()).summary.pending).toBe(2);
    port.put({ id: "n-cook", body: "묵은지와 두부, 파를 넣는다.", updatedAt: clock.now - 500 });
    const lease = await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 });
    expect(lease.jobs.map((job) => job.noteId).sort()).toEqual(["n-deploy", "n-sync"]);
    expect(lease.jobs.every((job) => job.texts.every((item) => item.text.includes("[폴더: 아키텍처]")))).toBe(true);
    // 가리지 않은 비밀은 워커로 가지 않는다.
    port.put({ id: "n-login", body: "비밀번호: another-PW9!\n로그인 화면", updatedAt: clock.now - 10_000 });
    const secret = (await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs.find((job) => job.noteId === "n-login")!;
    expect(secret.texts.map((item) => item.text).join("\n")).not.toContain("another-PW9");
  });

  test("계산하는 사이 바뀐 메모의 커밋은 버리고, 실패는 간격을 늘려 다시 하다가 멈추며, 돌려놓은 임대는 횟수를 세지 않는다", async () => {
    const { port, index, clock } = seeded();
    const lease = await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 });
    const job = lease.jobs.find((item) => item.noteId === "n-cook")!;
    const vectors = job.texts.map((item) => ({ hash: item.hash, data: encodeVector(fakeVector(item.text)) }));
    // 틀린 임대 토큰, 틀린 차원.
    expect(await index.commit({ modelKey: lease.modelKey, noteId: "n-cook", leaseToken: "wrong-token", inputHash: job.inputHash, vectors })).toMatchObject({ committed: false });
    await expect(index.commit({ modelKey: lease.modelKey, noteId: "n-cook", leaseToken: job.leaseToken, inputHash: job.inputHash, vectors: [{ hash: job.texts[0]!.hash, data: encodeVector(unit([1, 2, 3])!) }] }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    // 시험하지 않는 메모는 그대로 커밋해 둔다.
    for (const other of lease.jobs.filter((item) => item.noteId !== "n-cook" && item.noteId !== "n-trip")) {
      expect(await index.commit({ modelKey: lease.modelKey, noteId: other.noteId, leaseToken: other.leaseToken, inputHash: other.inputHash,
        vectors: other.texts.map((item) => ({ hash: item.hash, data: encodeVector(fakeVector(item.text)) })) })).toMatchObject({ committed: true, embedded: other.texts.filter((item) => !item.query).length, reused: 0 });
    }
    // 임대 뒤에 메모가 바뀌었다.
    port.put({ id: "n-cook", body: "레시피를 바꿨다: 두부 대신 버섯.", updatedAt: clock.now - 10_000 });
    expect(await index.commit({ modelKey: lease.modelKey, noteId: "n-cook", leaseToken: job.leaseToken, inputHash: job.inputHash, vectors })).toEqual({ schemaVersion: 1, committed: false, staleSkipped: true });
    expect((await index.status("n-cook")).items![0]!.status).toBe("pending");

    // 실패 보고: 10초 뒤에 다시, 다섯 번이면 실패로 둔다.
    const trip = lease.jobs.find((item) => item.noteId === "n-trip")!;
    expect(await index.fail({ modelKey: lease.modelKey, noteId: "n-trip", leaseToken: trip.leaseToken, error: "embedder crashed", retryable: true })).toEqual({ schemaVersion: 1, nextRetryAt: clock.now + 10_000 });
    expect((await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 1 })).jobs.map((item) => item.noteId)).toEqual(["n-cook"]);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      clock.now += 3 * 60 * 60 * 1000;
      const again = (await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs.find((item) => item.noteId === "n-trip")!;
      await index.fail({ modelKey: lease.modelKey, noteId: "n-trip", leaseToken: again.leaseToken, error: "embedder crashed", retryable: true });
    }
    clock.now += 3 * 60 * 60 * 1000;
    expect((await index.status("n-trip")).items![0]).toMatchObject({ status: "failed", error: "embedder crashed" });
    // 워커가 가져간 채 돌아오지 않은 메모(n-cook)도 거듭되면 실패로 둔다(그 메모에서 워커가 죽는 경우다).
    expect((await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs).toEqual([]);
    expect((await index.status("n-cook")).items![0]).toMatchObject({ status: "failed", error: "lease_expired" });
    expect((await index.status()).summary).toMatchObject({ ready: 4, failed: 2, pending: 0 });
    // 다시 색인을 청하면 실패한 메모를 다시 시도한다.
    expect(await index.reindex({ scope: "failed" })).toEqual({ schemaVersion: 1, queued: 2 });
    expect((await index.status("n-trip")).items![0]!.status).toBe("pending");
    expect((await indexAll(index)).jobs).toBe(2);

    // 임베딩 서버가 꺼져 있어 돌려놓는 임대는 실패로 세지 않고 바로 다시 받을 수 있다.
    port.put({ id: "n-meet", body: "안건을 바꿨다: 회의록 양식.", updatedAt: clock.now - 10_000 });
    const held = (await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs.find((item) => item.noteId === "n-meet")!;
    expect((await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs).toEqual([]);
    await index.fail({ modelKey: lease.modelKey, noteId: "n-meet", leaseToken: held.leaseToken, error: RELEASED, retryable: true });
    const back = (await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 })).jobs.find((item) => item.noteId === "n-meet")!;
    expect(back.leaseToken).not.toBe(held.leaseToken);

    // 워커가 가져간 채 꺼졌다: 임대 시간이 지나면 다른 워커가 다시 받고, 늦게 온 옛 커밋은 받지 않는다.
    clock.now += 6 * 60 * 1000;
    const taken = (await index.lease({ workerId: "w2", model: FAKE_MODEL, limit: 8 })).jobs.find((item) => item.noteId === "n-meet")!;
    const late = back.texts.map((item) => ({ hash: item.hash, data: encodeVector(fakeVector(item.text)) }));
    expect(await index.commit({ modelKey: lease.modelKey, noteId: "n-meet", leaseToken: back.leaseToken, inputHash: back.inputHash, vectors: late })).toMatchObject({ committed: false });
    expect(await index.commit({ modelKey: lease.modelKey, noteId: "n-meet", leaseToken: taken.leaseToken, inputHash: taken.inputHash, vectors: late })).toMatchObject({ committed: true });
    expect((await index.status()).summary).toMatchObject({ ready: 6, pending: 0, failed: 0 });

    // 벡터를 버리고 새로 계산하게 한다.
    expect(await index.reindex({ scope: "note", noteId: "n-sync" })).toEqual({ schemaVersion: 1, queued: 1 });
    expect((await indexAll(index)).jobs).toBe(1);
    expect((await index.reindex({ scope: "all" })).queued).toBe(6);
    expect((await index.status()).summary.ready).toBe(0);
  });

  test("요청 본문을 검사한다", () => {
    expect(parseLease({ workerId: "pc", model: { name: "kure-v3", dimensions: 1024, prompt: "e5", floor: 0.11 } })).toEqual({ workerId: "pc", model: { name: "kure-v3", dimensions: 1024, prompt: "e5", floor: 0.11 }, limit: 8 });
    expect(parseSearch({ query: "  배포   순서 ", filters: { docType: "design", includeHistory: true } })).toEqual({ query: "배포 순서", mode: "hybrid", filters: { docType: ["design"], includeHistory: true }, limit: 10 });
    const bad = (run: () => unknown) => { try { run(); return "ok"; } catch (error) { return (error as { code: string }).code; } };
    expect(bad(() => parseSearch({ query: "" }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseSearch({ query: "x", queryVector: "AAAA" }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseSearch({ query: "x", mode: "fuzzy" }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseLease({ workerId: "pc", model: { name: "bad name", dimensions: 8, prompt: "e5" } }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseCommit({ modelKey: "m", noteId: "n", leaseToken: "short", inputHash: sha256("x"), vectors: [] }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseRegister({ body: "x", sourceRepo: "relay" }))).toBe("INVALID_ARGUMENT");
    expect(bad(() => parseRegister({ body: "x", sourceRepo: "relay", sourcePath: "../etc/passwd" }))).toBe("INVALID_ARGUMENT");
    expect(parseCards({ author: " claude-fable ", cards: [{ noteId: "n", summary: " 요약 ", terms: ["sync", "Sync", "동기화"], questions: [] }] }))
      .toEqual({ author: "claude-fable", cards: [{ noteId: "n", summary: "요약", terms: ["sync", "동기화"], questions: [] }] });
    expect(exactIntent("PARENT_CONFLICT 오류")).toBe(true);
    expect(exactIntent("/api/v1/notes 경로")).toBe(true);
    expect(exactIntent("compose.yml 고치기")).toBe(true);
    expect(exactIntent("절전 복귀 후 갱신이 늦다")).toBe(false);
  });
});

describe("검색", () => {
  test("낱말이 달라도 뜻이 가까운 절을 찾고, 질의 벡터가 없으면 낱말 검색으로 바로 답한다", async () => {
    const { port, index } = seeded();
    const { modelKey: key } = await indexAll(index);
    // 「resume from sleep」은 어느 메모에도 없는 낱말이다.
    const hybrid = await index.search(withVector("resume from sleep sync", key));
    expect(hybrid).toMatchObject({ searchMode: "hybrid", modelKey: key });
    expect(hybrid.items[0]).toMatchObject({ noteId: "n-sync", title: "증분 동기화 설계", path: "설계", staleIndex: false, docType: "memo" });
    expect(hybrid.items[0]!.matches[0]).toMatchObject({ headingPath: "증분 동기화 설계 > 누락된 작업 재처리" });
    expect(hybrid.items[0]!.matches[0]!.snippet).toContain("밀린 변경을 다시 받아");
    expect(hybrid.items[0]!.scores.semantic).toBeGreaterThan(0.3);
    expect(hybrid.items.map((item) => item.noteId)).not.toContain("n-cook");

    const fallback = await index.search(search("resume from sleep sync"));
    expect(fallback).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "embedder_offline", total: 0 });
    expect((await index.search(search("동기화 설계"))).items[0]).toMatchObject({ noteId: "n-sync" });
    expect((await index.search(search("동기화", { mode: "keyword" })))).toMatchObject({ searchMode: "keyword" });
    expect((await index.search(withVector("동기화", "other-model@16/plain/c1"))).fallbackReason).toBe("model_mismatch");
    expect((await index.search(withVector("동기화", key.replace("@16/", "@32/")))).fallbackReason).toBe("model_mismatch");
    // 조각 규칙의 판만 다른 키는 같은 임베딩이다: 조각 규칙이 바뀌어 다시 색인하는 동안에도 옛 판·새 판의 PC가 뜻으로 찾는다.
    expect(key.endsWith("/c2")).toBe(true);
    expect(await index.search(withVector("wake sync", key.replace(/\/c2$/, "/c1"), { mode: "semantic" }))).toMatchObject({ searchMode: "semantic", items: [{ noteId: "n-sync" }] });
    // 의미 검색만: 낱말이 겹치지 않아도 찾는다. 관련 없는 질의에는 억지 결과를 내지 않는다.
    expect((await index.search(withVector("wake sync", key, { mode: "semantic" }))).items[0]!.noteId).toBe("n-sync");
    expect((await index.search(withVector("양자역학 강의 노트", key, { mode: "semantic" }))).items).toEqual([]);

    // 정확한 식별자·경로는 낱말 순위를 무겁게 쳐서 맨 위에 둔다.
    const exact = await index.search(withVector("PARENT_CONFLICT", key));
    expect(exact.items[0]).toMatchObject({ noteId: "n-deploy" });
    expect(exact.items[0]!.matches[0]!.snippet).toContain("PARENT_CONFLICT");
    // 발췌에서도 비밀로 보이는 값은 가린다.
    const login = await index.search(withVector("password login", key));
    expect(login.items[0]!.noteId).toBe("n-login");
    expect(JSON.stringify(login)).not.toContain("hunter2");

    // 색인 뒤에 고친 메모: 옛 줄 번호 대신 지금 본문의 같은 절을 가리키고 staleIndex를 알린다.
    port.put({ id: "n-sync", body: "# 증분 동기화 설계\n\n새 머리말.\n\n## 누락된 작업 재처리\n\n기기가 다시 켜지면 밀린 변경을 다시 받는다 🙂" });
    const stale = (await index.search(withVector("resume from sleep sync", key))).items[0]!;
    expect(stale).toMatchObject({ noteId: "n-sync", staleIndex: true });
    expect(stale.matches[0]).toMatchObject({ headingPath: "증분 동기화 설계 > 누락된 작업 재처리", lineStart: 5 });
    expect(stale.matches[0]!.snippet).toContain("🙂");
    // 지운 메모는 워커를 기다리지 않고 바로 빠진다.
    port.remove("n-sync");
    expect((await index.search(withVector("resume from sleep sync", key))).items.map((item) => item.noteId)).not.toContain("n-sync");

    // 같은 색인으로 거듭 찾을 때는 조각도 메모 본문도 다시 읽지 않는다.
    const reads = port.chunkReads, bodies = port.noteReads;
    await index.search(withVector("배포", key));
    await index.search(withVector("회의", key));
    await index.status();
    expect(port.chunkReads - reads).toBeLessThanOrEqual(1);
    expect(port.noteReads - bodies).toBeLessThanOrEqual(1);
  });

  test("채택한 문서를 앞에 두고 대체된 문서는 새 문서를 알리며, 유형·프로젝트·폴더로 좁힌다", async () => {
    const { port, index } = engine();
    const old = await index.register({ title: "동기화 결정 (구)", body: "동기화는 폴링으로 한다. sync", docType: "decision", docStatus: "adopted", project: "relay", sourceRepo: "relay", sourcePath: "docs/adr/001-sync.md", sourceCommit: "abc1234" });
    expect(old).toMatchObject({ action: "created", revision: 1 });
    expect(port.items.get(old.noteId)).toMatchObject({ title: "동기화 결정 (구)", body: "동기화는 폴링으로 한다. sync", parentId: null });
    // 같은 파일을 다시 올리면 같은 메모를 고친다. 바뀐 것이 없으면 그대로다.
    expect(await index.register({ title: "동기화 결정 (구)", body: "동기화는 폴링으로 한다. sync", docType: "decision", sourceRepo: "relay", sourcePath: "docs/adr/001-sync.md" })).toMatchObject({ action: "unchanged", noteId: old.noteId, revision: 1 });
    expect(await index.register({ body: "동기화는 긴 폴링으로 한다. sync", docType: "decision", sourceRepo: "relay", sourcePath: "docs/adr/001-sync.md", sourceCommit: "def5678" })).toMatchObject({ action: "updated", noteId: old.noteId, revision: 2 });
    expect(port.metaRows.get(old.noteId)).toMatchObject({ docStatus: "adopted", sourceCommit: "def5678", project: "relay" });

    const next = await index.register({ body: "# 동기화 결정 (신)\n\n동기화는 푸시로 바꾼다. sync", docType: "decision", docStatus: "adopted", project: "relay", sourceRepo: "relay", sourcePath: "docs/adr/007-sync.md", supersedes: old.noteId });
    expect(next).toMatchObject({ action: "created", superseded: old.noteId });
    expect(port.items.get(next.noteId)).toMatchObject({ title: "동기화 결정 (신)" });
    expect(port.metaRows.get(old.noteId)).toMatchObject({ docStatus: "superseded", supersededBy: next.noteId });
    // 서로를 대신하는 관계는 받지 않는다.
    await expect(index.register({ noteId: old.noteId, body: "x", docType: "decision", supersedes: next.noteId })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    // 거절한 등록은 메모를 건드리지 않는다(본문을 먼저 쓰고 나서 거절하던 때는 「x」가 남았다).
    expect(port.items.get(old.noteId)).toMatchObject({ body: "동기화는 긴 폴링으로 한다. sync" });
    await expect(index.setMeta({ noteId: next.noteId, supersededBy: old.noteId })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    // 다른 프로젝트의 메모는 대체된 옛 결정과 글이 똑같다: 낱말로는 똑같이 맞는다.
    port.put({ id: "n-other", title: "동기화 결정 (구)", body: "동기화는 긴 폴링으로 한다. sync" });
    await index.setMeta({ noteId: "n-other", project: "other", docType: "knowledge" });
    const found = await index.search(search("동기화 sync", { mode: "keyword" }));
    expect(found.items[0]).toMatchObject({ noteId: next.noteId, docType: "decision", docStatus: "adopted", project: "relay" });
    const superseded = found.items.find((item) => item.noteId === old.noteId)!;
    expect(superseded).toMatchObject({ docStatus: "superseded", supersededBy: { id: next.noteId, title: "동기화 결정 (신)", status: "adopted" } });
    // 똑같이 맞았지만 대체된 문서는 크게 깎여 맨 뒤로 간다.
    const other = found.items.find((item) => item.noteId === "n-other")!;
    expect(superseded.scores.keyword).toBeCloseTo(other.scores.keyword!, 1);
    expect(superseded.score).toBeLessThan(other.score * 0.7);
    expect(found.items.at(-1)!.noteId).toBe(old.noteId);
    // 이력까지 보면 상태로 가르지 않는다: 똑같이 맞은 두 글의 점수가 같다.
    const history = await index.search(search("동기화 sync", { mode: "keyword", filters: { includeHistory: true } }));
    expect(history.items.find((item) => item.noteId === old.noteId)!.score).toBeCloseTo(history.items.find((item) => item.noteId === "n-other")!.score, 1);
    expect((await index.search(search("동기화", { mode: "keyword", filters: { project: "other" } }))).items.map((item) => item.noteId)).toEqual(["n-other"]);
    expect((await index.search(search("동기화", { mode: "keyword", filters: { docType: ["decision"], docStatus: ["adopted"] } }))).items.map((item) => item.noteId)).toEqual([next.noteId]);
    port.put({ id: "f-a", kind: "folder", name: "가" } as never, { id: "n-in", parentId: "f-a", title: "폴더 안 동기화", body: "sync" });
    expect((await index.search(search("동기화", { mode: "keyword", filters: { folderId: "f-a" } }))).items.map((item) => item.noteId)).toEqual(["n-in"]);
    expect((await index.metaList()).items.map((item) => item.noteId).sort()).toEqual([next.noteId, old.noteId, "n-other"].sort());
  });

  test("문서 상태는 비슷하게 맞은 문서 사이에서만 순서를 바꾼다: 훨씬 잘 맞은 문서를 채택한 문서들이 밀어내지 않는다", async () => {
    const { port, index } = engine();
    const day = 86_400_000;
    // 가장 잘 맞는 글은 상태가 없고 가장 오래됐다. 채택한 문서 셋은 덜 맞을수록 새 글이다(고친 날짜로 줄 세우면 거꾸로 나온다).
    port.put({ id: "n-best", title: "배포 절차", body: "배포 절차를 순서대로 적는다. 배포 전 점검, 배포, 배포 뒤 확인.", updatedAt: day },
      { id: "n-strong", title: "배포 점검표", body: "배포 전에 볼 것을 적는다. 절차는 따로 둔다.", updatedAt: 2 * day },
      { id: "n-weak", title: "회의록", body: "여러 이야기를 했다. 일정, 예산, 채용, 그리고 배포 절차 이야기도 조금 나왔다. 다음 회의는 다음 주다.", updatedAt: 3 * day },
      { id: "n-weaker", title: "잡담", body: "점심 메뉴를 정했다. 날씨 이야기를 했다. 주말 계획을 나눴다. 끝에 배포 절차가 잠깐 나왔다. 그 밖에 여러 가지를 이야기했고 다음에 또 모이기로 했다. 다음 주에는 장소를 바꾸기로 했고 그때 다시 이야기한다.", updatedAt: 4 * day },
      // 흔한 말 하나(배포)만 걸린 글은 질의의 절반도 담지 못해 결과에 들지 않는다.
      { id: "n-noise", title: "일정", body: "다음 달에 배포가 있다.", updatedAt: 5 * day });
    for (const noteId of ["n-strong", "n-weak", "n-weaker", "n-noise"]) await index.setMeta({ noteId, docType: "design", docStatus: "adopted" });
    const found = await index.search(search("배포 절차", { mode: "keyword" }));
    expect(found.items.map((item) => item.noteId)).toEqual(["n-best", "n-strong", "n-weak", "n-weaker"]);
    // 점수도 그 순서대로 내려간다(맨 위 여럿이 같은 점수로 뭉치지 않는다).
    expect(found.items.map((item) => item.score)).toEqual([...found.items.map((item) => item.score)].sort((a, b) => b - a));
    expect(new Set(found.items.map((item) => item.score)).size).toBe(4);
    // 똑같이 맞으면 채택한 문서가 앞선다.
    port.put({ id: "n-twin-a", title: "복구 훈련", body: "복구 훈련 기록" }, { id: "n-twin-b", title: "복구 훈련", body: "복구 훈련 기록" });
    expect((await index.search(search("복구 훈련", { mode: "keyword" }))).items.map((item) => item.noteId)).toEqual(["n-twin-a", "n-twin-b"]);
    await index.setMeta({ noteId: "n-twin-b", docType: "decision", docStatus: "adopted" });
    expect((await index.search(search("복구 훈련", { mode: "keyword" }))).items.map((item) => item.noteId)).toEqual(["n-twin-b", "n-twin-a"]);
  });
});

describe("의미 연결과 의미 카드", () => {
  test("뜻이 가까운 메모를 근거 절과 함께 제안하고, 새 메모는 옛 메모의 제안에 바로 나오며, 거절한 쌍은 다시 내지 않는다", async () => {
    const { port, index, clock } = seeded();
    port.put({ id: "n-wake", title: "절전 뒤 갱신 지연", body: "노트북이 sleep에서 resume한 뒤 메모 갱신이 늦다. 밀린 sync가 원인으로 보인다.", updatedAt: clock.now - 10_000 },
      { id: "n-recipe", title: "된장찌개", body: "두부와 호박을 넣고 끓이는 요리.", updatedAt: clock.now - 10_000 });
    await indexAll(index);
    const links = await index.links();
    const pair = (a: string, b: string) => links.items.find((item) => item.a === (a < b ? a : b) && item.b === (a < b ? b : a));
    expect(pair("n-sync", "n-wake")).toBeDefined();
    expect(pair("n-cook", "n-recipe")).toBeDefined();
    expect(pair("n-cook", "n-sync")).toBeUndefined();
    expect(links.items.every((item) => item.a < item.b && item.strength > 0 && item.strength <= 1)).toBe(true);

    // 옛 메모(n-sync)를 다시 색인하지 않아도, 새로 등록한 메모가 그 제안에 나온다.
    const suggestions = await index.suggestions("n-sync");
    const wake = suggestions.items.find((item) => item.targetNoteId === "n-wake")!;
    expect(wake).toMatchObject({ title: "절전 뒤 갱신 지연", sourceHeading: "증분 동기화 설계 > 누락된 작업 재처리" });
    expect(wake.sourceSnippet).toContain("밀린 변경");
    expect(wake.targetSnippet).toContain("resume");

    expect(await index.dismiss("n-wake", "n-sync")).toEqual({ schemaVersion: 1, dismissed: true });
    expect((await index.suggestions("n-sync")).items.map((item) => item.targetNoteId)).not.toContain("n-wake");
    expect((await index.suggestions("n-wake")).items.map((item) => item.targetNoteId)).not.toContain("n-sync");
    // 다시 색인해도 거절은 남는다. 메모를 지우면 그 메모의 연결도 사라진다.
    await index.reindex({ scope: "all" });
    await indexAll(index);
    expect((await index.suggestions("n-sync")).items.map((item) => item.targetNoteId)).not.toContain("n-wake");
    port.remove("n-recipe");
    expect((await index.links()).items.some((item) => item.a === "n-recipe" || item.b === "n-recipe")).toBe(false);
    await expect(index.suggestions("n-recipe")).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });
  });

  test("에이전트가 쓴 의미 카드가 본문에 없는 낱말로도 찾게 하고, 카드에도 비밀은 싣지 않으며, 메모가 바뀌면 낡았다고 알린다", async () => {
    const { port, index, clock } = seeded();
    const pending = await index.cardsPending(3);
    expect(pending).toMatchObject({ total: 6, missing: 6, stale: 0 });
    expect(pending.items).toHaveLength(3);
    const login = (await index.cardsPending(50)).items.find((item) => item.noteId === "n-login")!;
    expect(login.text).toContain("[가림]");
    expect(login.text).not.toContain("hunter2");

    // 「hibernate」와 「offline-first」는 메모 어디에도 없다.
    expect((await index.search(search("hibernate offline-first", { mode: "keyword" }))).items).toEqual([]);
    const sync = (await index.cardsPending(50)).items.find((item) => item.noteId === "n-sync")!;
    const saved = await index.cardsSave("claude-fable", [
      { noteId: "n-sync", contentHash: sync.contentHash, summary: "기기가 꺼져 있던 동안 밀린 변경을 다시 받아 맞추는 동기화 설계", terms: ["hibernate", "offline-first", "catch-up", "절전 복귀"], questions: ["절전에서 깨어난 뒤 메모가 늦게 갱신되는 까닭은?"] },
      { noteId: "n-login", summary: "암호 재설정 방법. 관리자 비밀번호: leaked-PW7!", terms: ["password reset"], questions: [] },
      { noteId: "n-gone", summary: "없는 메모", terms: [], questions: [] },
      { noteId: "n-cook", contentHash: sha256("다른 내용"), summary: "읽은 뒤 바뀐 메모", terms: [], questions: [] },
    ]);
    expect(saved).toEqual({ schemaVersion: 1, saved: 2, skipped: [{ noteId: "n-gone", reason: "not_found" }, { noteId: "n-cook", reason: "changed" }] });
    expect(port.cardRows.get("n-login")!.summary).not.toContain("leaked-PW7");
    expect(port.cardRows.get("n-sync")).toMatchObject({ author: "claude-fable", contentHash: sync.contentHash });
    const found = await index.search(search("hibernate offline-first", { mode: "keyword" }));
    expect(found.items.map((item) => item.noteId)).toEqual(["n-sync"]);
    expect((await index.search(search("절전에서 깨어난 뒤 갱신", { mode: "keyword" }))).items[0]!.noteId).toBe("n-sync");

    // 카드의 요약은 조각 머리말에 들어가므로, 카드를 쓰면 그 메모를 다시 임베딩한다.
    await indexAll(index);
    const lease = await index.lease({ workerId: "w", model: FAKE_MODEL, limit: 8 });
    expect(lease.jobs).toEqual([]);
    expect(port.chunkRows.get(modelKey("fake-embed", FAKE_DIMS, "plain"))!.get("n-sync")!.length).toBeGreaterThan(0);
    expect((await index.status()).cards).toEqual({ total: 6, fresh: 2, stale: 0, missing: 4 });

    port.put({ id: "n-sync", body: "# 증분 동기화 설계\n\n전면 개정했다.", updatedAt: clock.now - 10_000 });
    expect((await index.status("n-sync")).items![0]!.card).toBe("stale");
    const again = await index.cardsPending(50);
    expect(again).toMatchObject({ missing: 4, stale: 1 });
    expect(again.items.at(-1)).toMatchObject({ noteId: "n-sync", stale: true });
  });
});
