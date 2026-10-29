/* Relay 서비스 워커. 설치한 앱은 서버가 꺼져 있어도 화면을 열고, 서버가 다시 뜨면 화면이 스스로 연결된다.
   항상 서버 응답을 먼저 쓰고(network-first) 응답이 없을 때만 보관본을 꺼낸다. 세션 데이터(/api/)는 보관하지 않는다. */
const CACHE = "relay-shell-v1";
const SHELL = ["/", "/app.js", "/style.css", "/theme.js", "/icon.svg", "/manifest.webmanifest", "/fonts/PretendardVariable.woff2",
  "/wallpaper-dark.jpg", "/wallpaper-light.jpg", "/icons/app-192.png", "/icons/sessions.png", "/icons/guide.png", "/icons/command.png", "/icons/settings.png", "/icons/youtube.png", "/icons/notes.png", "/icons/files.png", "/icons/viewer.png", "/icons/calculator.png"];
/** 목록과 세션 상세 주소는 같은 HTML을 받는다. 그 밖의 주소는 보관본으로 대신하지 않는다. */
const APP_ROUTE = /^\/(?:sessions\/[^/]+)?$/;

/** 같은 포트에 다른 서버가 떠 있어도 그 응답은 담지 않도록, Relay 서버가 붙이는 헤더가 있는 성공 응답만 보관한다. */
const fromRelay = (response) => response.status === 200 && response.headers.has("Relay-Pid");

self.addEventListener("install", (event) => {
  // 3초마다 오가는 세션 조회는 서비스 워커를 깨우지 않고 곧장 서버로 간다(Static Routing API를 지원하는 브라우저).
  try { event.addRoutes?.({ condition: { urlPattern: new URLPattern({ pathname: "/api/*" }) }, source: "network" })?.catch(() => {}); }
  catch { /* 지원하지 않으면 아래 fetch 처리기가 /api/를 그대로 흘려보낸다. */ }
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const response = await fetch(path, { cache: "no-store" });
      if (fromRelay(response)) await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("relay-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && !APP_ROUTE.test(url.pathname)) return;
  const key = request.mode === "navigate" ? "/" : url.pathname;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (fromRelay(response)) {
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
