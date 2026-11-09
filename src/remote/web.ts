import type { Config } from "../config";
import { errorBody, RelayError } from "../errors";
import { RemoteClient } from "./client";
import { MAX_IMAGE_UPLOAD_BYTES } from "@relay/core";
import { checkRequest, checkWrite, MAX_IMPORT_BYTES, securityHeaders } from "../web/security";
import { PID_HEADER } from "../web/control";
import { places } from "../files/files.service";
import { version } from "../../package.json";
import { buildId } from "../web/assets";
import { transfer } from "./transfer";
import { paths, REMOTE_PREFIX, remotePath } from "./paths";

export { REMOTE_PREFIX };

/** 로컬 보안 검사를 유지하고 허용한 API만 서버 간 중계한다. 인증·토큰은 브라우저로 보내지 않는다. */
export function remoteHandler(config: Config, fallback: (request: Request) => Response | Promise<Response>) {
  const localHeaders = { ...securityHeaders(config.webPort), [PID_HEADER]: String(process.pid) };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/v1/")) return fallback(request);
    try {
      checkRequest(request, config.webPort);
      // 그림 올리기(최대 16MB)와 파일은 오래 걸릴 수 있다.
      const image = url.pathname.startsWith("/api/v1/notes/images");
      const client = new RemoteClient(config, url.pathname.includes("files") || image ? 120_000 : 8000);
      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        let status: Record<string, unknown> = { reachable: false };
        const started = Date.now();
        try { const health = await new RemoteClient(config, 1500).json<{ apiVersion: number }>("/api/v1/health"); status = { reachable: true, latencyMs: Date.now() - started, apiVersion: health.apiVersion }; } catch { /* 로컬 창은 오프라인에서도 열린다. */ }
        const outbox = client.list();
        return Response.json({ schemaVersion: 1, status: "ok", mode: "remote", appVersion: version, build: buildId,
          dataDirectory: config.dataDirectory, databasePath: config.databasePath,
          remote: { ...status, url: config.remote!.url, outbox: { pending: outbox.pending.length, failed: outbox.failed.length } } }, { headers: localHeaders });
      }
      if (url.pathname === "/api/v1/files/places" && request.method === "GET") {
        const local = places();
        return Response.json({ ...local, drives: [...local.drives, { path: "remote:/", label: `원격 서버 · ${new URL(config.remote!.url).hostname}`, type: "network", total: null, free: null }] }, { headers: localHeaders });
      }
      let route = url.pathname + url.search;
      let encode = false;
      let body: unknown;
      const fileApi = url.pathname === "/api/v1/files" || url.pathname.startsWith("/api/v1/files/");
      const explicitFiles = url.pathname === "/api/v1/remote/files" || url.pathname.startsWith("/api/v1/remote/files/");
      const dataApi = /^\/api\/v1\/(sessions(?:\/[^/]+(?:\/(?:updates|children|chain|actions))?)?|notes(?:\/export|\/import|\/images(?:\/[0-9a-f]{64})?)?|calculator\/history|tasks|board|events|activity(?:\/day)?)$/.test(url.pathname);
      if (!["GET", "POST", "PUT"].includes(request.method)) throw new RelayError("METHOD_NOT_ALLOWED", "지원하지 않는 HTTP 메서드입니다.", 2, 405);
      if ((fileApi || explicitFiles || image) && request.method === "GET") {
        const site = request.headers.get("sec-fetch-site");
        if (site !== null && site !== "same-origin" && site !== "none") throw new RelayError("FORBIDDEN", "이 화면에서 보낸 파일 조회만 받습니다.", 2, 403);
      }
      if (request.method === "POST" && (fileApi || explicitFiles || dataApi)) {
        const limit = /\/(import|save)$/.test(url.pathname) ? MAX_IMPORT_BYTES : image ? MAX_IMAGE_UPLOAD_BYTES : 8 * 1024 * 1024;
        checkWrite(request, config.webPort, limit);
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = []; let total = 0;
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > limit) { await reader.cancel(); throw new RelayError("PAYLOAD_TOO_LARGE", "보낸 JSON 내용이 너무 큽니다.", 2, 413); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new RelayError("INVALID_ARGUMENT", "JSON 본문을 읽을 수 없습니다."); }
      }
      if (fileApi && !explicitFiles) {
        const value = body as { path?: string; paths?: string[]; parent?: string; destination?: string; sources?: string[] } | undefined;
        if (url.pathname === "/api/v1/files/transfer" || (url.pathname.endsWith("/paste") && value?.sources?.some(source => remotePath(source) !== remotePath(value.destination)))) {
          return Response.json(await transfer(client, body), { headers: localHeaders });
        }
        encode = remotePath(url.searchParams.get("path")) || remotePath(value?.path) || remotePath(value?.parent) || remotePath(value?.destination) || Boolean(value?.paths?.some(remotePath));
        if (!encode) return fallback(request.method === "POST" ? new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }) : request);
        if (value?.paths && !value.paths.every(remotePath)) throw new RelayError("INVALID_ARGUMENT", "서로 다른 출처는 따로 삭제하세요.");
        if (["/api/v1/files/open", "/api/v1/files/clipboard"].includes(url.pathname)) throw new RelayError("FORBIDDEN", "원격 파일에는 Windows 연동을 사용할 수 없습니다.", 2, 403);
        if (url.searchParams.has("path")) url.searchParams.set("path", url.searchParams.get("path")!.slice(REMOTE_PREFIX.length));
        route = url.pathname + url.search;
        body = paths(body, false);
      } else if (explicitFiles) route = url.pathname.replace("/remote/files", "/files") + url.search;
      else if (!dataApi) return fallback(request);
      if (request.method === "PUT") {
        if ((!fileApi && !explicitFiles) || !url.pathname.endsWith("/content")) throw new RelayError("METHOD_NOT_ALLOWED", "파일 업로드만 PUT으로 보낼 수 있습니다.", 2, 405);
        if (request.headers.get("origin") !== url.origin || (request.headers.get("sec-fetch-site") != null && request.headers.get("sec-fetch-site") !== "same-origin")) throw new RelayError("FORBIDDEN", "이 화면에서 보낸 업로드만 받습니다.", 2, 403);
      }
      const headers = new Headers();
      for (const name of ["content-type", "range", "if-none-match"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
      const response = await client.fetch(route, { method: request.method, headers,
        ...(request.method === "POST" ? { body: JSON.stringify(body) } : request.method === "PUT" ? { body: request.body } : {}) }, request.method === "POST" ? crypto.randomUUID() : undefined);
      const outgoing = new Headers(localHeaders);
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "x-file-modified", "retry-after"]) {
        const value = response.headers.get(name); if (value) outgoing.set(name, value);
      }
      if (encode && response.headers.get("content-type")?.includes("application/json")) {
        outgoing.delete("content-length");
        return Response.json(paths(await response.json(), true), { status: response.status, headers: outgoing });
      }
      // 파일 HTML/SVG 같은 활성 콘텐츠에는 로컬 fileResponse와 같은 격리를 건다.
      if (url.pathname.endsWith("/content")) outgoing.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      // 메모 그림은 내용이 바뀌지 않으므로 원격 서버가 정한 보관 기간을 따르고, 문서로 열어도 아무것도 실행하지 않게 한다.
      if (image && request.method === "GET") {
        const cache = response.headers.get("cache-control");
        if (cache) outgoing.set("Cache-Control", cache);
        outgoing.set("Content-Security-Policy", "default-src 'none'; sandbox");
      }
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch (error) {
      const failure = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "원격 요청을 처리하지 못했습니다.", 5, 500);
      return Response.json(errorBody(failure), { status: failure.httpStatus, headers: localHeaders });
    }
  };
}
