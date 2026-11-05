import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testApp, type TestApp } from "./helpers.js";

describe("원격 파일 API (지정 폴더 안에서만)", () => {
  let t: TestApp;
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "relay-files-"));
    outside = mkdtempSync(path.join(os.tmpdir(), "relay-outside-"));
    writeFileSync(path.join(outside, "secret.txt"), "비밀");
    mkdirSync(path.join(root, "문서"));
    writeFileSync(path.join(root, "문서", "a.txt"), "hello world");
    writeFileSync(path.join(root, "b.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    t = await testApp({ filesRoot: root });
  });
  afterEach(async () => { await t.close(); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

  test("places·목록·속성은 루트 기준 경로로 답하고 .trash는 숨긴다", async () => {
    expect((await t.raw.get("/api/v1/health").expect(200)).body.files).toBe(true);
    const places = (await t.get("/api/v1/files/places").expect(200)).body;
    expect(places.places[0]).toMatchObject({ id: "home", path: "/" }); expect(places.drives[0].path).toBe("/");
    const listing = (await t.get("/api/v1/files?path=/").expect(200)).body;
    expect(new Set(listing.entries.map((e: { name: string }) => e.name))).toEqual(new Set(["b.png", "문서"]));
    expect(listing.parent).toBeNull(); expect(listing.crumbs).toEqual([{ name: "원격 서버", path: "/" }]);
    const inner = (await t.get("/api/v1/files?path=/문서").expect(200)).body;
    expect(inner.entries[0]).toMatchObject({ name: "a.txt", path: "/문서/a.txt", kind: "file", size: 11 });
    expect(inner.parent).toBe("/"); expect(inner.crumbs.at(-1)).toEqual({ name: "문서", path: "/문서" });
    const info = (await t.get("/api/v1/files/stat?path=/문서/a.txt").expect(200)).body;
    expect(info).toMatchObject({ name: "a.txt", path: "/문서/a.txt", kind: "file", size: 11, readonly: false });
    expect((await t.get("/api/v1/files/stat?path=/").expect(200)).body.contents.files).toBe(2);
    expect((await t.get("/api/v1/files?path=/none")).body.error.code).toBe("NOT_FOUND");
    expect((await t.get("/api/v1/files?path=relative")).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.get("/api/v1/files?path=/&x=1")).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("루트 밖으로는 나갈 수 없다: .., 심볼릭 링크, .trash", async () => {
    expect((await t.get("/api/v1/files?path=/../")).body.error.code).toBe("REMOTE_FORBIDDEN_PATH");
    expect((await t.get("/api/v1/files?path=/문서/../../x")).body.error.code).toBe("REMOTE_FORBIDDEN_PATH");
    expect((await t.get("/api/v1/files?path=/.trash")).status).toBe(403);
    try { symlinkSync(outside, path.join(root, "link"), "dir"); } catch { return; /* 링크를 만들 권한이 없는 환경이면 건너뛴다 */ }
    expect((await t.get("/api/v1/files?path=/link")).body.error.code).toBe("REMOTE_FORBIDDEN_PATH");
    expect((await t.get("/api/v1/files/content?path=/link/secret.txt")).status).toBe(403);
  });

  test("내용은 Range를 받고, 올리기는 스트림으로 받아 덮어쓰지 않는다", async () => {
    const whole = await t.get("/api/v1/files/content?path=/문서/a.txt").expect(200);
    expect(whole.text).toBe("hello world"); expect(whole.headers["content-type"]).toMatch(/^text\/plain/);
    expect(whole.headers["x-file-modified"]).toBeTruthy(); expect(whole.headers["accept-ranges"]).toBe("bytes");
    const part = await t.get("/api/v1/files/content?path=/문서/a.txt").set("Range", "bytes=6-").expect(206);
    expect(part.text).toBe("world"); expect(part.headers["content-range"]).toBe("bytes 6-10/11");
    expect((await t.get("/api/v1/files/content?path=/문서/a.txt").set("Range", "bytes=50-")).status).toBe(416);
    const download = await t.get("/api/v1/files/content?path=/b.png&download=1").expect(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect((await t.get("/api/v1/files/content?path=/문서")).body.error.code).toBe("NOT_A_FILE");
    const uploaded = await t.put("/api/v1/files/content?path=/문서/new.bin").set("Content-Type", "application/octet-stream").send(Buffer.alloc(1024, 7)).expect(200);
    expect(uploaded.body).toMatchObject({ path: "/문서/new.bin", size: 1024 });
    expect((await t.put("/api/v1/files/content?path=/문서/new.bin").set("Content-Type", "application/octet-stream").send(Buffer.alloc(1))).body.error.code).toBe("FILE_EXISTS");
    expect((await t.put("/api/v1/files/content?path=/문서/new.bin&overwrite=1").set("Content-Type", "application/octet-stream").send(Buffer.alloc(2)).expect(200)).body.size).toBe(2);
    expect(readdirSync(path.join(root, "문서")).filter((name) => name.includes("upload-"))).toEqual([]);
    expect((await t.put("/api/v1/files/content?path=/문서").set("Content-Type", "application/octet-stream").send(Buffer.alloc(1))).body.error.code).toBe("NOT_A_FILE");
  });

  test("저장·새 폴더·이름 바꾸기·복사·이동·휴지통", async () => {
    const info = (await t.get("/api/v1/files/stat?path=/문서/a.txt").expect(200)).body;
    const saved = (await t.post("/api/v1/files/save", { path: "/문서/a.txt", data: Buffer.from("바뀜").toString("base64"), modified: info.modified }).expect(200)).body;
    expect(saved.size).toBe(Buffer.byteLength("바뀜"));
    expect((await t.post("/api/v1/files/save", { path: "/문서/a.txt", data: "QQ==", modified: info.modified })).body.error.code).toBe("FILE_CHANGED");
    const made = (await t.post("/api/v1/files/mkdir", { parent: "/" }).expect(200)).body;
    expect(made).toEqual({ schemaVersion: 1, path: "/새 폴더", name: "새 폴더" });
    expect((await t.post("/api/v1/files/mkdir", { parent: "/" }).expect(200)).body.name).toBe("새 폴더 (2)");
    expect((await t.post("/api/v1/files/mkdir", { parent: "/", name: ".trash" })).status).toBe(403);
    expect((await t.post("/api/v1/files/mkdir", { parent: "/", name: "a:b" })).body.error.code).toBe("INVALID_NAME");
    const renamed = (await t.post("/api/v1/files/rename", { path: "/새 폴더 (2)", name: "자료" }).expect(200)).body;
    expect(renamed).toMatchObject({ from: "/새 폴더 (2)", to: "/자료" });
    expect((await t.post("/api/v1/files/rename", { path: "/자료", name: "새 폴더" })).body.error.code).toBe("FILE_EXISTS");
    const copied = (await t.post("/api/v1/files/paste", { sources: ["/문서/a.txt"], destination: "/문서", mode: "copy" }).expect(200)).body;
    expect(copied.done[0].to).toBe("/문서/a - 복사본.txt");
    const moved = (await t.post("/api/v1/files/paste", { sources: ["/문서/a - 복사본.txt", "/none"], destination: "/자료", mode: "cut" }).expect(200)).body;
    expect(moved.done[0].to).toBe("/자료/a - 복사본.txt"); expect(moved.failed[0].path).toBe("/none");
    expect((await t.post("/api/v1/files/paste", { sources: ["/문서"], destination: "/문서", mode: "cut" }).expect(200)).body.failed.length).toBe(1);
    const removed = (await t.post("/api/v1/files/delete", { paths: ["/자료", "/"] }).expect(200)).body;
    expect(removed.done).toEqual(["/자료"]); expect(removed.recycled).toBe(true); expect(removed.failed[0].path).toBe("/");
    expect(existsSync(path.join(root, "자료"))).toBe(false);
    const trash = readdirSync(path.join(root, ".trash"));
    expect(trash.length).toBe(1);
    expect(readdirSync(path.join(root, ".trash", trash[0]))).toEqual(["자료"]);
    expect((await t.get("/api/v1/files?path=/").expect(200)).body.entries.map((e: { name: string }) => e.name)).not.toContain(".trash");
  });

  test("파일 폴더가 없으면 파일 API는 404", async () => {
    const plain = await testApp();
    try {
      expect((await plain.get("/api/v1/files/places")).body.error.code).toBe("NOT_FOUND");
      expect((await plain.raw.get("/api/v1/health").expect(200)).body.files).toBe(false);
    } finally { await plain.close(); }
  });
});
