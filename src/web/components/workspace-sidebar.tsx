import { ArrowUpRight, GitBranch, Layers, Terminal } from "lucide-react";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { NavLink } from "./session-common";
import type { HealthData } from "../lib/queries";

export function WorkspaceSidebar({ health, connection }: {
  health?: HealthData; connection: "pending" | "online" | "offline";
}) {
  return <aside className="sidebar">
    <NavLink href="/" className="brand" aria-label="Relay 홈"><span className="brand-mark">r<span>↗</span></span><span>relay<span className="brand-sub">CONTEXT WORKSPACE</span></span></NavLink>
    <div className="workspace-label"><span className="workspace-icon"><Terminal /></span><div><strong>로컬 워크스페이스</strong><span>대화를 잇는 작업 기록</span></div></div>
    <p className="nav-label">WORKSPACE</p>
    <nav aria-label="워크스페이스 탐색"><NavLink href="/" className="nav-item selected" aria-current="page"><Layers /><span>세션 기록</span><ArrowUpRight /></NavLink></nav>
    <div className="sidebar-note"><GitBranch /><strong>다음 대화를 위한 기록.</strong><p>무엇을 했는지, 무엇이 남았는지.<br />필요한 맥락을 다음 Agent에게 전달하세요.</p></div>
    <div className="sidebar-footer"><Separator /><div className="flex items-center gap-2"><span className="connection-dot" data-state={connection} /><strong>로컬 저장소</strong><Badge variant="outline">읽기 전용</Badge></div><p id="database-path" title={health?.databasePath}>{health?.databasePath ?? "저장소 확인 중…"}</p><span className="version">RELAY {health?.appVersion ? `v${health.appVersion}` : ""}</span></div>
  </aside>;
}
