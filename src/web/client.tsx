import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Layers, Radio, Terminal, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Textarea } from "./components/ui/textarea";
import { TooltipProvider } from "./components/ui/tooltip";
import { ErrorNotice } from "./components/session-common";
import { SessionDetail } from "./components/session-detail";
import { Filters } from "./components/session-filters";
import { ContextGuide } from "./components/context-guide";
import { SessionList } from "./components/session-list";
import { WorkspaceSidebar } from "./components/workspace-sidebar";
import { resource, type BriefSession, type DetailData, type HealthData, type HistoryData, type ListData } from "./lib/queries";
import { listLocation, navigate, useUI } from "./lib/store";
import { cn } from "./lib/utils";

const queryClient = new QueryClient();

function App() {
  const currentLocation = useUI((state) => state.location);
  const listUrl = new URL(listLocation(), location.origin);
  const params = listUrl.searchParams;
  const match = /^\/sessions\/([^/]+)$/.exec(location.pathname);
  const id = match?.[1];
  const detailParams = new URLSearchParams(location.search);
  const health = useQuery(resource<HealthData>("/api/v1/health"));
  const list = useQuery(resource<ListData>(`/api/v1/sessions?${params}`));
  const detail = useQuery(resource<DetailData>(`/api/v1/sessions/${id}`, Boolean(id)));
  const updates = useQuery(resource<HistoryData>(`/api/v1/sessions/${id}/updates?limit=50&offset=${encodeURIComponent(detailParams.get("historyOffset") ?? "0")}`, Boolean(id)));
  const children = useQuery(resource<ListData<BriefSession>>(`/api/v1/sessions/${id}/children?limit=50&offset=${encodeURIComponent(detailParams.get("childrenOffset") ?? "0")}`, Boolean(id)));
  const watched = [health, list, ...(id ? [detail, updates, children] : [])];
  const failed = watched.some((query) => query.isError);
  const pending = watched.some((query) => query.isPending);
  const successAt = Math.min(...watched.map((query) => query.dataUpdatedAt));
  const [copyStatus, setCopyStatus] = useState("");
  const [fallback, setFallback] = useState<{ value: string } | null>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);
  const copyTriggerRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const pop = () => useUI.getState().syncLocation();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
        target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "/") {
        const search = document.getElementById("search");
        if (search?.getClientRects().length) { event.preventDefault(); search.focus(); }
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    document.title = detail.data?.session && id ? `${detail.data.session.sessionName ?? "세션 상세"} · Relay` : "Relay · 세션 워크스페이스";
    if (id !== selectedRef.current) {
      const previous = selectedRef.current;
      selectedRef.current = id;
      if (id && window.matchMedia("(max-width: 1100px)").matches) window.scrollTo(0, 0);
      if (id) document.querySelector<HTMLElement>(".detail-panel")?.focus({ preventScroll: true });
      else if (previous) {
        const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(".session-name"))
          .find((element) => new URL(element.href).pathname === `/sessions/${previous}`);
        (link ?? document.getElementById("workspace"))?.focus({ preventScroll: true });
      }
    }
  }, [id, detail.data?.session.sessionName, currentLocation]);
  useEffect(() => { if (fallback !== null) { copyRef.current?.focus(); copyRef.current?.select(); } }, [fallback]);
  useEffect(() => { if (copyStatus) { const timer = setTimeout(() => setCopyStatus(""), 3000); return () => clearTimeout(timer); } }, [copyStatus]);

  async function copy(value: string) {
    copyTriggerRef.current = document.activeElement as HTMLElement | null;
    try { await navigator.clipboard.writeText(value); setFallback(null); setCopyStatus("복사했습니다."); }
    catch { setFallback({ value }); }
  }
  function closeFallback() {
    setFallback(null);
    copyTriggerRef.current?.focus({ preventScroll: true });
  }
  function listPage(offset: number) {
    const next = new URLSearchParams(params); next.set("offset", String(offset));
    if (id) {
      const detailQuery = new URLSearchParams(location.search); detailQuery.set("back", `/?${next}`);
      navigate(`${location.pathname}?${detailQuery}`);
    } else navigate(`/?${next}`);
  }
  const activeFilters = ["q", "provider", "agent", "cwd"].filter((key) => params.has(key));

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">본문으로 건너뛰기</a>
    <WorkspaceSidebar health={health.data} connection={failed ? "offline" : pending ? "pending" : "online"} />
    <div className="workspace-shell"><header className="topbar"><div className="breadcrumb"><Layers /><span>워크스페이스</span><ChevronRight /><strong>세션 기록</strong></div><span className="local-label"><Terminal />로컬 · 읽기 전용</span></header>
      <main id="workspace" tabIndex={-1}>
        <div className="workspace-heading"><div><h1>세션 기록 <Badge variant="secondary">{list.data?.page.total.toLocaleString() ?? "—"}</Badge></h1><span>최근 기록부터 확인하고 다음 대화에 필요한 맥락을 복사하세요.</span></div></div>
        <Filters />
        {activeFilters.length > 0 && <div className="filter-chips" role="group" aria-label="적용된 필터">{activeFilters.map((key) => <Badge variant="secondary" key={key}>{params.get(key)}<button type="button" aria-label={`${key} 필터 해제`} onClick={() => { const next = new URLSearchParams(params); next.delete(key); next.delete("offset"); navigate(`/?${next}`); }}><X /></button></Badge>)}<Button variant="ghost" size="xs" onClick={() => navigate("/")}>전체 초기화</Button></div>}
        <ErrorNotice id="global-error" error={health.error} />
        <div className={cn("session-workspace", id && "has-detail")}>
          <SessionList list={list} selectedId={id} activeFilters={activeFilters} storeDirectory={health.data?.dataDirectory} copy={copy} onPage={listPage} />
          {id ? <SessionDetail key={id} detail={detail} updates={updates} children={children} storeDirectory={health.data?.dataDirectory} copy={copy} /> : <ContextGuide />}
        </div>
        <footer className="workspace-footer"><div id="connection-state" role="status"><Radio className={cn(failed && "offline")} />{failed ? "연결 끊김 또는 조회 오류 · 재시도 중" : pending ? "연결 확인 중…" : "연결됨 · 3초마다 자동 조회"}</div><span>{successAt ? `마지막 성공 조회 ${new Date(successAt).toLocaleTimeString("ko-KR")}` : "마지막 조회 —"}</span></footer>
      </main>
    </div>
    {copyStatus && <div id="copy-status" className="copy-toast" role="status"><Check />{copyStatus}</div>}
    {fallback !== null && <section id="copy-fallback" className="copy-fallback" aria-labelledby="copy-label" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeFallback(); } }}><div><label id="copy-label" htmlFor="copy-text">자동 복사 실패 — 아래 원문을 선택하여 복사하세요.</label><Button variant="ghost" size="icon-sm" aria-label="복사 원문 닫기" onClick={closeFallback}><X /></Button></div><Textarea id="copy-text" ref={copyRef} value={fallback.value} readOnly /></section>}
  </div>;
}


createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><TooltipProvider delayDuration={250}><App /></TooltipProvider></QueryClientProvider></StrictMode>);
