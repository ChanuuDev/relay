import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RelayError } from "@relay/core";
import { FilesService } from "./files.service.js";

function onlyKeys(query: Record<string, unknown>, allowed: string[]) {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
    if (Array.isArray(value)) throw new RelayError("INVALID_ARGUMENT", `${key}는 한 번만 줍니다.`);
  }
}
const pathOf = (query: Record<string, unknown>) => {
  if (typeof query.path !== "string") throw new RelayError("INVALID_ARGUMENT", "path를 한 번 주세요.");
  return query.path;
};

/** 지정 폴더 안의 파일. 로컬 파일 API와 같은 경로·모양이지만 경로는 루트 기준(`/문서/a.txt`)이다. 기본 앱 열기·시스템 클립보드는 없다. */
@Controller("api/v1/files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get("places")
  places(@Query() query: Record<string, unknown>) {
    onlyKeys(query, []);
    return this.files.places();
  }

  @Get()
  list(@Query() query: Record<string, unknown>) {
    onlyKeys(query, ["path"]);
    return this.files.list(pathOf(query));
  }

  @Get("stat")
  stat(@Query() query: Record<string, unknown>) {
    onlyKeys(query, ["path"]);
    return this.files.stat(pathOf(query));
  }

  @Get("content")
  content(@Query() query: Record<string, unknown>, @Headers("range") range: string | undefined, @Res() response: Response) {
    onlyKeys(query, ["path", "download"]);
    const result = this.files.content(pathOf(query), range ?? null, query.download === "1");
    response.status(result.status);
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value);
    if (!result.stream) { response.end(); return; }
    result.stream.on("error", () => { if (!response.headersSent) response.status(500); response.end(); });
    result.stream.pipe(response);
  }

  /** 올리기. 본문은 파일 바이트 그대로(application/octet-stream). overwrite=1이면 같은 이름을 덮어쓴다. */
  @Put("content")
  upload(@Query() query: Record<string, unknown>, @Req() request: Request) {
    onlyKeys(query, ["path", "overwrite"]);
    const length = request.headers["content-length"];
    const declared = typeof length === "string" && /^\d+$/.test(length) ? Number(length) : null;
    return this.files.upload(pathOf(query), request, declared, query.overwrite === "1");
  }

  @Post("save") @HttpCode(200) save(@Body() body: unknown) { return this.files.save(body); }
  @Post("mkdir") @HttpCode(200) mkdir(@Body() body: unknown) { return this.files.mkdir(body); }
  @Post("rename") @HttpCode(200) rename(@Body() body: unknown) { return this.files.rename(body); }
  @Post("paste") @HttpCode(200) paste(@Body() body: unknown) { return this.files.paste(body); }
  @Post("delete") @HttpCode(200) remove(@Body() body: unknown) { return this.files.delete(body); }
}
