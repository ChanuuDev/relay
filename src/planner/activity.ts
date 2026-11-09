import type { Database } from "bun:sqlite";
import { activityWindow, bucketActivity, daySessions, type ActivityDayQuery, type ActivityDayResult, type ActivityQuery, type ActivityResult } from "@relay/core";
import { storageError } from "../errors";

export { parseActivityDayQuery, parseActivityQuery } from "@relay/core";

/** 이 컴퓨터의 시간대. 화면은 늘 자기 시간대(tz)를 보내므로 query가 없을 때만 쓴다. */
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const iso = (ms: number) => new Date(ms).toISOString();

/** 잔디: 기간 안의 기록을 날마다 센다. 세션이 보관 기간으로 지워져도 activity_log에 남은 기록은 센다. */
export function sessionActivity(db: Database, query: ActivityQuery): ActivityResult {
  const { start, end } = activityWindow(query.from, query.to);
  try {
    const rows = (query.provider
      ? db.query("SELECT created_at, session_id FROM activity_log WHERE created_at >= ? AND created_at < ? AND provider = ?").all(iso(start), iso(end), query.provider)
      : db.query("SELECT created_at, session_id FROM activity_log WHERE created_at >= ? AND created_at < ?").all(iso(start), iso(end))) as Array<{ created_at: string; session_id: string }>;
    return bucketActivity(rows.map((row) => ({ at: Date.parse(row.created_at), sessionId: row.session_id })).filter((row) => Number.isFinite(row.at)), query);
  } catch (error) { throw storageError(error); }
}

/** 그날 기록한 세션. 지워진 세션은 Provider·에이전트만 남는다. */
export function sessionActivityDay(db: Database, query: ActivityDayQuery): ActivityDayResult {
  const { start, end } = activityWindow(query.date, query.date);
  try {
    const rows = db.query(`SELECT a.created_at, a.session_id, a.provider, a.agent, s.provider_session_id, s.session_name, s.working_directory, s.status
      FROM activity_log a LEFT JOIN sessions s ON s.id = a.session_id
      WHERE a.created_at >= ? AND a.created_at < ?${query.provider ? " AND a.provider = ?" : ""}`)
      .all(...(query.provider ? [iso(start), iso(end), query.provider] : [iso(start), iso(end)])) as Array<{ created_at: string; session_id: string; provider: string;
        agent: string; provider_session_id: string | null; session_name: string | null; working_directory: string | null; status: string | null }>;
    return daySessions(rows.map((row) => ({ at: Date.parse(row.created_at), sessionId: row.session_id, provider: row.provider, agent: row.agent,
      providerSessionId: row.provider_session_id, sessionName: row.session_name, workingDirectory: row.working_directory, status: row.status }))
      .filter((row) => Number.isFinite(row.at)), query);
  } catch (error) { throw storageError(error); }
}
