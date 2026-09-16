import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { RelayError, storageError } from "./errors";
import { directory, integer } from "./validation";

export interface Config { dataDirectory: string; databasePath: string; webHost: "127.0.0.1"; webPort: number; retentionDays: number }

export const DEFAULT_RETENTION_DAYS = 30;

export function loadConfig(dataDir?: string, port?: string): Config {
  const dataDirectory = directory(dataDir ?? process.env.RELAY_DATA_DIR ?? path.join(homedir(), ".relay"), false);
  // UNC/network databases are not supported. Mapped/synced drives remain an operator constraint.
  if (dataDirectory.startsWith("//")) throw new RelayError("INVALID_CONFIG", "저장소는 로컬 디스크를 사용하세요.");
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(dataDirectory, "config.json"), "utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    raw = parsed;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw new RelayError("INVALID_CONFIG", "config.json을 읽을 수 없거나 JSON 형식이 잘못되었습니다.");
  }
  if (Object.keys(raw).some(k => !["webHost", "webPort", "retentionDays", "schemaVersion"].includes(k)) ||
    (raw.webHost !== undefined && raw.webHost !== "127.0.0.1") ||
    (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) ||
    (raw.webPort !== undefined && typeof raw.webPort !== "number") ||
    (raw.retentionDays !== undefined && typeof raw.retentionDays !== "number")) {
    throw new RelayError("INVALID_CONFIG", "config.json의 키·버전·webHost/webPort/retentionDays 설정을 확인하세요.");
  }
  let configPort: number;
  try { configPort = integer(raw.webPort, "webPort", 7474, 1, 65535); }
  catch { throw new RelayError("INVALID_CONFIG", "config webPort는 1~65535 정수여야 합니다."); }
  let retentionDays: number;
  try { retentionDays = integer(raw.retentionDays, "retentionDays", DEFAULT_RETENTION_DAYS, 0, 3650); }
  catch { throw new RelayError("INVALID_CONFIG", "config retentionDays는 0~3650 정수여야 합니다. 0은 자동 삭제를 하지 않습니다."); }
  return { dataDirectory, databasePath: path.join(dataDirectory, "relay.db"),
    webHost: "127.0.0.1", webPort: integer(port, "port", configPort, 1, 65535), retentionDays };
}

export function ensureDataDirectory(config: Config) {
  try { mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 }); }
  catch (error) { throw storageError(error); }
}
