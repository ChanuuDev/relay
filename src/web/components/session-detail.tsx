import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, Copy, Folder, GitBranch, Hash, Terminal } from "lucide-react";
import type { Session } from "../../session/session.types";
import type { BriefSession, DetailData, HistoryData, ListData, QueryResult } from "../lib/queries";
import { listLocation } from "../lib/store";
import { useUI, type DetailTab } from "../lib/store";
import { projectName, timestamp } from "../lib/format";
import { sessionCommand, sessionContext } from "../lib/session-context";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Separator } from "./ui/separator";
import { CopyButton, ErrorNotice, Loading, NavLink, Pager, SessionLink } from "./session-common";

export function SessionDetail({ detail, updates, children, storeDirectory, copy }: {
  detail: QueryResult<DetailData>; updates: QueryResult<HistoryData>; children: QueryResult<ListData<BriefSession>>;
  storeDirectory?: string; copy: (value: string) => void;
}) {
  const tab = useUI((state) => state.tab);
  const setTab = useUI((state) => state.setTab);
  const shell = useUI((state) => state.shell);
  const setShell = useUI((state) => state.setShell);
  const s = detail.data?.session;
  return <aside className="detail-panel" aria-label="세션 상세" tabIndex={-1}>
    <div className="detail-topline"><span className="eyebrow">SESSION DETAILS</span><NavLink href={listLocation()} className="close-detail" aria-label="목록으로 돌아가기"><ArrowLeft /> 목록으로</NavLink></div>
    <ErrorNotice id="detail-error" error={detail.error} />
    {detail.isPending ? <Loading /> : s ? <>
      <header className="detail-header"><div className="flex items-center gap-2"><span className="muted">{s.agent}</span></div>
        <h2>{s.sessionName ?? "이름 없는 세션"}</h2><p className="detail-project"><Folder />{projectName(s.workingDirectory)}</p></header>
      <div className="detail-actions"><Button onClick={() => copy(sessionContext(s, { shell, storeDirectory, origin: location.origin }))}><Copy data-icon="inline-start" />세션 컨텍스트 복사</Button>
        <Button variant="outline" disabled={!storeDirectory} onClick={() => copy(sessionCommand(s, storeDirectory!, shell))}><Terminal data-icon="inline-start" />조회 명령 복사</Button></div>
      <p className="context-copy-hint">에이전트·경로·작업 시각·최근 요약을 함께 복사합니다.</p>
      <div className="shell-select"><label htmlFor="command-shell">조회 명령 셸</label><NativeSelect id="command-shell" size="sm" value={shell} onChange={(event) => setShell(event.target.value as typeof shell)}>
        <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption></NativeSelect></div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
        <TabsList variant="line" className="detail-tabs"><TabsTrigger value="overview">개요</TabsTrigger><TabsTrigger value="history">기록 이력 <span>{updates.data?.page.total ?? "—"}</span></TabsTrigger>
          <TabsTrigger value="connections">세션 연결 <span>{children.data ? children.data.page.total + (detail.data?.parentSession ? 1 : 0) : "—"}</span></TabsTrigger></TabsList>
        <TabsContent value="overview"><div className="detail-section"><h3>최근 작업 요약</h3><div className="summary">{s.summary}</div>
          <p className="hint">작업을 이어가기 전, 실제 프로젝트 파일도 확인하세요.</p></div><Separator /><SessionMetadata session={s} copy={copy} /></TabsContent>
        <TabsContent value="history"><div className="detail-section"><div className="section-title"><h3>기록 이력</h3><span className="muted">최신 기록부터</span></div>
          <ErrorNotice id="updates-error" error={updates.error} /><div id="updates-content">{updates.isPending ? <Loading /> : updates.data ? <>
            <ol className="timeline">{updates.data.items.map((update) => <li key={update.id} data-testid="history-entry"><span className="timeline-dot" /><div className="timeline-meta"><span>#{update.sequence}</span><time title={update.createdAt}>{timestamp(update.createdAt)}</time></div><p>{update.summary}</p></li>)}</ol>
            {!updates.data.items.length && <p className="muted">현재 페이지에 이력이 없습니다.</p>}<Pager page={updates.data.page} queryKey="historyOffset" /></> : null}</div></div></TabsContent>
        <TabsContent value="connections"><div className="detail-section"><h3><GitBranch />작업의 연결</h3><p className="hint">이전 맥락에서 다음 작업까지, 세션의 흐름을 확인하세요.</p>
          <div className="relation-section"><span className="eyebrow">이전 세션</span>{detail.data?.parentSession ? <Relation session={detail.data.parentSession} /> : <p className="muted">최초 세션 · 이전 연결 없음</p>}</div>
          <div className="current-session"><GitBranch /><div><strong>{s.sessionName ?? "이름 없는 세션"}</strong><span>현재 세션</span></div></div>
          <div className="relation-section"><span className="eyebrow">이어받은 세션</span><ErrorNotice id="children-error" error={children.error} /><div id="children-content">{children.isPending ? <Loading /> : children.data ? <>
            {children.data.items.length ? <ul className="relations">{children.data.items.map((child) => <li key={child.id}><Relation session={child} /></li>)}</ul> : <p className="muted">이어받은 세션 없음</p>}
            <Pager page={children.data.page} queryKey="childrenOffset" /></> : null}</div></div></div></TabsContent>
      </Tabs>
    </> : <p className="hint">목록에서 다른 세션을 선택하거나 새로고침해 주세요.</p>}
  </aside>;
}

function Relation({ session }: { session: BriefSession }) {
  return <div className="relation"><div className="relation-heading"><SessionLink session={session} /><ArrowUpRight /></div><div className="flex items-center gap-2"><span className="muted">{session.provider}</span></div><p>{session.summary}</p></div>;
}

function SessionMetadata({ session: s, copy }: { session: Session; copy: (value: string) => void }) {
  return <div className="detail-section"><h3>세션 정보</h3><div className="identity-grid"><div><span>Provider / Agent</span><strong>{s.provider} / {s.agent}</strong></div><div><span>모델</span><strong>{s.model ?? "미기록"}</strong></div></div>
    <div className="path-block"><span><Folder />작업 경로</span><code>{s.workingDirectory}</code></div>
    <div className="time-grid"><div><CalendarDays /><span>최초 기록</span><time title={s.createdAt}>{timestamp(s.createdAt)}</time></div><div><Clock3 /><span>마지막 갱신</span><time title={s.updatedAt}>{timestamp(s.updatedAt)}</time></div></div>
    <details className="technical-details"><summary><Hash />세션 식별자</summary><dl><dt>Provider Session ID</dt><dd>{s.providerSessionId}</dd></dl><CopyButton value={s.providerSessionId} copy={copy} label="Session ID만 복사" /><dl><dt>Relay 내부 ID</dt><dd>{s.id}</dd></dl></details></div>;
}
