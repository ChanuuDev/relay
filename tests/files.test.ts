import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { handler } from "../src/web/server";
import { byteRange, crumbsOf } from "../src/files/files.service";
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
    const handle = handler(f.service, f.config, undefined, { launch: (target, action, directory) => { launched.push([target, action, directory]); } });
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
