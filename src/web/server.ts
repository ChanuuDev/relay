import type { Config } from "../config";
import { openDatabase } from "../db/database";
import { errorBody, RelayError } from "../errors";
import { SessionRepository } from "../session/session.repository";
import { SessionService } from "../session/session.service";
import { api } from "./api";
import { assets } from "./assets";
import { checkRequest, securityHeaders } from "./security";

export function handler(service: SessionService, config: Config) {
  return (request: Request): Response => {
    try {
      checkRequest(request, config.webPort);
      if (request.method !== "GET") throw new RelayError("METHOD_NOT_ALLOWED", "GET 조회만 허용합니다.", 2, 405);
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return Response.json(api(url, service, config), { headers: securityHeaders });
      const asset = assets.get(/^\/sessions\/[^/]+$/.test(url.pathname) ? "/" : url.pathname);
      if (!asset) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
      return new Response(asset.body, { headers: { ...securityHeaders, "Content-Type": asset.type } });
    } catch (error) {
      const failure = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", 5, 500);
      return Response.json(errorBody(failure), { status: failure.httpStatus,
        headers: { ...securityHeaders, ...(failure.code === "DB_BUSY" ? { "Retry-After": "3" } : {}),
          ...(failure.httpStatus === 405 ? { Allow: "GET" } : {}) } });
    }
  };
}

export function startServer(config: Config) {
  const db = openDatabase(config, true);
  const service = new SessionService(new SessionRepository(db));
  let server;
  try {
    server = Bun.serve({ hostname: config.webHost, port: config.webPort, fetch: handler(service, config),
      maxRequestBodySize: 1024, development: false, reusePort: false });
  } catch (error) {
    db.close();
    if ((error as { code?: string }).code === "EADDRINUSE") throw new RelayError("PORT_IN_USE", "포트가 사용 중입니다. 기존 서버를 확인하거나 --port를 지정하세요.", 6, 500);
    throw new RelayError("SERVER_START_FAILED", "로컬 서버를 시작할 수 없습니다. 포트와 권한을 확인하세요.", 6, 500);
  }
  let stopped = false;
  return { server, async stop() { if (!stopped) { stopped = true; await server.stop(false); db.close(); } } };
}
