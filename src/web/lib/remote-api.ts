import { paths, REMOTE_PREFIX, remotePath } from "../../remote/paths";

/* 브라우저 모드(원격 Relay를 브라우저로 직접 여는 화면)의 API 변환. 화면은 로컬 relay.exe가 내려줄 때와 같은 같은 출처 `/api/v1/*`를 부르고,
   이 모듈이 그 요청을 로그인한 원격 서버로 보낸다. relay.exe 원격 모드의 중계(src/remote/web.ts)와 같은 규칙을 따른다:
   파일 경로는 화면에서 `remote:/…`로 보이고 서버에는 `/…`로 가며, Windows 연동은 막는다. 페이지와 서비스 워커가 함께 쓰므로 DOM에 기대지 않는다. */

/** 로그인한 원격 Relay. url은 출처(`https://host`)만 담는다. */
export interface Credentials { url: string; token: string; user?: string; tokenName?: string }

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
  const explicit = pathname === "/api/v1/remote/files" || pathname.startsWith("/api/v1/remote/files/");
  const files = !explicit && (pathname === "/api/v1/files" || pathname.startsWith("/api/v1/files/"));
  const route = explicit ? pathname.replace("/api/v1/remote/files", "/api/v1/files") : pathname;
  const search = new URLSearchParams(target.search);
  let payload = body;
  if (files) {
    const path = search.get("path");
    if (path !== null && remotePath(path)) search.set("path", path.slice(REMOTE_PREFIX.length));
    if (verb === "POST" && typeof body === "string") {
      try { payload = JSON.stringify(paths(JSON.parse(body), false)); } catch { /* 서버가 JSON 오류를 알린다. */ }
    }
  }
  const outgoing = new Headers();
  for (const name of REQUEST_HEADERS) { const value = headers.get(name); if (value) outgoing.set(name, value); }
  outgoing.set("Authorization", `Bearer ${credentials.token}`);
  const query = search.toString();
  const sent = options.send(`${credentials.url}${route}${query ? `?${query}` : ""}`, {
    method: verb, headers: outgoing, credentials: "omit", redirect: "follow",
    ...(verb === "GET" || verb === "HEAD" ? {} : { body: payload ?? null }),
    ...(options.signal ? { signal: options.signal } : {}), ...(options.keepalive ? { keepalive: true } : {}), ...(options.cache ? { cache: options.cache } : {}),
  });
  return sent.then(async (response) => {
    if (response.status === 401) options.onUnauthorized?.();
    const passed = new Headers({ "Cache-Control": "no-store" });
    for (const name of RESPONSE_HEADERS) { const value = response.headers.get(name); if (value) passed.set(name, value); }
    if (files && response.headers.get("content-type")?.includes("application/json")) {
      passed.delete("content-length");
      return new Response(JSON.stringify(paths(await response.json(), true)), { status: response.status, statusText: response.statusText, headers: passed });
    }
    if ((files || explicit) && pathname.endsWith("/content")) passed.set("Content-Security-Policy", FILE_CSP);
    if (pathname.startsWith("/api/v1/notes/images/")) passed.set("Content-Security-Policy", IMAGE_CSP);
    return new Response(NULL_BODY.has(response.status) ? null : response.body, { status: response.status, statusText: response.statusText, headers: passed });
  });
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
