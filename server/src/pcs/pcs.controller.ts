import { Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { RelayError } from "@relay/core";
import { AuthService } from "../auth/auth.service.js";
import { Auth, type AuthContext } from "../common/decorators.js";
import { DevicesService } from "../devices/devices.service.js";
import { PcBroker, type PcJob } from "./pc-broker.service.js";

/** PC가 돌려줘도 브라우저에 넘기는 응답 헤더. 파일 내용의 범위·이름·형식과 메모 ETag 정도다. */
export const REPLY_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "x-file-modified", "cache-control", "content-security-policy"];
const REQUEST_HEADERS = ["range", "if-none-match", "content-type"];
const DEVICE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * 브라우저 모드가 부르는 PC 파일. `/api/v1/pcs/:기기/files…`는 그 PC의 로컬 파일 API(`/api/v1/files…`)와 같은 경로·모양이고,
 * 요청은 PcBroker를 거쳐 PC의 relay.exe가 처리한다. 기본 앱으로 열기·시스템 클립보드는 그 PC 화면에서만 뜻이 있으므로 없다.
 */
@Controller("api/v1/pcs")
export class PcsController {
  constructor(private readonly broker: PcBroker, private readonly devices: DevicesService, private readonly auth: AuthService) {}

  /** 이 사용자의 기기와, 지금 파일을 볼 수 있는지(PC의 Relay가 연결돼 있는지). */
  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "PC 목록은 query를 받지 않습니다.");
    const { items } = await this.devices.list(auth.userId);
    return { schemaVersion: 1, items: items.map((device) => ({ ...device, online: this.broker.online(device.id) })) };
  }

  @Get(":deviceId/files") listing(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "GET", "/api/v1/files", request, response); }
  @Get(":deviceId/files/places") places(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "GET", "/api/v1/files/places", request, response); }
  @Get(":deviceId/files/stat") stat(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "GET", "/api/v1/files/stat", request, response); }
  @Get(":deviceId/files/content") content(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "GET", "/api/v1/files/content", request, response); }
  @Post(":deviceId/files/save") save(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "POST", "/api/v1/files/save", request, response); }
  @Post(":deviceId/files/mkdir") mkdir(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "POST", "/api/v1/files/mkdir", request, response); }
  @Post(":deviceId/files/rename") rename(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "POST", "/api/v1/files/rename", request, response); }
  @Post(":deviceId/files/paste") paste(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "POST", "/api/v1/files/paste", request, response); }
  @Post(":deviceId/files/delete") remove(@Auth() auth: AuthContext, @Param("deviceId") id: string, @Req() request: Request, @Res() response: Response) { return this.relay(auth, id, "POST", "/api/v1/files/delete", request, response); }

  private async relay(auth: AuthContext, deviceId: string, method: PcJob["method"], path: string, request: Request, response: Response) {
    if (!DEVICE_ID.test(deviceId) || !(await this.auth.deviceBelongs(auth.userId, deviceId))) throw new RelayError("NOT_FOUND", "그 PC를 찾을 수 없습니다.", 3, 404);
    const at = request.originalUrl.indexOf("?");
    const headers: Record<string, string> = {};
    for (const name of REQUEST_HEADERS) { const value = request.headers[name]; if (typeof value === "string" && value) headers[name] = value; }
    if (method === "POST" && !/^application\/json\s*(;|$)/i.test(headers["content-type"] ?? "")) throw new RelayError("UNSUPPORTED_MEDIA_TYPE", "application/json으로 보내야 합니다.", 2, 415);
    const abort = new AbortController();
    response.on("close", () => { if (!response.writableEnded) abort.abort(); });
    await this.broker.submit(auth.userId, deviceId, {
      method, path, query: at < 0 ? "" : request.originalUrl.slice(at + 1), headers,
      body: method === "POST" ? JSON.stringify(request.body ?? null) : null,
    }, async (reply) => {
      response.status(reply.status);
      for (const [name, value] of Object.entries(reply.headers)) response.setHeader(name, value);
      // 브라우저가 중간에 떠나면 PC에서 오던 흐름도 끊는다. 이미 보낸 응답이라 오류 본문은 쓰지 않는다.
      try { await pipeline(reply.body, response); } catch { reply.body.destroy(); response.destroy(); }
    }, abort.signal);
  }
}
