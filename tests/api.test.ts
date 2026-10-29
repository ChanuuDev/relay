import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handler, startServer } from "../src/web/server";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";
import { RelayError } from "../src/errors";
import { fixture, input } from "./helpers";
import { NoteStore } from "../src/notes/notes.store";
import { HOOK_SUMMARY } from "../src/session/session.service";
import { CalculatorStore, MAX_HISTORY } from "../src/calculator/calculator.store";

describe("Local read-only HTTP API", () => {
  let f: ReturnType<typeof fixture>;
  let request: (url: string, init?: RequestInit) => Response;
  beforeEach(() => {
    f = fixture(); const handle = handler(f.service, f.config);
    request = (url, init = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } })) as Response;
  });
  afterEach(() => f.close());

  test("health, DTO contract, internal IDs, parent, children and history", async () => {
    const health = await request("/api/v1/health").json(); expect(health.databasePath).toBe(f.config.databasePath);
    // 모든 응답이 서버 PID를 알려 준다. relay web --close가 이 값으로 끝낼 서버를 찾는다.
    expect(request("/api/v1/health").headers.get("Relay-Pid")).toBe(String(process.pid));
    expect(request("/missing").headers.get("Relay-Pid")).toBe(String(process.pid));
    // 화면 빌드 식별자는 HTML과 health가 같다. 열린 화면은 둘이 달라지면(서버가 새 빌드로 다시 뜨면) 스스로 새로 고친다.
    expect(health.build).toMatch(/^[0-9a-z]+$/);
    for (const page of ["/", "/sessions/any"]) expect(await request(page).text()).toContain(`<meta name="relay-build" content="${health.build}">`);
    const a = f.service.record(input("provider-a")).session;
    f.service.update("provider-a", "다음 대화에 필요한 맥락");
    const child = f.service.record(input("provider-b", { provider: "anthropic", agent: "claude-code" }), "provider-a").session;
    const list = await request("/api/v1/sessions?provider=anthropic").json();
    expect(list.schemaVersion).toBe(1); expect(list.items[0].id).toBe(child.id); expect(list.page.total).toBe(1);
    const detail = await request(`/api/v1/sessions/${child.id}`).json(); expect(detail.parentSession.id).toBe(a.id);
    expect(detail.session.createdAt).toBeString(); expect(detail.session.endedAt).toBeNull();
    for (const row of [detail.session, list.items[0]]) {
      expect(row).not.toHaveProperty("startedAt");
      expect(row.status).toBeNull(); expect(row.pinned).toBe(false); expect(row.git).toBeNull();
    }
    expect((await request(`/api/v1/sessions/${a.id}/children?limit=1`).json()).items[0].id).toBe(child.id);
    const history = await request(`/api/v1/sessions/${a.id}/updates?offset=1`).json();
    expect(history.items[0].sequence).toBe(1);
    expect(history.items[0].summary).toBe(a.summary);
    expect(history.items[0]).not.toHaveProperty("type");
    expect(request("/api/v1/sessions/provider-a").status).toBe(404);
    expect(request(`/api/v1/sessions/${a.id}`).headers.get("Cache-Control")).toBe("no-store");
  });

  test("invalid filters, duplicate/unknown params and unknown routes are explicit errors", async () => {
    for (const query of ["nope=1", "status=bad", "limit=0", "offset=-1", "limit=101", "provider=x&provider=y", "cwd=relative", "limit=2.5"]) {
      const response = request(`/api/v1/sessions?${query}`); expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGUMENT");
    }
    expect(request("/api/v1/health?q=x").status).toBe(400);
    expect(request("/api/v1/nope").status).toBe(404);
    expect(request("/api/v1/sessions/%ZZ").status).toBe(400);
    expect(request("/api/v1/sessions/absent").status).toBe(404);
  });

  test("loopback Host, same Origin and Fetch-Site checks apply to API and static assets", () => {
    for (const endpoint of ["/", "/app.js", "/api/v1/sessions"]) {
      const denied: Record<string, string>[] = [{ host: "evil.example:7474" }, { host: "[" }, { origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { host: "127.0.0.1:7475" }];
      for (const headers of denied) {
        expect(request(endpoint, { headers }).status).toBe(403);
      }
      expect(request(endpoint, { headers: { origin: "http://127.0.0.1:7474" } }).status).toBe(200);
      expect(request(endpoint, { headers: { host: "localhost:7474", origin: "http://localhost:7474" } }).status).toBe(200);
      expect(request(endpoint).headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect(request(endpoint).headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(request(endpoint).headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      // 유튜브 창은 localhost 출처의 플레이어 래퍼(iframe)·섬네일·oEmbed만 바깥에서 받는다.
      expect(request(endpoint).headers.get("Content-Security-Policy")).toContain("frame-src 'self' http://localhost:7474");
      expect(request(endpoint).headers.get("Content-Security-Policy")).toContain("img-src 'self' blob: https://i.ytimg.com");
      expect(request(endpoint).headers.get("Content-Security-Policy")).toContain("connect-src 'self' https://www.youtube.com");
    }
  });

  test("youtube player wrapper: localhost-origin page that embeds only the nocookie player", async () => {
    // 127.0.0.1 화면이 localhost 래퍼를 iframe으로 넣으면 브라우저가 cross-site로 표시하므로 이 경로만 허용한다.
    const page = request("/youtube/player?v=dQw4w9WgXcQ&list=PLabc&start=65", { headers: { host: "localhost:7474", "sec-fetch-site": "cross-site" } });
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors http://127.0.0.1:7474 http://localhost:7474");
    expect(page.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(page.headers.get("Relay-Pid")).toBe(String(process.pid));
    const html = await page.text();
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;rel=0&amp;playsinline=1&amp;list=PLabc&amp;start=65"');
    expect(html).not.toContain("<script");
    expect(await request("/youtube/player?list=PLabc").text()).toContain("/embed/videoseries?autoplay=1&amp;rel=0&amp;playsinline=1&amp;list=PLabc");
    for (const query of ["", "?v=short", "?v=dQw4w9WgXcQ&start=0", "?v=dQw4w9WgXcQ&x=1", "?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ", "?list=a", "?v=%22%3E%3Cscript%3E"]) {
      expect(request(`/youtube/player${query}`).status, query).toBe(400);
    }
    expect(request("/api/v1/health", { headers: { "sec-fetch-site": "cross-site" } }).status).toBe(403);
    expect(request("/youtube/player?v=dQw4w9WgXcQ", { headers: { host: "evil.example:7474" } }).status).toBe(403);
    expect(request("/youtube/player?v=dQw4w9WgXcQ", { method: "POST" }).status).toBe(405);
  });

  test("no mutations or arbitrary static files; detail URL reload serves HTML", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT", "OPTIONS", "HEAD"]) expect(request("/api/v1/sessions", { method }).status).toBe(405);
    for (const path of ["/relay.db", "/config.json", "/src/index.ts", "/..%2frelay.db", "/api/v1/execute"]) expect(request(path).status).toBe(404);
    const html = request("/sessions/ses_example"); expect(html.status).toBe(200);
    expect(await html.text()).toContain('<html lang="ko">');
    expect(f.service.list().page.total).toBe(0);
  });

  test("installed-app assets: manifest, service worker and app icons come from the executable", async () => {
    const html = await request("/").text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    const response = request("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json; charset=utf-8");
    const manifest = await response.json();
    expect(manifest).toMatchObject({ id: "/", name: "Relay", short_name: "Relay", start_url: "/", scope: "/", display: "standalone", lang: "ko" });
    expect(manifest.display_override).toEqual(["window-controls-overlay"]);
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const image = request(icon.src);
      expect(image.status).toBe(200); expect(image.headers.get("Content-Type")).toBe(icon.type);
      // PNG IHDR의 가로·세로가 매니페스트에 적은 크기와 같아야 브라우저가 설치 아이콘으로 쓴다.
      const header = new DataView(await image.arrayBuffer());
      expect(`${header.getUint32(16)}x${header.getUint32(20)}`).toBe(icon.sizes);
    }
    const worker = request("/sw.js");
    expect(worker.status).toBe(200);
    expect(worker.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(worker.headers.get("Cache-Control")).toBe("no-store");
    // 서비스 워커가 미리 담는 셸은 모두 서버가 실제로 내주는 자산이어야 한다.
    const shell: string[] = JSON.parse(/const SHELL = (\[[^\]]+\])/.exec(await worker.text())![1]);
    for (const path of shell) expect(request(path).status).toBe(200);
    expect(shell.some((path) => path.startsWith("/api/"))).toBe(false);
  });

  test("schema changes and busy errors produce structured 503, not empty data", async () => {
    f.db.exec("PRAGMA user_version=99");
    expect(request("/api/v1/health").status).toBe(503);
    const mismatch = request("/api/v1/sessions"); expect((await mismatch.json()).error.code).toBe("SCHEMA_MISMATCH");
    const original = f.service.list;
    f.service.list = () => { throw new RelayError("DB_BUSY", "잠금", 5, 503); };
    const busy = request("/api/v1/sessions"); expect(busy.status).toBe(503); expect(busy.headers.get("Retry-After")).toBe("3");
    f.service.list = original;
  });

  test("server actually binds loopback, reads live changes, has readonly DB and rejects port reuse", async () => {
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
    const port = reservation.port!; await reservation.stop(true);
    const config = loadConfig(f.dir, String(port)); const running = startServer(config);
    try {
      const readonly = openDatabase(config, true);
      try { expect(() => readonly.exec("DELETE FROM sessions")).toThrow(); } finally { readonly.close(); }
      expect(running.server.hostname).toBe("127.0.0.1");
      let duplicate: ReturnType<typeof startServer> | undefined;
      try { expect(() => { duplicate = startServer(config); }).toThrow("포트가 사용 중"); }
      finally { await duplicate?.stop(); }
      const s = f.service.record(input("live")).session;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions/${s.id}`);
      expect((await response.json()).session.providerSessionId).toBe("live");
      f.service.update("live", "실시간 갱신");
      expect((await (await fetch(`http://127.0.0.1:${port}/api/v1/sessions/${s.id}`)).json()).session.summary).toBe("실시간 갱신");
    } finally { await running.stop(); }
  });

  test("chain endpoint, declared-state and pin filters", async () => {
    const origin = f.service.record(input("root", { status: "done" })).session;
    const child = f.service.record(input("child", { provider: "anthropic", agent: "claude-code", status: "handoff" }), "root").session;
    f.service.pin("child", true);
    const chain = await request(`/api/v1/sessions/${child.id}/chain`).json();
    expect(chain.schemaVersion).toBe(1); expect(chain.sessionId).toBe(child.id); expect(chain.truncated).toBe(false);
    expect(chain.items.map((n: { id: string; depth: number; current: boolean }) => [n.id, n.depth, n.current])).toEqual([[origin.id, 0, false], [child.id, 1, true]]);
    expect(request(`/api/v1/sessions/${child.id}/chain?limit=1`).status).toBe(400);
    expect(request("/api/v1/sessions/absent/chain").status).toBe(404);
    const ids = async (query: string) => (await request(`/api/v1/sessions?${query}`).json()).items.map((s: { id: string }) => s.id);
    expect(await ids("status=handoff")).toEqual([child.id]);
    expect(await ids("pinned=1")).toEqual([child.id]);
    expect(await ids("pinned=false")).toEqual([origin.id]);
    expect(request("/api/v1/sessions?pinned=maybe").status).toBe(400);
    const detail = await request(`/api/v1/sessions/${child.id}`).json();
    expect(detail.session.status).toBe("handoff"); expect(detail.session.pinned).toBe(true);
    expect(detail.parentSession.agent).toBe("codex"); expect(detail.parentSession.status).toBe("done");
    expect((await request(`/api/v1/sessions/${child.id}/updates`).json()).items[0].status).toBe("handoff");
  });

});

describe("Notes API: the only write the web server accepts", () => {
  let f: ReturnType<typeof fixture>;
  let send: (url: string, init?: RequestInit) => Promise<Response>;
  const origin = "http://127.0.0.1:7474";
  const post = (body: unknown, headers: Record<string, string> = {}) => send("/api/v1/notes", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  });
  const list = async () => (await send("/api/v1/notes")).json() as Promise<{ revision: number; items: Array<Record<string, unknown>> }>;
  beforeEach(() => {
    f = fixture(); const handle = handler(f.service, f.config, { notes: new NoteStore(f.db) });
    send = async (url, init = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  });
  afterEach(() => f.close());

  test("lists, saves a batch, answers 304 while nothing changed and cascades folder deletion", async () => {
    const empty = await send("/api/v1/notes");
    expect(await empty.json()).toEqual({ schemaVersion: 1, revision: 0, items: [] });
    expect(empty.headers.get("ETag")).toBe('"0"');
    expect((await send("/api/v1/notes", { headers: { "if-none-match": '"0"' } })).status).toBe(304);
    const saved = await post({ upserts: [
      { id: "f1", kind: "folder", parentId: null, name: "  업무  ", createdAt: 1, updatedAt: 1 },
      { id: "n1", kind: "note", parentId: "f1", title: "회의", body: "# 제목\n\n- [ ] 할 일", createdAt: 2, updatedAt: 3 },
      { id: "n2", kind: "note", parentId: null, title: "", body: "최상위", createdAt: 4, updatedAt: 4 },
    ], deletes: [] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ schemaVersion: 1, revision: 1 });
    const after = await list();
    expect(after.revision).toBe(1);
    expect(after.items).toEqual([
      { id: "f1", kind: "folder", parentId: null, name: "업무", position: null, createdAt: 1, updatedAt: 1 },
      { id: "n1", kind: "note", parentId: "f1", title: "회의", body: "# 제목\n\n- [ ] 할 일", position: null, createdAt: 2, updatedAt: 3 },
      { id: "n2", kind: "note", parentId: null, title: "", body: "최상위", position: null, createdAt: 4, updatedAt: 4 },
    ]);
    expect((await send("/api/v1/notes", { headers: { "if-none-match": '"0"' } })).status).toBe(200);
    // 고치기는 같은 id로 다시 보낸다. 폴더를 지우면 안의 메모도 지운다.
    expect((await post({ upserts: [{ id: "n2", kind: "note", parentId: null, title: "고침", body: "", createdAt: 4, updatedAt: 9 }], deletes: ["f1"] })).status).toBe(200);
    expect((await list()).items).toEqual([{ id: "n2", kind: "note", parentId: null, title: "고침", body: "", position: null, createdAt: 4, updatedAt: 9 }]);
    // 끌어 정한 순서(position)는 그대로 남고, 다시 보내면 바뀐다.
    expect((await post({ upserts: [{ id: "n2", kind: "note", parentId: null, title: "고침", body: "", position: -1.5, createdAt: 4, updatedAt: 9 }], deletes: [] })).status).toBe(200);
    expect((await list()).items[0].position).toBe(-1.5);
    expect((await post({ upserts: [{ id: "n2", kind: "note", parentId: null, title: "고침", body: "", position: 3, createdAt: 4, updatedAt: 9 }], deletes: [] })).status).toBe(200);
    expect((await list()).items[0].position).toBe(3);
    // 세션은 그대로이고 세션 쪽 쓰기는 여전히 막혀 있다.
    const blocked = await send("/api/v1/sessions", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(blocked.status).toBe(405); expect(blocked.headers.get("Allow")).toBe("GET");
    const put = await send("/api/v1/notes", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(put.status).toBe(405); expect(put.headers.get("Allow")).toBe("GET, POST");
  });

  test("only accepts JSON posted by the same-origin screen and rejects malformed batches without writing", async () => {
    const batch = { upserts: [{ id: "n1", kind: "note", parentId: null, title: "t", body: "b" }], deletes: [] };
    const cases: Array<[Record<string, string>, number]> = [
      [{ origin: "" }, 403],
      [{ origin: "http://evil.example" }, 403],
      [{ "sec-fetch-site": "cross-site" }, 403],
      [{ "sec-fetch-site": "same-site" }, 403],
      [{ "content-type": "text/plain" }, 415],
      [{ "content-type": "application/x-www-form-urlencoded" }, 415],
    ];
    for (const [headers, status] of cases) {
      const response = await post(batch, headers);
      expect(response.status, JSON.stringify(headers)).toBe(status);
    }
    expect((await post(batch, { host: "evil.example:7474" })).status).toBe(403);
    for (const bad of ["{", "[]", { upserts: "x" }, { upserts: [{ id: "a b", kind: "note" }] }, { upserts: [{ id: "a", kind: "page" }] },
      { upserts: [{ id: "a", kind: "note", body: "x".repeat(200_001) }] }, { upserts: [{ id: "a", kind: "folder", parentId: "a" }] }, { deletes: [1] },
      { upserts: [{ id: "a", kind: "note", position: "1" }] }, { upserts: [{ id: "a", kind: "folder", position: [] }] }]) {
      const response = await post(bad);
      expect(response.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGUMENT");
    }
    expect((await post({}, { "content-length": String(9 * 1024 * 1024) })).status).toBe(413);
    expect((await list()).revision).toBe(0);
  });

  test("keeps the tree valid: missing or note parents and folder cycles fall back to the top level", async () => {
    await post({ upserts: [
      { id: "a", kind: "folder", parentId: "b", name: "가" },
      { id: "b", kind: "folder", parentId: "a", name: "나" },
      { id: "n", kind: "note", parentId: "gone", title: "길 잃은 메모" },
      { id: "m", kind: "note", parentId: "n", title: "메모 아래 메모" },
    ], deletes: [] });
    const items = Object.fromEntries((await list()).items.map((item) => [item.id, item.parentId]));
    expect(items.n).toBeNull(); expect(items.m).toBeNull();
    expect([items.a, items.b].filter((parent) => parent === null)).toHaveLength(1);
  });

  test("without a note store the screen gets no write route", async () => {
    const plain = handler(f.service, f.config);
    for (const url of ["/api/v1/notes", "/api/v1/notes/import"]) {
      const response = await plain(new Request(`http://127.0.0.1:7474${url}`, { method: "POST", body: "{}",
        headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json" } }));
      expect(response.status, url).toBe(405); expect(response.headers.get("Allow")).toBe("GET");
    }
    expect((await plain(new Request("http://127.0.0.1:7474/api/v1/notes/export", { headers: { host: "127.0.0.1:7474" } }))).status).toBe(404);
  });

  const importFile = (body: unknown, headers: Record<string, string> = {}, to = send) => to("/api/v1/notes/import", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  });

  test("exports every item as a dated file that another store imports as is", async () => {
    await post({ upserts: [
      { id: "f1", kind: "folder", parentId: null, name: "업무", createdAt: 1, updatedAt: 1 },
      { id: "n1", kind: "note", parentId: "f1", title: "회의", body: "# 제목\n\n- [ ] 할 일", createdAt: 2, updatedAt: 3 },
    ], deletes: [] });
    const exported = await send("/api/v1/notes/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(exported.headers.get("content-disposition")).toMatch(/^attachment; filename="relay-notes-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await exported.text();
    const file = JSON.parse(text);
    expect(file).toEqual({ format: "relay-notes", schemaVersion: 1, exportedAt: expect.any(String), items: (await list()).items });
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
    expect((await send("/api/v1/notes/export?all=1")).status).toBe(400);

    const other = fixture();
    try {
      const handle = handler(other.service, other.config, { notes: new NoteStore(other.db) });
      const to = async (url: string, init: RequestInit = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
      const imported = await importFile(text, {}, to);
      expect(imported.status).toBe(200);
      expect(await imported.json()).toEqual({ schemaVersion: 1, revision: 1, added: 2, updated: 0, kept: 0 });
      expect((await (await to("/api/v1/notes")).json()).items).toEqual(file.items);
      // 같은 파일을 다시 가져오면 바뀌는 것이 없고 저장 번호도 그대로다.
      expect(await (await importFile(text, {}, to)).json()).toEqual({ schemaVersion: 1, revision: 1, added: 0, updated: 0, kept: 2 });
    } finally { other.close(); }
  });

  test("import adds missing items, keeps the newer side, never deletes and keeps the tree valid", async () => {
    await post({ upserts: [
      { id: "f1", kind: "folder", parentId: null, name: "업무", createdAt: 1, updatedAt: 1 },
      { id: "old", kind: "note", parentId: "f1", title: "옛 메모", body: "옛 본문", createdAt: 2, updatedAt: 5 },
      { id: "mine", kind: "note", parentId: null, title: "이쪽이 최신", body: "이쪽", createdAt: 3, updatedAt: 50 },
      { id: "local", kind: "note", parentId: null, title: "이 환경에만", body: "", createdAt: 4, updatedAt: 4 },
    ], deletes: [] });
    const result = await importFile({ format: "relay-notes", schemaVersion: 1, exportedAt: "2026-10-28T00:00:00.000Z", items: [
      { id: "f1", kind: "folder", parentId: null, name: "업무", createdAt: 1, updatedAt: 1 },
      { id: "old", kind: "note", parentId: null, title: "고친 메모", body: "새 본문", createdAt: 2, updatedAt: 9 },
      { id: "mine", kind: "note", parentId: null, title: "저쪽", body: "저쪽", createdAt: 3, updatedAt: 40 },
      { id: "local", kind: "folder", parentId: null, name: "종류가 다름", createdAt: 4, updatedAt: 99 },
      { id: "new", kind: "note", parentId: "f1", title: "새 메모", body: "추가", createdAt: 6, updatedAt: 6 },
      { id: "lost", kind: "note", parentId: "gone", title: "부모 없음", body: "", createdAt: 7, updatedAt: 7 },
    ] });
    expect(await result.json()).toEqual({ schemaVersion: 1, revision: 2, added: 2, updated: 1, kept: 3 });
    const items = Object.fromEntries((await list()).items.map((item) => [item.id, item]));
    expect(Object.keys(items).sort()).toEqual(["f1", "local", "lost", "mine", "new", "old"]);
    expect(items.old).toEqual({ id: "old", kind: "note", parentId: null, title: "고친 메모", body: "새 본문", position: null, createdAt: 2, updatedAt: 9 });
    expect(items.mine).toMatchObject({ title: "이쪽이 최신", body: "이쪽", updatedAt: 50 });
    expect(items.local).toMatchObject({ kind: "note", title: "이 환경에만" });
    expect(items.new).toMatchObject({ parentId: "f1", body: "추가" });
    expect(items.lost!.parentId).toBeNull();
  });

  test("import takes only a Relay notes file from the same-origin screen and writes nothing when any item is wrong", async () => {
    const good = { format: "relay-notes", schemaVersion: 1, items: [{ id: "n1", kind: "note", parentId: null, title: "t", body: "b" }] };
    for (const [headers, status] of [[{ origin: "" }, 403], [{ origin: "http://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403],
      [{ "sec-fetch-site": "same-site" }, 403], [{ "content-type": "text/plain" }, 415]] as Array<[Record<string, string>, number]>) {
      expect((await importFile(good, headers)).status, JSON.stringify(headers)).toBe(status);
    }
    for (const bad of ["{", "[]", { ...good, format: "other" }, { ...good, schemaVersion: 2 }, { ...good, items: "x" },
      { upserts: good.items, deletes: [] }, { ...good, items: [...good.items, { id: "a b", kind: "note" }] },
      { ...good, items: [...good.items, { id: "big", kind: "note", body: "x".repeat(200_001) }] }]) {
      const response = await importFile(bad);
      expect(response.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGUMENT");
    }
    // 내보낸 파일은 저장 묶음(8MB)보다 클 수 있다. 64MB까지 받는다.
    expect((await importFile({}, { "content-length": String(9 * 1024 * 1024) })).status).toBe(400);
    expect((await importFile({}, { "content-length": String(65 * 1024 * 1024) })).status).toBe(413);
    expect((await list()).revision).toBe(0);
    const get = await send("/api/v1/notes/import");
    expect(get.status).toBe(405); expect(get.headers.get("Allow")).toBe("POST");
    const postExport = await send("/api/v1/notes/export", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(postExport.status).toBe(405); expect(postExport.headers.get("Allow")).toBe("GET");
    expect((await importFile(good, {}, async (url, init) => send(`${url}?x=1`, init))).status).toBe(400);
    expect((await importFile(good)).status).toBe(200);
  });
});

describe("Session actions API: tidying records from the list", () => {
  let f: ReturnType<typeof fixture>;
  let send: (url: string, init?: RequestInit) => Promise<Response>;
  const origin = "http://127.0.0.1:7474";
  const act = (id: string, body: unknown, headers: Record<string, string> = {}, query = "") => send(`/api/v1/sessions/${encodeURIComponent(id)}/actions${query}`, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  });
  const json = async (response: Response | Promise<Response>) => (await response).json();
  beforeEach(() => {
    f = fixture(); const handle = handler(f.service, f.config, { writer: f.service });
    send = async (url, init = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  });
  afterEach(() => f.close());

  test("sets the work state, pins, ends and reopens without moving the time of last update or the history", async () => {
    const { id } = f.service.record(input("tidy")).session;
    const before = f.service.byId(id).session;
    const status = await act(id, { action: "status", status: "done" });
    expect(status.status).toBe(200);
    expect((await status.json()).session.status).toBe("done");
    expect((await json(act(id, { action: "pin", pinned: true }))).session.pinned).toBe(true);
    const ended = (await json(act(id, { action: "end" }))).session;
    expect(ended.endedAt).not.toBeNull(); expect(ended.endReason).toBe("web");
    // 이미 끝난 세션을 다시 끝내도 종료 시각은 그대로다.
    expect((await json(act(id, { action: "end" }))).session.endedAt).toBe(ended.endedAt);
    expect(f.service.byId(id).session).toMatchObject({ status: "done", pinned: true, endedAt: ended.endedAt, endReason: "web",
      summary: before.summary, updatedAt: before.updatedAt });
    expect(f.service.updates(id).page.total).toBe(1);
    expect((await json(act(id, { action: "reopen" }))).session.endedAt).toBeNull();
    expect(f.service.byId(id).session).toMatchObject({ endedAt: null, endReason: null, updatedAt: before.updatedAt });
    expect((await json(act(id, { action: "pin", pinned: false }))).session.pinned).toBe(false);
    expect((await json(act(id, { action: "status", status: "working" }))).session.status).toBe("working");
    expect(f.service.updates(id).page.total).toBe(1);
  });

  test("an end set by hand keeps even an untouched automatic record, unlike the host's end hook", async () => {
    const { id } = f.service.record(input("automatic", { summary: HOOK_SUMMARY })).session;
    expect((await act(id, { action: "end" })).status).toBe(200);
    expect(f.service.byId(id).session.endReason).toBe("web");
  });

  test("deletes; a session others took over from needs force and its children keep their records", async () => {
    const parent = f.service.record(input("parent")).session;
    const child = f.service.record(input("child"), "parent").session;
    const refused = await act(parent.id, { action: "delete" });
    expect(refused.status).toBe(409); expect((await refused.json()).error.code).toBe("SESSION_LINKED");
    expect(f.service.list().page.total).toBe(2);
    const deleted = await act(parent.id, { action: "delete", force: true });
    expect(deleted.status).toBe(200); expect(await deleted.json()).toMatchObject({ deleted: true, detached: 1, session: { id: parent.id } });
    expect(f.service.byId(child.id).session.parentSessionId).toBeNull();
    expect((await act(child.id, { action: "delete", force: false })).status).toBe(200);
    expect(f.service.list().page.total).toBe(0);
    const missing = await act(parent.id, { action: "status", status: "done" });
    expect(missing.status).toBe(404); expect((await missing.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  test("only accepts JSON posted by the same-origin screen and refuses malformed actions without writing", async () => {
    const { id } = f.service.record(input("guarded")).session;
    const done = { action: "status", status: "done" };
    const cases: Array<[Record<string, string>, number]> = [
      [{ origin: "" }, 403], [{ origin: "http://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403], [{ "sec-fetch-site": "same-site" }, 403],
      [{ "content-type": "text/plain" }, 415], [{ "content-type": "application/x-www-form-urlencoded" }, 415], [{ host: "evil.example:7474" }, 403],
    ];
    for (const [headers, status] of cases) expect((await act(id, done, headers)).status, JSON.stringify(headers)).toBe(status);
    for (const bad of ["{", "[]", "null", {}, { action: "rename" }, { action: "status" }, { action: "status", status: "finished" }, { action: "status", status: null },
      { action: "pin" }, { action: "pin", pinned: "yes" }, { action: "end", reason: "x" }, { action: "reopen", force: true }, { action: "delete", force: 1 },
      { action: "status", status: "done", pinned: true }]) {
      const response = await act(id, bad);
      expect(response.status, JSON.stringify(bad)).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGUMENT");
    }
    expect((await act(id, done, {}, "?x=1")).status).toBe(400);
    const broken = await send("/api/v1/sessions/%E0%A4%A/actions", { method: "POST", body: JSON.stringify(done),
      headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } });
    expect(broken.status).toBe(400);
    const get = await send(`/api/v1/sessions/${id}/actions`);
    expect(get.status).toBe(405); expect(get.headers.get("Allow")).toBe("POST");
    expect(f.service.byId(id).session).toMatchObject({ status: null, pinned: false, endedAt: null });
  });

  test("without a writer the screen gets no tidying route", async () => {
    const { id } = f.service.record(input("read-only")).session;
    const plain = handler(f.service, f.config);
    const response = await plain(new Request(`http://127.0.0.1:7474/api/v1/sessions/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "end" }),
      headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json" } }));
    expect(response.status).toBe(405); expect(response.headers.get("Allow")).toBe("GET");
    expect((await plain(new Request(`http://127.0.0.1:7474/api/v1/sessions/${id}/actions`, { headers: { host: "127.0.0.1:7474" } }))).status).toBe(404);
    expect(f.service.byId(id).session.endedAt).toBeNull();
  });
});

describe("Calculator history API: what = finished, kept in the Relay store", () => {
  let f: ReturnType<typeof fixture>;
  let send: (url: string, init?: RequestInit) => Promise<Response>;
  const origin = "http://127.0.0.1:7474";
  const path = "/api/v1/calculator/history";
  const post = (body: unknown, headers: Record<string, string> = {}, query = "") => send(`${path}${query}`, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  });
  const list = async () => (await (await send(path)).json()) as { schemaVersion: number; items: Array<Record<string, unknown>> };
  const add = (id: string, createdAt: number, expression = "1 + 1", result = "2") => post({ action: "add", item: { id, expression, result, createdAt } });
  beforeEach(() => {
    f = fixture(); const handle = handler(f.service, f.config, { calculator: new CalculatorStore(f.db) });
    send = async (url, init = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  });
  afterEach(() => f.close());

  test("adds once per id, lists newest first, deletes one and clears all", async () => {
    expect(await list()).toEqual({ schemaVersion: 1, items: [] });
    const first = await add("c-1", 1000, "1,234.5 × 2", "2,469");
    expect(first.status).toBe(200); expect(await first.json()).toEqual({ schemaVersion: 1, added: true });
    // 보내지 못해 다시 보낸 같은 계산은 한 번만 남는다.
    expect(await (await add("c-1", 1000, "1,234.5 × 2", "2,469")).json()).toEqual({ schemaVersion: 1, added: false });
    await add("c-2", 3000); await add("c-3", 2000);
    expect((await list()).items).toEqual([
      { id: "c-2", expression: "1 + 1", result: "2", createdAt: 3000 },
      { id: "c-3", expression: "1 + 1", result: "2", createdAt: 2000 },
      { id: "c-1", expression: "1,234.5 × 2", result: "2,469", createdAt: 1000 },
    ]);
    expect(await (await post({ action: "delete", id: "c-3" })).json()).toEqual({ schemaVersion: 1, deleted: 1 });
    expect(await (await post({ action: "delete", id: "c-3" })).json()).toEqual({ schemaVersion: 1, deleted: 0 });
    expect(await (await post({ action: "clear" })).json()).toEqual({ schemaVersion: 1, deleted: 2 });
    expect((await list()).items).toEqual([]);
    // 세션 쪽은 건드리지 않는다.
    expect(f.service.list().page.total).toBe(0);
  });

  test("keeps the newest MAX_HISTORY calculations and drops older ones", () => {
    const store = new CalculatorStore(f.db);
    for (let i = 0; i < MAX_HISTORY + 3; i++) store.apply({ action: "add", item: { id: `c${i}`, expression: `${i} + 0`, result: String(i), createdAt: i } });
    const items = store.list().items;
    expect(items).toHaveLength(MAX_HISTORY);
    expect(items[0].id).toBe(`c${MAX_HISTORY + 2}`);
    expect(items.at(-1)!.id).toBe("c3");
  });

  test("only accepts JSON posted by the same-origin screen and refuses malformed changes without writing", async () => {
    const good = { action: "add", item: { id: "ok", expression: "2 × 3", result: "6", createdAt: 1 } };
    const cases: Array<[Record<string, string>, number]> = [
      [{ origin: "" }, 403], [{ origin: "http://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403], [{ "sec-fetch-site": "same-site" }, 403],
      [{ "content-type": "text/plain" }, 415], [{ host: "evil.example:7474" }, 403],
    ];
    for (const [headers, status] of cases) expect((await post(good, headers)).status, JSON.stringify(headers)).toBe(status);
    for (const bad of ["{", "[]", {}, { action: "rename" }, { action: "add" }, { action: "add", item: [] },
      { action: "add", item: { id: "a b", expression: "1", result: "1" } }, { action: "add", item: { id: "a", expression: "", result: "1" } },
      { action: "add", item: { id: "a", expression: "1", result: "x".repeat(101) } }, { action: "add", item: { id: "a", expression: "1", result: "1", extra: 1 } },
      { action: "add", item: { id: "a", expression: "1", result: "1" }, more: 1 }, { action: "delete" }, { action: "delete", id: 5 }, { action: "clear", all: true }]) {
      const response = await post(bad);
      expect(response.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_ARGUMENT");
    }
    expect((await post(good, {}, "?x=1")).status).toBe(400);
    expect((await send(`${path}?x=1`)).status).toBe(400);
    const put = await send(path, { method: "PUT", headers: { origin, "content-type": "application/json" }, body: "{}" });
    expect(put.status).toBe(405); expect(put.headers.get("Allow")).toBe("GET, POST");
    expect((await list()).items).toEqual([]);
    // createdAt이 없거나 틀리면 서버 시각을 쓴다.
    const before = Date.now();
    await post({ action: "add", item: { id: "late", expression: "1", result: "1", createdAt: "어제" } });
    expect((await list()).items[0].createdAt as number).toBeGreaterThanOrEqual(before);
  });

  test("without a calculator store the screen gets no history route", async () => {
    const plain = handler(f.service, f.config);
    expect((await plain(new Request(`http://127.0.0.1:7474${path}`, { headers: { host: "127.0.0.1:7474" } }))).status).toBe(404);
    const response = await plain(new Request(`http://127.0.0.1:7474${path}`, { method: "POST", body: "{}",
      headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json" } }));
    expect(response.status).toBe(405); expect(response.headers.get("Allow")).toBe("GET");
  });
});
