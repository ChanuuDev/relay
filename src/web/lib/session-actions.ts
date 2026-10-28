import type { Session, SessionAction, SessionStatus } from "../../session/session.types";

export type ActionResult = { schemaVersion: number; session: Session; deleted?: boolean; detached?: number };

/** 알림 문구에 들어갈 상태 이름. 받침에 따라 조사가 달라 통째로 둔다. */
export const STATUS_TO: Record<SessionStatus, string> = { working: "작업 중으로", blocked: "막힘으로", handoff: "인계 대기로", done: "완료로" };

/** 목록에서 고른 정리를 서버에 보낸다. 서버에 닿지 못하거나 거절되면 그 까닭을 담은 Error를 던진다. */
export async function sendAction(id: string, action: SessionAction): Promise<ActionResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("Relay 서버가 응답하지 않습니다", { cause: error });
    throw new Error("Relay 서버에 연결할 수 없습니다", { cause: error });
  }
  const data = await response.json().catch(() => null) as (ActionResult & { error?: { message?: string } }) | null;
  if (!response.ok || !data) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  return data;
}
