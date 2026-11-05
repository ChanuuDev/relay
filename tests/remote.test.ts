import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { testRemoteConnection } from "@relay/core";
import { RemoteClient } from "../src/remote/client";
import { RemoteSessions } from "../src/remote/sessions";
import { migrate } from "../src/remote/migrate";
import { remoteHandler } from "../src/remote/web";
import { fixture, input, cliAsync, root } from "./helpers";
import { errorBody, RelayError } from "../src/errors";

let f: ReturnType<typeof fixture>;
let server: ReturnType<typeof Bun.serve>;
let unavailable = false, reject = false, slow = false, clockSkew = 0;
let received: { route: string; body: any; key: string | null }[];
let responses: Map<string, unknown>;
beforeEach(() => {
  f = fixture(); clockSkew = 0; unavailable = false; reject = false; slow = false; received = []; responses = new Map();
  process.env.RELAY_ALLOW_HTTP = "1";
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (slow) await Bun.sleep(2300);
    if (unavailable) return Response.json({ error: { code: "STORAGE_ERROR", message: "offline" } }, { status: 503 });
    if (new URL(request.url).pathname !== "/api/v1/health" && request.headers.get("Authorization") !== "Bearer test-token") return Response.json({}, { status: 401 });
    const url = new URL(request.url), route = url.pathname;
    const body = request.method === "POST" ? await request.json() as any : undefined;
    const key = request.headers.get("Idempotency-Key");
    if (key && responses.has(key)) return Response.json(responses.get(key));
    received.push({ route, body, key });
    try {
      if (reject) throw new RelayError("INVALID_ARGUMENT", "bad request");
      let result: unknown;
      if (route === "/api/v1/health") result = { schemaVersion: 1, status: "ok", kind: "relay-remote", apiVersion: 1, appVersion: "test", build: "test", time: new Date(Date.now() + clockSkew).toISOString(), files: true };
      else if (route === "/api/v1/auth/whoami") result = { user: { name: "tester" }, token: { name: "test-token" } };
      else if (route === "/api/v1/devices/register") result = { device: { id: "dev-test", name: "test-device" }, created: true };
      else if (route === "/api/v1/sessions") result = request.method === "POST" ? f.service.record(body) : f.service.list(Object.fromEntries(url.searchParams));
      else if (route === "/api/v1/sessions/continue") result = f.service.record(body, body.parent.providerSessionId, body.parent.provider);
      else if (route === "/api/v1/sessions/update") result = f.service.update(body.providerSessionId, body.summary, body.provider, body);
      else if (route === "/api/v1/sessions/lookup") result = body.chain ? body.history ? f.service.packet(body.providerSessionId, body.provider, body) : f.service.chain(body.providerSessionId, body.provider) : f.service.show(body.providerSessionId, body.provider, body.history, body);
      else if (route === "/api/v1/sessions/models") result = f.service.models(body.providerSessionId, body.provider, body.models);
      else if (route === "/api/v1/files") result = { schemaVersion: 1, path: url.searchParams.get("path"), name: "root", parent: null, crumbs: [{ name: "서버", path: "/" }], entries: [{ name: "a.txt", path: "/a.txt", kind: "file", size: 6 }], truncated: false };
      else if (route === "/api/v1/files/stat") result = { kind: "file", size: 6, link: false };
      else if (route === "/api/v1/files/content") return new Response("abc", { status: request.headers.has("Range") ? 206 : 200, headers: { "Content-Type": "text/plain", "Content-Range": "bytes 0-2/6" } });
      else if (route === "/api/v1/import") result = { schemaVersion: 1 };
      else result = { schemaVersion: 1, ok: true };
      if (key) responses.set(key, result);
      return Response.json(result);
    } catch (error) { const failure = error as RelayError; return Response.json(errorBody(failure), { status: failure.httpStatus }); }
  } });
});
afterEach(async () => { await server.stop(true); f.close(); delete process.env.RELAY_ALLOW_HTTP; });
function config() { return { ...f.config, mode: "remote" as const, remote: { url: `http://127.0.0.1:${server.port}`, token: "test-token", deviceId: "dev-test" } }; }
function saveConfig() { writeFileSync(path.join(f.dir, "config.json"), JSON.stringify({ schemaVersion: 2, mode: "remote", remote: config().remote, desktop: { autoLaunch: true } })); }

