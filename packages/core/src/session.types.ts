/** The last work state an agent declared; null while none is on record. Not the host process state. */
export const SESSION_STATUSES = ["working", "blocked", "handoff", "done"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const STATUS_LABELS: Record<SessionStatus, string> = { working: "작업 중", blocked: "막힘", handoff: "인계 대기", done: "완료" };
/** The end reason a session closed from the web screen carries, so it reads apart from a host's own close. */
export const WEB_END_REASON = "web";

/** What the repository looked like when the record was last written: enough to find the commit, never the diff. */
export interface GitClue { branch: string | null; commit: string | null; dirty: number; at: string }

/** How often the host compacted this session's context, and when it last did. A compacted session may have lost detail the record never got. */
export interface Compaction { count: number; lastAt: string; trigger: string | null }

export interface Session {
  id: string;
  provider: string;
  agent: string;
  providerSessionId: string;
  sessionName: string | null;
  model: string | null;
  workingDirectory: string;
  summary: string;
  parentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the host closed the session and why; null while no end is on record. */
  endedAt: string | null;
  endReason: string | null;
  status: SessionStatus | null;
  /** A pinned record is exempt from retention and from the end hook's clean-up. */
  pinned: boolean;
  git: GitClue | null;
  compaction: Compaction | null;
  /** 원격 저장소에서 이 기록을 남긴 PC. 로컬 저장소에는 없다. */
  deviceId?: string | null;
}
export interface SessionUpdate {
  id: string; sessionId: string; sequence: number;
  summary: string; status: SessionStatus | null; createdAt: string;
}
export interface NewSession {
  provider: string; agent: string; sessionId: string; sessionName?: string;
  model?: string; cwd?: string; summary: string; status?: string;
}
/** What the web screen does to a record it lists: set the work state by hand, pin, end or take an end back, delete. */
export type SessionAction =
  | { action: "status"; status: SessionStatus }
  | { action: "pin"; pinned: boolean }
  | { action: "end" }
  | { action: "reopen" }
  | { action: "delete"; force: boolean };
export interface Filters { provider?: string; agent?: string; cwd?: string; q?: string; status?: string; pinned?: unknown; limit?: unknown; offset?: unknown; device?: string }
export type Page = { limit: number; offset: number; total: number };
/** A session's place in its chain: ancestors first, then the session, then everything that took over from it. */
export interface ChainNode {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null; summary: string;
  status: SessionStatus | null; pinned: boolean; createdAt: string; updatedAt: string; endedAt: string | null;
  parentSessionId: string | null; depth: number; current: boolean;
}
export type BriefSession = Pick<Session, "id" | "provider" | "agent" | "providerSessionId" | "sessionName" | "summary" | "status">;
export function brief(s: Session): BriefSession {
  return { id: s.id, provider: s.provider, agent: s.agent, providerSessionId: s.providerSessionId,
    sessionName: s.sessionName, summary: s.summary, status: s.status };
}

/** 세션 API 응답 모양. 로컬 Bun 서버와 원격 NestJS 서버가 같은 모양으로 답한다(`SessionService`의 반환값과 같다). */
/** record·continue: 부모에 연결했으면 parentSession이 있다. */
export type SessionResult = { schemaVersion: 1; session: Session; parentSession?: BriefSession };
/** update·compact·models·pin·status·end(화면)·reopen */
export type SessionChanged = { schemaVersion: 1; session: Session };
/** delete: 연결을 끊은 자식 수 */
export type SessionDeleted = { schemaVersion: 1; session: Session; deleted: true; detached: number };
/** end(훅): 훅 자동 기록만 남은 세션은 지워진다 */
export type SessionEnded = { schemaVersion: 1; session: Session; deleted: boolean };
/** 세션 상세: 부모 요약과 자식 첫 페이지 */
export type SessionDetail = { schemaVersion: 1; session: Session; parentSession: BriefSession | null; children: BriefSession[]; childrenPage: Page };
export type HistoryPage = { updates: SessionUpdate[]; updatesPage: Page };
/** show --history, packet, inspect: 상세 + 이력 페이지(+ 흐름) */
export type SessionShown = SessionDetail & Partial<HistoryPage>;
export type SessionPacket = SessionDetail & HistoryPage & { chain: ChainNode[] };
export type SessionLatest = SessionDetail & { scope: { cwd: string | null } };
export type SessionList = { schemaVersion: 1; items: Session[]; page: Page };
export type SessionChain = { schemaVersion: 1; session: Session; items: ChainNode[]; truncated: boolean };
export type SessionChainById = { schemaVersion: 1; sessionId: string; items: ChainNode[]; truncated: boolean };
export type SessionUpdates = { schemaVersion: 1; sessionId: string; items: SessionUpdate[]; page: Page };
export type SessionChildren = { schemaVersion: 1; sessionId: string; items: BriefSession[]; page: Page };
