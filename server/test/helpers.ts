import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth.service.js";
import type { ServerConfig } from "../src/config.js";
import { openPglite, type Db } from "../src/db/database.js";

export interface TestApp {
  app: INestApplication;
  db: Db;
  token: string;
  userId: string;
  /** 인증 헤더를 붙인 supertest 요청 */
  get: (url: string) => supertest.Test;
  post: (url: string, body?: unknown) => supertest.Test;
  put: (url: string) => supertest.Test;
  /** 인증 없는 요청 */
  raw: supertest.Agent;
  close: () => Promise<void>;
}

export async function testApp(overrides: Partial<ServerConfig> = {}): Promise<TestApp> {
  const { db, close } = await openPglite();
  const config: ServerConfig = { databaseUrl: null, port: 0, retentionDays: 30, filesRoot: null, build: "test", bootstrapUser: "tester", logLevel: "error", ...overrides };
  const app = await createApp(db, config, { schedule: false, log: false });
  const auth = app.get(AuthService);
  const user = await auth.bootstrap("tester");
  const { token } = await auth.createToken(user.id, "test-token");
  const server = app.getHttpServer();
  const raw = supertest(server);
  return {
    app, db, token, userId: user.id, raw,
    get: (url) => raw.get(url).set("Authorization", `Bearer ${token}`),
    post: (url, body) => { const t = raw.post(url).set("Authorization", `Bearer ${token}`); return body === undefined ? t : t.set("Content-Type", "application/json").send(JSON.stringify(body)); },
    put: (url) => raw.put(url).set("Authorization", `Bearer ${token}`),
    close: async () => { await app.close(); await close(); },
  };
}

/** `relay record`가 보내는 본문. */
export function recordInput(sessionId: string, extra: Record<string, unknown> = {}) {
  return { provider: "openai", agent: "codex", sessionId, cwd: "C:/work/project", summary: `첫 요약 ${sessionId}`, ...extra };
}
