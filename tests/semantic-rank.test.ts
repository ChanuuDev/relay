import { describe, expect, test } from "bun:test";
import { FLOOR_MIN_CHUNKS, FLOOR_PROBES, MAX_CHUNKS, encodeVector, floorFrom, parseProbe, parseSearch, type SearchRequest } from "@relay/core";
import { FAKE_DIMS, FAKE_MODEL, engine, fakeVector, indexAll } from "./semantic-helpers";

// 검색 순위와 문턱: 점수를 합치는 방식, 답이 없는 질의, 구절째 맞은 글, 일하는 저장소의 프로젝트, 바닥값 재기, 긴 메모, 연결의 세기.

const search = (query: string, extra: Partial<SearchRequest> = {}): SearchRequest => ({ query, mode: "hybrid", filters: {}, limit: 10, ...extra });
const withVector = (query: string, key: string, extra: Partial<SearchRequest> = {}) => search(query, { queryVector: encodeVector(fakeVector(query)), modelKey: key, ...extra });

describe("답이 없는 질의와 관련이 낮은 결과", () => {
  test("색인에 없는 것을 물으면 결과를 채우지 않고, 뜻으로는 맞지 않는데 낱말로 걸린 글에는 관련이 낮을 수 있다고 붙인다", async () => {
    const { port, index } = engine();
    port.put({ id: "n-budget", title: "가계부", body: "지출과 예산을 달마다 적는다." },
      { id: "n-close", title: "분기 정산 일정", body: "분기 정산 일정은 분기 말에 정한다." },
      { id: "n-cook", title: "김치찌개", body: "묵은지와 두부를 넣고 끓인다." },
      { id: "n-trip", title: "부산 여행", body: "기차와 숙소를 예약한다." });
    const { modelKey: key } = await indexAll(index);

    // 어느 메모와도 뜻이 닿지 않고 낱말도 없다: 바닥값을 넘는 메모가 없으므로 빈 결과다.
    expect(await index.search(withVector("양자역학 강의 노트", key))).toMatchObject({ searchMode: "hybrid", total: 0, items: [] });
    // 흔한 말 하나만 걸린 글도 결과를 채우지 않는다(질의의 낱말 셋 가운데 하나).
    expect((await index.search(withVector("양자역학 강의 일정", key))).items).toEqual([]);

    // 「예산」은 가계부와 뜻이 닿고, 「분기 정산」은 낱말로만 걸린다: 뒤의 글은 남기되 관련이 낮을 수 있다고 알린다.
    const mixed = await index.search(withVector("예산 분기 정산", key));
    expect(mixed.items.map((item) => item.noteId)).toEqual(["n-budget", "n-close"]);
    expect(mixed.items[0]!.weak).toBeUndefined();
    expect(mixed.items[0]!.scores.semantic).toBeGreaterThan(0.5);
    expect(mixed.items[1]).toMatchObject({ noteId: "n-close", weak: true });
    expect(mixed.items[1]!.scores.semantic).toBeUndefined();
    expect(mixed.items[0]!.score).toBeGreaterThan(mixed.items[1]!.score);

    // 의미 검색을 하지 못했을 때: 질의의 낱말을 절반도 담지 못한 글은 남기되 표시하고, 거의 담지 못한 글은 뺀다.
    const lexical = await index.search(search("분기 정산 양자역학 강의"));
    expect(lexical).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "embedder_offline" });
    expect(lexical.items.map((item) => [item.noteId, item.weak ?? false])).toEqual([["n-close", true]]);
    expect((await index.search(search("분기 정산"))).items.map((item) => [item.noteId, item.weak ?? false])).toEqual([["n-close", false]]);
    expect((await index.search(search("일정 양자역학 강의 노트 필기"))).items).toEqual([]);
  });

  test("뜻으로 맞은 글은 1위의 0.6배를 넘는 것만 남는다", async () => {
    const { port, index } = engine();
    // 「배포」로만 이루어진 글, 배포와 회의가 반씩인 글, 회의가 대부분인 글.
    port.put({ id: "n-pure", title: "release 점검", body: "release 전에 compose 파일을 본다." },
      { id: "n-half", title: "release 안건", body: "다음 주에 이야기한다." },
      { id: "n-little", title: "주간 회의록", body: "회의 안건을 적는다. meeting 뒤에 release 이야기를 한다." });
    const { modelKey: key } = await indexAll(index);
    const found = await index.search(withVector("deploy 컨테이너 레지스트리", key, { mode: "semantic" }));
    // n-half는 0.7쯤, n-little은 0.24쯤으로 맞는다: 바닥값(0.2)은 넘지만 1위의 0.6배에 못 미친 글은 뺀다.
    expect(found.items.map((item) => item.noteId)).toEqual(["n-pure", "n-half"]);
    expect(found.items[1]!.scores.semantic!).toBeGreaterThan(found.items[0]!.scores.semantic! * 0.6);
  });
});

