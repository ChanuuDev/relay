import type { WhoAmI } from "@relay/core";
import { clearCredentials } from "./credentials";
import { errorResponse, forward, isApi, normalizeRelayUrl, TOKEN_PATTERN, type Credentials } from "./remote-api";

/* 브라우저 모드: 원격 서버가 내려준 정적 화면(`relay-web` 메타가 있는 index.html)을 일반 브라우저로 연 경우다.
   로컬 relay.exe 없이 로그인한 원격 Relay에 직접 붙는다. 화면 코드는 그대로 같은 출처 `/api/v1/*`를 부르고,
   여기서 fetch를 감싸 원격 서버로 보내며 토큰을 붙인다. 그림·영상·내려받기처럼 fetch를 거치지 않는 요청은 서비스 워커(sw-web.js)가 같은 규칙으로 보낸다. */

export const browserMode = typeof document !== "undefined" && document.querySelector('meta[name="relay-web"]') !== null;
/** 토큰이 거절됐을 때 화면에 알리는 이벤트. 로그인 화면으로 돌아간다. */
export const UNAUTHORIZED_EVENT = "relay-web-unauthorized";
export const BROWSER_SW = "/sw-web.js";

const pageBuild = () => (typeof document === "undefined" ? "" : document.querySelector<HTMLMetaElement>('meta[name="relay-build"]')?.content ?? "");
let current: Credentials | null = null;
const original: typeof fetch = typeof window === "undefined" ? fetch : window.fetch.bind(window);
let installed = false;

export const currentCredentials = () => current;
const unauthorized = () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));

/** 서비스 워커에 지금 로그인 정보를 알린다(로그아웃이면 지운다). 워커는 정보를 기억에만 둔다. */
function tellWorker() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return;
  worker.postMessage(current ? { type: "relay-web-credentials", credentials: { url: current.url, token: current.token }, build: pageBuild() } : { type: "relay-web-logout" });
}

/** 감싼 fetch. 같은 출처 `/api/`만 원격으로 보내고 나머지는 그대로 둔다. */
function remoteFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const target = new URL(request ? request.url : input instanceof URL ? input.href : String(input), location.href);
  // 이미 토큰을 붙인 요청(원격 출처가 같은 경우의 재진입)과 API 밖의 요청은 그대로 보낸다.
  const headers = new Headers(init?.headers ?? request?.headers);
  if (!isApi(target, location.origin) || headers.has("authorization")) return original(input, init);
  // 로그인 전에는 서버에 묻지 않고 바로 답한다. 화면 모듈(메모·계산기)은 불러올 때 첫 목록을 요청하고 실패하면 몇 초 뒤 다시 시도한다.
  if (!current) return Promise.resolve(errorResponse(401, "UNAUTHORIZED", "로그인이 필요합니다."));
  const method = init?.method ?? request?.method ?? "GET";
  const options = { send: original, build: pageBuild(), onUnauthorized: unauthorized, signal: init?.signal ?? request?.signal ?? null,
    keepalive: init?.keepalive ?? false, ...(init?.cache ? { cache: init.cache } : {}) };
  const credentials = current;
  if (request && init?.body === undefined && !["GET", "HEAD"].includes(method.toUpperCase())) {
    return request.clone().blob().then(async (blob) => forward(credentials, target, method, headers, headers.get("content-type")?.includes("json") ? await blob.text() : blob, options));
  }
  return forward(credentials, target, method, headers, init?.body, options);
}

/** fetch를 감싸고 서비스 워커와 이야기할 준비를 한다. 브라우저 모드면 이 모듈을 불러올 때 바로 한다(client.tsx가 가장 먼저 불러온다). */
function install() {
  if (!installed && typeof window !== "undefined") {
    installed = true;
    window.fetch = remoteFetch as typeof fetch;
    const container = navigator.serviceWorker;
    container?.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "relay-web-credentials-request") event.ports[0]?.postMessage(current ? { url: current.url, token: current.token } : null);
      if (data?.type === "relay-web-unauthorized") unauthorized();
    });
    container?.addEventListener("controllerchange", tellWorker);
    // 강력 새로 고침(Shift+F5)으로 연 화면은 서비스 워커가 맡지 않으므로, 워커에게 이 화면을 맡아 달라고 한다. 그림·영상에 토큰을 붙이려면 필요하다.
    void container?.ready.then((registration) => { if (!container.controller) registration.active?.postMessage({ type: "relay-web-claim" }); }).catch(() => {});
  }
}
if (browserMode) install();

/** 로그인 정보를 쓰기 시작한다(null이면 그만 쓴다). 서비스 워커에도 알린다. */
export function activateCredentials(credentials: Credentials | null) {
  current = credentials;
  install();
  tellWorker();
}

const NOTICE_KEY = "relay-web-notice";

/** 로그아웃(또는 토큰 만료). 암호문과 키를 지우고, 화면 상태(메모·계산기 캐시 등)가 다음 로그인에 섞이지 않게 새로 연다. */
export async function signOut(notice: string) {
  activateCredentials(null);
  await clearCredentials();
  try { sessionStorage.setItem(NOTICE_KEY, notice); } catch { /* 안내 없이 로그인 화면만 보인다. */ }
  location.reload();
}

/** 새로 연 로그인 화면에 보일 안내. 한 번 읽으면 지운다. */
export function takeNotice(): string | undefined {
  try { const notice = sessionStorage.getItem(NOTICE_KEY); sessionStorage.removeItem(NOTICE_KEY); return notice ?? undefined; } catch { return undefined; }
}

export class LoginError extends Error {
  constructor(message: string, readonly field: "url" | "token" | "form") { super(message); this.name = "LoginError"; }
}

/** 로그인 칸의 주소와 토큰을 확인한다. 원격 Relay인지 health로 보고, 토큰은 whoami로 확인한다. 저장은 하지 않는다. */
export async function verifyLogin(urlInput: string, tokenInput: string): Promise<Credentials> {
  let url: string;
  try { url = normalizeRelayUrl(urlInput); } catch (error) { throw new LoginError((error as Error).message, "url"); }
  const token = tokenInput.trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new LoginError("발급받은 토큰을 입력하세요.", "token");
  if (!TOKEN_PATTERN.test(token)) throw new LoginError("토큰 형식이 올바르지 않습니다. 발급받은 토큰을 그대로 붙여 넣으세요.", "token");
  const request = async (path: string, headers: Record<string, string> = {}) => {
    try { return await original(`${url}${path}`, { headers, cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000) }); }
    catch { throw new LoginError("이 주소의 Relay에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.", "url"); }
  };
  const health = await request("/api/v1/health");
  const info = health.ok ? await health.json().catch(() => null) as { kind?: string } | null : null;
  if (info?.kind !== "relay-remote") throw new LoginError("이 주소는 Relay 원격 서버가 아닙니다.", "url");
  const response = await request("/api/v1/auth/whoami", { Authorization: `Bearer ${token}` });
  if (response.status === 401) throw new LoginError("토큰이 올바르지 않거나 폐기되었습니다.", "token");
  if (!response.ok) throw new LoginError(`로그인을 확인하지 못했습니다(HTTP ${response.status}).`, "form");
  const who = await response.json() as WhoAmI;
  return { url, token, user: who.user?.name, tokenName: who.token?.name };
}
