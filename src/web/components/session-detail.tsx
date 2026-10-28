import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useGSAP } from "@gsap/react";
import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, Copy, FileText, Folder, GitBranch, GitCommitHorizontal, Hash, LogOut, Pin, RotateCcw, Terminal } from "lucide-react";
import type { ChainNode, Session } from "../../session/session.types";
import type { BriefSession, ChainData, DetailData, HistoryData, ListData, QueryResult } from "../lib/queries";
import { listLocation } from "../lib/store";
import { useUI, type DetailTab } from "../lib/store";
import { compactionLabel, endLabel, gitLabel, isStale, projectName, STALE_HOURS, statusLabel, timestamp } from "../lib/format";
import { captureMove, enter, playMove, pulse, staggerIn } from "../lib/motion";
import { handoffMarkdown } from "../lib/handoff";
import { resumeCommand } from "../lib/resume-command";
import { sessionCommand, sessionContext } from "../lib/session-context";
import { cn } from "../lib/utils";
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

/** The declared work state as a small badge; nothing when none is on record. */
export function StatusBadge({ status, className }: { status: Session["status"]; className?: string }) {
  return status ? <Badge variant="outline" className={cn("status-badge", className)} data-status={status}>{statusLabel(status)}</Badge> : null;
}

/** Marks the session as pinned, exempt from clean-up. */
export function PinMark({ pinned }: { pinned: boolean }) {
  return pinned ? <Pin className="pin-mark" aria-label="고정됨" role="img" /> : null;
}

/** A session that neither closed nor finished and has not been updated for hours. */
export function StaleBadge({ session }: { session: Pick<Session, "endedAt" | "status" | "updatedAt"> }) {
  return isStale(session) ? <Badge variant="outline" className="stale-badge" title={`${STALE_HOURS}시간 넘게 갱신이 없고 종료 기록도 없습니다. 종료 훅 없이 닫혔을 수 있습니다.`}>응답 없음</Badge> : null;
}