describe("구절째 맞은 글과 점수 합치기", () => {
  test("질의가 글에 구절째 들어 있으면 그 글을 맨 앞에 둔다", async () => {
    const { port, index } = engine();
    const filler = Array.from({ length: 30 }, (_unused, at) => `${at + 1}번째 줄에는 다른 이야기를 길게 적어 둔다.`).join("\n");
    port.put({ id: "n-quote", title: "회고", body: `${filler}\n\n그날 서버 점검 순서를 다시 정하기로 했다.\n\n${filler}` },
      // 질의의 낱말을 더 자주 담았지만 구절은 없다: 낱말 점수만으로는 이 글이 앞선다.
      { id: "n-words", title: "서버 점검 순서", body: "점검. 서버. 순서. 서버 순서 점검을 다시 본다. 정하기." });
    const loose = await index.search(search("서버 점검 순서 정하기", { mode: "keyword" }));
    expect(loose.items[0]!.noteId).toBe("n-words");
    const exact = await index.search(search("서버 점검 순서를 다시 정하기로", { mode: "keyword" }));
    expect(exact.items.map((item) => item.noteId)).toEqual(["n-quote", "n-words"]);
    expect(exact.items[0]).toMatchObject({ score: 1 });
    expect(exact.items[0]!.weak).toBeUndefined();
    // 짧은 질의(12자 미만)는 구절로 보지 않는다.
    expect((await index.search(search("서버 점검 순서", { mode: "keyword" }))).items[0]!.noteId).toBe("n-words");
  });

  test("뜻과 낱말의 점수를 더해 줄 세운다: 뜻으로 가장 가까운 글이 흔한 낱말을 자주 담은 글에 밀리지 않는다", async () => {
    const { port, index } = engine();
    // 질의의 「sleep」은 n-meaning에 없는 낱말이지만 뜻이 닿고, 나머지 낱말은 n-words에만 있다.
    port.put({ id: "n-meaning", title: "절전 뒤 복귀", body: "노트북이 resume하면 wake 신호를 기다린다." },
      { id: "n-words", title: "서버 점검 순서", body: "서버 점검 순서를 적는다. 서버 점검 순서." },
      { id: "n-far", title: "부산 여행", body: "기차와 숙소를 예약한다." });
    const { modelKey: key } = await indexAll(index);
    const found = await index.search(withVector("sleep 서버 점검 순서", key));
    expect(found.items.map((item) => item.noteId)).toEqual(["n-meaning", "n-words"]);
    // 뜻의 몫이 0.7, 낱말의 몫이 0.3이다: 뜻으로 1위인 글은 0.7, 낱말로만 1위인 글은 0.3 남짓을 받는다(순위만 보고 합치면 둘이 같았다).
    expect(found.items[0]!.score).toBeGreaterThanOrEqual(0.7);
    expect(found.items[0]!.score).toBeLessThanOrEqual(1);
    expect(found.items[1]).toMatchObject({ weak: true, scores: { keyword: 1 } });
    expect(found.items[1]!.score).toBeGreaterThanOrEqual(0.3);
    expect(found.items[1]!.score).toBeLessThan(0.45);
    // 낱말만으로 찾으면 낱말 점수 그대로다.
    expect((await index.search(search("sleep 서버 점검 순서", { mode: "keyword" }))).items.map((item) => [item.noteId, item.score])).toEqual([["n-words", 1]]);
  });
});

