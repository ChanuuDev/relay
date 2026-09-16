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
    const a = f.service.record(input("provider-a")).session;
    f.service.update("provider-a", "다음 대화에 필요한 맥락");
    const child = f.service.record(input("provider-b", { provider: "anthropic", agent: "claude-code" }), "provider-a").session;
    const list = await request("/api/v1/sessions?provider=anthropic").json();
    expect(list.schemaVersion).toBe(1); expect(list.items[0].id).toBe(child.id); expect(list.page.total).toBe(1);
    const detail = await request(`/api/v1/sessions/${child.id}`).json(); expect(detail.parentSession.id).toBe(a.id);
    expect(detail.session.createdAt).toBeString();
    for (const field of ["status", "startedAt", "endedAt"]) {
      expect(detail.session).not.toHaveProperty(field);
      expect(list.items[0]).not.toHaveProperty(field);
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
    }
  });

  test("no mutations or arbitrary static files; detail URL reload serves HTML", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT", "OPTIONS", "HEAD"]) expect(request("/api/v1/sessions", { method }).status).toBe(405);
    for (const path of ["/relay.db", "/config.json", "/src/index.ts", "/..%2frelay.db", "/api/v1/execute"]) expect(request(path).status).toBe(404);
    const html = request("/sessions/ses_example"); expect(html.status).toBe(200);
    expect(await html.text()).toContain('<html lang="ko">');
    expect(f.service.list().page.total).toBe(0);
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
});
