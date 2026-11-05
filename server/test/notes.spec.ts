import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testApp, type TestApp } from "./helpers.js";

const folder = (id: string, parentId: string | null = null, extra: Record<string, unknown> = {}) => ({ id, kind: "folder", parentId, name: `폴더 ${id}`, ...extra });
const note = (id: string, parentId: string | null = null, extra: Record<string, unknown> = {}) => ({ id, kind: "note", parentId, title: `메모 ${id}`, body: "# 본문", ...extra });

describe("원격 메모 API", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("저장 묶음마다 revision이 오르고, ETag가 같으면 304", async () => {
    const empty = await t.get("/api/v1/notes").expect(200);
    expect(empty.body).toEqual({ schemaVersion: 1, revision: 0, items: [] });
    expect(empty.headers.etag).toBe('"0"');
    const saved = (await t.post("/api/v1/notes", { upserts: [folder("f1"), note("n1", "f1", { createdAt: 10, updatedAt: 20 })], deletes: [] }).expect(200)).body;
    expect(saved.revision).toBe(1);
    const list = await t.get("/api/v1/notes").expect(200);
    // 만든 시각 순: n1(10)이 지금 만든 f1보다 앞선다
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual(["n1", "f1"]);
    expect(list.body.items.find((i: { id: string }) => i.id === "n1")).toMatchObject({ kind: "note", parentId: "f1", title: "메모 n1", createdAt: 10, updatedAt: 20 });
    await t.get("/api/v1/notes").set("If-None-Match", '"1"').expect(304);
    // 폴더를 지우면 안의 메모도 사라진다
    const removed = (await t.post("/api/v1/notes", { upserts: [], deletes: ["f1"] }).expect(200)).body;
    expect(removed.revision).toBe(2);
    expect((await t.get("/api/v1/notes").expect(200)).body.items).toEqual([]);
    expect((await t.post("/api/v1/notes", { upserts: [{ id: "x", kind: "bad" }] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes?x=1", { upserts: [] })).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("부모가 없거나 폴더가 아니거나 순환하면 최상위로 올린다", async () => {
    await t.post("/api/v1/notes", { upserts: [note("orphan", "missing"), note("inNote", "n0"), note("n0"), folder("a", "b"), folder("b", "a")], deletes: [] }).expect(200);
    const items = (await t.get("/api/v1/notes").expect(200)).body.items as { id: string; parentId: string | null }[];
    const parent = (id: string) => items.find((i) => i.id === id)!.parentId;
    expect(parent("orphan")).toBeNull(); expect(parent("inNote")).toBeNull();
    expect([parent("a"), parent("b")]).toContain(null);
  });

  test("내보내기·가져오기는 더 최근 쪽을 남기고 아무것도 지우지 않는다", async () => {
    await t.post("/api/v1/notes", { upserts: [note("n1", null, { updatedAt: 100 }), note("n2", null, { updatedAt: 100 })], deletes: [] }).expect(200);
    const exported = await t.get("/api/v1/notes/export").expect(200);
    expect(exported.headers["content-disposition"]).toMatch(/relay-notes-\d{4}-\d{2}-\d{2}\.json/);
    const file = JSON.parse(exported.text);
    expect(file.format).toBe("relay-notes");
    file.items = [{ ...file.items.find((i: { id: string }) => i.id === "n1"), title: "새 제목", updatedAt: 200 },
      { ...file.items.find((i: { id: string }) => i.id === "n2"), title: "옛 제목", updatedAt: 50 }, note("n3", null, { updatedAt: 1 })];
    const merged = (await t.post("/api/v1/notes/import", file).expect(200)).body;
    expect(merged).toMatchObject({ added: 1, updated: 1, kept: 1, revision: 2 });
    const items = (await t.get("/api/v1/notes").expect(200)).body.items as { id: string; title?: string }[];
    expect(items.find((i) => i.id === "n1")!.title).toBe("새 제목");
    expect(items.find((i) => i.id === "n2")!.title).toBe("메모 n2");
    expect(items.length).toBe(3);
    // 바뀐 것이 없으면 revision도 그대로
    expect((await t.post("/api/v1/notes/import", file).expect(200)).body.revision).toBe(2);
    expect((await t.post("/api/v1/notes/import", { format: "other", schemaVersion: 1, items: [] })).body.error.code).toBe("INVALID_ARGUMENT");
  });
});
