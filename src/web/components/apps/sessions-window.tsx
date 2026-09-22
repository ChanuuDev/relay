import { useRef } from "react";
import { Badge } from "../ui/badge";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { FilterChips, FilterControls, SessionFiltersForm } from "../session-filters";
import { SessionList } from "../session-list";
import { SessionDetail } from "../session-detail";
import { Crossfade } from "../transitions";
import { DetailPlaceholder } from "../context-guide";
import { staggerIn } from "../../lib/motion";
import type { BriefSession, DetailData, HealthData, HistoryData, ListData, QueryResult } from "../../lib/queries";

/** 상세 자리(패널 또는 플레이스홀더). 클론 오버레이는 제외한다. */
const DETAIL_SLOT = ":scope > .detail-panel:not(.detail-clone), :scope > .detail-placeholder:not(.detail-clone)";
const staggerHeader = (panel: HTMLElement) =>
  staggerIn(panel.querySelectorAll(".detail-header > *, .detail-actions"), { y: 6, duration: "fast", step: "tight" });

export function SessionsWindow({ list, detail, updates, relations, health, params, selectedId, activeFilters, copy, onPage, successAt }: {
  list: QueryResult<ListData>; detail: QueryResult<DetailData>; updates: QueryResult<HistoryData>; relations: QueryResult<ListData<BriefSession>>;
  health?: HealthData; params: URLSearchParams; selectedId?: string; activeFilters: string[];
  copy: (value: string) => void; onPage: (offset: number) => void; successAt: number;
}) {
  const total = list.data?.page.total;
  const bodyRef = useRef<HTMLDivElement>(null);
  return <Window id="sessions" detail={Boolean(selectedId)} bodyClassName="sessions-shell" header={
    <SessionFiltersForm>
      <WindowTitleBar id="sessions" title={<>
        <span className="title-list">세션 기록 <Badge variant="secondary">{total?.toLocaleString() ?? "—"}</Badge></span>
        <span className="title-detail">세션 상세</span></>}>
        <FilterControls />
      </WindowTitleBar>
    </SessionFiltersForm>}>
    <FilterChips params={params} activeFilters={activeFilters} />
    <div id="workspace" className="sessions-body" tabIndex={-1} ref={bodyRef}>
      <SessionList list={list} selectedId={selectedId} activeFilters={activeFilters} listKey={params.toString()}
        storeDirectory={health?.dataDirectory} copy={copy} onPage={onPage} />
      <Crossfade swapKey={selectedId ?? ""} container={bodyRef} select={DETAIL_SLOT} onEntered={staggerHeader}>
        {selectedId
          ? <SessionDetail key={selectedId} detail={detail} updates={updates} children={relations} storeDirectory={health?.dataDirectory} copy={copy} />
          : <DetailPlaceholder />}
      </Crossfade>
    </div>
    <footer className="statusbar material-chrome">
      <span>총 {total?.toLocaleString() ?? "—"}건 · 최근 갱신순</span>
      <span id="database-path" title={health?.databasePath}>{health?.databasePath ?? "저장소 확인 중…"}</span>
      <span className="statusbar-end"><span className="version">RELAY {health?.appVersion ? `v${health.appVersion}` : ""}</span>
        <span>{successAt ? `마지막 성공 조회 ${new Date(successAt).toLocaleTimeString("ko-KR")}` : "마지막 조회 —"} · 3초마다 자동 조회</span></span>
    </footer>
  </Window>;
}
