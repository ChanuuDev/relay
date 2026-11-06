import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { IMAGE_GRACE_MS, NotesService } from "../src/notes/notes.service.js";
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

describe("원격 메모 그림 API", () => {
  let t: TestApp;
  // 1×1 PNG·GIF. 서버는 파일 머리의 서명으로 형식을 알아낸다.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("내용의 sha256으로 한 번만 저장하고, 격리·장기 보관 헤더로 돌려준다", async () => {
    const saved = (await t.post("/api/v1/notes/images", { data: PNG.toString("base64") }).expect(200)).body;
    expect(saved).toEqual({ schemaVersion: 1, id: sha(PNG), type: "image/png", size: PNG.length, url: `/api/v1/notes/images/${sha(PNG)}` });
    expect((await t.post("/api/v1/notes/images", { data: PNG.toString("base64") }).expect(200)).body).toEqual(saved);
    const read = await t.get(saved.url).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("end", () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(read.headers["content-type"]).toBe("image/png");
    expect(read.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(read.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(read.headers.etag).toBe(`"${saved.id}"`);
    expect((read.body as Buffer).equals(PNG)).toBe(true);
    await t.get(saved.url).set("If-None-Match", `"${saved.id}"`).expect(304);
    await t.get(`/api/v1/notes/images/${"0".repeat(64)}`).expect(404);
    expect((await t.get("/api/v1/notes/images/abc")).body.error.code).toBe("INVALID_ARGUMENT");
    // 토큰 없이는 읽지 못한다.
    await t.raw.get(saved.url).expect(401);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await t.post("/api/v1/notes/images", { data: svg.toString("base64") })).body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect((await t.post("/api/v1/notes/images", { data: "not base64!" })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes/images", { data: PNG.toString("base64"), type: "image/png" })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/notes/images?x=1", { data: PNG.toString("base64") })).body.error.code).toBe("INVALID_ARGUMENT");
    // 저장 묶음(8MB)보다 큰 그림도 받는다(그림 10MB, 본문 16MB까지).
    const big = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
    expect((await t.post("/api/v1/notes/images", { data: big.toString("base64") }).expect(200)).body.size).toBe(big.length);
    expect((await t.post("/api/v1/notes/images", { data: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]).toString("base64") })).body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("내보내기는 메모가 가리키는 그림을 담고, 가져오기는 내용이 id와 맞는 그림만 넣는다", async () => {
    const { url, id } = (await t.post("/api/v1/notes/images", { data: PNG.toString("base64") }).expect(200)).body;
    await t.post("/api/v1/notes/images", { data: GIF.toString("base64") }).expect(200);
    await t.post("/api/v1/notes", { upserts: [{ id: "n1", kind: "note", parentId: null, title: "그림", body: `![](${url})`, createdAt: 1, updatedAt: 1 }], deletes: [] }).expect(200);
    const file = JSON.parse((await t.get("/api/v1/notes/export").expect(200)).text);
    expect(file.images).toEqual([{ id, type: "image/png", data: PNG.toString("base64") }]);
    const other = await testApp();
    try {
      const forged = { id: sha(GIF), type: "image/gif", data: PNG.toString("base64") };
      expect((await other.post("/api/v1/notes/import", { ...file, images: [...file.images, forged] }).expect(200)).body).toMatchObject({ added: 1 });
      await other.get(url).expect(200);
      await other.get(`/api/v1/notes/images/${sha(GIF)}`).expect(404);
      expect((await other.post("/api/v1/notes/import", { ...file, images: "x" })).body.error.code).toBe("INVALID_ARGUMENT");
    } finally { await other.close(); }
  });

  test("30일 넘게 어느 메모도 가리키지 않은 그림만 정리한다", async () => {
    const notes = t.app.get(NotesService);
    const used = await notes.saveImage(t.userId, PNG, 0);
    const unused = await notes.saveImage(t.userId, GIF, 0);
    await t.post("/api/v1/notes", { upserts: [{ id: "n1", kind: "note", parentId: null, title: "", body: `![](${used.url})`, createdAt: 1, updatedAt: 1 }], deletes: [] }).expect(200);
    expect(await notes.pruneImages(IMAGE_GRACE_MS + 1)).toBe(1);
    expect(await notes.image(t.userId, unused.id)).toBeNull();
    expect((await notes.image(t.userId, used.id))?.type).toBe("image/png");
  });
});
