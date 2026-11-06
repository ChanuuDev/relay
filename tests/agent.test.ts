import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeJob, startAgent, type AgentJob } from "../src/remote/agent";
import type { Config } from "../src/config";

let dir = "";
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "relay-agent-")); writeFileSync(path.join(dir, "a.txt"), "0123456789"); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const job = (method: AgentJob["method"], route: string, query: Record<string, string> = {}, extra: Partial<AgentJob> = {}): AgentJob =>
  ({ id: crypto.randomUUID(), method, path: route, query: new URLSearchParams(query).toString(), headers: {}, body: null, ...extra });

test("PC 중계 요청을 로컬 파일 API와 같은 함수로 처리한다: 목록·정보·범위 읽기·새 폴더", async () => {
  const listing = await executeJob(job("GET", "/api/v1/files", { path: dir })).json() as { path: string; entries: { name: string }[] };
  expect(listing.path).toBe(dir);
  expect(listing.entries.map((entry) => entry.name)).toContain("a.txt");
  expect((await executeJob(job("GET", "/api/v1/files/stat", { path: path.join(dir, "a.txt") })).json() as { size: number }).size).toBe(10);
  const part = executeJob(job("GET", "/api/v1/files/content", { path: path.join(dir, "a.txt") }, { headers: { range: "bytes=2-4" } }));
  expect(part.status).toBe(206);
  expect(await part.text()).toBe("234");
  expect(part.headers.get("content-security-policy")).toContain("sandbox");
  const made = executeJob(job("POST", "/api/v1/files/mkdir", {}, { body: JSON.stringify({ parent: dir }) }));
  expect(made.status).toBe(200);
  expect((await executeJob(job("GET", "/api/v1/files/places")).json() as { drives: unknown[] }).drives.length).toBeGreaterThan(0);
});

test("열기·클립보드처럼 PC 앞에서만 뜻 있는 요청과 잘못된 입력은 오류 JSON으로 답한다", async () => {
  for (const route of ["/api/v1/files/open", "/api/v1/files/clipboard", "/api/v1/notes"]) {
    const response = executeJob(job("POST", route, {}, { body: JSON.stringify({ path: dir, action: "open" }) }));
    expect(response.status).toBe(404);
  }
  expect(executeJob(job("GET", "/api/v1/files", { path: dir, extra: "1" })).status).toBe(400);
  expect(executeJob(job("POST", "/api/v1/files/rename", {}, { body: "{" })).status).toBe(400);
  const deleted: string[][] = [];
  const removed = executeJob(job("POST", "/api/v1/files/delete", {}, { body: JSON.stringify({ paths: [path.join(dir, "a.txt")] }) }), (targets) => { deleted.push(targets); return { recycled: true, failed: [] }; });
  expect(removed.status).toBe(200);
  expect(deleted).toEqual([[path.join(dir, "a.txt")]]);
  expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("0123456789");
});

test("일꾼은 원격 모드·등록 기기·공유 켜짐일 때만 서버에 붙고, 받은 요청의 응답을 상태·헤더와 함께 흘려보낸다", async () => {
  const base = { dataDirectory: dir, databasePath: path.join(dir, "relay.db"), webHost: "127.0.0.1" as const, webPort: 7474, retentionDays: 30 };
  const calls: string[] = [];
  const idle: typeof fetch = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(null, { status: 204 }); }) as typeof fetch;
  startAgent({ ...base } as Config, { send: idle }).stop();
  startAgent({ ...base, mode: "remote", remote: { url: "https://relay.example.com", token: "t".repeat(32) } } as Config, { send: idle }).stop();
  startAgent({ ...base, mode: "remote", remote: { url: "https://relay.example.com", token: "t".repeat(32), deviceId: "dev_1", shareFiles: false } } as Config, { send: idle }).stop();
  expect(calls).toEqual([]);

  const replies: { url: string; status: string | null; headers: Record<string, string>; body: string; device: string | null }[] = [];
  let handed = false;
  const send: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/agent/next")) {
      if (handed) { await new Promise((resolve) => setTimeout(resolve, 20)); return new Response(null, { status: 204 }); }
      handed = true;
      return Response.json({ schemaVersion: 1, job: job("GET", "/api/v1/files/content", { path: path.join(dir, "a.txt") }, { headers: { range: "bytes=0-3" } }) });
    }
    const headers = new Headers(init?.headers);
    replies.push({ url, status: headers.get("x-relay-status"), device: headers.get("x-relay-device"),
      headers: JSON.parse(Buffer.from(headers.get("x-relay-headers") ?? "", "base64url").toString("utf8")), body: await new Response(init?.body).text() });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const agent = startAgent({ ...base, mode: "remote", remote: { url: "https://relay.example.com", token: "t".repeat(32), deviceId: "dev_1" } } as Config, { send, workers: 1 });
  try {
    for (let index = 0; index < 100 && !replies.length; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  } finally { agent.stop(); }
  expect(replies).toHaveLength(1);
  expect(replies[0]!.url).toMatch(/^https:\/\/relay\.example\.com\/api\/v1\/agent\/reply\/[0-9a-f-]{36}$/);
  expect(replies[0]!.status).toBe("206");
  expect(replies[0]!.device).toBe("dev_1");
  expect(replies[0]!.headers["content-range"]).toBe("bytes 0-3/10");
  expect(replies[0]!.body).toBe("0123");
});