describe("일하는 저장소의 프로젝트", () => {
  test("그 저장소에서 등록한 문서의 프로젝트를 앞에 두되 좁히지는 않는다", async () => {
    const { index } = engine();
    // 두 프로젝트에 같은 이름의 「작업 지침」이 있고, 다른 프로젝트의 것이 질의에 조금 더 맞는다.
    const mine = await index.register({ title: "작업 지침", body: "배포 전에 검증 절차를 돌린다. 그 밖에 여러 가지를 길게 적는다. 다른 이야기도 함께 적어 둔다.", docType: "knowledge", project: "alpha", sourceRepo: "alpha-repo", sourcePath: "AGENTS.md" });
    const theirs = await index.register({ title: "작업 지침", body: "배포 전에 검증 절차를 돌린다. 배포 뒤에도 검증 절차를 돌린다.", docType: "knowledge", project: "beta", sourceRepo: "beta-repo", sourcePath: "AGENTS.md" });
    const far = await index.register({ title: "배포 검증 절차", body: "배포 검증 절차. 배포 검증 절차. 배포 검증 절차를 그대로 적는다.", docType: "knowledge", project: "beta", sourceRepo: "beta-repo", sourcePath: "docs/server.md" });
    const ids = (response: { items: Array<{ noteId: string }> }) => response.items.map((item) => item.noteId);

    const everywhere = await index.search(search("배포 검증 절차", { mode: "keyword" }));
    expect(everywhere.preferredProjects).toBeUndefined();
    expect(ids(everywhere)).toEqual([far.noteId, theirs.noteId, mine.noteId]);

    const here = await index.search(search("배포 검증 절차", { mode: "keyword", filters: { sourceRepo: "ALPHA-repo" } }));
    expect(here.preferredProjects).toEqual(["alpha"]);
    // 같은 종류의 문서(작업 지침)는 내 프로젝트의 것이 앞서지만, 훨씬 잘 맞은 다른 프로젝트의 문서는 그대로 맨 앞이고 결과에서 빠지지도 않는다.
    expect(ids(here)).toEqual([far.noteId, mine.noteId, theirs.noteId]);
    expect(here.total).toBe(3);

    // 프로젝트를 정해 좁혔으면 저장소로 올리지 않는다. 그 저장소에서 등록한 문서가 없으면 아무것도 바꾸지 않는다.
    const narrowed = await index.search(search("배포 검증 절차", { mode: "keyword", filters: { project: "beta", sourceRepo: "alpha-repo" } }));
    expect(narrowed.preferredProjects).toBeUndefined();
    expect(ids(narrowed)).toEqual([far.noteId, theirs.noteId]);
    const unknown = await index.search(search("배포 검증 절차", { mode: "keyword", filters: { sourceRepo: "gamma-repo" } }));
    expect(unknown.preferredProjects).toBeUndefined();
    expect(ids(unknown)).toEqual(ids(everywhere));

    expect(parseSearch({ query: "배포", filters: { sourceRepo: "alpha-repo" } }).filters).toEqual({ sourceRepo: "alpha-repo" });
    expect(() => parseSearch({ query: "배포", filters: { sourceRepo: 3 } })).toThrow();
  });
});

