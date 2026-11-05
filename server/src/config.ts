import { RelayError, integer } from "@relay/core";

export interface ServerConfig {
  /** PostgreSQL 연결 문자열. 테스트는 비워 두고 PGlite를 쓴다. */
  databaseUrl: string | null;
  port: number;
  retentionDays: number;
  /** 원격 파일 폴더. 없거나 비어 있으면 파일 API를 끈다. */
  filesRoot: string | null;
  /** 빌드 식별자(컨테이너 빌드 때 git 짧은 해시). */
  build: string;
  /** 부트스트랩 때 만들 기본 사용자 이름. */
  bootstrapUser: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  let port: number, retentionDays: number;
  try { port = integer(env.PORT, "PORT", 3000, 1, 65535); }
  catch { throw new RelayError("INVALID_CONFIG", "PORT는 1~65535 정수여야 합니다."); }
  try { retentionDays = integer(env.RELAY_RETENTION_DAYS, "RELAY_RETENTION_DAYS", 30, 0, 3650); }
  catch { throw new RelayError("INVALID_CONFIG", "RELAY_RETENTION_DAYS는 0~3650 정수여야 합니다. 0은 자동 삭제를 하지 않습니다."); }
  const level = env.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(level)) throw new RelayError("INVALID_CONFIG", "LOG_LEVEL은 debug|info|warn|error 중 하나입니다.");
  return {
    databaseUrl: env.DATABASE_URL?.trim() || null,
    port, retentionDays,
    filesRoot: env.RELAY_FILES_ROOT?.trim() || null,
    build: (env.RELAY_BUILD?.trim() || "dev").replace(/[^0-9A-Za-z._-]/g, "").slice(0, 40) || "dev",
    bootstrapUser: env.RELAY_BOOTSTRAP_USER?.trim() || "relay",
    logLevel: level as ServerConfig["logLevel"],
  };
}
