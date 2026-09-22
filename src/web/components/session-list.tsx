import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ArrowDown, Folder, Layers, Terminal } from "lucide-react";
import type { Session } from "../../session/session.types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CopyButton, EmptyState, ErrorNotice, Loading, Pager, SessionLink } from "./session-common";
import { Crossfade, FlipList } from "./transitions";
import type { ListData, QueryResult } from "../lib/queries";
import { growAccent, pulse, staggerIn } from "../lib/motion";
import { navigate, sessionUrl, useUI } from "../lib/store";
import { endLabel, projectName, relativeTime, timestamp } from "../lib/format";
import { cn } from "../lib/utils";
import { sessionContext } from "../lib/session-context";

const ROWS = "#list-content .session-row";
/** 행이 실제로 바뀌었는지 판단하는 값(폴링 갱신 감지용). */
const signature = (session: Session) => `${session.summary}\u0000${session.updatedAt}\u0000${session.endedAt ?? ""}`;

export function SessionList({ list, selectedId, activeFilters, storeDirectory, copy, onPage, listKey }: {
  list: QueryResult<ListData>; selectedId?: string; activeFilters: string[]; listKey: string;
  storeDirectory?: string; copy: (value: string) => void; onPage: (offset: number) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const seen = useRef({ key: listKey, rows: new Map<string, string>() });
  const items = list.data?.items;
  const hasData = Boolean(list.data);
  const phase = list.isPending ? "pending" : !list.data ? "none" : list.data.items.length ? "list" : "empty";
  const rows = () => panelRef.current?.querySelectorAll<HTMLElement>(ROWS) ?? [];

  // B1·F5 목록이 통째로 바뀌면 행이 차례로 들어온다.
  useGSAP(() => { if (hasData) staggerIn(rows()); }, { dependencies: [listKey, hasData] });

  // B3 새로 선택된 행의 좌측 강조선.
  useGSAP(() => {
    if (selectedId) growAccent(panelRef.current?.querySelector(`${ROWS}.selected-row .row-accent`));
  }, { dependencies: [selectedId] });

  // B4 폴링으로 요약·시각이 바뀐 행만 한 번 밝아진다.
  useGSAP(() => {
    const previous = seen.current;
    const next = new Map<string, string>();
    const changed = new Set<string>();
    for (const session of items ?? []) {
      const value = signature(session);
      next.set(session.id, value);
      if (previous.rows.get(session.id) !== undefined && previous.rows.get(session.id) !== value) changed.add(session.id);
    }
    const sameQuery = previous.key === listKey;
    seen.current = { key: listKey, rows: next };
    if (!sameQuery || !changed.size) return;
    for (const row of Array.from(rows())) if (changed.has(row.dataset.flipId ?? "")) pulse(row);
  }, { dependencies: [items] });

  return <section className="list-panel material-chrome" aria-label="세션 목록" ref={panelRef}>
    <div className="list-toolbar"><span><Layers />전체 기록</span><span><ArrowDown />최근 갱신순</span></div>
    <ErrorNotice id="list-error" error={list.error} />
    <Crossfade swapKey={phase} container={panelRef} select="#list-content" from={{ x: 0, y: 0 }}>
      <div id="list-content" aria-busy={list.isPending}>
        {list.isPending ? <Loading /> : list.data ? list.data.items.length ? <>
          <FlipList className="session-rows" items={list.data.items} listKey={listKey}>{list.data.items.map((session) => <li key={session.id}
            data-flip-id={session.id}
            className={cn("session-row", selectedId === session.id && "selected-row")}
            aria-current={selectedId === session.id ? "true" : undefined}
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest("a,button") && !window.getSelection()?.toString()) navigate(sessionUrl(session.id));
            }}>
            <span className="row-accent" aria-hidden="true" />
            <span className="agent-avatar" data-provider={session.provider}>{session.provider === "anthropic" ? "✳" : session.provider === "openai" ? <Terminal /> : session.agent.slice(0, 1).toUpperCase()}</span>
            <div className="row-main">
              <div className="session-title-line"><SessionLink session={session} />{session.endedAt && <Badge variant="outline" className="ended-badge" title={`세션 종료 ${endLabel(session)}`}>종료</Badge>}</div>
              <p className="row-summary">{session.summary}</p>
              <div className="compact-meta"><span>{session.agent}</span><span>·</span><span>{projectName(session.workingDirectory)}</span><span>·</span><span>{relativeTime(session.updatedAt)}</span></div>
            </div>
            <div className="source-column"><strong>{session.agent}</strong><span>{session.model ?? session.provider}</span><span className="project-label" title={session.workingDirectory}><Folder />{projectName(session.workingDirectory)}</span></div>
            <div className="time-column"><time title={`${timestamp(session.updatedAt)} · ${session.updatedAt}`}>{relativeTime(session.updatedAt)}</time><span>{new Date(session.updatedAt).toLocaleDateString("ko-KR")}</span></div>
            <div className="row-action"><CopyButton value={() => sessionContext(session, { shell: useUI.getState().shell, storeDirectory })} copy={copy} label="세션 컨텍스트 복사" /></div>
          </li>)}</FlipList>
          <Pager page={list.data.page} onPage={onPage} />
        </> : <>
          <EmptyState title={list.data.page.total ? "현재 페이지에 결과가 없습니다." : activeFilters.length ? "검색 결과가 없습니다." : "저장된 세션이 없습니다."}
            description={list.data.page.total ? "이전 페이지에서 세션을 확인하세요." : activeFilters.length ? "검색어나 필터를 바꿔 다시 찾아보세요." : "Agent의 첫 작업을 기록하면 이곳에서 확인할 수 있습니다."}>
            {activeFilters.length ? <Button variant="outline" size="sm" onClick={() => navigate("/")}>필터 초기화</Button> : <code className="empty-command">relay record --help</code>}
          </EmptyState><Pager page={list.data.page} onPage={onPage} /></> : null}
      </div>
    </Crossfade>
  </section>;
}