describe("검색 바닥값 재기", () => {
  test("답이 없을 질의들이 지금 색인에서 얼마나 높이 맞는지 재고, 그 85번째 백분위 바로 위를 바닥값으로 삼는다", async () => {
    const { port, index } = engine();
    port.put({ id: "n-cook", title: "김치찌개", body: "묵은지와 두부를 넣고 끓인다." }, { id: "n-trip", title: "부산 여행", body: "기차와 숙소를 예약한다." });
    const { modelKey: key } = await indexAll(index);
    const probes = ["양자역학 강의 노트", "묵은지 찌개 끓이기"];
    const measured = await index.probe({ modelKey: key, vectors: probes.map((text) => encodeVector(fakeVector(text))) });
    expect(measured).toMatchObject({ schemaVersion: 1, modelKey: key, chunks: 2 });
    expect(measured.tops).toHaveLength(2);
    // 닿는 메모가 없는 질의는 낮게, 닿는 메모가 있는 질의는 높게 맞는다.
    expect(measured.tops[0]!).toBeLessThan(0.2);
    expect(measured.tops[1]!).toBeGreaterThan(0.9);
    // 재기만 한다: 색인과 상태는 그대로다.
    expect((await index.status()).summary).toMatchObject({ ready: 2, pending: 0 });
    await expect(index.probe({ modelKey: "other@16/plain/c2", vectors: [] })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });
    await expect(index.probe({ modelKey: key, vectors: [encodeVector(new Float32Array(FAKE_DIMS + 1).fill(0.1))] })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    expect(FLOOR_PROBES).toHaveLength(16);
    expect(new Set(FLOOR_PROBES).size).toBe(16);
    // 16개 가운데 85번째 백분위(14번째 값)에 0.01을 더한다. 하나둘 높이 맞은 질의(우연히 답이 있던 것)는 바닥값을 올리지 않는다.
    const tops = [0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.5, 0.7];
    expect(floorFrom(tops)).toBe(0.25);
    expect(floorFrom([...tops].reverse())).toBe(0.25);
    // 자가 진단이 정한 값보다 내려가지 않고, 0.6을 넘지 않으며, 잰 값이 없으면 진단 값 그대로다.
    expect(floorFrom(tops, 0.3)).toBe(0.3);
    expect(floorFrom(tops.map(() => 0.9))).toBe(0.6);
    expect(floorFrom([], 0.2)).toBe(0.2);

    expect(parseProbe({ modelKey: key, vectors: ["AAAA"] })).toEqual({ modelKey: key, vectors: ["AAAA"] });
    expect(parseProbe({ modelKey: key, vectors: ["AAAA"], apply: true, diagnosed: 0.2 })).toEqual({ modelKey: key, vectors: ["AAAA"], apply: true, diagnosed: 0.2 });
    expect(() => parseProbe({ modelKey: key, vectors: ["AAAA"], apply: "yes" })).toThrow();
    expect(() => parseProbe({ modelKey: key, vectors: ["AAAA"], diagnosed: 2 })).toThrow();
    expect(() => parseProbe({ modelKey: key, vectors: Array.from({ length: 33 }, () => "AAAA") })).toThrow();
    expect(() => parseProbe({ modelKey: key })).toThrow();
    expect(() => parseProbe({ vectors: [] })).toThrow();
  });

  test("잰 값을 색인에 남기면 그 값으로 거르고, 워커의 임대는 그 값을 되돌리지 않는다", async () => {
    const { port, index } = engine();
    // 「deploy」와 0.7쯤 맞는 글 하나와, 「여행」과 0.45쯤 맞는 글 여럿(조각이 FLOOR_MIN_CHUNKS개를 넘는다).
    port.put({ id: "n-half", title: "release 안건", body: "다음 주에 이야기한다." },
      ...Array.from({ length: FLOOR_MIN_CHUNKS }, (_unused, at) => ({ id: `n-mix-${String(at).padStart(2, "0")}`, title: `부산 가계부 지출 ${at}`, body: "적는다." })));
    const { modelKey: key } = await indexAll(index);
    expect(port.modelRows.get(key)).toMatchObject({ floor: FAKE_MODEL.floor, active: true });
    expect((await index.status()).models[0]).toMatchObject({ key, floor: FAKE_MODEL.floor });
    const hits = async (query: string) => (await index.search(withVector(query, key, { mode: "semantic", limit: 100 }))).items.length;
    expect(await hits("deploy")).toBe(1);
    expect(await hits("여행")).toBe(FLOOR_MIN_CHUNKS);

    // 답이 없을 질의 16개 가운데 14개가 「여행」처럼 0.45쯤으로 맞는다고 하자: 바닥값이 그 바로 위로 올라간다.
    const vectors = [...Array.from({ length: 14 }, () => "여행"), "양자역학", "천문학"].map((text) => encodeVector(fakeVector(text)));
    // apply 없이 재면 색인을 바꾸지 않는다.
    const dry = await index.probe({ modelKey: key, vectors });
    expect(dry.floor).toBeUndefined();
    expect(port.modelRows.get(key)).toMatchObject({ floor: FAKE_MODEL.floor });
    const applied = await index.probe({ modelKey: key, vectors, apply: true, diagnosed: FAKE_MODEL.floor });
    expect(applied).toMatchObject({ chunks: FLOOR_MIN_CHUNKS + 1 });
    expect(applied.floor).toBe(floorFrom(applied.tops, FAKE_MODEL.floor));
    expect(applied.floor!).toBeGreaterThan(0.44);
    expect(applied.floor!).toBeLessThan(0.47);
    expect(port.modelRows.get(key)).toMatchObject({ floor: applied.floor, active: true });
    expect((await index.status()).models[0]).toMatchObject({ floor: applied.floor });
    // 이제 0.45쯤으로 맞던 글들은 뜻으로 찾았다고 보지 않는다. 더 잘 맞는 글은 그대로 찾는다.
    expect(await hits("여행")).toBe(0);
    expect(await hits("deploy")).toBe(1);

    // 워커가 자가 진단 값을 들고 임대해도 색인에 남긴 값은 그대로다(PC가 둘이어도 서로의 값을 번갈아 되돌리지 않는다).
    expect(await index.lease({ workerId: "other-pc", model: FAKE_MODEL, limit: 8 })).toMatchObject({ modelKey: key, jobs: [] });
    expect(port.modelRows.get(key)).toMatchObject({ floor: applied.floor });
    // 거의 같은 값으로는 고쳐 쓰지 않고, 색인이 작으면 재지 않는다.
    const again = await index.probe({ modelKey: key, vectors, apply: true, diagnosed: FAKE_MODEL.floor });
    expect(again.floor).toBe(applied.floor);
    for (let at = 3; at < FLOOR_MIN_CHUNKS; at++) port.remove(`n-mix-${String(at).padStart(2, "0")}`);
    expect((await index.probe({ modelKey: key, vectors, apply: true })).floor).toBeUndefined();
    expect(port.modelRows.get(key)).toMatchObject({ floor: applied.floor });
  });
});

