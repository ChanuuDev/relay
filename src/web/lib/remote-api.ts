import { paths, REMOTE_PREFIX, remotePath } from "../../remote/paths";

/* 브라우저 모드(원격 Relay를 브라우저로 직접 여는 화면)의 API 변환. 화면은 로컬 relay.exe가 내려줄 때와 같은 같은 출처 `/api/v1/*`를 부르고,
   이 모듈이 그 요청을 로그인한 원격 서버로 보낸다. relay.exe 원격 모드의 중계(src/remote/web.ts)와 같은 규칙을 따른다:
   파일 경로는 화면에서 `remote:/…`로 보이고 서버에는 `/…`로 가며, Windows 연동은 막는다. 페이지와 서비스 워커가 함께 쓰므로 DOM에 기대지 않는다. */

/** 로그인한 원격 Relay. url은 출처(`https://host`)만 담는다. pc는 파일을 볼 PC(기기 id)로, 없으면 지금 연결된 PC 중 가장 최근 것을 쓴다. */
export interface Credentials { url: string; token: string; user?: string; tokenName?: string; pc?: string }

export interface ForwardOptions {
  /** 실제로 보내는 fetch. 페이지는 감싸기 전 원래 fetch, 서비스 워커는 자기 fetch를 준다. */
  send: (url: string, init: RequestInit) => Promise<Response>;
  /** 화면 빌드. health가 이 값을 build로 돌려, 화면이 원격 서버 빌드와 비교해 되풀이해 새로 고치지 않는다. */
  build: string;
  /** 토큰이 거절됐을 때(401). 화면은 로그인으로 돌아간다. */
  onUnauthorized?: () => void;
  signal?: AbortSignal | null;
  keepalive?: boolean;
  cache?: RequestCache;
}

/** 파일 내용(HTML·SVG 같은 활성 콘텐츠 포함)을 문서로 열어도 이 화면의 출처에서 아무것도 실행하지 않게 한다. 로컬 중계와 같은 격리다. */
export const FILE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
export const IMAGE_CSP = "default-src 'none'; sandbox";
const REQUEST_HEADERS = ["content-type", "range", "if-none-match"];
const RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "x-file-modified", "retry-after", "cache-control"];
/** 본문 없이 보내야 하는 상태 코드 */
const NULL_BODY = new Set([101, 204, 205, 304]);

export const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ schemaVersion: 1, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

/** 같은 출처의 API 요청인지. 그 밖의 요청(화면 자산, 다른 사이트)은 그대로 보낸다. */
export const isApi = (url: URL, origin: string) => url.origin === origin && url.pathname.startsWith("/api/");

/** 브라우저 모드의 health. 로컬 서버 health와 같은 모양으로, 원격 서버에 닿는지와 지연을 담는다. 토큰은 확인하지 않는다(다른 요청의 401이 알린다). */
async function health(credentials: Credentials, options: ForwardOptions): Promise<Response> {
  const started = Date.now();
  let appVersion = "";
  let remote: Record<string, unknown> = { url: credentials.url, reachable: false, outbox: { pending: 0, failed: 0 } };
  try {
    const response = await options.send(`${credentials.url}/api/v1/health`, { cache: "no-store", credentials: "omit", ...(options.signal ? { signal: options.signal } : {}) });
    const data = response.ok ? await response.json() as { kind?: string; appVersion?: string; apiVersion?: number } : null;
    if (data?.kind === "relay-remote") {
      appVersion = data.appVersion ?? "";
      remote = { ...remote, reachable: true, latencyMs: Date.now() - started, apiVersion: data.apiVersion };
    }
  } catch { /* 닿지 못하면 연결 끊김으로 보인다. */ }
  return Response.json({ schemaVersion: 1, status: "ok", mode: "browser", appVersion, build: options.build, dataDirectory: "", databasePath: "", remote },
    { headers: { "Cache-Control": "no-store" } });
}

/** 연결된 PC. 원격 서버의 `/api/v1/pcs`가 그 사용자의 기기와 지금 연결돼 있는지 알려 준다(server/src/pcs). */
export interface PcInfo { id: string; name: string; platform: string | null; lastSeenAt: string | null; online: boolean }
/** 파일을 볼 PC를 잠깐 기억한다. 페이지와 서비스 워커가 각자 기억한다. 못 찾았을 때는 PC가 곧 붙을 수 있으므로 짧게만 기억한다. */
const pcCache = new Map<string, { at: number; pc: PcInfo | null }>();
const PC_CACHE_MS = 15_000;
const PC_MISS_MS = 2_000;

function authorized(credentials: Credentials, headers?: Headers) {
  const outgoing = new Headers();
  for (const name of REQUEST_HEADERS) { const value = headers?.get(name); if (value) outgoing.set(name, value); }
  outgoing.set("Authorization", `Bearer ${credentials.token}`);
  return outgoing;
}

