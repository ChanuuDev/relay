import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { IMAGE_ID, RelayError, exportFileName, parseBatch, parseExport, parseExportImages, parseImageUpload } from "@relay/core";
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
    return this.notes.merge(auth.userId, parseExport(body), parseExportImages(body));
  }

  /** 붙여 넣거나 고른 그림 한 장을 `{ data: base64 }`로 받는다. 돌려준 url을 본문에 넣는다. */
  @Post("images")
  @HttpCode(200)
  saveImage(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "그림 올리기");
    return this.notes.saveImage(auth.userId, Buffer.from(parseImageUpload(body).data, "base64"));
  }

  /** 그림 보기. id가 내용의 해시라 오래 보관해도 되고, 문서로 열어도 아무것도 실행하지 않게 격리한다. */
  @Get("images/:id")
  async image(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>,
    @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() response: Response) {
    noQuery(query, "그림 보기");
    if (!IMAGE_ID.test(id)) throw new RelayError("INVALID_ARGUMENT", "그림 id가 올바르지 않습니다.");
    const tag = `"${id}"`;
    if (ifNoneMatch === tag) { response.status(304).setHeader("ETag", tag).setHeader("Cache-Control", "private, max-age=31536000, immutable").end(); return; }
    const image = await this.notes.image(auth.userId, id);
    if (!image) throw new RelayError("NOT_FOUND", "그림이 없습니다.", 3, 404);
    response.setHeader("ETag", tag).setHeader("Cache-Control", "private, max-age=31536000, immutable").setHeader("Content-Type", image.type)
      .setHeader("Content-Security-Policy", "default-src 'none'; sandbox").send(Buffer.from(image.data));
  }
}
