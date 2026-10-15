import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { root } from "./helpers";

const source = readFileSync(path.join(root, "src/web/public/sw.js"), "utf8");
const ORIGIN = "http://127.0.0.1:7474";
const relay = (body: string) => new Response(body, { headers: { "Relay-Pid": "1234" } });
const foreign = (body: string) => new Response(body);

type FakeRequest = { url: string; method: string; mode: string };
type Handler = (event: Record<string, unknown>) => void;

/** sw.js를 가짜 서비스 워커 전역에 올린다. 네트워크 응답은 network가 정하고, 캐시는 이름별 Map이다. */
function worker(network: (path: string) => Response | Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>([["other-app", new Map()]]);
  const fetched: string[] = [];
  const routes: unknown[] = [];
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return { put: async (key: string, response: Response) => { store.set(key, response); }, match: async (key: string) => store.get(key)?.clone() };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const fetch = async (input: string | FakeRequest) => {
    const pathname = new URL(typeof input === "string" ? input : input.url, ORIGIN).pathname;
    fetched.push(pathname);
    return network(pathname);
  };
  class URLPattern { constructor(readonly init: unknown) {} }
  const self = { location: new URL(`${ORIGIN}/sw.js`), addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => {}, clients: { claim: async () => {} } };
  new Function("self", "caches", "fetch", "URLPattern", source)(self, caches, fetch, URLPattern);

  async function lifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)!({ waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      addRoutes: async (rules: unknown) => { routes.push(rules); } });
    await Promise.all(pending);
  }
  /** fetch 이벤트를 보내고, 서비스 워커가 응답을 맡았으면 그 응답을, 아니면 undefined를 돌려준다. */
  async function request(url: string, { mode = "no-cors", method = "GET" } = {}) {
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.get("fetch")!({ request: { url: new URL(url, ORIGIN).href, method, mode },
      respondWith: (promise: Promise<Response>) => { responded = promise; }, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    if (!responded) return undefined;
    const response = await responded;
    await Promise.all(pending);
    return response;
  }
  const saved = (key: string) => stores.get("relay-shell-v1")?.get(key)?.clone().text();
  return { lifecycle, request, saved, stores, fetched, routes };
}

describe("Service worker (installed app shell)", () => {
  test("install keeps only Relay's own shell responses and sends session API calls straight to the network", async () => {
    const sw = worker((pathname) => pathname === "/icon.svg" ? foreign("다른 서버") : relay(`relay ${pathname}`));
    await sw.lifecycle("install");
    expect(sw.fetched).toContain("/");
    expect(sw.fetched).toContain("/app.js");
    expect(await sw.saved("/")).toBe("relay /");
    expect(await sw.saved("/app.js")).toBe("relay /app.js");
    expect(sw.stores.get("relay-shell-v1")!.has("/icon.svg")).toBe(false);
    expect(sw.routes).toEqual([{ condition: { urlPattern: { init: { pathname: "/api/*" } } }, source: "network" }]);
  });

  test("activate removes only older Relay caches", async () => {
    const sw = worker((pathname) => relay(pathname));
    sw.stores.set("relay-shell-v0", new Map());
    await sw.lifecycle("activate");
    expect([...sw.stores.keys()].sort()).toEqual(["other-app"]);
  });

  test("API, other methods, other origins and unknown pages are left to the browser", async () => {
    const sw = worker((pathname) => relay(pathname));
    expect(await sw.request("/api/v1/sessions?limit=50")).toBeUndefined();
    expect(await sw.request("/api/v1/health", { mode: "navigate" })).toBeUndefined();
    expect(await sw.request("/app.js", { method: "POST" })).toBeUndefined();
    expect(await sw.request("https://example.com/app.js")).toBeUndefined();
    expect(await sw.request("/relay.db", { mode: "navigate" })).toBeUndefined();
    expect(sw.fetched).toEqual([]);
  });

  test("network first: fresh responses are returned and saved, session pages share the list shell", async () => {
    let version = "v1";
    const sw = worker((pathname) => relay(`${version} ${pathname}`));
    expect(await (await sw.request("/sessions/ses_1?back=%2F", { mode: "navigate" }))!.text()).toBe("v1 /sessions/ses_1");
    expect(await sw.saved("/")).toBe("v1 /sessions/ses_1");
    version = "v2";
    expect(await (await sw.request("/app.js"))!.text()).toBe("v2 /app.js");
    expect(await sw.saved("/app.js")).toBe("v2 /app.js");
  });

  test("a foreign server on the same port is passed through but never saved", async () => {
    let up: "relay" | "foreign" = "relay";
    const sw = worker((pathname) => up === "relay" ? relay(`relay ${pathname}`) : foreign(`foreign ${pathname}`));
    await sw.request("/", { mode: "navigate" });
    up = "foreign";
    expect(await (await sw.request("/", { mode: "navigate" }))!.text()).toBe("foreign /");
    expect(await sw.saved("/")).toBe("relay /");
  });

  test("when the server is down the saved shell opens; anything never saved still fails", async () => {
    let online = true;
    const sw = worker((pathname) => { if (!online) throw new TypeError("Failed to fetch"); return relay(`relay ${pathname}`); });
    await sw.request("/", { mode: "navigate" });
    await sw.request("/app.js");
    online = false;
    expect(await (await sw.request("/sessions/ses_2", { mode: "navigate" }))!.text()).toBe("relay /");
    expect(await (await sw.request("/app.js"))!.text()).toBe("relay /app.js");
    const failure = await sw.request("/wallpapers/aurora.jpg").catch((error: Error) => error);
    expect(failure).toBeInstanceOf(TypeError);
  });
});