/** 이 사용자의 기기 목록. 연결된 것을 먼저, 최근에 본 것을 앞에 둔다. */
export async function listPcs(credentials: Credentials, send: ForwardOptions["send"], signal?: AbortSignal | null): Promise<PcInfo[]> {
  const response = await send(`${credentials.url}/api/v1/pcs`, { headers: authorized(credentials), credentials: "omit", cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) return [];
  const data = await response.json() as { items?: PcInfo[] };
  return (data.items ?? []).slice().sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
}

/** 파일을 볼 PC: 로그인 정보에 고른 PC가 있으면 그것, 없으면 지금 연결된 PC 중 가장 최근 것. */
async function choosePc(credentials: Credentials, options: ForwardOptions): Promise<PcInfo | null> {
  const key = `${credentials.url}\n${credentials.token}\n${credentials.pc ?? ""}`;
  const cached = pcCache.get(key);
  if (cached && Date.now() - cached.at < (cached.pc ? PC_CACHE_MS : PC_MISS_MS)) return cached.pc;
  const items = await listPcs(credentials, options.send, options.signal);
  const found = (credentials.pc ? items.find((item) => item.id === credentials.pc) : items.find((item) => item.online)) ?? null;
  // 꺼진 PC는 짧게만 기억해, 켜지면 곧 보이게 한다. 고른 PC가 꺼져 있으면 그 PC로 보내 서버가 꺼져 있다고 알리게 한다.
  pcCache.set(key, { at: Date.now(), pc: found?.online ? found : null });
  return found;
}

/** 파일 요청이 어느 쪽 것인지: `remote:/`는 원격 서버, 그 밖의 경로는 연결된 PC. 둘이 섞이면 mixed. */
function sourceOf(query: string | null, body: unknown): "remote" | "pc" | "mixed" {
  const found = new Set<"remote" | "pc">();
  const look = (value: unknown) => { if (typeof value === "string" && value) found.add(remotePath(value) ? "remote" : "pc"); };
  look(query);
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    for (const key of ["path", "parent", "destination"]) look(value[key]);
    for (const key of ["paths", "sources"]) if (Array.isArray(value[key])) (value[key] as unknown[]).forEach(look);
  }
  return found.size > 1 ? "mixed" : found.has("pc") ? "pc" : "remote";
}

/** 서버로 보내고 응답을 화면에 맞게 다듬는다. encode면 JSON 속 원격 경로를 `remote:/`로 바꾼다. */
function relay(credentials: Credentials, route: string, search: URLSearchParams, verb: string, headers: Headers, payload: BodyInit | null | undefined,
  options: ForwardOptions, shape: { encode: boolean; csp?: string }): Promise<Response> {
  const query = search.toString();
  const sent = options.send(`${credentials.url}${route}${query ? `?${query}` : ""}`, {
    method: verb, headers: authorized(credentials, headers), credentials: "omit", redirect: "follow",
    ...(verb === "GET" || verb === "HEAD" ? {} : { body: payload ?? null }),
    ...(options.signal ? { signal: options.signal } : {}), ...(options.keepalive ? { keepalive: true } : {}), ...(options.cache ? { cache: options.cache } : {}),
  });
  return sent.then(async (response) => {
    if (response.status === 401) options.onUnauthorized?.();
    const passed = new Headers({ "Cache-Control": "no-store" });
    for (const name of RESPONSE_HEADERS) { const value = response.headers.get(name); if (value) passed.set(name, value); }
    if (shape.encode && response.headers.get("content-type")?.includes("application/json")) {
      passed.delete("content-length");
      return new Response(JSON.stringify(paths(await response.json(), true)), { status: response.status, statusText: response.statusText, headers: passed });
    }
    if (shape.csp) passed.set("Content-Security-Policy", shape.csp);
    return new Response(NULL_BODY.has(response.status) ? null : response.body, { status: response.status, statusText: response.statusText, headers: passed });
  });
}

