import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { RelayError, storageError } from "./errors";
import { directory, integer } from "./validation";

export interface RemoteConfig { url: string; token: string; deviceId?: string | null; deviceName?: string }
export interface Config { dataDirectory: string; databasePath: string; webHost: "127.0.0.1"; webPort: number; retentionDays: number; mode?: "local" | "remote"; remote?: RemoteConfig }

export function remoteUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new RelayError("INVALID_CONFIG", "원격 서버 주소가 필요합니다.");
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { throw new RelayError("INVALID_CONFIG", "원격 서버 주소 형식을 확인하세요."); }
  if ((url.protocol !== "https:" && !(process.env.RELAY_ALLOW_HTTP === "1" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw new RelayError("INVALID_CONFIG", "원격 서버는 인증 정보·query가 없는 HTTPS 주소여야 합니다.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

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
  if (Object.keys(raw).some(k => !["webHost", "webPort", "retentionDays", "schemaVersion", "mode", "remote", "desktop"].includes(k)) ||
    (raw.webHost !== undefined && raw.webHost !== "127.0.0.1") ||
    (raw.schemaVersion !== undefined && raw.schemaVersion !== 1 && raw.schemaVersion !== 2) ||
    (raw.mode !== undefined && raw.mode !== "local" && raw.mode !== "remote") ||
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
  let remote: RemoteConfig | undefined;
  if (raw.mode === "remote") {
    const value = raw.remote as Partial<RemoteConfig> | undefined;
    if (!value || typeof value.token !== "string" || !value.token.trim() || /[\r\n]/.test(value.token) ||
      (value.deviceId != null && typeof value.deviceId !== "string")) throw new RelayError("INVALID_CONFIG", "원격 서버 토큰·기기 설정을 확인하세요.");
    remote = { url: remoteUrl(value.url), token: value.token.trim(), deviceId: value.deviceId, deviceName: value.deviceName };
  }
  return { dataDirectory, databasePath: path.join(dataDirectory, "relay.db"),
    webHost: "127.0.0.1", webPort: integer(port, "port", configPort, 1, 65535), retentionDays,
    ...(raw.mode ? { mode: raw.mode as "local" | "remote" } : {}), ...(remote ? { remote } : {}) };
}

export function ensureDataDirectory(config: Config) {
  try { mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 }); }
  catch (error) { throw storageError(error); }
}
