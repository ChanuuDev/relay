import { errorResponse, forward, isApi, type Credentials } from "./lib/remote-api";

/* 브라우저 모드(원격 서버가 내려준 화면)의 서비스 워커. scripts/build-web.ts가 generated/sw-web.js로 묶는다.
   1) 그림·영상·내려받기처럼 화면의 fetch를 거치지 않는 `/api/` 요청에 토큰을 붙여 로그인한 원격 Relay로 보낸다(규칙은 lib/remote-api.ts).
      토큰은 기억에만 두고, 워커가 다시 깨어나 잊었으면 열린 화면에 물어본다. 저장소에는 쓰지 않는다.
   2) 화면 자산은 로컬 sw.js처럼 network-first로 보관해 서버가 잠시 닿지 않아도 화면을 연다. API 응답은 보관하지 않는다. */

interface Client { id: string; postMessage(message: unknown, transfer?: unknown[]): void }
interface FetchEvent extends Event { request: Request; clientId: string; respondWith(response: Promise<Response> | Response): void; waitUntil(promise: Promise<unknown>): void }
interface ExtendableEvent extends Event { waitUntil(promise: Promise<unknown>): void }
interface WorkerScope {
  location: Location;
  clients: { get(id: string): Promise<Client | undefined>; matchAll(options: { type: "window"; includeUncontrolled?: boolean }): Promise<Client[]>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", handler: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", handler: (event: FetchEvent) => void): void;
  addEventListener(type: "message", handler: (event: MessageEvent) => void): void;
}
const scope = globalThis as unknown as WorkerScope;

const CACHE = "relay-web-shell-v1";
/** 처음 설치할 때 받아 두는 화면 자산. src/web/public/sw.js의 목록과 같다. */
const SHELL = ["/", "/app.js", "/style.css", "/theme.js", "/icon.svg", "/manifest.webmanifest", "/fonts/PretendardVariable.woff2",
  "/fonts/JetBrainsMono-latin.woff2", "/fonts/JetBrainsMono-latin-italic.woff2", "/fonts/JetBrainsMono-latin-ext.woff2", "/fonts/JetBrainsMono-latin-ext-italic.woff2",
  "/wallpaper-dark.jpg", "/wallpaper-light.jpg", "/icons/app-192.png", "/icons/sessions.png", "/icons/command.png", "/icons/settings.png", "/icons/youtube.png", "/icons/notes.png", "/icons/files.png", "/icons/viewer.png", "/icons/calculator.png", "/icons/office.png", "/icons/activity.png", "/icons/tasks.png", "/icons/board.png", "/icons/calendar.png",
  "/office/kit-night.png", "/office/floors-night.png", "/office/kit-birch.png", "/office/floors-birch.png", "/office/kit-oak.png", "/office/floors-oak.png",
  "/office/backdrop-night.webp", "/office/backdrop-birch.webp", "/office/backdrop-oak.webp", "/office/worker.png", "/office/badges.png"];
const APP_ROUTE = /^\/(?:sessions\/[^/]+)?$/;

let credentials: Credentials | null = null;
let build = "";

const validCredentials = (value: unknown): value is Credentials => {
  const item = value as Partial<Credentials> | null;
  return Boolean(item && typeof item.url === "string" && typeof item.token === "string" && item.url && item.token);
};

/** 워커가 잊은 로그인 정보를 요청한 화면(없으면 열린 화면 아무 곳)에 묻는다. */
async function askClients(clientId: string): Promise<Credentials | null> {
  const asked = clientId ? await scope.clients.get(clientId) : undefined;
  const clients = asked ? [asked] : await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    const answer = await new Promise<unknown>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 1500);
      channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
      client.postMessage({ type: "relay-web-credentials-request" }, [channel.port2]);
    });
    if (validCredentials(answer)) return (credentials = { url: answer.url, token: answer.token, ...(answer.pc ? { pc: answer.pc } : {}) });
  }
  return null;
}

async function notifyUnauthorized() {
  for (const client of await scope.clients.matchAll({ type: "window" })) client.postMessage({ type: "relay-web-unauthorized" });
}

async function api(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const login = credentials ?? await askClients(event.clientId);
  if (!login) return errorResponse(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined
    : request.headers.get("content-type")?.includes("json") ? await request.text() : await request.blob();
  return forward(login, new URL(request.url), method, request.headers, body, {
    send: (url, init) => fetch(url, init), build, onUnauthorized: () => { credentials = null; void notifyUnauthorized(); }, signal: request.signal,
  });
}

scope.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try { const response = await fetch(path, { cache: "no-store" }); if (response.ok) await cache.put(path, response); } catch { /* 다음에 받는다. */ }
    }));
    await scope.skipWaiting();
  })());
});

scope.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("relay-") && key !== CACHE) await caches.delete(key);
    await scope.clients.claim();
  })());
});

scope.addEventListener("message", (event) => {
  const data = event.data as { type?: string; credentials?: unknown; build?: unknown } | null;
  if (data?.type === "relay-web-credentials" && validCredentials(data.credentials)) {
    credentials = { url: data.credentials.url, token: data.credentials.token, ...(data.credentials.pc ? { pc: data.credentials.pc } : {}) };
    if (typeof data.build === "string") build = data.build;
  }
  if (data?.type === "relay-web-logout") credentials = null;
  if (data?.type === "relay-web-claim") void scope.clients.claim();
});

scope.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isApi(url, scope.location.origin)) {
    // 화면의 fetch가 이미 토큰을 붙여 보낸 요청과, 토큰이 필요 없는 health(로그인 확인·연결 확인)는 그대로 둔다.
    if (request.headers.has("authorization") || url.pathname === "/api/v1/health") return;
    event.respondWith(api(event).catch(() => errorResponse(502, "REMOTE_UNREACHABLE", "원격 Relay에 연결할 수 없습니다.")));
    return;
  }
  if (request.method !== "GET" || url.origin !== scope.location.origin) return;
  if (request.mode === "navigate" && !APP_ROUTE.test(url.pathname)) return;
  const key = request.mode === "navigate" ? "/" : url.pathname;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {}));
      }
      return response;
    } catch (error) {
      const saved = await caches.open(CACHE).then((cache) => cache.match(key));
      if (saved) return saved;
      throw error;
    }
  })());
});
