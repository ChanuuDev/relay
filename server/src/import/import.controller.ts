import { Body, Controller, HttpCode, Post, Query } from "@nestjs/common";
import { RelayError, type ImportResult } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { ImportService } from "./import.service.js";

@Controller("api/v1/import")
export class ImportController {
  constructor(private readonly importer: ImportService) {}

  /** 로컬 SQLite 전체를 올리는 이전. 1,000행 단위로 여러 번 불러도 멱등하다. */
  @Post()
  @HttpCode(200)
  run(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<ImportResult> {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "가져오기는 query를 받지 않습니다.");
    return this.importer.run(auth.userId, auth.deviceId, body);
  }
}