export function SessionDetail({ detail, updates, children, chain, storeDirectory, copy }: {
  detail: QueryResult<DetailData>; updates: QueryResult<HistoryData>; children: QueryResult<ListData<BriefSession>>; chain: QueryResult<ChainData>;
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

  // 창 폭이 바뀌면 thumb 위치를 애니메이션 없이 다시 맞춘다. 탭은 상세를 다 불러온 뒤에 그려지므로 그때 다시 붙인다
  // (관찰을 시작하면 한 번 불리므로 첫 위치도 이때 놓인다).
  const tabsShown = !detail.isPending && Boolean(s);
  useEffect(() => {
    const list = tabsRef.current?.querySelector<HTMLElement>('[data-slot="tabs-list"]');
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(list);
    return () => observer.disconnect();
  }, [place, tabsShown]);

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

  const resume = s ? resumeCommand(s, shell) : null;
  /** 인계 문서는 지금 화면이 아는 것(상세·최근 이력 한 페이지·연결·흐름)으로 만든다. */
  const handoff = () => s ? handoffMarkdown({ session: s, parentSession: detail.data?.parentSession, children: children.data?.items,
    childrenTotal: children.data?.page.total, updates: updates.data?.items, updatesTotal: updates.data?.page.total, chain: chain.data?.items },
    { shell, storeDirectory }) : "";

  return <aside className="detail-panel" aria-label="세션 상세" tabIndex={-1} ref={panelRef}>
    <div className="detail-topline"><NavLink href={listLocation()} className="close-detail" aria-label="목록으로 돌아가기"><ArrowLeft />목록으로</NavLink>
      {s && <><span className="detail-updated">최근 갱신 {timestamp(s.updatedAt)}</span>
        <span className="detail-source"><span className="muted">{s.agent}</span><PinMark pinned={s.pinned} /><StatusBadge status={s.status} /><StaleBadge session={s} />{s.endedAt && <Badge variant="outline" className="ended-badge">종료</Badge>}</span></>}</div>
    <ErrorNotice id="detail-error" error={detail.error} />
    {detail.isPending ? <Loading /> : s ? <>
      <header className="detail-header">
        <h2>{s.sessionName ?? "이름 없는 세션"}</h2><p className="detail-project"><Folder />{projectName(s.workingDirectory)}</p></header>
      <div className="detail-actions"><Button size="sm" onClick={() => copy(sessionContext(s, { shell, storeDirectory }))}><Copy data-icon="inline-start" />세션 컨텍스트 복사</Button>
        <Button size="sm" variant="outline" onClick={() => copy(sessionCommand(s, storeDirectory, shell))}><Terminal data-icon="inline-start" />조회 명령 복사</Button>
        <Button size="sm" variant="outline" onClick={() => copy(handoff())}><FileText data-icon="inline-start" />인계 문서 복사</Button>
        {resume && <Button size="sm" variant="outline" onClick={() => copy(resume)}><RotateCcw data-icon="inline-start" />원본 세션 재개 명령 복사</Button>}</div>
      <p className="context-copy-hint">Relay 기록으로 원본 세션을 찾아 실제 대화를 읽고 이어서 작업하라는 안내를 단계별로 복사합니다. Relay 요약은 줄인 메모라 요구사항은 원본 대화에서 확인하게 합니다. 인계 문서는 요약·이력·흐름·재개 명령을 담은 Markdown이라 relay가 없는 곳에도 붙여넣을 수 있습니다.</p>
      <div className="shell-select"><label htmlFor="command-shell">조회 명령 셸</label><NativeSelect id="command-shell" size="sm" value={shell} onChange={(event) => setShell(event.target.value as typeof shell)}>
        <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption></NativeSelect></div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} ref={tabsRef}>
        <TabsList className="detail-tabs"><span className="tabs-thumb" aria-hidden="true" />
          <TabsTrigger value="overview">개요</TabsTrigger><TabsTrigger value="history">기록 이력 <span>{updates.data?.page.total ?? "—"}</span></TabsTrigger>
          <TabsTrigger value="connections">세션 연결 <span>{children.data ? children.data.page.total + (detail.data?.parentSession ? 1 : 0) : "—"}</span></TabsTrigger></TabsList>
        <TabsContent value="overview"><div className="detail-section"><h3>최근 작업 요약</h3><div className="summary" ref={summaryRef}>{s.summary}</div>
          <p className="hint">작업을 이어가기 전, 실제 프로젝트 파일도 확인하세요.</p></div><Separator /><SessionMetadata session={s} copy={copy} resume={resume} /></TabsContent>
        <TabsContent value="history"><div className="detail-section"><div className="section-title"><h3>기록 이력</h3><span className="muted">최신 기록부터</span></div>
          <ErrorNotice id="updates-error" error={updates.error} /><div id="updates-content">{updates.isPending ? <Loading /> : updates.data ? <>
            <FlipList className="timeline" items={updates.data.items} listKey={String(updates.data.page.offset)}>{updates.data.items.map((update) => <li key={update.id} data-flip-id={update.id} data-testid="history-entry"><span className="timeline-dot" /><div className="timeline-meta"><span>#{update.sequence}</span><StatusBadge status={update.status} /><time title={update.createdAt}>{timestamp(update.createdAt)}</time></div><p>{update.summary}</p></li>)}</FlipList>
            {!updates.data.items.length && <p className="muted">현재 페이지에 이력이 없습니다.</p>}<Pager page={updates.data.page} queryKey="historyOffset" /></> : null}</div></div></TabsContent>
        <TabsContent value="connections"><div className="detail-section"><h3><GitBranch />작업의 연결</h3><p className="hint">이전 맥락에서 다음 작업까지, 세션의 흐름을 확인하세요.</p>
          <div className="relation-section"><span className="eyebrow">세션 흐름</span><ErrorNotice id="chain-error" error={chain.error} /><div id="chain-content">{chain.isPending ? <Loading /> : chain.data ? <Chain items={chain.data.items} truncated={chain.data.truncated} /> : null}</div></div>
          <div className="relation-section"><span className="eyebrow">이전 세션</span>{detail.data?.parentSession ? <Relation session={detail.data.parentSession} /> : <p className="muted">최초 세션 · 이전 연결 없음</p>}</div>
          <div className="current-session"><GitBranch /><div><strong>{s.sessionName ?? "이름 없는 세션"}</strong><span>현재 세션</span></div></div>
          <div className="relation-section"><span className="eyebrow">이어받은 세션</span><ErrorNotice id="children-error" error={children.error} /><div id="children-content">{children.isPending ? <Loading /> : children.data ? <>
            {children.data.items.length ? <ul className="relations">{children.data.items.map((child) => <li key={child.id}><Relation session={child} /></li>)}</ul> : <p className="muted">이어받은 세션 없음</p>}
            <Pager page={children.data.page} queryKey="childrenOffset" /></> : null}</div></div></div></TabsContent>
      </Tabs>
    </> : <p className="hint">목록에서 다른 세션을 선택하거나 새로고침해 주세요.</p>}
  </aside>;
}

/** 처음 세션부터 이어받은 세션까지 한 줄로. 깊이만큼 들여 써서 누가 누구를 이어받았는지 보인다. */
function Chain({ items, truncated }: { items: ChainNode[]; truncated: boolean }) {
  if (items.length < 2) return <p className="muted">이 세션 하나뿐 · 이어진 흐름 없음</p>;
  return <>
    <ol className="chain">{items.map((node) => <li key={node.id} className={cn("chain-node", node.current && "chain-current")} data-testid="chain-node"
      style={{ "--depth": node.depth } as CSSProperties} aria-current={node.current ? "true" : undefined}>
      <span className="chain-dot" aria-hidden="true" />
      <div className="chain-head">{node.current ? <strong>{node.sessionName ?? "이름 없는 세션"}</strong> : <SessionLink session={node} />}
        <span className="muted">{node.agent}</span><PinMark pinned={node.pinned} /><StatusBadge status={node.status} />{node.current && <span className="chain-here">현재</span>}
        <time title={node.updatedAt}>{timestamp(node.updatedAt)}</time></div>
      <p>{node.summary}</p></li>)}</ol>
    {truncated && <p className="muted">흐름이 길어 일부만 표시합니다.</p>}
  </>;
}

function Relation({ session }: { session: BriefSession }) {
  return <div className="relation"><div className="relation-heading"><SessionLink session={session} /><ArrowUpRight /></div><div className="flex items-center gap-2"><span className="muted">{session.provider}{session.agent ? ` / ${session.agent}` : ""}</span><StatusBadge status={session.status ?? null} /></div><p>{session.summary}</p></div>;
}

function SessionMetadata({ session: s, copy, resume }: { session: Session; copy: (value: string) => void; resume: string | null }) {
  // C4 세션 식별자 펼침.
  const reveal = (event: { currentTarget: HTMLDetailsElement }) => {
    if (event.currentTarget.open) staggerIn(event.currentTarget.querySelectorAll(":scope > *:not(summary)"), { y: 4, duration: "fast", step: "tight" });
  };
  return <div className="detail-section"><h3>세션 정보</h3><div className="identity-grid"><div><span>Provider / Agent</span><strong>{s.provider} / {s.agent}</strong></div><div><span>모델</span><strong>{s.model ?? "미기록"}</strong></div>
    <div><span>작업 상태</span><strong data-testid="session-status">{statusLabel(s.status)}{s.pinned ? " · 고정" : ""}</strong></div>
    <div><span><GitCommitHorizontal />Git</span><strong data-testid="session-git" title={s.git ? `읽은 시각 ${timestamp(s.git.at)}` : undefined}>{gitLabel(s.git)}</strong></div>
    <div><span>컨텍스트 압축</span><strong data-testid="session-compaction" title={s.compaction ? "압축 전 대화의 세부는 기록에 없을 수 있습니다." : undefined}>{compactionLabel(s.compaction)}</strong></div></div>
    <div className="path-block"><span><Folder />작업 경로</span><code>{s.workingDirectory}</code></div>
    <div className="time-grid"><div><CalendarDays /><span>최초 기록</span><time title={s.createdAt}>{timestamp(s.createdAt)}</time></div><div><Clock3 /><span>마지막 갱신</span><time title={s.updatedAt}>{timestamp(s.updatedAt)}</time></div><div><LogOut /><span>세션 종료</span><time title={s.endedAt ?? "종료 기록 없음"} data-testid="session-end">{endLabel(s)}</time></div></div>
    {resume && <div className="path-block resume-block"><span><RotateCcw />원본 세션 재개</span><code data-testid="resume-command">{resume}</code></div>}
    <details className="technical-details" onToggle={reveal}><summary><Hash />세션 식별자</summary><dl><dt>Agent Session ID</dt><dd>{s.providerSessionId}</dd></dl><CopyButton value={s.providerSessionId} copy={copy} label="Agent Session ID만 복사" /><dl><dt>Relay 내부 ID</dt><dd>{s.id}</dd></dl></details></div>;
}
