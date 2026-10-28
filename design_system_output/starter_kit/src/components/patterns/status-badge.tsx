import { Badge } from "@/components/ui/badge";

export type WorkStatus = "working" | "blocked" | "handoff" | "done";
const LABELS: Record<WorkStatus, string> = { working: "작업 중", blocked: "막힘", handoff: "인계 대기", done: "완료" };

/** 상태 배지: 상태색 글자 + 같은 색 45% 테두리, 10px/600. 강조색을 늘리지 않고 상태를 구분한다. */
export function StatusBadge({ status }: { status: WorkStatus }) {
  return <Badge variant="outline" className="status-badge" data-status={status}>{LABELS[status]}</Badge>;
}

/** 경고성 표시(응답 없음 등): 점선 테두리 */
export function StaleBadge({ children = "응답 없음" }: { children?: string }) {
  return <Badge variant="outline" className="stale-badge">{children}</Badge>;
}

/** 조용한 표시(종료됨 등): 회색 글자 */
export function QuietBadge({ children }: { children: string }) {
  return <Badge variant="outline" className="quiet-badge">{children}</Badge>;
}
