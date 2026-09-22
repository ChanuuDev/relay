import { useCallback, useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, Copy, Folder, GitBranch, Hash, LogOut, Terminal } from "lucide-react";
import type { Session } from "../../session/session.types";
import type { BriefSession, DetailData, HistoryData, ListData, QueryResult } from "../lib/queries";
import { listLocation } from "../lib/store";
import { useUI, type DetailTab } from "../lib/store";
import { endLabel, projectName, timestamp } from "../lib/format";
import { captureMove, enter, playMove, pulse, staggerIn } from "../lib/motion";
import { sessionCommand, sessionContext } from "../lib/session-context";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Separator } from "./ui/separator";
import { FlipList } from "./transitions";
import { CopyButton, ErrorNotice, Loading, NavLink, Pager, SessionLink } from "./session-common";

const ACTIVE_TRIGGER = '[data-slot="tabs-trigger"][data-state="active"]';
const ACTIVE_CONTENT = '[data-slot="tabs-content"][data-state="active"]';
const HEADER = ".detail-header > *, .detail-actions";

export function SessionDetail({ detail, updates, children, storeDirectory, copy }: {
  detail: QueryResult<DetailData>; updates: QueryResult<HistoryData>; children: QueryResult<ListData<BriefSession>>;
  storeDirectory?: string; copy: (value: string) => void;
}) {
  const tab = useUI((state) => state.tab);
  const setTab = useUI((state) => state.setTab);
  const shell = useUI((state) => state.shell);
  const setShell = useUI((state) => state.setShell);
  const s = detail.data?.session;
  const panelRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const was = useRef({ tab, summary: s?.summary, pending: detail.isPending });

  /** 세그먼트 컨트롤의 활성 배경(thumb)을 활성 탭 위에 놓는다. */
  const place = useCallback(() => {
    const root = tabsRef.current;
    const thumb = root?.querySelector<HTMLElement>(".tabs-thumb");
    const active = root?.querySelector<HTMLElement>(ACTIVE_TRIGGER);
    if (!thumb || !active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.setAttribute("data-ready", "");
  }, []);

  // C2 탭 전환: thumb은 Flip으로 미끄러지고 콘텐츠는 아래에서 올라온다.
  useGSAP(() => {
    const root = tabsRef.current;
    if (!root) return;
    const previous = was.current.tab;
    was.current.tab = tab;
    const moved = previous !== tab;
    const state = moved ? captureMove(root.querySelector<HTMLElement>(".tabs-thumb")) : null;
    place();
    if (state) playMove(state, "fast");
    if (moved) enter(root.querySelector(ACTIVE_CONTENT), { y: 6, duration: "fast" });
  }, { dependencies: [tab] });

  // 창 폭이 바뀌면 thumb 위치를 애니메이션 없이 다시 맞춘다.
  useEffect(() => {
    const list = tabsRef.current?.querySelector<HTMLElement>('[data-slot="tabs-list"]');
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(list);
    return () => observer.disconnect();
  }, [place]);

  // C3 요약이 폴링으로 바뀌면 한 번 밝아진다. C5 스켈레톤이 걷히면 머리글이 차례로 들어온다.
  useGSAP(() => {
    const previous = was.current.summary;
    was.current.summary = s?.summary;
    if (previous !== undefined && s?.summary !== undefined && previous !== s.summary) pulse(summaryRef.current);
  }, { dependencies: [s?.summary] });
  useGSAP(() => {
    const previous = was.current.pending;
    was.current.pending = detail.isPending;
    if (previous && !detail.isPending) staggerIn(panelRef.current?.querySelectorAll(HEADER) ?? [], { y: 6, duration: "fast", step: "tight" });
  }, { dependencies: [detail.isPending] });

  return <aside className="detail-panel" aria-label="세션 상세" tabIndex={-1} ref={panelRef}>
    <div className="detail-topline"><NavLink href={listLocation()} className="close-detail" aria-label="목록으로 돌아가기"><ArrowLeft />목록으로</NavLink>
      {s && <><span className="detail-updated">최근 갱신 {timestamp(s.updatedAt)}</span>
        <span className="detail-source"><span className="muted">{s.agent}</span>{s.endedAt && <Badge variant="outline" className="ended-badge">종료</Badge>}</span></>}</div>
    <ErrorNotice id="detail-error" error={detail.error} />
    {detail.isPending ? <Loading /> : s ? <>
      <header className="detail-header">
        <h2>{s.sessionName ?? "이름 없는 세션"}</h2><p className="detail-project"><Folder />{projectName(s.workingDirectory)}</p></header>
      <div className="detail-actions"><Button size="sm" onClick={() => copy(sessionContext(s, { shell, storeDirectory }))}><Copy data-icon="inline-start" />세션 컨텍스트 복사</Button>
        <Button size="sm" variant="outline" onClick={() => copy(sessionCommand(s, storeDirectory, shell))}><Terminal data-icon="inline-start" />조회 명령 복사</Button></div>
      <p className="context-copy-hint">붙여넣는 순간 대화가 먼저 전송되지 않도록, 이 기록을 읽는 조회 명령만 줄바꿈 없이 한 줄로 복사합니다.</p>
      <div className="shell-select"><label htmlFor="command-shell">조회 명령 셸</label><NativeSelect id="command-shell" size="sm" value={shell} onChange={(event) => setShell(event.target.value as typeof shell)}>
        <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption></NativeSelect></div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} ref={tabsRef}>
        <TabsList className="detail-tabs"><span className="tabs-thumb" aria-hidden="true" />
          <TabsTrigger value="overview">개요</TabsTrigger><TabsTrigger value="history">기록 이력 <span>{updates.data?.page.total ?? "—"}</span></TabsTrigger>
          <TabsTrigger value="connections">세션 연결 <span>{children.data ? children.data.page.total + (detail.data?.parentSession ? 1 : 0) : "—"}</span></TabsTrigger></TabsList>
        <TabsContent value="overview"><div className="detail-section"><h3>최근 작업 요약</h3><div className="summary" ref={summaryRef}>{s.summary}</div>
          <p className="hint">작업을 이어가기 전, 실제 프로젝트 파일도 확인하세요.</p></div><Separator /><SessionMetadata session={s} copy={copy} /></TabsContent>
        <TabsContent value="history"><div className="detail-section"><div className="section-title"><h3>기록 이력</h3><span className="muted">최신 기록부터</span></div>
          <ErrorNotice id="updates-error" error={updates.error} /><div id="updates-content">{updates.isPending ? <Loading /> : updates.data ? <>
            <FlipList className="timeline" items={updates.data.items} listKey={String(updates.data.page.offset)}>{updates.data.items.map((update) => <li key={update.id} data-flip-id={update.id} data-testid="history-entry"><span className="timeline-dot" /><div className="timeline-meta"><span>#{update.sequence}</span><time title={update.createdAt}>{timestamp(update.createdAt)}</time></div><p>{update.summary}</p></li>)}</FlipList>
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
  // C4 세션 식별자 펼침.
  const reveal = (event: { currentTarget: HTMLDetailsElement }) => {
    if (event.currentTarget.open) staggerIn(event.currentTarget.querySelectorAll(":scope > *:not(summary)"), { y: 4, duration: "fast", step: "tight" });
  };
  return <div className="detail-section"><h3>세션 정보</h3><div className="identity-grid"><div><span>Provider / Agent</span><strong>{s.provider} / {s.agent}</strong></div><div><span>모델</span><strong>{s.model ?? "미기록"}</strong></div></div>
    <div className="path-block"><span><Folder />작업 경로</span><code>{s.workingDirectory}</code></div>
    <div className="time-grid"><div><CalendarDays /><span>최초 기록</span><time title={s.createdAt}>{timestamp(s.createdAt)}</time></div><div><Clock3 /><span>마지막 갱신</span><time title={s.updatedAt}>{timestamp(s.updatedAt)}</time></div><div><LogOut /><span>세션 종료</span><time title={s.endedAt ?? "종료 기록 없음"} data-testid="session-end">{endLabel(s)}</time></div></div>
    <details className="technical-details" onToggle={reveal}><summary><Hash />세션 식별자</summary><dl><dt>Agent Session ID</dt><dd>{s.providerSessionId}</dd></dl><CopyButton value={s.providerSessionId} copy={copy} label="Agent Session ID만 복사" /><dl><dt>Relay 내부 ID</dt><dd>{s.id}</dd></dl></details></div>;
}
