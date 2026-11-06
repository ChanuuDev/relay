import { expect, test, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { binary, root, spawnEnv } from "./web-helpers";

/* 브라우저 모드(원격 서버가 내려준 정적 화면)를 끝까지 확인한다. nginx(deploy/nginx/relay-web.conf)처럼 내보낸 화면을 내려주고
   /api/는 테스트용 원격 서버(NestJS + PGlite)로 넘기는 작은 서버를 띄운다. localhost는 보안 출처라 WebCrypto·서비스 워커가 그대로 돈다. */

const CSP = "default-src 'self'; img-src 'self' blob: https:; script-src 'self'; style-src 'self'; connect-src 'self' https:; frame-src 'self' https://www.youtube-nocookie.com; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
/** 1×1 PNG */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let dir = "";
let site = "";
let fixture: { url: string; token: string };
let remote: ChildProcess | undefined;
let web: http.Server | undefined;

function serve(webRoot: string, api: string) {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string" && !["host", "connection", "origin"].includes(name)) headers.set(name, value);
        void fetch(`${api}${url.pathname}${url.search}`, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }).then(async (upstream) => {
          const out: Record<string, string> = {};
          upstream.headers.forEach((value, name) => { if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(name)) out[name] = value; });
          response.writeHead(upstream.status, out).end(Buffer.from(await upstream.arrayBuffer()));
        }).catch(() => response.writeHead(502).end());
      });
      return;
    }
    const route = /^\/(?:sessions\/[^/]+)?$/.test(url.pathname) ? "/index.html" : url.pathname;
    const file = path.join(webRoot, decodeURIComponent(route));
    if (!file.startsWith(webRoot) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache",
      ...(route.endsWith(".html") ? { "Content-Security-Policy": CSP } : {}) }).end(readFileSync(file));
  });
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  dir = mkdtempSync(path.join(tmpdir(), "relay-browser-mode-"));
  if (!existsSync(path.join(root, "server", "dist", "app.js"))) {
    const built = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "-w", "@relay/server"], { cwd: root, shell: process.platform === "win32", encoding: "utf8" });
    if (built.status !== 0) throw new Error(`server build failed: ${built.stderr}`);
  }
  // bun 패키지는 플랫폼과 관계없이 bin/bun.exe를 둔다.
  const bun = path.join(root, "node_modules", "bun", "bin", "bun.exe");
  const exported = spawnSync(existsSync(bun) ? bun : "bun", ["run", "scripts/export-web.ts", path.join(dir, "web"), "--no-build"], { cwd: root, encoding: "utf8" });
  if (exported.status !== 0) throw new Error(`export failed: ${exported.stderr}${exported.stdout}`);
  remote = spawn(process.execPath, [path.join(root, "tests", "support", "remote-server.mjs"), dir], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let logs = "";
  remote.stderr?.on("data", (chunk) => { logs += chunk; });
  await new Promise<void>((resolve, reject) => {
    remote!.stdout?.on("data", (chunk) => { if (String(chunk).includes("ready")) resolve(); });
    remote!.once("exit", () => reject(new Error(`remote fixture exited: ${logs}`)));
  });
  fixture = JSON.parse(readFileSync(path.join(dir, "fixture.json"), "utf8"));
  web = serve(path.join(dir, "web"), fixture.url);
  await new Promise<void>((resolve) => web!.listen(0, "127.0.0.1", resolve));
  site = `http://localhost:${(web.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (web ? web.close(() => resolve()) : resolve()));
  if (remote && remote.exitCode === null) { const done = new Promise((resolve) => remote!.once("exit", resolve)); remote.kill("SIGTERM"); remote.stdin?.end(); await done; }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function login(page: Page, token = fixture.token) {
  await page.goto(site);
  await expect(page.getByRole("heading", { name: "Relay" })).toBeVisible();
  await expect(page.getByLabel("Relay 주소")).toHaveValue(site);
  await page.getByLabel("토큰", { exact: true }).fill(token);
  await page.getByRole("button", { name: "연결" }).click();
}

test("토큰과 주소로 로그인하고, 암호화해 둔 정보로 다시 열며, 그림 요청에도 토큰을 붙인다", async ({ page }) => {
  // 로그인 전에는 화면 모듈(메모·계산기)의 첫 요청을 서버로 보내지 않는다. 토큰 확인(whoami)의 401만 서버에서 온다.
  const rejected: string[] = [];
  page.on("response", (response) => { if (response.status() === 401 && !response.url().endsWith("/api/v1/auth/whoami")) rejected.push(new URL(response.url()).pathname); });
  await login(page, "x".repeat(40));
  await expect(page.getByRole("alert")).toHaveText("토큰이 올바르지 않거나 폐기되었습니다.");
  await page.getByLabel("토큰", { exact: true }).fill("짧음");
  await page.getByRole("button", { name: "연결" }).click();
  await expect(page.getByRole("alert")).toContainText("토큰 형식이 올바르지 않습니다");

  await page.getByLabel("토큰", { exact: true }).fill(fixture.token);
  await page.getByRole("button", { name: "연결" }).click();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect(page.locator(".menubar .local-label")).toHaveText("원격 · 브라우저");
  await expect(page.getByText("다른 PC에서 남긴 기록").first()).toBeVisible();
  // 로그인 전에 실패한 메모 첫 목록은 몇 초 안에 스스로 다시 받는다.
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/v1/notes")).status)).toBe(200);
  expect(rejected).toEqual([]);

  // 저장한 것은 암호문뿐이고, 토큰·주소가 그대로 보이지 않는다.
  const stored = await page.evaluate(() => localStorage.getItem("relay-web-credentials"));
  expect(stored).toBeTruthy();
  expect(stored).not.toContain(fixture.token);
  expect(stored).not.toContain("localhost");
  expect(JSON.parse(stored!)).toMatchObject({ v: 1, alg: "AES-GCM" });
  const extractable = await page.evaluate(() => new Promise<boolean | null>((resolve) => {
    const open = indexedDB.open("relay-web", 1);
    open.onsuccess = () => { const get = open.result.transaction("keys").objectStore("keys").get("credentials"); get.onsuccess = () => resolve((get.result as CryptoKey | undefined)?.extractable ?? null); };
  }));
  expect(extractable).toBe(false);

  // 다시 열어도 로그인 화면 없이 바로 데스크톱이 뜬다.
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await expect(page.getByRole("heading", { name: "Relay" })).toHaveCount(0);

  // 파일 올리기(fetch)와 그림 보기(<img>, 서비스 워커가 토큰을 붙임)가 원격 서버로 간다. 경로는 remote:/로 보인다.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const result = await page.evaluate(async (pixel) => {
    const bytes = Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0));
    const put = await fetch("/api/v1/remote/files/content?path=%2Fpixel.png", { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
    const listing = await (await fetch("/api/v1/files?path=remote%3A%2F")).json() as { entries: { path: string }[] };
    const image = new Image();
    image.src = "/api/v1/files/content?path=remote%3A%2Fpixel.png";
    await image.decode();
    const open = await fetch("/api/v1/files/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "remote:/pixel.png", action: "open" }) });
    return { put: put.status, paths: listing.entries.map((entry) => entry.path), width: image.naturalWidth, open: open.status };
  }, PIXEL.toString("base64"));
  expect(result.put).toBeLessThan(300);
  expect(result.paths).toEqual(expect.arrayContaining(["remote:/pixel.png", "remote:/remote-note.txt"]));
  expect(result.width).toBe(1);
  expect(result.open).toBe(403);
});

test("설정에서 로그아웃하면 암호문과 키를 지우고 로그인 화면으로 돌아간다", async ({ page }) => {
  await login(page);
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator('.dock-item[aria-label="설정"]').click();
  await expect(page.locator("#storage-info")).toContainText(site);
  await expect(page.locator("#storage-info")).toContainText("tester");
  await page.locator("#browser-logout").click();
  await expect(page.getByRole("status").filter({ hasText: "로그아웃했습니다" })).toBeVisible();
  await expect(page.getByLabel("토큰", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("relay-web-credentials"))).toBeNull();
});

test("원격 모드로 켜 둔 PC의 파일을 브라우저에서 보고, 그림·글도 그 PC에서 받아 온다", async ({ page }) => {
  test.setTimeout(120_000);
  // PC 역할: 이 컴퓨터의 임시 폴더를 저장소로 쓰는 relay.exe를 원격 모드로 띄운다. 기기는 원격 서버에 먼저 등록한다.
  const pcDir = path.join(dir, "pc");
  const share = path.join(pcDir, "share");
  mkdirSync(share, { recursive: true });
  writeFileSync(path.join(share, "pc-note.txt"), "PC에 있는 메모");
  writeFileSync(path.join(share, "pc-pixel.png"), PIXEL);
  const registered = await (await fetch(`${fixture.url}/api/v1/devices/register`, { method: "POST",
    headers: { Authorization: `Bearer ${fixture.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "test-pc", platform: process.platform }) })).json() as { device: { id: string } };
  writeFileSync(path.join(pcDir, "config.json"), JSON.stringify({ schemaVersion: 1, mode: "remote",
    remote: { url: fixture.url, token: fixture.token, deviceId: registered.device.id, deviceName: "test-pc" } }));
  const reservation = net.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const pc = spawn(binary, ["web", "--data-dir", pcDir, "--port", String(port)], { cwd: pcDir, windowsHide: true, stdio: "pipe", env: { ...spawnEnv, RELAY_ALLOW_HTTP: "1" } });
  try {
    await login(page);
    await expect(page.locator("#connection-state")).toContainText("연결됨");
    await expect.poll(() => page.evaluate(async () => ((await (await fetch("/api/v1/pcs")).json()) as { items: { online: boolean }[] }).items.some((item) => item.online)), { timeout: 30_000 }).toBe(true);
    const note = path.join(share, "pc-note.txt");
    const pixel = path.join(share, "pc-pixel.png");
    const result = await page.evaluate(async ({ share, note, pixel }) => {
      const places = await (await fetch("/api/v1/files/places")).json() as { platform: string; drives: { path: string }[]; pc?: { name: string } };
      const listing = await (await fetch(`/api/v1/files?path=${encodeURIComponent(share)}`)).json() as { path: string; entries: { name: string; path: string }[] };
      const text = await (await fetch(`/api/v1/files/content?path=${encodeURIComponent(note)}`)).text();
      const image = new Image();
      image.src = `/api/v1/files/content?path=${encodeURIComponent(pixel)}`;
      await image.decode();
      const server = await (await fetch("/api/v1/files?path=remote%3A%2F")).json() as { entries: { path: string }[] };
      const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.status);
      return { places, listing, text, width: image.naturalWidth, server: server.entries.map((entry) => entry.path),
        open: await post("/api/v1/files/open", { path: note, action: "open" }),
        mixed: await post("/api/v1/files/paste", { sources: [note], destination: "remote:/", mode: "copy" }) };
    }, { share, note, pixel });
    expect(result.places.pc?.name).toBe("test-pc");
    expect(result.places.platform).toBe(process.platform);
    expect(result.places.drives.map((drive) => drive.path)).toContain("remote:/");
    expect(result.listing.path).toBe(share);
    expect(result.listing.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(["pc-note.txt", "pc-pixel.png"]));
    expect(result.listing.entries.find((entry) => entry.name === "pc-note.txt")?.path).toBe(note);
    expect(result.text).toBe("PC에 있는 메모");
    expect(result.width).toBe(1);
    expect(result.server).toContain("remote:/remote-note.txt");
    expect(result.open).toBe(403);
    expect(result.mixed).toBe(403);

    // 파일 탐색기 창: PC 드라이브와 원격 서버 드라이브가 함께 보이고, PC 폴더를 열면 그 PC의 파일이 보인다.
    await page.locator('.dock-item[aria-label="파일 탐색기"]').click();
    const files = page.locator('.window[data-window="files"]');
    await expect(files.getByText("원격 서버").first()).toBeVisible();
  } finally {
    const done = new Promise((resolve) => pc.once("exit", resolve));
    pc.kill("SIGTERM");
    await done;
  }
});
