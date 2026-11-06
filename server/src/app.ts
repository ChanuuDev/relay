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

/** main.ts(운영)와 테스트가 같은 조립을 쓴다. */
export async function createApp(db: Db, config: ServerConfig, options: AppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(db, config, options), {
    bodyParser: false,
    logger: options.log === false ? false : ["error", "warn", "log"],
  });
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("trust proxy", "loopback");
  const json = (limit: number) => express.json({ limit, strict: true, type: "application/json" });
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
