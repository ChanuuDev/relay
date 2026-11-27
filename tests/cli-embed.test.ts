import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanup, cli, root, temporary } from "./helpers";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";
import { EmbedderHost, loadEmbedding, saveEmbedding } from "../src/notes/embed";
import { frontmatter, gitSource } from "../src/notes/embed-cli";
import { NoteStore } from "../src/notes/notes.store";
import { FAKE_DIMS } from "./semantic-helpers";

// 임베딩 서버는 다른 프로세스로 띄운다(CLI를 기다리는 동안 이 테스트 프로세스는 멈춰 있으므로 안에서 띄우면 답하지 못한다).
const bun = process.execPath;
const fake = path.join(root, "tests", "support", "fake-embedder.ts");
function freePort() {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  return port;
}
async function up(port: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/calls`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* 아직 뜨지 않았다. */ }
    await Bun.sleep(50);
  }
  throw new Error("fake embedder did not start");
}

describe("relay embed와 의미 검색 CLI", () => {
  let dir: string;
  const servers: Array<ReturnType<typeof Bun.spawn>> = [];
  let good = 0, blind = 0;
  beforeAll(async () => {
    good = freePort(); blind = freePort();
    servers.push(Bun.spawn([bun, fake, String(good)], { stdout: "ignore", stderr: "ignore" }), Bun.spawn([bun, fake, String(blind), "blind"], { stdout: "ignore", stderr: "ignore" }));
    await Promise.all([up(good), up(blind)]);
  });
  afterAll(() => { for (const server of servers) server.kill(); });
  beforeEach(() => {
    dir = temporary();
    const old = Date.now() - 60_000;
    const note = (id: string, title: string, body: string, parentId: string | null = null) => ({ id, kind: "note" as const, parentId, title, body, position: null, createdAt: old, updatedAt: old });
    const db = openDatabase(loadConfig(dir));
    new NoteStore(db).apply({ deletes: [], upserts: [
      { id: "f-design", kind: "folder", parentId: null, name: "설계", position: null, createdAt: old, updatedAt: old },
      note("n-sync", "증분 동기화 설계", "# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다.", "f-design"),
      note("n-wake", "노트북을 열면 메모가 늦게 뜬다", "sleep에서 resume한 뒤 sync가 밀린다."),
      note("n-deploy", "서버 배포 절차", "이미지를 레지스트리에 올리고 컨테이너를 다시 띄운다.\n\n관리자 비밀번호: hunter2-XYZ!", "f-design"),
      note("n-cook", "김치찌개", "두부를 넣고 끓인다."),
    ] });
    db.close();
  });
  afterEach(() => cleanup(dir));
  const setup = (port: number, ...extra: string[]) => cli(dir, ["embed", "setup", "--url", `http://127.0.0.1:${port}`, "--model", "fake-embed", "--dimensions", String(FAKE_DIMS), ...extra]);

  test("임베딩 서버를 잇고 색인하면 낱말이 달라도 뜻으로 찾고, 그래프의 제안과 맥락 묶음도 뜻을 따른다", () => {
    const before = cli(dir, ["embed", "status"]).data;
    expect(before).toMatchObject({ activeModelKey: null, embedding: null, summary: { total: 4, ready: 0, pending: 4 } });
    expect(cli(dir, ["embed", "run"]).data.error).toMatchObject({ code: "INVALID_CONFIG" });
    expect(cli(dir, ["memo", "--search", "resume from sleep sync"]).data).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "no_index" });

    // 벡터는 나오지만 뜻을 담지 못하는 서버는 자가 진단에서 걸려 저장하지 않는다.
    const refused = setup(blind);
    expect(refused.code).toBe(1);
    expect(refused.data).toMatchObject({ saved: false, diagnosis: { ok: false } });
    expect(existsSync(path.join(dir, "embedding.json"))).toBe(false);
    // 꺼진 서버.
    expect(setup(freePort()).data.error.code).toBe("EMBEDDING_FAILED");

    const saved = setup(good, "--idle", "3").data;
    expect(saved).toMatchObject({ saved: true, diagnosis: { ok: true, dimensions: FAKE_DIMS }, embedding: { model: "fake-embed", dimensions: FAKE_DIMS, prompt: "plain", style: "openai", idleMinutes: 3 } });
    expect(saved.diagnosis.passed).toBe(saved.diagnosis.total);
    expect(loadEmbedding(dir)).toMatchObject({ url: `http://127.0.0.1:${good}`, floor: saved.diagnosis.floor });

    const run = cli(dir, ["embed", "run"]).data;
    expect(run).toMatchObject({ notes: 4, failed: 0, remaining: 0, offline: false, modelKey: `fake-embed@${FAKE_DIMS}/plain/c2` });
    expect(run).toMatchObject({ embedded: 4, reused: 0 });
    // 색인이 작을 때는 검색 바닥값을 재지 않는다(조각 50개부터 잰다).
    expect(run.searchFloor).toBeUndefined();
    expect(cli(dir, ["embed", "run"]).data).toMatchObject({ notes: 0, embedded: 0 });
    const status = cli(dir, ["embed", "status", "--note", "n-sync"]).data;
    expect(status).toMatchObject({ activeModelKey: run.modelKey, summary: { total: 4, ready: 4, pending: 0 }, items: [{ noteId: "n-sync", status: "ready", chunks: 1 }] });

    // 「wake sync」는 n-sync 본문에 없는 낱말이다.
    const found = cli(dir, ["memo", "--search", "wake up sync"]).data;
    expect(found).toMatchObject({ searchMode: "hybrid", modelKey: run.modelKey });
    expect(found.items.map((item: { id: string }) => item.id).slice(0, 2).sort()).toEqual(["n-sync", "n-wake"]);
    expect(found.items.find((item: { id: string }) => item.id === "n-sync").matches[0]).toMatchObject({ headingPath: "증분 동기화 설계 > 누락된 작업 재처리" });
    expect(cli(dir, ["memo", "--search", "wake up sync", "--mode", "keyword"]).data.items.map((item: { id: string }) => item.id)).not.toContain("n-sync");
    expect(JSON.stringify(cli(dir, ["memo", "--search", "배포 deploy"]).data)).not.toContain("hunter2");

    // 그래프: 뜻이 가까운 쌍이 제안으로 나오고, 맥락 묶음은 뜻으로 찾은 메모에서 시작한다.
    const suggested = cli(dir, ["graph", "suggest", "--semantic"]).data;
    expect(suggested.items.map((item: { from: { id: string }; to: { id: string } }) => [item.from.id, item.to.id].sort().join("|"))).toEqual(["n-sync|n-wake"]);
    expect(suggested.items[0].reasons[0]).toContain("낱말은 달라도 뜻이 가깝습니다");
    expect(cli(dir, ["graph", "map"]).data.counts.edges.semantic).toBe(1);
    const context = cli(dir, ["graph", "context", "wake", "up", "sync"]).data;
    expect(context.core.map((item: { id: string }) => item.id).slice(0, 2).sort()).toEqual(["n-sync", "n-wake"]);
    expect(context.core.find((item: { id: string }) => item.id === "n-sync").why).toContain("질의와 뜻이 가까움");
    expect(cli(dir, ["graph", "context", "wake", "up", "sync", "--lexical"]).data.core.map((item: { id: string }) => item.id)).not.toContain("n-sync");

    // 임베딩 서버가 꺼지면 받은 일을 돌려놓고 멈추며, 검색은 낱말로 답한다. 메모를 지우면 색인도 함께 사라진다.
    const db = openDatabase(loadConfig(dir));
    new NoteStore(db).apply({ deletes: ["n-cook"], upserts: [{ id: "n-new", kind: "note", parentId: null, title: "새 메모", body: "resume sync", position: null, createdAt: 1, updatedAt: Date.now() - 60_000 }] });
    expect(db.query("SELECT count(*) AS total FROM note_chunks WHERE note_id = 'n-cook'").get()).toEqual({ total: 0 });
    db.close();
    writeFileSync(path.join(dir, "embedding.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(dir, "embedding.json"), "utf8")), url: `http://127.0.0.1:${freePort()}` }));
    const offline = cli(dir, ["embed", "run"]);
    expect(offline.code).toBe(1);
    expect(offline.data).toMatchObject({ notes: 0, offline: true, remaining: 1 });
    expect(cli(dir, ["memo", "--search", "wake up sync"]).data).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "embedder_offline" });
    expect(cli(dir, ["embed", "status"]).data.summary).toMatchObject({ total: 4, ready: 3, pending: 1, failed: 0 });
    expect(cli(dir, ["embed", "reindex", "--all"]).data).toEqual({ schemaVersion: 1, queued: 4 });
    expect(cli(dir, ["embed", "reindex"]).code).toBe(2);
    expect(cli(dir, ["embed", "setup", "--remove"]).data).toEqual({ schemaVersion: 1, removed: true });
    expect(existsSync(path.join(dir, "embedding.json"))).toBe(false);
  }, 60000);

  test("의미 카드와 문서 등록: 에이전트가 쓴 카드로 본문에 없는 말을 찾고, Git 문서는 같은 메모를 고치며 대체 관계를 남긴다", () => {
    const pending = cli(dir, ["embed", "cards", "--limit", "10"]).data;
    expect(pending).toMatchObject({ total: 4, missing: 4, stale: 0 });
    const deploy = pending.items.find((item: { noteId: string }) => item.noteId === "n-deploy");
    expect(deploy.text).toContain("[가림]");
    expect(deploy.text).not.toContain("hunter2");
    const sync = pending.items.find((item: { noteId: string }) => item.noteId === "n-sync");
    const file = path.join(dir, "cards.json");
    writeFileSync(file, JSON.stringify({ author: "claude-fable", cards: [
      { noteId: "n-sync", contentHash: sync.contentHash, summary: "꺼져 있던 동안 밀린 변경을 다시 맞추는 설계", terms: ["hibernate", "offline-first"], questions: ["절전 뒤에 메모가 늦게 뜨는 까닭은?"] },
      { noteId: "n-none", summary: "없는 메모", terms: [], questions: [] }] }));
    expect(cli(dir, ["embed", "cards", "--save", file]).data).toEqual({ schemaVersion: 1, saved: 1, skipped: [{ noteId: "n-none", reason: "not_found" }] });
    expect(cli(dir, ["memo", "--search", "hibernate offline-first"]).data.items.map((item: { id: string }) => item.id)).toEqual(["n-sync"]);
    expect(cli(dir, ["embed", "status"]).data.cards).toEqual({ total: 4, fresh: 1, stale: 0, missing: 3 });
    expect(cli(dir, ["embed", "cards", "--save", path.join(dir, "missing.json")]).data.error.code).toBe("INVALID_ARGUMENT");

    // 등록: 본문은 파일 그대로, 머리말의 문서 정보는 따로 읽는다.
    const docs = path.join(dir, "docs");
    mkdirSync(docs);
    const first = path.join(docs, "adr-001.md"), second = path.join(docs, "adr-002.md");
    const body = "---\ntitle: 동기화 결정 1\ntype: decision\nstatus: adopted\nproject: relay\n---\n\n동기화는 폴링으로 한다.\n";
    writeFileSync(first, body);
    writeFileSync(second, "# 동기화 결정 2\n\n동기화는 푸시로 바꾼다.\n");
    const env = process.env.RELAY_NO_GIT;
    process.env.RELAY_NO_GIT = "1";
    try {
      const created = cli(dir, ["memo", "register", first]).data;
      expect(created).toMatchObject({ action: "created" });
      const stored = cli(dir, ["memo", "--find", created.noteId]).data.item;
      expect(stored).toMatchObject({ title: "동기화 결정 1", body, parentId: null });
      // --folder는 relay memo --list의 옵션과 이름이 같다. 등록에 준 값이 윗 명령으로 새지 않고 그 폴더에 만들어져야 한다.
      const third = path.join(docs, "adr-003.md");
      writeFileSync(third, "# 폴더에 넣을 문서\n\n설계 폴더 아래에 둔다.\n");
      const placed = cli(dir, ["memo", "register", third, "--folder", "f-design"]).data;
      expect(cli(dir, ["memo", "--find", placed.noteId]).data.item).toMatchObject({ title: "폴더에 넣을 문서", parentId: "f-design" });
      expect(cli(dir, ["memo", "register", third, "--folder", "f-none"]).data.error.code).toBe("NOTE_NOT_FOUND");
      expect(cli(dir, ["memo", "meta", created.noteId]).data.meta).toMatchObject({ docType: "decision", docStatus: "adopted", project: "relay", sourceRepo: null });
      writeFileSync(first, `${body}\n보완: 간격은 30초.\n`);
      expect(cli(dir, ["memo", "register", first, "--note", created.noteId]).data).toMatchObject({ action: "updated", noteId: created.noteId });
      expect(cli(dir, ["memo", "register", first, "--note", created.noteId]).data).toMatchObject({ action: "unchanged" });
      const next = cli(dir, ["memo", "register", second, "--type", "decision", "--status", "adopted", "--project", "relay", "--supersedes", created.noteId]).data;
      expect(next).toMatchObject({ action: "created", superseded: created.noteId });
      const found = cli(dir, ["memo", "--search", "동기화 결정", "--type", "decision"]).data.items;
      expect(found.map((item: { id: string }) => item.id)).toEqual([next.noteId, created.noteId]);
      expect(found[1]).toMatchObject({ docStatus: "superseded", supersededBy: { id: next.noteId, title: "동기화 결정 2" } });
      expect(cli(dir, ["memo", "--search", "동기화 결정", "--status", "adopted"]).data.items.map((item: { id: string }) => item.id)).toEqual([next.noteId]);
      expect(cli(dir, ["memo", "meta", "n-cook", "--type", "knowledge", "--project", "home"]).data.meta).toMatchObject({ noteId: "n-cook", docType: "knowledge", project: "home" });
      expect(cli(dir, ["memo", "meta"]).data.items).toHaveLength(4);
      expect(cli(dir, ["memo", "meta", next.noteId, "--superseded-by", created.noteId]).data.error.code).toBe("INVALID_ARGUMENT");
      expect(cli(dir, ["memo", "register", path.join(docs, "none.md")]).data.error.code).toBe("FILE_NOT_FOUND");
    } finally { if (env === undefined) delete process.env.RELAY_NO_GIT; else process.env.RELAY_NO_GIT = env; }
  }, 60000);

  test("머리말과 Git 출처를 읽고, 띄우는 명령이 있으면 임베딩 서버를 필요할 때 띄웠다가 끈다", async () => {
    expect(frontmatter("---\ntitle: \"제목\"\ndoc_type: design\nstatus: draft\nproject: relay\nextra: x\n---\n본문")).toEqual({ title: "제목", type: "design", status: "draft", project: "relay" });
    expect(frontmatter("# 머리말 없는 글\n---\ntitle: 아님\n---")).toEqual({});
    // 이 저장소의 파일: 저장소 이름(주소의 마지막 마디)과 저장소 안 경로, 커밋만 남는다.
    const source = gitSource(path.join(root, "README.md"));
    if (source) {
      expect(source.sourcePath).toBe("README.md");
      expect(source.sourceRepo).not.toMatch(/[\s\\:@]/);
      expect(source.sourceCommit ?? "abcdefg").toMatch(/^[0-9a-f]{7,12}$/);
    }
    expect(gitSource(path.join(dir, "outside.md"))).toBeNull();

    const port = freePort();
    const host = new EmbedderHost({ url: `http://127.0.0.1:${port}`, style: "openai", model: "fake-embed", dimensions: FAKE_DIMS, prompt: "plain", launch: [bun, fake, String(port)], idleMinutes: 1 });
    try {
      expect(await host.alive(300)).toBe(false);
      // 검색 질의: 꺼져 있으면 이번에는 못 한다고 바로 답하고 뒤에서 띄운다.
      expect(await host.query("wake sync")).toEqual({ failed: "embedder_offline" });
      expect(await host.ensure(15_000)).toBe(true);
      expect(host.running).toBe(true);
      expect(await host.query("wake sync")).toBeInstanceOf(Float32Array);
      const attached = await host.attach({ query: "wake sync", mode: "hybrid", filters: {}, limit: 5 });
      expect(attached).toMatchObject({ modelKey: `fake-embed@${FAKE_DIMS}/plain/c2` });
      expect(typeof attached.queryVector).toBe("string");
      expect(await host.attach({ query: "wake sync", mode: "keyword", filters: {}, limit: 5 })).not.toHaveProperty("queryVector");
    } finally { host.stop(); }
    expect(host.running).toBe(false);
    for (let attempt = 0; attempt < 40 && await host.alive(200); attempt++) await Bun.sleep(100);
    expect(await host.alive(300)).toBe(false);

    // 기다리는 시간을 주면 꺼진 서버를 띄워 기다렸다가 임베딩한다(에이전트의 검색: 드물게 한 번씩 찾으므로 그 한 번이 낱말 검색이 되지 않게).
    const waiting = new EmbedderHost({ url: `http://127.0.0.1:${port}`, style: "openai", model: "fake-embed", dimensions: FAKE_DIMS, prompt: "plain", launch: [bun, fake, String(port)], idleMinutes: 1 });
    try {
      const attached = await waiting.attach({ query: "wake sync", mode: "hybrid", filters: {}, limit: 5 }, 15_000);
      expect(typeof attached.queryVector).toBe("string");
      expect(waiting.running).toBe(true);
    } finally { waiting.stop(); }
  }, 30000);

  test("쉬다 꺼진 임베딩 서버: 띄우는 명령이 있으면 검색이 띄워 기다렸다가 뜻으로 찾고, 끝나면 닫는다", async () => {
    const port = freePort();
    const alive = async () => { try { return (await fetch(`http://127.0.0.1:${port}/calls`, { signal: AbortSignal.timeout(300) })).ok; } catch { return false; } };
    const down = async () => { for (let attempt = 0; attempt < 50 && await alive(); attempt++) await Bun.sleep(100); return !(await alive()); };
    saveEmbedding(loadConfig(dir), { url: `http://127.0.0.1:${port}`, style: "openai", model: "fake-embed", dimensions: FAKE_DIMS, prompt: "plain", floor: 0.2, launch: [bun, fake, String(port)], idleMinutes: 1 });
    // 색인도 검색도 서버를 스스로 띄웠다가 끝낼 때 닫는다.
    expect(cli(dir, ["embed", "run"]).data).toMatchObject({ notes: 4, failed: 0, remaining: 0, offline: false });
    expect(await down()).toBe(true);
    const found = cli(dir, ["memo", "--search", "wake up sync"]).data;
    expect(found).toMatchObject({ searchMode: "hybrid" });
    expect(found.fallbackReason).toBeUndefined();
    expect(found.items.map((item: { id: string }) => item.id).slice(0, 2).sort()).toEqual(["n-sync", "n-wake"]);
    expect(await down()).toBe(true);
    // 맥락 묶음도 같은 길로 찾는다. 낱말로만 찾을 때는 서버를 띄우지 않는다.
    expect(cli(dir, ["graph", "context", "wake", "up", "sync"]).data.core.find((item: { id: string }) => item.id === "n-sync").why).toContain("질의와 뜻이 가까움");
    expect(await down()).toBe(true);
    expect(cli(dir, ["memo", "--search", "wake up sync", "--mode", "keyword"]).data).toMatchObject({ searchMode: "keyword" });
    expect(await alive()).toBe(false);
  }, 90000);

  test("검색 바닥값: 색인을 다 따라잡으면 답이 없을 질의로 재서 설정에 남기고, 그 값 아래로 맞은 글은 뜻으로 찾았다고 보지 않는다", () => {
    const old = Date.now() - 60_000;
    const db = openDatabase(loadConfig(dir));
    // 조각이 50개를 넘어야 잰다. 모두 여행 이야기라 답이 없을 질의와는 거의 닿지 않는다.
    new NoteStore(db).apply({ deletes: [], upserts: Array.from({ length: 56 }, (_unused, at) => ({ id: `n-trip-${at}`, kind: "note" as const, parentId: null, title: `여행 기록 ${at}`,
      body: `부산으로 가는 기차와 숙소를 ${at}번째로 예약했다.`, position: null, createdAt: old, updatedAt: old })) });
    db.close();
    const saved = setup(good).data;
    const run = cli(dir, ["embed", "run"]).data;
    expect(run).toMatchObject({ notes: 60, failed: 0, remaining: 0 });
    expect(typeof run.searchFloor).toBe("number");
    expect(run.searchFloor).toBeGreaterThanOrEqual(saved.diagnosis.floor);
    expect(run.searchFloor).toBeLessThan(0.6);
    // 잰 값은 설정 파일이 아니라 색인에 남는다(어느 PC에서 찾든 같은 값을 쓴다).
    expect(loadEmbedding(dir)).toMatchObject({ floor: saved.diagnosis.floor });
    expect(cli(dir, ["embed", "status"]).data).toMatchObject({ truncated: 0, models: [{ key: run.modelKey, active: true, floor: run.searchFloor }] });
    // 자가 진단도 다시 잰다. 잰 값들(답이 없을 질의 16개의 최고 유사도)을 함께 보인다.
    const doctor = cli(dir, ["embed", "doctor"]).data;
    expect(doctor).toMatchObject({ diagnosis: { ok: true }, searchFloor: run.searchFloor });
    expect(doctor.probes).toHaveLength(16);
    // 색인에 없는 것을 물으면 결과를 채우지 않는다.
    expect(cli(dir, ["memo", "--search", "양자역학 강의"]).data).toMatchObject({ searchMode: "hybrid", total: 0, items: [] });
  }, 60000);

  test("질의 세트로 검색 품질을 재고, 저장된 의미 카드를 보며, 작업 중인 저장소의 프로젝트 문서를 앞에 둔다", () => {
    setup(good);
    expect(cli(dir, ["embed", "run"]).data).toMatchObject({ notes: 4, remaining: 0 });

    // 질의 세트: 기대한 메모가 몇 번째에 나오는지. expect가 빈 질의는 답이 없어야 하는 질의다.
    const file = path.join(dir, "golden.json");
    writeFileSync(file, JSON.stringify({ queries: [
      { id: "q-wake", kind: "바꿔 말하기", query: "wake up sync", expect: ["n-sync", "n-wake"] },
      { id: "q-cook", kind: "낱말", query: "김치찌개", expect: ["n-cook"] },
      { kind: "낱말", query: "레지스트리 컨테이너", expect: ["n-deploy"] },
      { id: "q-none", query: "양자역학 강의", expect: [] }] }));
    const report = cli(dir, ["embed", "eval", file, "--all"]).data;
    expect(report).toMatchObject({ schemaVersion: 1, queries: 4, answerable: 3 });
    expect(report.modes.map((mode: { mode: string }) => mode.mode)).toEqual(["hybrid", "keyword", "semantic"]);
    const hybrid = report.modes[0];
    expect(hybrid).toMatchObject({ recall1: 1, recall3: 1, recall10: 1, mrr: 1, fallbacks: 0 });
    expect(hybrid.kinds).toEqual([{ kind: "바꿔 말하기", count: 1, mrr: 1 }, { kind: "낱말", count: 2, mrr: 1 }]);
    // 「wake up sync」는 n-sync·n-wake 어디에도 그 낱말들이 함께 없다: 낱말만으로는 놓치거나 뒤로 간다.
    expect(report.modes[1].mrr).toBeLessThanOrEqual(1);
    expect(report.rows.map((row: { id: string }) => row.id)).toEqual(["q-wake", "q-cook", "3", "q-none"]);
    expect(report.rows[0]).toMatchObject({ kind: "바꿔 말하기", expect: ["n-sync", "n-wake"], ranks: { hybrid: 1, semantic: 1 } });
    expect(report.rows[3]).toMatchObject({ expect: [], ranks: { hybrid: null, keyword: null, semantic: null }, results: { keyword: 0 }, weak: { keyword: 0 } });
    // 방식을 골라 잴 수 있다. 사람이 읽는 출력은 방식마다 한 줄이다.
    expect(cli(dir, ["embed", "eval", file, "--modes", "keyword"]).data.modes.map((mode: { mode: string }) => mode.mode)).toEqual(["keyword"]);
    const text = Bun.spawnSync([bun, path.join(root, "src/index.ts"), "embed", "eval", file, "--all", "--data-dir", dir], { cwd: root, env: { ...process.env, RELAY_DATA_DIR: dir }, stdout: "pipe" }).stdout.toString();
    expect(text).toContain("질의 4개(답이 있는 것 3개)");
    expect(text).toMatch(/hybrid\s+R@1 1\.00 · R@3 1\.00 · R@10 1\.00 · MRR 1\.000/);
    expect(text).toContain("답이 없어야 하는 질의");
    expect(cli(dir, ["embed", "eval", file, "--modes", "fuzzy"]).code).toBe(2);
    expect(cli(dir, ["embed", "eval", path.join(dir, "none.json")]).data.error.code).toBe("FILE_NOT_FOUND");
    writeFileSync(file, JSON.stringify({ queries: [{ query: "x", expect: ["n-missing"] }] }));
    expect(cli(dir, ["embed", "eval", file]).data.error.code).toBe("NOTE_NOT_FOUND");
    writeFileSync(file, JSON.stringify({ queries: [] }));
    expect(cli(dir, ["embed", "eval", file]).code).toBe(2);

    // 저장된 카드를 읽는다(검색이 왜 그 메모를 찾았는지, 카드가 낡았는지 확인할 때).
    expect(cli(dir, ["embed", "cards", "--show", "n-sync"]).data).toMatchObject({ noteId: "n-sync", title: "증분 동기화 설계", path: "설계", state: "missing", card: null });
    const cards = path.join(dir, "cards.json");
    writeFileSync(cards, JSON.stringify({ author: "claude-fable", cards: [{ noteId: "n-sync", summary: "꺼져 있던 동안 밀린 변경을 다시 맞추는 설계", terms: ["hibernate"], questions: ["절전 뒤에 메모가 늦게 뜨는 까닭은?"] }] }));
    expect(cli(dir, ["embed", "cards", "--save", cards]).data).toMatchObject({ saved: 1 });
    expect(cli(dir, ["embed", "cards", "--show", "n-sync"]).data).toMatchObject({ state: "fresh",
      card: { summary: "꺼져 있던 동안 밀린 변경을 다시 맞추는 설계", terms: ["hibernate"], questions: ["절전 뒤에 메모가 늦게 뜨는 까닭은?"], author: "claude-fable" } });
    expect(cli(dir, ["embed", "cards", "--show", "n-sync", "--save", cards]).code).toBe(2);
    expect(cli(dir, ["embed", "cards", "--show", "n-none"]).data.error.code).toBe("NOTE_NOT_FOUND");

    // 이 저장소의 파일을 등록하면 출처(저장소 이름)가 남고, 이 저장소 안에서 찾을 때 그 프로젝트의 문서를 앞에 둔다.
    const tracked = path.join(root, "CLAUDE.md");
    if (gitSource(tracked)) {
      const there = path.join(dir, "there.md");
      writeFileSync(there, ["# 작업 지침", "", "복구 훈련 절차를 돌린다. 끝나면 복구 훈련 절차를 다시 돌린다.", ""].join("\n"));
      const mine = cli(dir, ["memo", "register", tracked, "--title", "작업 지침", "--project", "alpha"]).data;
      expect(mine).toMatchObject({ action: "created" });
      const env = process.env.RELAY_NO_GIT;
      process.env.RELAY_NO_GIT = "1";
      let theirs: { noteId: string };
      try { theirs = cli(dir, ["memo", "register", there, "--project", "beta"]).data; } finally { if (env === undefined) delete process.env.RELAY_NO_GIT; else process.env.RELAY_NO_GIT = env; }
      expect(cli(dir, ["memo", "meta", mine.noteId]).data.meta).toMatchObject({ project: "alpha", sourcePath: "CLAUDE.md" });
      const preferred = cli(dir, ["memo", "--search", "작업 지침", "--mode", "keyword"]).data;
      expect(preferred.preferredProjects).toEqual(["alpha"]);
      expect(preferred.items.map((item: { id: string }) => item.id)).toContain(theirs.noteId);
      // --all: 전체에서 고르게 찾는다. --project로 좁혔을 때도 앞에 두지 않는다.
      expect(cli(dir, ["memo", "--search", "작업 지침", "--mode", "keyword", "--all"]).data.preferredProjects).toBeUndefined();
      expect(cli(dir, ["memo", "--search", "작업 지침", "--mode", "keyword", "--project", "beta"]).data.preferredProjects).toBeUndefined();
      expect(cli(dir, ["graph", "context", "작업", "지침", "--lexical"]).code).toBe(0);
    }
    expect(cli(dir, ["memo", "--list", "--all"]).code).toBe(2);
  }, 90000);
});
