import { createHash } from "node:crypto";
import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RelayError, serveIndex } from "@relay/core";
import { Auth, SkipIdempotency, type AuthContext } from "../common/decorators.js";
import { NotesIndexService } from "./index.service.js";

/** 메모 의미 검색·색인 API. 경로와 요청 검사는 로컬 서버와 같은 함수(@relay/core의 serveIndex)가 한다(경로 목록은 그 파일의 머리말).
 *  읽기 응답은 내용의 해시를 ETag로 달아, 화면이 색인 상태를 자주 물어도 바뀌지 않았으면 304로 답한다.
 *  멱등 키로 응답을 보관하지 않는다: 검색은 읽기이고, 워커의 요청은 조각 글과 벡터가 실려 크며, 나머지는 같은 요청을 거듭 받아도 결과가 같다. */
@Controller("api/v1/notes")
@SkipIdempotency()
export class NotesIndexController {
  constructor(private readonly index: NotesIndexService) {}

  private async serve(auth: AuthContext, request: Request, response: Response, body: unknown) {
    const result = await serveIndex(this.index.engine(auth.userId), request.method, request.path, request.query as Record<string, unknown>, body);
    if (result === undefined) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
    if (request.method !== "GET") { response.status(200).json(result); return; }
    const text = JSON.stringify(result);
    const tag = `"${createHash("sha256").update(text).digest("hex").slice(0, 32)}"`;
    if (request.headers["if-none-match"] === tag) { response.status(304).setHeader("ETag", tag).end(); return; }
    response.setHeader("ETag", tag).setHeader("Content-Type", "application/json; charset=utf-8").send(text);
  }

  @Get(["index-status", "semantic-links", "cards", "meta", ":id/suggestions"])
  read(@Auth() auth: AuthContext, @Req() request: Request, @Res() response: Response) { return this.serve(auth, request, response, undefined); }

  @Post(["search", "reindex", "index-jobs/lease", "index-jobs/commit", "index-jobs/fail", "index-models/activate", "cards", "meta", "register-doc", ":id/suggestions/:target/dismiss"])
  write(@Auth() auth: AuthContext, @Req() request: Request, @Res() response: Response, @Body() body: unknown) { return this.serve(auth, request, response, body); }
}
