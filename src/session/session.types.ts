export type SessionStatus = "ACTIVE" | "INTERRUPTED" | "COMPLETED" | "ABANDONED";
export interface Session {
  id: string;
  provider: string;
  agent: string;
  providerSessionId: string;
  sessionName: string | null;
  model: string | null;
  workingDirectory: string;
  status: SessionStatus;
  summary: string;
  parentSessionId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}
export interface SessionUpdate {
  id: string; sessionId: string; sequence: number; type: "START" | "PROGRESS" | "END";
  summary: string; createdAt: string;
}
export interface NewSession {
  provider: string; agent: string; sessionId: string; sessionName?: string;
  model?: string; cwd?: string; summary: string;
}
export interface Filters { status?: string; provider?: string; agent?: string; cwd?: string; q?: string; limit?: unknown; offset?: unknown }
export type Page = { limit: number; offset: number; total: number };
export function brief(s: Session) {
  return { id: s.id, provider: s.provider, providerSessionId: s.providerSessionId,
    sessionName: s.sessionName, status: s.status, summary: s.summary };
}
