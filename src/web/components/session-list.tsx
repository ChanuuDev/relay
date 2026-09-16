import { ArrowDown, Folder, Layers, Terminal } from "lucide-react";
import { Button } from "./ui/button";
import { CopyButton, EmptyState, ErrorNotice, Loading, Pager, SessionLink } from "./session-common";
import type { ListData, QueryResult } from "../lib/queries";
import { navigate, sessionUrl, useUI } from "../lib/store";
import { projectName, relativeTime, timestamp } from "../lib/format";
import { cn } from "../lib/utils";
import { sessionContext } from "../lib/session-context";

export function SessionList({ list, selectedId, activeFilters, storeDirectory, copy, onPage }: {
  list: QueryResult<ListData>; selectedId?: string; activeFilters: string[];
  storeDirectory?: string; copy: (value: string) => void; onPage: (offset: number) => void;
}) {
  return <section className="list-panel" aria-label="세션 목록"><div className="list-toolbar"><span><Layers />전체 기록</span><span><ArrowDown />최근 갱신순</span></div>
            <ErrorNotice id="list-error" error={list.error} /><div id="list-content" aria-busy={list.isPending}>
              {list.isPending ? <Loading /> : list.data ? list.data.items.length ? <>
                <div className="session-table-wrap"><table className="session-table"><thead><tr><th scope="col">세션 / 최근 작업</th><th scope="col">Agent / 프로젝트</th><th scope="col">마지막 갱신</th><th scope="col"><span className="sr-only">작업</span></th></tr></thead><tbody>{list.data.items.map((session) => <tr key={session.id} className={cn("session-row", selectedId === session.id && "selected-row")} aria-current={selectedId === session.id ? "true" : undefined} onClick={(event) => {
                  if (!(event.target as HTMLElement).closest("a,button") && !window.getSelection()?.toString()) navigate(sessionUrl(session.id));
                }}><td><div className="session-title"><span className="agent-avatar" data-provider={session.provider}>{session.provider === "anthropic" ? "✳" : session.provider === "openai" ? <Terminal /> : session.agent.slice(0, 1).toUpperCase()}</span><div><div className="session-title-line"><SessionLink session={session} /></div><p className="row-summary">{session.summary}</p><div className="compact-meta"><span>{session.agent}</span><span>·</span><span>{projectName(session.workingDirectory)}</span><span>·</span><span>{relativeTime(session.updatedAt)}</span></div></div></div></td>
                  <td className="source-column"><strong>{session.agent}</strong><span>{session.model ?? session.provider}</span><span className="project-label" title={session.workingDirectory}><Folder />{projectName(session.workingDirectory)}</span></td>
                  <td className="time-column"><time title={`${timestamp(session.updatedAt)} · ${session.updatedAt}`}>{relativeTime(session.updatedAt)}</time><span>{new Date(session.updatedAt).toLocaleDateString("ko-KR")}</span></td><td className="row-action"><CopyButton value={() => sessionContext(session, { shell: useUI.getState().shell, storeDirectory })} copy={copy} label="세션 컨텍스트 복사" /></td></tr>)}</tbody></table></div><Pager page={list.data.page} onPage={onPage} />
              </> : <><EmptyState title={list.data.page.total ? "현재 페이지에 결과가 없습니다." : activeFilters.length ? "검색 결과가 없습니다." : "저장된 세션이 없습니다."} description={list.data.page.total ? "이전 페이지에서 세션을 확인하세요." : activeFilters.length ? "검색어나 필터를 바꿔 다시 찾아보세요." : "Agent의 첫 작업을 기록하면 이곳에서 확인할 수 있습니다."}>
                {activeFilters.length ? <Button variant="outline" onClick={() => navigate("/")}>필터 초기화</Button> : <code className="empty-command">relay record --help</code>}</EmptyState><Pager page={list.data.page} onPage={onPage} /></> : null}
            </div></section>;
}