/** 파일 탐색기 첫 화면: 연결된 PC의 드라이브·즐겨찾기에 원격 서버 드라이브를 더한다. PC가 없으면 원격 서버만 보인다. */
async function places(credentials: Credentials, options: ForwardOptions): Promise<Response> {
  const read = async (url: string) => {
    try {
      const response = await options.send(url, { headers: authorized(credentials), credentials: "omit", cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
      if (response.status === 401) options.onUnauthorized?.();
      return response.ok ? await response.json() as Record<string, unknown> & { drives?: Record<string, unknown>[] } : null;
    } catch { return null; }
  };
  const pc = await choosePc(credentials, options).catch(() => null);
  const [server, local] = await Promise.all([read(`${credentials.url}/api/v1/files/places`), pc?.online ? read(`${credentials.url}/api/v1/pcs/${encodeURIComponent(pc.id)}/files/places`) : null]);
  const headers = { "Cache-Control": "no-store" };
  const remoteDrive = server ? { path: `${REMOTE_PREFIX}/`, label: "원격 서버", type: "network", total: server.drives?.[0]?.total ?? null, free: server.drives?.[0]?.free ?? null } : null;
  if (local) return Response.json({ ...local, drives: [...(local.drives ?? []), ...(remoteDrive ? [remoteDrive] : [])], pc: { id: pc!.id, name: pc!.name } }, { headers });
  if (server) return Response.json(paths(server, true), { headers });
  return errorResponse(503, "FILES_UNAVAILABLE", pc ? "PC가 연결돼 있지 않고 원격 서버 파일도 꺼져 있습니다." : "볼 수 있는 파일이 없습니다. PC에서 Relay를 원격 모드로 켜 두세요.");
}

/** 파일 API: 원격 서버 경로는 서버 파일 API로, PC 경로는 그 PC로 중계한다(server/src/pcs, src/remote/agent.ts). */
async function files(credentials: Credentials, target: URL, verb: string, headers: Headers, body: BodyInit | null | undefined, options: ForwardOptions): Promise<Response> {
  const pathname = target.pathname;
  if (pathname === "/api/v1/files/places" && verb === "GET") return places(credentials, options);
  const search = new URLSearchParams(target.search);
  let parsed: unknown = null;
  if (verb === "POST" && typeof body === "string") { try { parsed = JSON.parse(body); } catch { /* 서버가 JSON 오류를 알린다. */ } }
  const source = sourceOf(search.get("path"), parsed);
  const csp = pathname.endsWith("/content") ? FILE_CSP : undefined;
  if (source === "mixed") return errorResponse(403, "FORBIDDEN", "PC와 원격 서버 사이에서는 바로 복사·이동할 수 없습니다. 내려받은 뒤 원격 서버에 올려 주세요.");
  if (source === "remote") {
    const path = search.get("path");
    if (path !== null && remotePath(path)) search.set("path", path.slice(REMOTE_PREFIX.length));
    const payload = parsed === null ? body : JSON.stringify(paths(parsed, false));
    return relay(credentials, pathname, search, verb, headers, payload, options, { encode: true, ...(csp ? { csp } : {}) });
  }
  const pc = await choosePc(credentials, options);
  if (!pc) return errorResponse(503, "PC_OFFLINE", "연결된 PC가 없습니다. 파일을 볼 PC에서 Relay를 원격 모드로 켜 두세요.");
  return relay(credentials, `/api/v1/pcs/${encodeURIComponent(pc.id)}${pathname.slice("/api/v1".length)}`, search, verb, headers, body, options, { encode: false, ...(csp ? { csp } : {}) });
}

/**
 * 화면의 API 요청 하나를 원격 서버로 보낸다. `body`는 POST면 JSON 문자열, PUT(파일 올리기)이면 Blob 같은 바이트다.
 * 파일 API가 아니면 첫 await 전에 보내므로, 페이지를 닫을 때 keepalive로 보내는 메모 저장도 끊기지 않는다.
 */
export function forward(credentials: Credentials, target: URL, method: string, headers: Headers, body: BodyInit | null | undefined, options: ForwardOptions): Promise<Response> {
  const verb = method.toUpperCase();
  const pathname = target.pathname;
  if (pathname === "/api/v1/health" && verb === "GET") return health(credentials, options);
  if (pathname === "/api/v1/files/open" || pathname === "/api/v1/files/clipboard" || pathname === "/api/v1/files/transfer") {
    return Promise.resolve(errorResponse(403, "FORBIDDEN", "브라우저에서는 기본 앱으로 열기·시스템 클립보드·PC와 서버 사이 옮기기를 쓸 수 없습니다."));
  }
  if (pathname === "/api/v1/files" || pathname.startsWith("/api/v1/files/")) return files(credentials, target, verb, headers, body, options);
  // 원격 서버에 파일 올리기: 화면이 `remote:`를 뗀 경로로 이 주소를 부른다.
  const explicit = pathname === "/api/v1/remote/files" || pathname.startsWith("/api/v1/remote/files/");
  const route = explicit ? pathname.replace("/api/v1/remote/files", "/api/v1/files") : pathname;
  const image = pathname.startsWith("/api/v1/notes/images/");
  return relay(credentials, route, new URLSearchParams(target.search), verb, headers, body, options,
    { encode: false, ...(explicit && pathname.endsWith("/content") ? { csp: FILE_CSP } : image ? { csp: IMAGE_CSP } : {}) });
}

/** 로그인 칸에 넣은 주소를 출처로 맞춘다. 스킴이 없으면 https로 보고, http는 이 컴퓨터(localhost·127.0.0.1)만 허용한다. */
export function normalizeRelayUrl(input: string): string {
  const text = input.trim();
  if (!text) throw new Error("Relay 주소를 입력하세요.");
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { throw new Error("Relay 주소 형식이 올바르지 않습니다."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Relay 주소는 https://로 시작해야 합니다.");
  if (url.username || url.password) throw new Error("주소에 사용자 정보를 넣지 마세요.");
  return url.origin;
}

/** 원격 서버 토큰 형식(Bearer). 서버의 인증 가드와 같은 규칙이다. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
