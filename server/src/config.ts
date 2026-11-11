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
  /** 브라우저 모드 화면이 다른 출처에서 이 서버를 부를 때 허용할 출처(`https://host`). 비우면 CORS를 열지 않는다. */
  corsOrigins?: string[];
  /** 공휴일 공공 API(한국천문연구원 특일 정보) 인증키(HOLIDAY_API_KEY). 없으면 매일 00시 동기화를 하지 않고 계산만 쓴다. */
  holidayApiKey?: string | null;
  /** 공휴일 API 주소(HOLIDAY_API_URL). 시험용이며 기본은 공공데이터포털 주소다. */
  holidayApiUrl?: string | null;
}

/** RELAY_CORS_ORIGINS(쉼표로 구분). 출처 형식만 받고, http는 이 컴퓨터만 허용한다. */
export function parseCorsOrigins(value: string | undefined): string[] {
  const origins: string[] = [];
  for (const item of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    let url: URL;
    try { url = new URL(item); } catch { throw new RelayError("INVALID_CONFIG", "RELAY_CORS_ORIGINS에는 https://host 형식의 출처만 쉼표로 적습니다."); }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.origin !== item.replace(/\/$/, "") || !(url.protocol === "https:" || (url.protocol === "http:" && local))) {
      throw new RelayError("INVALID_CONFIG", "RELAY_CORS_ORIGINS에는 https://host 형식의 출처만 쉼표로 적습니다.");
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
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
    corsOrigins: parseCorsOrigins(env.RELAY_CORS_ORIGINS),
    holidayApiKey: env.HOLIDAY_API_KEY?.trim() || null,
    holidayApiUrl: env.HOLIDAY_API_URL?.trim() || null,
  };
}
