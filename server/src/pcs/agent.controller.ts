import { Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RelayError } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { PcBroker } from "./pc-broker.service.js";
import { REPLY_HEADERS } from "./pcs.controller.js";

const JOB_ID = /^[0-9a-f-]{36}$/;
const deviceOf = (auth: AuthContext) => {
  if (!auth.deviceId) throw new RelayError("INVALID_ARGUMENT", "PC 파일 중계는 등록한 기기만 씁니다(X-Relay-Device).", 2, 400);
  return auth.deviceId;
};

/**
 * PC의 relay.exe가 부르는 쪽. `next`로 맡길 요청을 기다리고(최대 30초, 없으면 204), 처리한 응답은 `reply/:id`의 본문으로 흘려보낸다.
 * 상태와 헤더는 `X-Relay-Status`·`X-Relay-Headers`(JSON을 base64url로)로, 본문은 application/octet-stream 그대로 온다.
 */
@Controller("api/v1/agent")
export class AgentController {
  constructor(private readonly broker: PcBroker) {}

  @Get("next")
  async next(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const deviceId = deviceOf(auth);
    for (const key of Object.keys(query)) if (key !== "wait") throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
    const seconds = query.wait === undefined ? 25 : Number(query.wait);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 30) throw new RelayError("INVALID_ARGUMENT", "wait는 0~30초 정수입니다.");
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const job = await this.broker.next(auth.userId, deviceId, seconds * 1000, abort.signal);
    if (abort.signal.aborted || response.destroyed) { if (job) this.broker.abandon(job.id); return; }
    if (!job) { response.status(204).end(); return; }
    response.json({ schemaVersion: 1, job });
  }

  @Post("reply/:id")
  async reply(@Auth() auth: AuthContext, @Param("id") id: string, @Req() request: Request, @Res() response: Response) {
    const deviceId = deviceOf(auth);
    const pending = JOB_ID.test(id) ? this.broker.reply(auth.userId, deviceId, id) : undefined;
    if (!pending) throw new RelayError("NOT_FOUND", "기다리는 요청이 없거나 이미 끝났습니다.", 3, 404);
    const status = Number(request.headers["x-relay-status"]);
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new RelayError("INVALID_ARGUMENT", "X-Relay-Status가 올바르지 않습니다.");
    let raw: unknown = {};
    try { raw = JSON.parse(Buffer.from(String(request.headers["x-relay-headers"] ?? ""), "base64url").toString("utf8") || "{}"); } catch { raw = {}; }
    const headers: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [name, value] of Object.entries(raw)) if (REPLY_HEADERS.includes(name.toLowerCase()) && typeof value === "string" && !/[\r\n]/.test(value)) headers[name.toLowerCase()] = value;
    }
    await pending.deliver({ status, headers, body: request }).catch(() => {});
    if (!response.headersSent) response.status(204).end();
  }
}