test("v1/v2 설정 호환과 HTTPS·자격 증명 주소 검사", () => {
  saveConfig(); expect(loadConfig(f.dir).remote?.token).toBe("test-token");
  delete process.env.RELAY_ALLOW_HTTP;
  expect(() => loadConfig(f.dir)).toThrow("HTTPS");
  for (const url of ["https://user:password@example.com", "https://example.com?token=x"]) {
    writeFileSync(path.join(f.dir, "config.json"), JSON.stringify({ schemaVersion: 2, mode: "remote", remote: { url, token: "test" } }));
    expect(() => loadConfig(f.dir)).toThrow();
  }
});
test("HTTP 세션 명령이 부모 연결·이력·오류를 보존한다", async () => {
  const service = new RemoteSessions(new RemoteClient(config()));
  await service.record(input("parent"));
  await service.record(input("child"), "parent", "openai");
  await service.update("child", "새 요약", "openai", { status: "working" });
  expect((await service.show("child", "openai", true)).session.summary).toBe("새 요약");
  expect((await service.packet("child")).chain.length).toBe(2);
  expect((await service.chain("child")).items.length).toBe(2);
  expect((await service.list()).page.total).toBe(2);
  await expect(service.show("missing")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND", exitCode: 3 });
  expect(received.filter(row => row.route === "/api/v1/sessions")[0].body.cwd).toBe(root.replaceAll("\\", "/"));
});
test("오프라인 쓰기는 보존하고 같은 키 재시도는 한 번만 반영한다", async () => {
  unavailable = true;
  const queued = await new RemoteSessions(new RemoteClient(config(), 100)).record(input("queued"));
  expect(queued).toMatchObject({ queued: true });
  const client = new RemoteClient(config());
  const name = client.list().pending[0];
  const raw = readFileSync(path.join(f.dir, "outbox", name), "utf8");
  expect(raw).not.toContain("test-token");
  unavailable = false;
  const payload = JSON.parse(raw);
  await client.json(payload.route, payload.body, payload.key); // 서버 응답 뒤 소비자가 죽은 경우
  expect((await client.flush()).sent).toBe(1);
  expect(f.service.show("queued", "openai", true).updates!.length).toBe(1);
  expect(client.list().pending).toHaveLength(0);
});
test("영구 오류는 failed로, 다른 목적지 요청은 원래 대기열에 남는다", async () => {
  reject = true;
  const client = new RemoteClient(config());
  await expect(client.write("/api/v1/sessions", input("bad"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(client.list().failed).toHaveLength(1);
  reject = false;
  client.enqueue("/api/v1/sessions", input("old"));
  const other = new RemoteClient({ ...config(), remote: { ...config().remote, token: "other" } });
  expect((await other.flush()).sent).toBe(0);
  expect(other.list().pending).toHaveLength(1);
});
test("실제 CLI와 훅은 원격 HTTP를 사용하고 지연 훅은 2초 안에 대기열에 넣는다", async () => {
  saveConfig();
  const result = await cliAsync(f.dir, ["record", "--provider", "openai", "--agent", "codex", "--session-id", "cli", "--summary", "CLI"]);
  expect(result.code).toBe(0); expect(result.data.session.providerSessionId).toBe("cli");
  slow = true;
  const started = Date.now();
  const child = Bun.spawn([process.execPath, path.join(root, "src/index.ts"), "hook", "codex", "--data-dir", f.dir], { env: process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify({ session_id: "hook", cwd: root })); child.stdin.end();
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(JSON.parse(out).hookSpecificOutput).toBeDefined();
  expect(Date.now() - started).toBeLessThan(2200);
  expect(new RemoteClient(config()).list().pending.length).toBeGreaterThan(0);
});
test("웹은 출처 검사를 유지하며 원격 파일 경로·Range·로컬 health를 보존한다", async () => {
  const handler = remoteHandler(config(), () => Response.json({ local: true }));
  const request = (route: string, init: RequestInit = {}) => handler(new Request("http://127.0.0.1:7474" + route, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  expect((await request("/api/v1/sessions", { method: "POST", headers: { origin: "https://evil.test", "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
  const listing = await (await request("/api/v1/files?path=remote%3A%2F")).json();
  expect(listing.entries[0].path).toBe("remote:/a.txt"); expect(listing.crumbs[0].path).toBe("remote:/");
  const response = await request("/api/v1/files/content?path=remote%3A%2Fa.txt", { headers: { Range: "bytes=0-2" } });
  expect(response.status).toBe(206); expect(response.headers.get("Content-Range")).toBe("bytes 0-2/6");
  expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  const health = await (await request("/api/v1/health")).text();
  expect(health).toContain('"mode":"remote"'); expect(health).not.toContain("test-token");
});
test("출처 간 붙여넣기는 로컬에 스트리밍하고 성공 뒤에만 이동 원본을 지운다", async () => {
  const handler = remoteHandler(config(), () => new Response(null, { status: 404 }));
  const response = await handler(new Request("http://127.0.0.1:7474/api/v1/files/paste", { method: "POST", headers: { host: "127.0.0.1:7474", origin: "http://127.0.0.1:7474", "Content-Type": "application/json" }, body: JSON.stringify({ sources: ["remote:/a.txt"], destination: f.dir, mode: "copy" }) }));
  const result = await response.json(); expect(result.done).toHaveLength(1);
  expect(readFileSync(path.join(f.dir, "a.txt"), "utf8")).toBe("abc");
  expect(received.some(row => row.route === "/api/v1/files/delete")).toBe(false);
});
test("이전 미리 보기는 쓰지 않고 실행은 원본 DB와 이력을 보존한다", async () => {
  f.service.record(input("migrate"));
  const preview = await migrate(config(), true);
  expect(preview.counts.sessions).toBe(1); expect(received).toHaveLength(0);
  await migrate(config(), false);
  expect(received.filter(row => row.route === "/api/v1/import")).toHaveLength(3);
  expect(existsSync(f.config.databasePath)).toBe(true);
  expect(f.service.show("migrate", "openai", true).updates).toHaveLength(1);
});

test("PC 시각 차이는 연결을 차단하지 않고 경고한다", async () => {
  clockSkew = 10 * 60_000;
  const result = await testRemoteConnection({ url: config().remote.url, token: "test-token", deviceName: "test-device" }, { allowHttp: true, platform: "win32" });
  expect(result.ok).toBe(true);
  expect(result.steps.find(step => step.id === "clock")?.state).toBe("warn");
});
