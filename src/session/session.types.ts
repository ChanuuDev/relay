/** The last work state an agent declared; null while none is on record. Not the host process state. */
export const SESSION_STATUSES = ["working", "blocked", "handoff", "done"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const STATUS_LABELS: Record<SessionStatus, string> = { working: "작업 중", blocked: "막힘", handoff: "인계 대기", done: "완료" };

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
export interface Filters { provider?: string; agent?: string; cwd?: string; q?: string; status?: string; pinned?: unknown; limit?: unknown; offset?: unknown }
export type Page = { limit: number; offset: number; total: number };
/** A session's place in its chain: ancestors first, then the session, then everything that took over from it. */
export interface ChainNode {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null; summary: string;
  status: SessionStatus | null; pinned: boolean; createdAt: string; updatedAt: string; endedAt: string | null;
  parentSessionId: string | null; depth: number; current: boolean;
}
export function brief(s: Session) {
  return { id: s.id, provider: s.provider, agent: s.agent, providerSessionId: s.providerSessionId,
    sessionName: s.sessionName, summary: s.summary, status: s.status };
}
