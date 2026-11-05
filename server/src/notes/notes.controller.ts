import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { RelayError, exportFileName, parseBatch, parseExport } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { NotesService } from "./notes.service.js";

const noQuery = (query: Record<string, unknown>, what: string) => {
  if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", `${what}은(는) query를 받지 않습니다.`);
};

@Controller("api/v1/notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** 메모 목록. ETag가 저장 번호(revision)라 바뀌지 않았으면 304로 본문 없이 답한다. */
  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() response: Response) {
    noQuery(query, "메모 목록");
    const tag = `"${await this.notes.revision(auth.userId)}"`;
    if (ifNoneMatch === tag) { response.status(304).setHeader("ETag", tag).end(); return; }
    const data = await this.notes.list(auth.userId);
    response.setHeader("ETag", `"${data.revision}"`).json(data);
  }

  @Post()
  @HttpCode(200)
  save(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "메모 저장");
    return this.notes.apply(auth.userId, parseBatch(body));
  }

  /** 다른 환경으로 옮길 파일. 주소로 바로 열어도 날짜를 붙인 이름으로 내려받는다. */
  @Get("export")
  async exportAll(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Res() response: Response) {
    noQuery(query, "메모 내보내기");
    const data = await this.notes.exportAll(auth.userId);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${exportFileName()}"`);
    response.send(`${JSON.stringify(data, null, 2)}\n`);
  }

  @Post("import")
  @HttpCode(200)
  importAll(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "메모 가져오기");
    return this.notes.merge(auth.userId, parseExport(body));
  }
}
