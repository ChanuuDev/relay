import type { GitClue, SessionAction, SessionStatus } from "./session.types.js";

/** 원격 API의 계약 버전. 화면·CLI는 health의 apiVersion이 이 값 이상인 서버만 쓴다. */
export const API_VERSION = 1;
/** API 경로 접두어. 로컬 서버와 원격 서버가 같다. */
export const API_PREFIX = "/api/v1";

/** 원격 서버 health. 로컬 서버의 health와 달리 저장소 경로는 내지 않는다. */
export interface RemoteHealth {
  schemaVersion: 1;
  status: "ok";
  kind: "relay-remote";
  appVersion: string;
  apiVersion: number;
  build: string;
  db: "ok";
  /** 서버 시각(ISO). 화면이 PC 시각과 비교해 5분 이상 어긋나면 경고한다. */
  time: string;
  /** 원격 파일 폴더를 쓸 수 있는지 */
  files: boolean;
}

/** `POST /api/v1/sessions` — `relay record`와 훅 첫 기록. */
export interface RecordRequest {
  provider: string;
  agent: string;
  sessionId: string;
  sessionName?: string;
  model?: string;
  cwd?: string;
  summary: string;
  status?: string;
  git?: GitClue | null;
}
/** `POST /api/v1/sessions/continue` — `relay continue`. */
export interface ContinueRequest extends RecordRequest {
  parent: { providerSessionId: string; provider?: string };
}
/** `POST /api/v1/sessions/lookup` — Agent Session ID로 세션을 찾는다. */
export interface LookupRequest { providerSessionId: string; provider?: string }
/** `POST /api/v1/sessions/:id/updates` — `relay update`. */
export interface UpdateRequest { summary: string; sessionName?: string; status?: string; git?: GitClue | null }
/** `POST /api/v1/sessions/:id/actions` — 화면의 정리에 훅의 end·compact·models가 더해진다. */
export type RemoteSessionAction =
  | SessionAction
  | { action: "end"; reason?: string }
  | { action: "compact"; trigger?: string }
  | { action: "models"; models: string[] };

/** `POST /api/v1/devices/register` */
export interface DeviceRegisterRequest { name: string; platform?: string }
export interface DeviceInfo { id: string; name: string; platform: string | null; createdAt: string; lastSeenAt: string | null }
export type DeviceRegistered = { schemaVersion: 1; device: DeviceInfo; created: boolean };
export type DeviceList = { schemaVersion: 1; items: DeviceInfo[] };

/** `GET /api/v1/auth/whoami` */
export interface WhoAmI {
  schemaVersion: 1;
  user: { id: string; name: string };
  token: { id: string; name: string; createdAt: string; lastUsedAt: string | null };
}

/** 로컬→원격 이전(`POST /api/v1/import`). id 기준 멱등 upsert. */
export interface ImportSessionRow {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null; model: string | null;
  workingDirectory: string; summary: string; parentSessionId: string | null; createdAt: string; updatedAt: string;
  endedAt: string | null; endReason: string | null; status: SessionStatus | null; pinned: boolean;
  git: GitClue | null; compaction: { count: number; lastAt: string; trigger: string | null } | null;
}
export interface ImportUpdateRow { id: string; sessionId: string; sequence: number; summary: string; status: SessionStatus | null; createdAt: string }
export interface ImportNoteRow {
  id: string; kind: "folder" | "note"; parentId: string | null; name: string; title: string; body: string;
  createdAt: number; updatedAt: number; revision: number; position: number | null;
}
export interface ImportCalculationRow { id: string; expression: string; result: string; createdAt: number }
export interface ImportRequest {
  sessions?: ImportSessionRow[];
  updates?: ImportUpdateRow[];
  notes?: ImportNoteRow[];
  calculations?: ImportCalculationRow[];
}
export interface ImportResult {
  schemaVersion: 1;
  sessions: { added: number; updated: number; kept: number };
  updates: { added: number; kept: number };
  notes: { added: number; updated: number; kept: number };
  calculations: { added: number; kept: number };
}

/** 헤더 이름. */
export const DEVICE_HEADER = "x-relay-device";
export const IDEMPOTENCY_HEADER = "idempotency-key";