describe("긴 메모", () => {
  test("조각 상한에 걸린 메모를 상태에서 알리고, 카드를 쓸 때는 잘린 뒤의 소제목을 함께 준다", async () => {
    const { port, index } = engine();
    const section = (at: number) => `## 절 ${at}\n\n${Array.from({ length: 6 }, (_unused, line) => `절 ${at}의 ${line + 1}번째 문장으로 조각이 따로 서도록 충분히 길게 쓴다.`).join("\n")}`;
    port.put({ id: "n-huge", title: "아주 긴 문서", body: Array.from({ length: MAX_CHUNKS + 20 }, (_unused, at) => section(at)).join("\n\n") },
      { id: "n-long", title: "긴 문서", body: ["# 긴 문서", "", "가나다라마바사 ".repeat(900), "", "## 뒤쪽 설치", "", "설치한다.", "", "```sh", "# 주석이지 소제목이 아니다", "```", "", "### 뒤쪽 점검", "", "점검한다.", "", "#### 너무 깊은 제목", "", "끝."].join("\n") },
      { id: "n-short", title: "짧은 문서", body: "## 머리\n\n짧다." });
    await indexAll(index);
    const status = await index.status();
    expect(status).toMatchObject({ truncated: 1 });
    expect((await index.status("n-huge")).items![0]).toMatchObject({ status: "ready", chunks: MAX_CHUNKS, truncated: true });
    expect((await index.status("n-long")).items![0]).toMatchObject({ status: "ready", truncated: false });

    const pending = (await index.cardsPending(50)).items;
    const long = pending.find((item) => item.noteId === "n-long")!;
    expect(long).toMatchObject({ clipped: true, outline: ["## 뒤쪽 설치", "### 뒤쪽 점검"] });
    expect(long.text).toHaveLength(6000);
    const short = pending.find((item) => item.noteId === "n-short")!;
    expect(short.clipped).toBe(false);
    expect(short.outline).toBeUndefined();
    // 소제목이 아주 많은 문서는 앞의 40개만 준다.
    expect(pending.find((item) => item.noteId === "n-huge")!.outline).toHaveLength(40);
  });

  test("메모에 저장된 카드를 읽고, 카드를 쓴 뒤 메모가 바뀌었는지 안다", async () => {
    const { port, index, clock } = engine();
    port.put({ id: "n-sync", title: "증분 동기화 설계", body: "밀린 변경을 다시 받아 적용한다." }, { id: "n-cook", title: "김치찌개", body: "묵은지와 두부를 넣고 끓인다." });
    expect(await index.card("n-cook")).toEqual({ schemaVersion: 1, noteId: "n-cook", title: "김치찌개", path: "", state: "missing", card: null });
    await index.cardsSave("claude-fable", [{ noteId: "n-sync", summary: "꺼져 있던 동안 밀린 변경을 맞추는 설계", terms: ["catch-up"], questions: ["다시 켜면 무엇을 하나?"] }]);
    expect(await index.card("n-sync")).toEqual({ schemaVersion: 1, noteId: "n-sync", title: "증분 동기화 설계", path: "", state: "fresh",
      card: { summary: "꺼져 있던 동안 밀린 변경을 맞추는 설계", terms: ["catch-up"], questions: ["다시 켜면 무엇을 하나?"], author: "claude-fable", updatedAt: clock.now } });
    port.put({ id: "n-sync", body: "전면 개정했다." });
    expect(await index.card("n-sync")).toMatchObject({ state: "stale", card: { summary: "꺼져 있던 동안 밀린 변경을 맞추는 설계" } });
    await expect(index.card("n-gone")).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });
  });
});

