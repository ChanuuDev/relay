import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeVector, modelKey, unit } from "@relay/core";
import { AuthService } from "../src/auth/auth.service.js";
import { schema } from "../src/db/database.js";
import { testApp, type TestApp } from "./helpers.js";

// 뜻을 흉내 내는 임베딩: 같은 갈래의 한국어·영어 낱말이 같은 차원을 올린다(낱말이 달라도 뜻이 같으면 가깝다).
const CONCEPTS = [["절전", "sleep", "resume", "깨어"], ["동기화", "sync", "밀린", "재처리"], ["배포", "deploy", "컨테이너", "레지스트리"], ["찌개", "두부", "끓", "recipe"], ["회의", "meeting", "안건"]];
const DIMS = 16;
function vector(text: string) {
  const lowered = text.toLowerCase();
  const values = new Array<number>(DIMS).fill(0);
  CONCEPTS.forEach((words, at) => { for (const word of words) if (lowered.includes(word)) values[at]! += 1; });
  values[5 + lowered.length % 3]! += 0.15;
  return unit(values)!;
}
const MODEL = { name: "fake-embed", dimensions: DIMS, prompt: "plain", floor: 0.2 };
const KEY = modelKey(MODEL.name, MODEL.dimensions, MODEL.prompt);
const old = Date.now() - 60_000;
const note = (id: string, title: string, body: string, parentId: string | null = null) => ({ id, kind: "note", parentId, title, body, createdAt: old, updatedAt: old });
const NOTES = [
  { id: "f-design", kind: "folder", parentId: null, name: "설계", createdAt: old, updatedAt: old },
  note("n-sync", "증분 동기화 설계", "# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다.", "f-design"),
  note("n-wake", "노트북을 열면 메모가 늦게 뜬다", "sleep에서 resume한 뒤 sync가 밀린다."),
  note("n-deploy", "서버 배포 절차", "이미지를 레지스트리에 올리고 컨테이너를 다시 띄운다. 비밀번호: hunter2-XYZ!", "f-design"),
  note("n-cook", "김치찌개", "두부를 넣고 끓인다."),
];

