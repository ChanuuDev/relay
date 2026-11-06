import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IdempotencyInterceptor } from "../common/idempotency.interceptor.js";
import { DB, type Db } from "../db/database.js";
import { FilesService } from "../files/files.service.js";
import { NotesService } from "../notes/notes.service.js";
import { SessionsService } from "../sessions/sessions.service.js";

/** 매일 새벽: 보관 기간이 지난 세션, 하루 지난 멱등 키, 30일 지난 휴지통, 30일 넘게 어느 메모도 쓰지 않은 그림을 비운다. 기동 때도 한 번 돈다. */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger("maintenance");
  constructor(@Inject(DB) private readonly db: Db, private readonly sessions: SessionsService, private readonly files: FilesService,
    private readonly notes: NotesService) {}

  onModuleInit() { void this.run("startup"); }

  @Cron("0 30 3 * * *", { timeZone: "Asia/Seoul" })
  nightly() { return this.run("nightly"); }

  async run(reason: string) {
    try {
      const sessions = await this.sessions.expireAll();
      await IdempotencyInterceptor.purge(this.db);
      const trash = await this.files.purgeTrash();
      const images = await this.notes.pruneImages();
      this.logger.log(`${reason}: 보관 기간 지난 세션 ${sessions}건, 휴지통 ${trash}묶음, 쓰지 않는 메모 그림 ${images}장 정리`);
    } catch (error) {
      this.logger.warn(`${reason}: 유지 작업 실패: ${(error as Error).message}`);
    }
  }
}