describe("의미 연결의 세기", () => {
  test("가까운 쌍과 느슨한 쌍의 세기가 다르고, 자기 자신과 맞는 정도의 절반 남짓에 못 미치는 쌍은 잇지 않는다", async () => {
    const { port, index } = engine();
    port.put({ id: "n-a", title: "배포 절차", body: "레지스트리에 올리고 컨테이너를 띄운다. deploy" },
      { id: "n-b", title: "release 점검", body: "release 전에 compose 파일을 본다." },
      // 배포와 회의가 반씩 섞인 글: 배포 글과 0.7쯤으로 맞는다.
      { id: "n-c", title: "release 안건", body: "다음 주에 이야기한다." },
      // 회의가 대부분인 글: 배포 글과 0.3쯤으로 맞는다(잇지 않는다).
      { id: "n-d", title: "주간 회의록", body: "회의 안건을 적는다. meeting 뒤에 release 이야기를 한다." },
      { id: "n-e", title: "김치찌개", body: "묵은지와 두부를 넣고 끓인다." });
    await indexAll(index);
    const links = (await index.links()).items;
    const pair = (a: string, b: string) => links.find((item) => item.a === (a < b ? a : b) && item.b === (a < b ? b : a));
    const close = pair("n-a", "n-b")!, loose = pair("n-a", "n-c")!;
    expect(close.strength).toBeGreaterThan(0.9);
    expect(loose.strength).toBeGreaterThan(0.3);
    expect(loose.strength).toBeLessThan(0.8);
    expect(pair("n-a", "n-d")).toBeUndefined();
    expect(pair("n-a", "n-e")).toBeUndefined();
    expect(pair("n-c", "n-e")).toBeUndefined();
    // 회의 글은 반씩 섞인 글과는 이어진다(한쪽에서 본 비율이 문턱을 넘는다).
    expect(pair("n-c", "n-d")).toBeDefined();
    // 세기가 모두 1로 뭉치지 않는다. 가장 센 것부터 준다.
    expect(new Set(links.map((item) => item.strength)).size).toBeGreaterThan(1);
    expect(links.map((item) => item.strength)).toEqual([...links.map((item) => item.strength)].sort((x, y) => y - x));
    expect(links.every((item) => item.strength >= 0.1 && item.strength <= 1)).toBe(true);
  });
});
