import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./app.js";
import { AuthService } from "./auth/auth.service.js";
import { loadConfig } from "./config.js";
import { openPostgres } from "./db/database.js";
import { APP_VERSION } from "./version.js";

const logger = new Logger("relay");
const config = loadConfig();
if (!config.databaseUrl) { logger.error("DATABASE_URL이 없습니다."); process.exit(2); }

const { db, close } = await openPostgres(config.databaseUrl);
const app = await createApp(db, config);
// 첫 실행: 기본 사용자가 없으면 만든다. 토큰은 CLI(`node dist/cli.js token create`)로 만든다.
const user = await app.get(AuthService).bootstrap(config.bootstrapUser);
if (user.created) logger.log(`기본 사용자를 만들었습니다: ${user.name}. 토큰: node dist/cli.js token create --name <기기명>`);
await app.listen(config.port, "0.0.0.0");
logger.log(`Relay 원격 서버 ${APP_VERSION} (build ${config.build}) · 포트 ${config.port}`);

const stop = async () => {
  logger.log("종료 중…");
  try { await app.close(); await close(); } finally { process.exit(0); }
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
