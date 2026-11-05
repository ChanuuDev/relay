import { Controller, Get, Inject, Query } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { API_VERSION, RelayError, type RemoteHealth } from "@relay/core";
import { Public } from "../common/decorators.js";
import { CONFIG } from "../app.tokens.js";
import type { ServerConfig } from "../config.js";
import { DB, type Db } from "../db/database.js";
import { FilesService } from "../files/files.service.js";
import { APP_VERSION } from "../version.js";

@Controller("api/v1/health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: ServerConfig, private readonly files: FilesService) {}

  /** 인증 없이 서버의 정체·판·DB 상태·시각을 알린다. 저장소 경로 같은 내부 정보는 내지 않는다. */
  @Public()
  @Get()
  async health(@Query() query: Record<string, unknown>): Promise<RemoteHealth> {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "health는 query를 받지 않습니다.");
    try { await this.db.execute(sql`SELECT 1`); }
    catch { throw new RelayError("STORAGE_ERROR", "저장소에 접근할 수 없습니다.", 5, 503); }
    return { schemaVersion: 1, status: "ok", kind: "relay-remote", appVersion: APP_VERSION, apiVersion: API_VERSION,
      build: this.config.build, db: "ok", time: new Date().toISOString(), files: this.files.enabled };
  }
}
