import type { Config } from "../config";
import { errorBody, RelayError } from "../errors";
import { deleteItems, fileResponse, listDirectory, makeFolder, pasteItems, places, renameItem, saveFile, statPath, systemRemover, type Remover } from "../files/files.service";

/*
 * 이 PC의 파일을 원격 서버를 거쳐 브라우저 모드 화면에 보여 준다(서버 쪽은 server/src/pcs). 원격 모드의 `relay web`이 켜져 있는 동안
 * 몇 개의 일꾼이 `GET /api/v1/agent/next`로 맡길 요청을 기다리고, 받은 요청을 로컬 파일 API와 같은 함수로 처리해
 * 응답을 `POST /api/v1/agent/reply/:id`의 본문으로 흘려보낸다. PC가 먼저 바깥으로 연결하므로 공유기·방화벽에 구멍을 낼 필요가 없다.
 * 기본 앱으로 열기·시스템 클립보드는 이 PC 앞의 사람에게만 뜻이 있으므로 받지 않는다. config.json의 remote.shareFiles를 false로 두면 켜지 않는다.
 */

export interface AgentJob { id: string; method: "GET" | "POST"; path: string; query: string; headers: Record<string, string>; body: string | null }
/** PC가 서버에 돌려주는 응답 헤더. 서버도 같은 목록만 브라우저에 넘긴다. */
const REPLY_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "x-file-modified", "cache-control", "content-security-policy"];
const WORKERS = 4;
const WAIT_SECONDS = 25;

const failure = (error: unknown) => {
  const relay = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "PC에서 요청을 처리하지 못했습니다.", 5, 500);
  return Response.json(errorBody(relay), { status: relay.httpStatus });
};
const parsed = (body: string | null) => {
  try { return JSON.parse(body ?? "null") as unknown; } catch { throw new RelayError("INVALID_ARGUMENT", "JSON 본문을 읽을 수 없습니다."); }
};

/** 서버가 건넨 요청 하나를 이 PC의 파일 API로 처리한다. 로컬 서버(src/web/server.ts)의 파일 경로와 같은 검사를 거친다. */
export function executeJob(job: AgentJob, remove: Remover = systemRemover): Response {
  try {
    const url = new URL(`http://pc${job.path}${job.query ? `?${job.query}` : ""}`);
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const onlyPath = () => {
      for (const key of url.searchParams.keys()) if (key !== "path") throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
      if (url.searchParams.getAll("path").length !== 1) throw new RelayError("INVALID_ARGUMENT", "path를 한 번 주세요.");
      return url.searchParams.get("path");
    };
    const route = `${job.method} ${url.pathname}`;
    if (route === "GET /api/v1/files/places") {
      if (url.search) throw new RelayError("INVALID_ARGUMENT", "places는 query를 받지 않습니다.");
      return Response.json(places(), { headers });
    }
    if (route === "GET /api/v1/files") return Response.json(listDirectory(onlyPath()), { headers });
    if (route === "GET /api/v1/files/stat") return Response.json(statPath(onlyPath()), { headers });
    if (route === "GET /api/v1/files/content") return fileResponse(new Request(url, { headers: job.headers.range ? { range: job.headers.range } : {} }), url, headers);
    if (job.method === "POST" && url.search) throw new RelayError("INVALID_ARGUMENT", "파일 정리 요청은 query를 받지 않습니다.");
    if (route === "POST /api/v1/files/save") return Response.json(saveFile(parsed(job.body)), { headers });
    if (route === "POST /api/v1/files/mkdir") return Response.json(makeFolder(parsed(job.body)), { headers });
    if (route === "POST /api/v1/files/rename") return Response.json(renameItem(parsed(job.body)), { headers });
    if (route === "POST /api/v1/files/paste") return Response.json(pasteItems(parsed(job.body)), { headers });
    if (route === "POST /api/v1/files/delete") return Response.json(deleteItems(parsed(job.body), remove), { headers });
    throw new RelayError("NOT_FOUND", "PC에서 받지 않는 요청입니다.", 3, 404);
  } catch (error) { return failure(error); }
}

const validJob = (value: unknown): value is AgentJob => {
  const job = value as Partial<AgentJob> | null;
  return Boolean(job && typeof job.id === "string" && (job.method === "GET" || job.method === "POST") && typeof job.path === "string" && job.path.startsWith("/api/v1/files")
    && typeof job.query === "string" && job.headers && typeof job.headers === "object" && (job.body === null || typeof job.body === "string"));
};

/** 원격 모드의 `relay web`이 켤 때 부른다. 돌려준 stop()으로 일꾼을 멈춘다. */
export function startAgent(config: Config, { workers = WORKERS, send = fetch }: { workers?: number; send?: typeof fetch } = {}) {
  const remote = config.remote;
  if (config.mode !== "remote" || !remote?.deviceId || remote.shareFiles === false) return { stop() {} };
  const auth = { Authorization: `Bearer ${remote.token}`, "X-Relay-Device": remote.deviceId };
  const controllers = new Set<AbortController>();
  let stopped = false;
  const pause = (ms: number) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

  async function reply(job: AgentJob, response: Response, signal: AbortSignal) {
    const passed: Record<string, string> = {};
    response.headers.forEach((value, name) => { if (REPLY_HEADERS.includes(name)) passed[name] = value; });
    await send(`${remote!.url}/api/v1/agent/reply/${encodeURIComponent(job.id)}`, {
      method: "POST", signal, body: response.body ?? "",
      headers: { ...auth, "Content-Type": "application/octet-stream", "X-Relay-Status": String(response.status), "X-Relay-Headers": Buffer.from(JSON.stringify(passed)).toString("base64url") },
    });
  }

  async function worker() {
    let backoff = 1000;
    while (!stopped) {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await send(`${remote!.url}/api/v1/agent/next?wait=${WAIT_SECONDS}`, { headers: auth, signal: AbortSignal.any([controller.signal, AbortSignal.timeout((WAIT_SECONDS + 15) * 1000)]) });
        if (response.status === 204) { backoff = 1000; continue; }
        // 토큰이 막혔거나 PC 중계를 모르는 옛 서버면 오래 쉬었다가 다시 본다.
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
        const data = await response.json() as { job?: unknown };
        if (!validJob(data.job)) throw new Error("잘못된 요청");
        backoff = 1000;
        await reply(data.job, executeJob(data.job), controller.signal);
      } catch {
        if (stopped) break;
        await pause(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      } finally { controllers.delete(controller); }
    }
  }

  for (let index = 0; index < workers; index += 1) void worker();
  return { stop() { stopped = true; for (const controller of controllers) controller.abort(); } };
}
