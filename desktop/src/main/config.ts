import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesktopConfig, Mode, RelayConfig, RemoteConfig } from "../shared/types";

/** relay.exe와 같은 규칙: RELAY_DATA_DIR → ~/.relay. 그 안의 config.json을 둘이 함께 읽는다. */
export function dataDirectory(): string {
  return process.env.RELAY_DATA_DIR?.trim() || path.join(os.homedir(), ".relay");
}

export const DEFAULT_PORT = 7474;
const DEFAULT_DESKTOP: DesktopConfig = { autoLaunch: true, closeToTray: true };

export function readConfig(): RelayConfig {
  const file = path.join(dataDirectory(), "config.json");
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
  } catch { /* 없거나 깨진 설정은 기본값으로 시작한다. */ }
  const port = typeof raw.webPort === "number" && Number.isInteger(raw.webPort) && raw.webPort >= 1 && raw.webPort <= 65535 ? raw.webPort : DEFAULT_PORT;
  const retention = typeof raw.retentionDays === "number" && Number.isInteger(raw.retentionDays) && raw.retentionDays >= 0 ? raw.retentionDays : 30;
  const mode: Mode | undefined = raw.mode === "local" || raw.mode === "remote" ? raw.mode : undefined;
  const remote = readRemote(raw.remote);
  const desktop = readDesktop(raw.desktop);
  return { schemaVersion: 2, webPort: port, retentionDays: retention, ...(mode ? { mode } : {}), ...(remote ? { remote } : {}), desktop };
}

function readRemote(value: unknown): RemoteConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.url !== "string" || typeof r.token !== "string") return undefined;
  return { url: r.url, token: r.token, deviceId: typeof r.deviceId === "string" ? r.deviceId : null, deviceName: typeof r.deviceName === "string" ? r.deviceName : os.hostname() };
}

function readDesktop(value: unknown): DesktopConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_DESKTOP };
  const d = value as Record<string, unknown>;
  return { keepServerRunning: d.keepServerRunning === true, autoLaunch: typeof d.autoLaunch === "boolean" ? d.autoLaunch : DEFAULT_DESKTOP.autoLaunch,
    closeToTray: typeof d.closeToTray === "boolean" ? d.closeToTray : DEFAULT_DESKTOP.closeToTray };
}

/** 아는 키만 쓴다(relay.exe가 모르는 키를 거절하므로). 임시 파일에 쓴 뒤 바꿔 넣어 깨진 파일을 남기지 않는다. */
export function writeConfig(config: RelayConfig): RelayConfig {
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "config.json");
  const body: Record<string, unknown> = { schemaVersion: 2, webHost: "127.0.0.1", webPort: config.webPort, retentionDays: config.retentionDays };
  if (config.mode) body.mode = config.mode;
  if (config.mode === "remote" && config.remote) body.remote = { url: config.remote.url, token: config.remote.token, deviceId: config.remote.deviceId, deviceName: config.remote.deviceName };
  body.desktop = config.desktop ?? { ...DEFAULT_DESKTOP };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  return readConfig();
}

/** 화면이 입력한 주소를 저장 모양으로: 스킴이 없으면 https, 끝 / 제거, http는 루프백에만 허용. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("서버 주소를 입력하세요.");
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new Error("서버 주소 형식이 올바르지 않습니다."); }
  if (url.protocol !== "https:" && !(process.env.RELAY_ALLOW_HTTP === "1" && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("원격 서버는 https:// 주소만 쓸 수 있습니다.");
  }
  if (url.search || url.hash || url.username || url.password) throw new Error("주소에는 호스트와 경로만 넣으세요.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function defaultDeviceName(): string {
  return os.hostname() || "내 PC";
}