describe("원격 메모 의미 검색 API", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); await t.post("/api/v1/notes", { upserts: NOTES, deletes: [] }).expect(200); });
  afterEach(async () => { await t.close(); });

  /** 워커가 하는 일: 받아 가서 임베딩하고 올린다. */
  async function work(app: Pick<TestApp, "post"> = t) {
    let notes = 0;
    for (let guard = 0; guard < 20; guard++) {
      const lease = (await app.post("/api/v1/notes/index-jobs/lease", { workerId: "pc-1", model: MODEL }).expect(200)).body;
      if (!lease.jobs.length) return { notes, lease };
      for (const job of lease.jobs) {
        const committed = (await app.post("/api/v1/notes/index-jobs/commit", { modelKey: lease.modelKey, noteId: job.noteId, leaseToken: job.leaseToken, inputHash: job.inputHash,
          vectors: job.texts.map((item: { hash: string; text: string }) => ({ hash: item.hash, data: encodeVector(vector(item.text)) })) }).expect(200)).body;
        expect(committed.committed).toBe(true);
        notes++;
      }
    }
    throw new Error("색인이 끝나지 않습니다");
  }
  const search = (query: string, extra: Record<string, unknown> = {}) => t.post("/api/v1/notes/search", { query, queryVector: encodeVector(vector(query)), modelKey: KEY, ...extra });

  test("워커가 받아 가서 올리면 준비되고, 질의 벡터가 있으면 뜻으로 찾으며 없으면 낱말로 바로 답한다", async () => {
    const before = await t.get("/api/v1/notes/index-status").expect(200);
    expect(before.body).toMatchObject({ schemaVersion: 1, activeModelKey: null, embedderOnline: false, summary: { total: 4, ready: 0, pending: 4, failed: 0 } });
    await t.get("/api/v1/notes/index-status").set("If-None-Match", before.headers.etag as string).expect(304);

    const lease = (await t.post("/api/v1/notes/index-jobs/lease", { workerId: "pc-1", model: MODEL, limit: 1 }).expect(200)).body;
    expect(lease).toMatchObject({ modelKey: KEY, active: true, remaining: 3 });
    // 조각 글과 메모의 질의 글이 온다. 가리지 않은 비밀은 워커로 가지 않는다.
    expect(lease.jobs[0].texts.some((item: { query?: boolean }) => item.query === true)).toBe(true);
    await t.post("/api/v1/notes/index-jobs/fail", { modelKey: KEY, noteId: lease.jobs[0].noteId, leaseToken: lease.jobs[0].leaseToken, error: "released" }).expect(200);
    const all = (await t.post("/api/v1/notes/index-jobs/lease", { workerId: "pc-1", model: MODEL }).expect(200)).body;
    expect(JSON.stringify(all.jobs)).not.toContain("hunter2");
    expect(JSON.stringify(all.jobs)).toContain("[가림]");
    for (const job of all.jobs) await t.post("/api/v1/notes/index-jobs/fail", { modelKey: KEY, noteId: job.noteId, leaseToken: job.leaseToken, error: "released" }).expect(200);
    expect((await work()).notes).toBe(4);
    const after = (await t.get("/api/v1/notes/index-status?noteId=n-sync").expect(200)).body;
    expect(after).toMatchObject({ activeModelKey: KEY, embedderOnline: true, summary: { total: 4, ready: 4, pending: 0 } });
    expect(after.items[0]).toMatchObject({ noteId: "n-sync", status: "ready", chunks: 1 });

    // 「wake sync」는 n-sync 본문에 없는 낱말이다.
    const hybrid = (await search("wake up sync").expect(200)).body;
    expect(hybrid).toMatchObject({ searchMode: "hybrid", modelKey: KEY });
    expect(hybrid.items.map((item: { noteId: string }) => item.noteId).slice(0, 2).sort()).toEqual(["n-sync", "n-wake"]);
    const sync = hybrid.items.find((item: { noteId: string }) => item.noteId === "n-sync");
    expect(sync).toMatchObject({ title: "증분 동기화 설계", path: "설계", staleIndex: false });
    expect(sync.matches[0]).toMatchObject({ headingPath: "증분 동기화 설계 > 누락된 작업 재처리" });
    const fallback = (await t.post("/api/v1/notes/search", { query: "wake up sync" }).expect(200)).body;
    expect(fallback).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "embedder_offline" });
    expect((await search("배포", { mode: "keyword" }).expect(200)).body.items[0].noteId).toBe("n-deploy");
    expect(JSON.stringify((await search("배포 deploy").expect(200)).body)).not.toContain("hunter2");

    // 색인에 없는 것을 물으면 결과를 채우지 않는다. 뜻으로 맞지 않는데 낱말로만 걸린 글에는 관련이 낮을 수 있다고 붙인다.
    expect((await search("양자역학 강의").expect(200)).body).toMatchObject({ searchMode: "hybrid", total: 0, items: [] });
    const weak = (await search("sync 이미지 올리고").expect(200)).body.items.find((item: { noteId: string }) => item.noteId === "n-deploy");
    expect(weak).toMatchObject({ weak: true });

    // 바닥값 재기: 답이 없을 질의의 벡터를 보내면 지금 색인에서 가장 가까운 점수를 돌려준다. 색인이 작으면(조각 50개 미만) 바닥값을 고치지 않는다.
    const probe = { modelKey: KEY, vectors: [encodeVector(vector("양자역학")), encodeVector(vector("두부 찌개"))], apply: true, diagnosed: 0.2 };
    const probed = (await t.post("/api/v1/notes/index-jobs/probe", probe).expect(200)).body;
    expect(probed).toMatchObject({ schemaVersion: 1, modelKey: KEY, chunks: 4 });
    expect(probed.tops[0]).toBeLessThan(0.2);
    expect(probed.tops[1]).toBeGreaterThan(0.9);
    expect(probed.floor).toBeUndefined();
    expect((await t.get("/api/v1/notes/index-status").expect(200)).body.models).toMatchObject([{ key: KEY, active: true, floor: 0.2 }]);
    expect((await t.post("/api/v1/notes/index-jobs/probe", { modelKey: KEY, vectors: [] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes/index-jobs/probe", { ...probe, modelKey: "other@16/plain/c2" })).status).toBe(404);
    await t.raw.post("/api/v1/notes/index-jobs/probe").send(probe).expect(401);

    // 검색과 워커 요청에 멱등 키가 붙어 와도 응답을 보관하지 않는다.
    await search("wake up sync").set("Idempotency-Key", "search-key-0001").expect(200);
    await t.post("/api/v1/notes/index-jobs/lease", { workerId: "pc-1", model: MODEL }).set("Idempotency-Key", "lease-key-00001").expect(200);
    await t.post("/api/v1/notes/index-jobs/probe", probe).set("Idempotency-Key", "probe-key-00001").expect(200);
    expect(await t.db.select().from(schema.idempotencyKeys)).toEqual([]);

    // 요청 검사와 경로.
    expect((await t.post("/api/v1/notes/search", { query: "" })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes/search", { query: "x y", queryVector: "AAAA", modelKey: KEY })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await search("x y", { modelKey: "other@16/plain/c1" }).expect(200)).body.fallbackReason).toBe("model_mismatch");
    await t.get("/api/v1/notes/search").expect(404);
    expect((await t.get("/api/v1/notes/index-status?x=1")).body.error.code).toBe("INVALID_ARGUMENT");
    await t.raw.get("/api/v1/notes/index-status").expect(401);
  });

  test("뜻이 가까운 메모를 근거와 함께 제안하고, 거절은 남으며, 메모를 지우면 색인도 함께 사라진다", async () => {
    await work();
    const links = (await t.get("/api/v1/notes/semantic-links").expect(200)).body;
    expect(links.modelKey).toBe(KEY);
    expect(links.items.map((item: { a: string; b: string }) => `${item.a}|${item.b}`)).toEqual(["n-sync|n-wake"]);
    const suggestions = (await t.get("/api/v1/notes/n-sync/suggestions").expect(200)).body;
    expect(suggestions.items[0]).toMatchObject({ targetNoteId: "n-wake", title: "노트북을 열면 메모가 늦게 뜬다", sourceHeading: "증분 동기화 설계 > 누락된 작업 재처리" });
    expect(suggestions.items[0].targetSnippet).toContain("resume");

    // 새 메모가 들어오면 옛 메모를 다시 색인하지 않아도 그 제안에 나온다.
    await t.post("/api/v1/notes", { upserts: [note("n-hib", "최대 절전 뒤 동기화", "깨어난 뒤 밀린 sync를 재처리한다.")], deletes: [] }).expect(200);
    expect((await work()).notes).toBe(1);
    expect((await t.get("/api/v1/notes/n-sync/suggestions").expect(200)).body.items.map((item: { targetNoteId: string }) => item.targetNoteId).sort()).toEqual(["n-hib", "n-wake"]);

    expect((await t.post("/api/v1/notes/n-wake/suggestions/n-sync/dismiss", {}).expect(200)).body).toEqual({ schemaVersion: 1, dismissed: true });
    expect((await t.get("/api/v1/notes/n-sync/suggestions").expect(200)).body.items.map((item: { targetNoteId: string }) => item.targetNoteId)).toEqual(["n-hib"]);
    expect((await t.post("/api/v1/notes/n-sync/suggestions/n-sync/dismiss", {})).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.get("/api/v1/notes/n-none/suggestions")).status).toBe(404);

    // 다시 색인해도 거절은 남는다.
    expect((await t.post("/api/v1/notes/reindex", { scope: "all" }).expect(200)).body.queued).toBe(5);
    await work();
    expect((await t.get("/api/v1/notes/n-wake/suggestions").expect(200)).body.items.map((item: { targetNoteId: string }) => item.targetNoteId)).not.toContain("n-sync");

    // 폴더를 지우면 그 안의 메모와 그 메모의 조각·연결·거절이 함께 사라진다(워커를 기다리지 않는다).
    await t.post("/api/v1/notes", { upserts: [], deletes: ["f-design"] }).expect(200);
    const count = async (table: typeof schema.noteChunks | typeof schema.noteIndex) => (await t.db.select({ total: sql<number>`count(*)::int` }).from(table).where(eq(table.noteId, "n-sync")))[0]!.total;
    expect(await count(schema.noteChunks)).toBe(0);
    expect(await count(schema.noteIndex)).toBe(0);
    expect(await t.db.select().from(schema.noteLinkDismissals)).toEqual([]);
    expect((await t.get("/api/v1/notes/semantic-links").expect(200)).body.items.every((item: { a: string; b: string }) => item.a !== "n-sync" && item.b !== "n-sync")).toBe(true);
    expect((await search("wake up sync").expect(200)).body.items.map((item: { noteId: string }) => item.noteId)).not.toContain("n-sync");
    expect((await t.get("/api/v1/notes/index-status").expect(200)).body.summary).toMatchObject({ total: 3, ready: 3 });
  });

  test("의미 카드와 문서 등록: 본문에 없는 낱말로 찾고, 대체된 결정은 새 결정을 알린다", async () => {
    const pending = (await t.get("/api/v1/notes/cards?limit=2").expect(200)).body;
    expect(pending).toMatchObject({ total: 4, missing: 4, stale: 0 });
    expect(pending.items).toHaveLength(2);
    const sync = (await t.get("/api/v1/notes/cards?limit=50").expect(200)).body.items.find((item: { noteId: string }) => item.noteId === "n-sync");
    expect(sync.contentHash).toBe(createHash("sha256").update("증분 동기화 설계\0# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다.").digest("hex"));
    const saved = (await t.post("/api/v1/notes/cards", { author: "claude-fable", cards: [
      { noteId: "n-sync", contentHash: sync.contentHash, summary: "꺼져 있던 동안 밀린 변경을 다시 맞추는 설계", terms: ["hibernate", "offline-first"], questions: ["절전 뒤에 메모가 늦게 뜨는 까닭은?"] },
      { noteId: "n-gone", summary: "없는 메모", terms: [], questions: [] }] }).expect(200)).body;
    expect(saved).toEqual({ schemaVersion: 1, saved: 1, skipped: [{ noteId: "n-gone", reason: "not_found" }] });
    expect((await t.post("/api/v1/notes/search", { query: "hibernate offline-first", mode: "keyword" }).expect(200)).body.items.map((item: { noteId: string }) => item.noteId)).toEqual(["n-sync"]);
    expect((await t.get("/api/v1/notes/index-status").expect(200)).body.cards).toEqual({ total: 4, fresh: 1, stale: 0, missing: 3 });
    // 메모 하나에 저장된 카드.
    expect((await t.get("/api/v1/notes/cards?noteId=n-sync").expect(200)).body).toMatchObject({ noteId: "n-sync", title: "증분 동기화 설계", path: "설계", state: "fresh",
      card: { summary: "꺼져 있던 동안 밀린 변경을 다시 맞추는 설계", terms: ["hibernate", "offline-first"], author: "claude-fable" } });
    expect((await t.get("/api/v1/notes/cards?noteId=n-cook").expect(200)).body).toMatchObject({ state: "missing", card: null });
    expect((await t.get("/api/v1/notes/cards?noteId=n-none")).status).toBe(404);

    const first = (await t.post("/api/v1/notes/register-doc", { title: "동기화 결정 1", body: "동기화는 폴링으로 한다.", docType: "decision", docStatus: "adopted", project: "relay",
      sourceRepo: "relay", sourcePath: "docs/adr/001.md", sourceCommit: "abc1234" }).expect(200)).body;
    expect(first).toMatchObject({ action: "created" });
    expect((await t.post("/api/v1/notes/register-doc", { title: "동기화 결정 1", body: "동기화는 폴링으로 한다.", docType: "decision", sourceRepo: "relay", sourcePath: "docs/adr/001.md" }).expect(200)).body)
      .toMatchObject({ action: "unchanged", noteId: first.noteId });
    const second = (await t.post("/api/v1/notes/register-doc", { body: "# 동기화 결정 2\n\n동기화는 푸시로 바꾼다.", docType: "decision", docStatus: "adopted", project: "relay",
      sourceRepo: "relay", sourcePath: "docs/adr/002.md", supersedes: first.noteId }).expect(200)).body;
    expect(second).toMatchObject({ action: "created", superseded: first.noteId });
    const found = (await t.post("/api/v1/notes/search", { query: "동기화 결정", mode: "keyword", filters: { docType: ["decision"] } }).expect(200)).body.items;
    expect(found[0]).toMatchObject({ noteId: second.noteId, docStatus: "adopted", project: "relay" });
    expect(found[1]).toMatchObject({ noteId: first.noteId, docStatus: "superseded", supersededBy: { id: second.noteId, title: "동기화 결정 2" } });
    // 일하는 저장소를 알리면 그 저장소에서 등록한 문서의 프로젝트를 앞에 둔다고 함께 알린다(좁히지는 않는다).
    const here = (await t.post("/api/v1/notes/search", { query: "동기화", mode: "keyword", filters: { sourceRepo: "relay" } }).expect(200)).body;
    expect(here.preferredProjects).toEqual(["relay"]);
    expect(here.items.map((item: { noteId: string }) => item.noteId)).toContain("n-sync");
    expect((await t.post("/api/v1/notes/search", { query: "동기화", mode: "keyword" }).expect(200)).body.preferredProjects).toBeUndefined();
    expect((await t.post("/api/v1/notes/meta", { noteId: second.noteId, supersededBy: first.noteId })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes/meta", { noteId: "n-cook", docType: "knowledge", project: "home" }).expect(200)).body.meta).toMatchObject({ noteId: "n-cook", docType: "knowledge", project: "home" });
    expect((await t.get("/api/v1/notes/meta").expect(200)).body.items.map((item: { noteId: string }) => item.noteId).sort()).toEqual([first.noteId, second.noteId, "n-cook"].sort());
    // 새 문서를 지우면 옛 문서의 「대신하는 문서」만 비고, 옛 문서는 남는다.
    await t.post("/api/v1/notes", { upserts: [], deletes: [second.noteId] }).expect(200);
    const left = (await t.get("/api/v1/notes/meta").expect(200)).body.items.find((item: { noteId: string }) => item.noteId === first.noteId);
    expect(left).toMatchObject({ docStatus: "superseded", supersededBy: null });
  });

  test("다른 사용자의 색인·검색·제안은 서로 보이지 않는다", async () => {
    await work();
    await t.db.insert(schema.users).values({ id: "user-b", name: "다른 사람" });
    const { token } = await t.app.get(AuthService).createToken("user-b", "b-token");
    const as = { get: (url: string) => t.raw.get(url).set("Authorization", `Bearer ${token}`),
      post: (url: string, body?: unknown) => t.raw.post(url).set("Authorization", `Bearer ${token}`).set("Content-Type", "application/json").send(JSON.stringify(body ?? {})) };
    expect((await as.get("/api/v1/notes/index-status").expect(200)).body).toMatchObject({ activeModelKey: null, summary: { total: 0, ready: 0 } });
    expect((await as.get("/api/v1/notes/semantic-links").expect(200)).body.items).toEqual([]);
    expect((await as.post("/api/v1/notes/search", { query: "wake up sync", queryVector: encodeVector(vector("wake up sync")), modelKey: KEY }).expect(200)).body.items).toEqual([]);
    expect((await as.get("/api/v1/notes/n-sync/suggestions")).status).toBe(404);
    expect((await as.post("/api/v1/notes/n-sync/suggestions/n-wake/dismiss", {})).status).toBe(404);
    expect((await as.post("/api/v1/notes/cards", { cards: [{ noteId: "n-sync", summary: "남의 메모", terms: [], questions: [] }] }).expect(200)).body).toMatchObject({ saved: 0 });
    expect((await as.post("/api/v1/notes/meta", { noteId: "n-sync", docType: "design" })).status).toBe(404);
    // 같은 ID의 메모를 써도 서로의 색인을 건드리지 않는다.
    await as.post("/api/v1/notes", { upserts: [note("n-own", "나의 배포 메모", "deploy 배포")], deletes: [] }).expect(200);
    expect((await work(as as never)).notes).toBe(1);
    expect((await as.get("/api/v1/notes/index-status").expect(200)).body.summary).toMatchObject({ total: 1, ready: 1 });
    expect((await t.get("/api/v1/notes/index-status").expect(200)).body.summary).toMatchObject({ total: 4, ready: 4 });
    expect((await t.post("/api/v1/notes/search", { query: "deploy", mode: "keyword" }).expect(200)).body.items.map((item: { noteId: string }) => item.noteId)).not.toContain("n-own");
  });
});
