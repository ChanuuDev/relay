import "reflect-metadata";
import { Logger, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { MAX_IMAGE_UPLOAD_BYTES } from "@relay/core";
import { AppModule } from "./app.module.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/database.js";

/** 본문 상한. 로컬 서버와 같다: 가져오기 64MB, 메모 그림 16MB, 나머지 8MB. 파일 올리기(PUT)는 본문을 파서 없이 스트림으로 받는다. */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface AppOptions { schedule?: boolean; log?: boolean }
/** 브라우저가 다른 출처 응답에서 읽을 수 있게 할 헤더. 메모 ETag, 파일 범위·이름·수정 시각이다. */
const CORS_EXPOSE = "ETag, Content-Range, Content-Length, Accept-Ranges, Content-Disposition, X-File-Modified, Retry-After";

/** main.ts(운영)와 테스트가 같은 조립을 쓴다. */
export async function createApp(db: Db, config: ServerConfig, options: AppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(db, config, options), {
    bodyParser: false,
    logger: options.log === false ? false : ["error", "warn", "log"],
  });
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("trust proxy", "loopback");
  // 브라우저 모드 화면(다른 출처)이 토큰을 붙여 부를 수 있게, 허용한 출처에만 CORS를 연다. 쿠키는 쓰지 않으므로 자격 증명 허용은 하지 않는다.
  const allowed = new Set(config.corsOrigins ?? []);
  if (allowed.size) app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !allowed.has(origin)) return next();
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Expose-Headers", CORS_EXPOSE);
    if (request.method !== "OPTIONS") return next();
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Range, If-None-Match, Idempotency-Key");
    response.setHeader("Access-Control-Max-Age", "600");
    response.status(204).end();
  });
  const json =(limit: number) => express.json({ limit, strict: true, type: "application/json" });
  app.use("/api/v1/import", json(MAX_IMPORT_BYTES));
  app.use("/api/v1/notes/import", json(MAX_IMPORT_BYTES));
  app.use("/api/v1/notes/images", json(MAX_IMAGE_UPLOAD_BYTES));
  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (request.path.startsWith("/api/v1/files/content") && request.method === "PUT") return next();
    if (request.path === "/api/v1/import" || request.path === "/api/v1/notes/import" || request.path.startsWith("/api/v1/notes/images")) return next();
    return json(MAX_WRITE_BYTES)(request, response, next);
  });
  app.use((_request: express.Request, response: express.Response, next: express.NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  await app.init();
  if (options.log !== false) new Logger("relay").log(`원격 파일 폴더: ${config.filesRoot ?? "(끔)"} · 보관 ${config.retentionDays}일`);
  return app;
}
