import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handler, startServer } from "../src/web/server";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";
import { RelayError } from "../src/errors";
import { fixture, input } from "./helpers";

describe("Local read-only HTTP API", () => {
  let f: ReturnType<typeof fixture>;
  let request: (url: string, init?: RequestInit) => Response;
  beforeEach(() => {
    f = fixture(); const handle = handler(f.service, f.config);
    request = (url, init = {}) => handle(new Request(`http://127.0.0.1:7474${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
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
