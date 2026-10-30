import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { handler } from "../src/web/server";
import { byteRange, copyName, crumbsOf, newFolderName } from "../src/files/files.service";
import { decodeTextAs, encodeText } from "../src/web/lib/files";
import { fixture } from "./helpers";

describe("File explorer API", () => {
  let f: ReturnType<typeof fixture>;
  let launched: [string, string, boolean][];
  let request: (url: string, init?: RequestInit) => Promise<Response>;
  let disk: string;
  const origin = "http://127.0.0.1:7474";
  const q = (target: string) => encodeURIComponent(target);
  const memo = "첫 줄\n둘째 줄\n";
  beforeEach(() => {
    f = fixture(); launched = [];
    const handle = handler(f.service, f.config, { files: { launch: (target, action, directory) => { launched.push([target, action, directory]); } } });
    request = async (url, init = {}) => handle(new Request(`${origin}${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
    disk = realpathSync(f.dir);
    mkdirSync(path.join(disk, "폴더 하나"));
    writeFileSync(path.join(disk, "메모.txt"), memo);
    writeFileSync(path.join(disk, ".숨김"), "x");
    writeFileSync(path.join(disk, "page.html"), "<script>alert(1)</script>");
    writeFileSync(path.join(disk, "setup.exe"), "MZ");
  });
  afterEach(() => f.close());

  test("lists a folder with crumbs, kinds, sizes and hidden flags", async () => {
    const listing = await (await request(`/api/v1/files?path=${q(disk)}`)).json();
    expect(listing.schemaVersion).toBe(1);
    expect(listing.path).toBe(disk);
    expect(listing.crumbs.at(-1)).toEqual({ name: path.basename(disk), path: disk });
    expect(listing.crumbs[0].path).toBe(path.parse(disk).root);
    expect(listing.parent).toBe(path.dirname(disk));
    const byName = Object.fromEntries(listing.entries.map((entry: { name: string }) => [entry.name, entry]));
    expect(byName["폴더 하나"]).toMatchObject({ kind: "directory", size: null, hidden: false });
    expect(byName["메모.txt"]).toMatchObject({ kind: "file", size: Buffer.byteLength(memo), hidden: false, link: false, path: path.join(disk, "메모.txt") });
    expect(byName[".숨김"].hidden).toBe(true);
    expect(typeof byName["메모.txt"].modified).toBe("string");
    expect(listing.total).toBe(listing.entries.length); expect(listing.truncated).toBe(false);
    const places = await (await request("/api/v1/files/places")).json();
    expect(places.home).toBeString(); expect(places.places[0]).toMatchObject({ id: "home", path: places.home });
    expect(places.drives.length).toBeGreaterThan(0);
    expect(places.separator).toBe(path.sep);
  });

  test("serves file content inline with a sandbox, byte ranges and downloads", async () => {
    const url = `/api/v1/files/content?path=${q(path.join(disk, "메모.txt"))}`;
    const text = await request(url);
    expect(text.status).toBe(200); expect(text.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(text.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(text.headers.get("Cache-Control")).toBe("no-store");
    expect(await text.text()).toBe(memo);
    const part = await request(url, { headers: { range: "bytes=0-2" } });
    expect(part.status).toBe(206); expect(part.headers.get("Content-Range")).toBe(`bytes 0-2/${Buffer.byteLength(memo)}`);
    expect(await part.text()).toBe("첫");
    expect((await request(url, { headers: { range: "bytes=999-" } })).status).toBe(416);
    // HTML은 이 출처에서 문서로 열리지 않도록 내려받기 형식으로만 준다.
    expect((await request(`/api/v1/files/content?path=${q(path.join(disk, "page.html"))}`)).headers.get("Content-Type")).toBe("application/octet-stream");
    const download = await request(`${url}&download=1`);
    expect(download.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(download.headers.get("Content-Disposition")).toBe(`attachment; filename="__.txt"; filename*=UTF-8''${encodeURIComponent("메모.txt")}`);
  });

  test("rejects bad paths, missing items, other sites and stray parameters", async () => {
    const status = async (url: string, init?: RequestInit) => (await request(url, init)).status;
    expect(await status(`/api/v1/files?path=${q(path.join(disk, "없음"))}`)).toBe(404);
    expect(await status(`/api/v1/files?path=${q(path.join(disk, "메모.txt"))}`)).toBe(400);
    expect(await status(`/api/v1/files/content?path=${q(disk)}`)).toBe(400);
    for (const bad of ["relative", "", "a\0b"]) expect(await status(`/api/v1/files?path=${q(bad)}`), bad).toBe(400);
    if (process.platform === "win32") {
      for (const bad of ["\\\\server\\share", "//server/share", "\\\\?\\C:\\", "C:relative", "C:\\a.txt:stream"]) expect(await status(`/api/v1/files?path=${q(bad)}`), bad).toBe(400);
    }
    expect(await status(`/api/v1/files?path=${q(disk)}&x=1`)).toBe(400);
    expect(await status(`/api/v1/files?path=${q(disk)}&path=${q(disk)}`)).toBe(400);
    expect(await status("/api/v1/files")).toBe(400);
    expect(await status("/api/v1/files/places?x=1")).toBe(400);
    expect(await status("/api/v1/files/nope")).toBe(404);
    // 같은 컴퓨터의 다른 포트(same-site)나 다른 사이트가 넣는 이미지·요청은 받지 않는다. 주소창에 직접 친 요청(none)은 받는다.
    for (const site of ["same-site", "cross-site"]) expect(await status(`/api/v1/files?path=${q(disk)}`, { headers: { "sec-fetch-site": site } })).toBe(403);
    expect(await status(`/api/v1/files?path=${q(disk)}`, { headers: { "sec-fetch-site": "none" } })).toBe(200);
    expect(await status(`/api/v1/files?path=${q(disk)}`, { headers: { host: "evil.example:7474" } })).toBe(403);
    expect(await status(`/api/v1/files?path=${q(disk)}`, { method: "DELETE" })).toBe(405);
    // 파일 탐색기를 주지 않은 서버에는 파일 경로가 없다.
    const plain = handler(f.service, f.config);
    expect((await plain(new Request(`${origin}/api/v1/files?path=${q(disk)}`, { headers: { host: "127.0.0.1:7474" } }))).status).toBe(404);
  });

  test("open hands folders and files to the system, but only reveals executables", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) => request("/api/v1/files/open", { method: "POST", body: JSON.stringify(body),
      headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });
    expect((await (await post({ path: disk, action: "open" })).json()).action).toBe("open");
    expect((await (await post({ path: path.join(disk, "메모.txt"), action: "reveal" })).json()).action).toBe("reveal");
    expect((await (await post({ path: path.join(disk, "setup.exe"), action: "open" })).json()).action).toBe("reveal");
    expect(launched).toEqual([[disk, "open", true], [path.join(disk, "메모.txt"), "reveal", false], [path.join(disk, "setup.exe"), "reveal", false]]);
    expect((await post({ path: disk, action: "open" }, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await post({ path: disk, action: "open" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ path: disk, action: "open" }, { "content-type": "text/plain" })).status).toBe(415);
    for (const bad of [{ path: disk }, { path: disk, action: "run" }, { path: disk, action: "open", extra: 1 }, [], "x"]) expect((await post(bad)).status).toBe(400);
    expect((await post({ path: path.join(disk, "없음"), action: "open" })).status).toBe(404);
    const get = await request("/api/v1/files/open");
    expect(get.status).toBe(405); expect(get.headers.get("Allow")).toBe("POST");
    expect(launched).toHaveLength(3);
  });

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) => request(url, { method: "POST", body: JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });

  test("stat reports properties of files and folders, including folder contents", async () => {
    const file = await (await request(`/api/v1/files/stat?path=${q(path.join(disk, "메모.txt"))}`)).json();
    expect(file).toMatchObject({ schemaVersion: 1, name: "메모.txt", kind: "file", size: Buffer.byteLength(memo), hidden: false, readonly: false, link: false, target: null, contents: null });
    expect(typeof file.modified).toBe("string"); expect(typeof file.accessed).toBe("string");
    writeFileSync(path.join(disk, "폴더 하나", "안.txt"), "12345");
    mkdirSync(path.join(disk, "폴더 하나", "깊이"));
    const folder = await (await request(`/api/v1/files/stat?path=${q(path.join(disk, "폴더 하나"))}`)).json();
    expect(folder).toMatchObject({ name: "폴더 하나", kind: "directory", size: null, contents: { folders: 1, files: 1, bytes: 5, partial: false } });
    expect((await request(`/api/v1/files/stat?path=${q(path.join(disk, "없음"))}`)).status).toBe(404);
    expect((await request(`/api/v1/files/stat?path=${q(disk)}&x=1`)).status).toBe(400);
  });

  test("paste copies with Explorer-style names, moves without overwriting and reports each failure", async () => {
    const target = path.join(disk, "폴더 하나");
    // 같은 폴더에 복사하면 `- 복사본`, 또 하면 `- 복사본 (2)`
    const first = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "메모.txt")], destination: disk, mode: "copy" })).json();
    expect(first).toEqual({ schemaVersion: 1, mode: "copy", done: [{ from: path.join(disk, "메모.txt"), to: path.join(disk, "메모 - 복사본.txt") }], failed: [] });
    const second = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "메모.txt")], destination: disk, mode: "copy" })).json();
    expect(second.done[0].to).toBe(path.join(disk, "메모 - 복사본 (2).txt"));
    expect(readFileSync(path.join(disk, "메모 - 복사본 (2).txt"), "utf8")).toBe(memo);
    // 폴더 복사는 안까지 복사하고, 자기 자신 안으로는 못 넣는다.
    writeFileSync(path.join(target, "안.txt"), "x");
    const folder = await (await post("/api/v1/files/paste", { sources: [target, target], destination: disk, mode: "copy" })).json();
    expect(folder.done).toEqual([{ from: target, to: path.join(disk, "폴더 하나 - 복사본") }]);
    expect(existsSync(path.join(disk, "폴더 하나 - 복사본", "안.txt"))).toBe(true);
    const self = await (await post("/api/v1/files/paste", { sources: [target], destination: target, mode: "copy" })).json();
    expect(self.failed[0].message).toContain("자기 자신");
    // 잘라내기: 옮기고, 같은 폴더면 건너뛰고, 이름이 겹치면 덮어쓰지 않는다.
    const moved = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "메모 - 복사본.txt"), path.join(disk, "page.html")], destination: target, mode: "cut" })).json();
    expect(moved.done.map((item: { to: string }) => item.to)).toEqual([path.join(target, "메모 - 복사본.txt"), path.join(target, "page.html")]);
    expect(existsSync(path.join(disk, "page.html"))).toBe(false);
    writeFileSync(path.join(disk, "page.html"), "again");
    const clash = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "page.html"), path.join(disk, "setup.exe")], destination: target, mode: "cut" })).json();
    expect(clash.done).toEqual([{ from: path.join(disk, "setup.exe"), to: path.join(target, "setup.exe") }]);
    expect(clash.failed).toEqual([{ path: path.join(disk, "page.html"), message: "같은 이름의 항목이 이미 있습니다." }]);
    expect(readFileSync(path.join(target, "page.html"), "utf8")).toBe("<script>alert(1)</script>");
    const same = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "page.html")], destination: disk, mode: "cut" })).json();
    expect(same.failed[0].message).toBe("이미 이 폴더에 있습니다.");
    // 검사: 폴더가 아닌 곳, 없는 원본, 잘못된 본문, 다른 사이트
    expect((await post("/api/v1/files/paste", { sources: [path.join(disk, "메모.txt")], destination: path.join(disk, "메모.txt"), mode: "copy" })).status).toBe(400);
    const missing = await (await post("/api/v1/files/paste", { sources: [path.join(disk, "없음")], destination: disk, mode: "copy" })).json();
    expect(missing.failed[0].message).toBe("파일이나 폴더가 없습니다.");
    for (const bad of [{ sources: [], destination: disk, mode: "copy" }, { sources: [disk], destination: disk, mode: "move" }, { sources: [disk], destination: disk, mode: "copy", x: 1 }, []]) {
      expect((await post("/api/v1/files/paste", bad)).status).toBe(400);
    }
    expect((await post("/api/v1/files/paste", { sources: [disk], destination: disk, mode: "copy" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await request("/api/v1/files/paste")).status).toBe(405);
  });

  test("delete hands items to the remover and refuses roots, the home folder and missing items", async () => {
    const removed: string[][] = [];
    const handle = handler(f.service, f.config, { files: { launch: () => {}, remove: (targets) => { removed.push(targets); return { recycled: true, failed: targets.filter((target) => target.endsWith(".exe")).map((target) => ({ path: target, message: "잠김" })) }; } } });
    const send = async (body: unknown) => (await handle(new Request(`${origin}/api/v1/files/delete`, { method: "POST", body: JSON.stringify(body),
      headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } }))).json();
    const root = path.parse(disk).root;
    const result = await send({ paths: [path.join(disk, "메모.txt"), path.join(disk, "setup.exe"), root, path.join(disk, "없음")] });
    expect(removed).toEqual([[path.join(disk, "메모.txt"), path.join(disk, "setup.exe")]]);
    expect(result).toEqual({ schemaVersion: 1, recycled: true, done: [path.join(disk, "메모.txt")], failed: [
      { path: root, message: "드라이브 전체나 사용자 폴더는 지울 수 없습니다." }, { path: path.join(disk, "없음"), message: "파일이나 폴더가 없습니다." },
      { path: path.join(disk, "setup.exe"), message: "잠김" }] });
    // 실제 제거기: 파일과 폴더가 사라진다(Windows는 휴지통으로).
    mkdirSync(path.join(disk, "지울 폴더")); writeFileSync(path.join(disk, "지울 폴더", "안.txt"), "x");
    const real = await (await post("/api/v1/files/delete", { paths: [path.join(disk, "지울 폴더"), path.join(disk, ".숨김")] })).json();
    expect(real.failed).toEqual([]);
    expect(real.done).toEqual([path.join(disk, "지울 폴더"), path.join(disk, ".숨김")]);
    expect(real.recycled).toBe(process.platform === "win32");
    expect(existsSync(path.join(disk, "지울 폴더"))).toBe(false);
    expect(existsSync(path.join(disk, ".숨김"))).toBe(false);
    for (const bad of [{ paths: [] }, { paths: "x" }, { paths: [disk], x: 1 }, {}]) expect((await post("/api/v1/files/delete", bad)).status).toBe(400);
    expect((await request("/api/v1/files/delete")).status).toBe(405);
  });

  test("save rewrites an existing file, refusing stale reads unless told to overwrite", async () => {
    const target = path.join(disk, "메모.txt");
    const read = await request(`/api/v1/files/content?path=${q(target)}`);
    const modified = read.headers.get("X-File-Modified");
    expect(modified).toBe(statSync(target).mtime.toISOString());
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    const saved = await post("/api/v1/files/save", { path: target, data: b64("고친 줄\r\n"), modified });
    expect(saved.status).toBe(200);
    const result = await saved.json();
    expect(result).toEqual({ schemaVersion: 1, path: target, size: Buffer.byteLength("고친 줄\r\n"), modified: statSync(target).mtime.toISOString() });
    expect(readFileSync(target, "utf8")).toBe("고친 줄\r\n");
    // 읽은 뒤 다른 곳에서 바뀌었으면(옛 수정 시각) 덮어쓰지 않고, null이면 그대로 덮어쓴다.
    utimesSync(target, new Date(), new Date(Date.parse(result.modified) + 5000));
    const stale = await post("/api/v1/files/save", { path: target, data: b64("늦은 저장"), modified: result.modified });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("FILE_CHANGED");
    expect(readFileSync(target, "utf8")).toBe("고친 줄\r\n");
    expect((await post("/api/v1/files/save", { path: target, data: b64("덮어쓰기"), modified: null })).status).toBe(200);
    expect(readFileSync(target, "utf8")).toBe("덮어쓰기");
    // 새 파일은 만들지 않고, 폴더·잘못된 본문·다른 사이트는 받지 않는다.
    expect((await post("/api/v1/files/save", { path: path.join(disk, "없음.txt"), data: b64("x"), modified: null })).status).toBe(404);
    expect(existsSync(path.join(disk, "없음.txt"))).toBe(false);
    expect((await post("/api/v1/files/save", { path: path.join(disk, "폴더 하나"), data: b64("x"), modified: null })).status).toBe(400);
    for (const bad of [{ path: target, data: "!!", modified: null }, { path: target, data: b64("x") }, { path: target, data: b64("x"), modified: 1 }, { path: target, data: b64("x"), modified: null, x: 1 }, []]) {
      expect((await post("/api/v1/files/save", bad)).status).toBe(400);
    }
    expect((await post("/api/v1/files/save", { path: target, data: b64("x"), modified: null }, { "sec-fetch-site": "same-site" })).status).toBe(403);
    const get = await request("/api/v1/files/save");
    expect(get.status).toBe(405); expect(get.headers.get("Allow")).toBe("POST");
    expect(readFileSync(target, "utf8")).toBe("덮어쓰기");
  });

  test("text is decoded with its encoding and written back byte for byte", () => {
    const roundTrip = (bytes: Uint8Array) => {
      const decoded = decodeTextAs(bytes)!;
      expect(decoded.exact).toBe(true);
      expect(Buffer.from(encodeText(decoded.text, decoded.encoding)).equals(Buffer.from(bytes))).toBe(true);
      return decoded.encoding;
    };
    expect(roundTrip(Buffer.from("한글 abc\n"))).toBe("utf-8");
    expect(roundTrip(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("BOM 한글")]))).toBe("utf-8-bom");
    expect(roundTrip(Buffer.from([0xff, 0xfe, ...Buffer.from("UTF-16 한글", "utf16le")]))).toBe("utf-16le");
    // CP949: `한글`(C7D1 B1DB)과 확장 완성형 `똠`(8C63)
    expect(roundTrip(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0x8c, 0x63, 0x0d, 0x0a]))).toBe("euc-kr");
    expect(() => encodeText("한글 😀", "euc-kr")).toThrow("CP949");
    expect(decodeTextAs(Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
  });

  test("mkdir makes Explorer-style new folders and rename changes only the name without overwriting", async () => {
    // 이름 없이 만들면 `새 폴더`, 또 만들면 `새 폴더 (2)`. 이름을 주면 그 이름이고, 겹치면 409다.
    const first = await (await post("/api/v1/files/mkdir", { parent: disk })).json();
    expect(first).toEqual({ schemaVersion: 1, path: path.join(disk, "새 폴더"), name: "새 폴더" });
    expect(statSync(first.path).isDirectory()).toBe(true);
    expect((await (await post("/api/v1/files/mkdir", { parent: disk })).json()).name).toBe("새 폴더 (2)");
    expect((await (await post("/api/v1/files/mkdir", { parent: disk, name: "  자료  " })).json()).path).toBe(path.join(disk, "자료"));
    const exists = await post("/api/v1/files/mkdir", { parent: disk, name: "폴더 하나" });
    expect(exists.status).toBe(409);
    expect((await exists.json()).error.message).toBe("같은 이름의 항목이 이미 있습니다.");
    expect((await post("/api/v1/files/mkdir", { parent: path.join(disk, "메모.txt") })).status).toBe(400);
    expect((await post("/api/v1/files/mkdir", { parent: path.join(disk, "없음") })).status).toBe(404);

    // 이름 바꾸기: 같은 폴더 안에서, 끝의 점·공백은 떼고, 대소문자만 바꾸는 것도 된다.
    const renamed = await (await post("/api/v1/files/rename", { path: path.join(disk, "메모.txt"), name: "회의록.md. " })).json();
    expect(renamed).toEqual({ schemaVersion: 1, from: path.join(disk, "메모.txt"), to: path.join(disk, "회의록.md"), name: "회의록.md" });
    expect(readFileSync(path.join(disk, "회의록.md"), "utf8")).toBe(memo);
    expect(existsSync(path.join(disk, "메모.txt"))).toBe(false);
    const folder = await (await post("/api/v1/files/rename", { path: first.path, name: "Archive" })).json();
    expect(folder.to).toBe(path.join(disk, "Archive"));
    if (process.platform === "win32") {
      expect((await post("/api/v1/files/rename", { path: path.join(disk, "Archive"), name: "ARCHIVE" })).status).toBe(200);
      expect(readdirSync(disk)).toContain("ARCHIVE");
    }
    // 덮어쓰지 않는다.
    const clash = await post("/api/v1/files/rename", { path: path.join(disk, "회의록.md"), name: "page.html" });
    expect(clash.status).toBe(409);
    expect(readFileSync(path.join(disk, "page.html"), "utf8")).toBe("<script>alert(1)</script>");
    expect(readFileSync(path.join(disk, "회의록.md"), "utf8")).toBe(memo);
    // 못 쓰는 이름: 빈 이름, 금지 글자, 예약 이름, 너무 긴 이름, 경로를 섞은 이름
    const message = async (name: unknown) => { const response = await post("/api/v1/files/rename", { path: path.join(disk, "회의록.md"), name }); expect(response.status).toBe(400); return (await response.json()).error.message as string; };
    expect(await message("  . ")).toBe("이름을 입력하세요.");
    expect(await message("a:b.txt")).toContain("다음 문자는 쓸 수 없습니다");
    expect(await message("..\\밖.txt")).toContain("다음 문자는 쓸 수 없습니다");
    expect(await message("CON.txt")).toContain("예약한 이름");
    expect(await message("가".repeat(256))).toContain("너무 깁니다");
    expect(await message(3)).toBe("name은 문자열입니다.");
    // 드라이브·없는 항목·잘못된 본문·다른 사이트·GET
    expect((await post("/api/v1/files/rename", { path: path.parse(disk).root, name: "x" })).status).toBe(400);
    expect((await post("/api/v1/files/rename", { path: path.join(disk, "없음"), name: "x" })).status).toBe(404);
    for (const bad of [{ path: path.join(disk, "회의록.md") }, { path: path.join(disk, "회의록.md"), name: "x", y: 1 }, []]) expect((await post("/api/v1/files/rename", bad)).status).toBe(400);
    for (const bad of [{ parent: disk, x: 1 }, { parent: disk, name: "a?b" }, []]) expect((await post("/api/v1/files/mkdir", bad)).status).toBe(400);
    expect((await post("/api/v1/files/mkdir", { parent: disk }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await request("/api/v1/files/rename")).status).toBe(405);
    expect((await request("/api/v1/files/mkdir")).status).toBe(405);
    expect(existsSync(path.join(disk, "새 폴더 (3)"))).toBe(false);
  });

  test("new folder name helper", () => {
    expect(newFolderName(disk)).toBe("새 폴더");
    expect(newFolderName(disk, (name) => ["새 폴더", "새 폴더 (2)"].includes(name))).toBe("새 폴더 (3)");
  });

  test("copy name helper", () => {
    expect(copyName(disk, "없음.txt")).toBe("없음.txt");
    expect(copyName(disk, "메모.txt")).toBe("메모 - 복사본.txt");
    expect(copyName(disk, "폴더 하나")).toBe("폴더 하나 - 복사본");
    expect(copyName(disk, ".숨김")).toBe(".숨김 - 복사본");
    expect(copyName(disk, "a.txt", (name) => ["a.txt", "a - 복사본.txt", "a - 복사본 (2).txt"].includes(name))).toBe("a - 복사본 (3).txt");
  });

  test("range and crumb helpers", () => {
    expect(byteRange(null, 10)).toBeNull();
    expect(byteRange("bytes=2-", 10)).toEqual({ start: 2, end: 9 });
    expect(byteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(byteRange("bytes=0-99", 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange("bytes=5-2", 10)).toBe("invalid");
    expect(byteRange("bytes=0-1,4-5", 10)).toBeNull();
    if (process.platform === "win32") expect(crumbsOf("C:\\Users\\me")).toEqual([{ name: "C:", path: "C:\\" }, { name: "Users", path: "C:\\Users" }, { name: "me", path: "C:\\Users\\me" }]);
    else expect(crumbsOf("/home/me").map((crumb) => crumb.name)).toEqual(["/", "home", "me"]);
  });
});
