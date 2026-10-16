import { STATUS_LABELS, type GitClue, type Session, type SessionStatus } from "../../session/session.types";

export const projectName = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || path;
export function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "미기록";
}
/** When and why the host closed the session; a session without an end on record says so. */
export function endLabel(session: Pick<Session, "endedAt" | "endReason">) {
  return session.endedAt ? `${timestamp(session.endedAt)}${session.endReason ? ` · ${session.endReason}` : ""}` : "기록 없음";
}
export function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`;
  return timestamp(value);
}
export const quote = (value: string, shell: "powershell" | "bash") =>
  "'" + (shell === "powershell" ? value.replaceAll("'", "''") : value.replaceAll("'", "'\"'\"'")) + "'";

/** The declared work state in words; a session that declared none reads as such. */
export const statusLabel = (status: SessionStatus | null) => status ? STATUS_LABELS[status] : "미기록";

/** Hours without an update after which a session that has neither finished nor closed is probably dead. */
export const STALE_HOURS = 6;

/**
 * No end on record and no new context for a long while: the host was most likely closed without its
 * end hook. A session declared handed over or done is not waiting on anyone, so it never reads as stale.
 */
export function isStale(session: Pick<Session, "endedAt" | "status" | "updatedAt">, now = Date.now()) {
  if (session.endedAt || session.status === "handoff" || session.status === "done") return false;
  return now - new Date(session.updatedAt).getTime() > STALE_HOURS * 3_600_000;
}

/** The working tree clue in one phrase: branch, commit and how many paths differed when it was read. */
export function gitLabel(git: GitClue | null) {
  if (!git) return "기록 없음";
  const where = [git.branch ?? "(브랜치 없음)", git.commit ? `@ ${git.commit}` : ""].filter(Boolean).join(" ");
  return `${where} · ${git.dirty ? `수정 ${git.dirty}건` : "깨끗함"}`;
}
