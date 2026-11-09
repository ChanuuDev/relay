import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flame, Sprout, TriangleAlert } from "lucide-react";
import { activityStreaks, addDays, weekdayOf, type ActivityDayResult, type ActivityResult } from "@relay/core";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { Button } from "../ui/button";
import { openSession, parseDate, PROVIDER_ORDER, TASK_AGENTS, timeZone, todayKey } from "../../lib/planner";
import { ProviderMark } from "./planner-common";

const WEEKS = 53;
const longDay = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const shortDay = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const number = new Intl.NumberFormat("ko-KR");

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

/** 기록 수를 색 단계(0–4)로: 그 기간 가장 많은 날의 25·50·75%를 경계로 쓴다. */
const levelOf = (count: number, max: number) => (count <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / Math.max(1, max)) * 4))));

/** 잔디: 날마다 남긴 세션 기록 수를 GitHub 잔디처럼 53주 × 7일 칸으로 본다. 칸을 누르면 그날 기록한 세션이 보인다. */
export function ActivityWindow() {
  const tz = useMemo(timeZone, []);
  const [back, setBack] = useState(0);
  const [provider, setProvider] = useState<string>("");
  const today = todayKey();
  const end = addDays(today, -364 * back);
  const start = addDays(end, -(WEEKS - 1) * 7 - weekdayOf(end));
  const [selected, setSelected] = useState<string>(today);
  const [hover, setHover] = useState<{ date: string; left: number; top: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const filter = provider ? `&provider=${provider}` : "";
  const activity = useQuery<ActivityResult>({ queryKey: ["relay", "activity", start, end, tz, provider], retry: false, refetchInterval: 30_000, placeholderData: (previous) => previous,
    queryFn: ({ signal }) => getJson<ActivityResult>(`/api/v1/activity?from=${start}&to=${end}&tz=${encodeURIComponent(tz)}${filter}`, signal) });
  const day = useQuery({ queryKey: ["relay", "activity-day", selected, tz, provider], retry: false, refetchInterval: 30_000,
    queryFn: ({ signal }) => getJson<ActivityDayResult>(`/api/v1/activity/day?date=${selected}&tz=${encodeURIComponent(tz)}${filter}`, signal) });

  const counts = useMemo(() => new Map((activity.data?.days ?? []).map((item) => [item.date, item])), [activity.data]);
  const max = useMemo(() => Math.max(0, ...(activity.data?.days ?? []).map((item) => item.count)), [activity.data]);
  const streaks = useMemo(() => activityStreaks(activity.data?.days ?? [], today), [activity.data, today]);
  const days = useMemo(() => Array.from({ length: WEEKS * 7 }, (_, index) => addDays(start, index)), [start]);
  const months = useMemo(() => {
    const labels: Array<{ week: number; label: string }> = [];
    for (let week = 0; week < WEEKS; week++) {
      const first = days[week * 7]!;
      const previous = week ? days[week * 7 - 7]! : null;
      if (!previous || first.slice(5, 7) !== previous.slice(5, 7)) {
        const label = `${Number(first.slice(5, 7))}월`;
        if (labels.length && week - labels.at(-1)!.week < 3) labels.pop();
        labels.push({ week, label });
      }
    }
    return labels;
  }, [days]);
  const periodLabel = back === 0 ? "최근 1년" : `${shortDay.format(parseDate(start))} – ${shortDay.format(parseDate(end))}`;

  const focusDay = (date: string) => requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus());
  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(selected, step);
    if (next < start || next > end) return;
    setSelected(next);
    focusDay(next);
  }
  // 잔디가 카드보다 넓으면(좁은 창) 최근 주가 보이도록 오른쪽 끝에서 시작한다.
  useEffect(() => { const card = cardRef.current; if (card && card.scrollWidth > card.clientWidth) card.scrollLeft = card.scrollWidth; }, [start, activity.data]);
  const detail = counts.get(selected);
  const sessions = day.data?.sessions ?? [];

  return <Window id="activity" bodyClassName="planner-body activity-body" header={
    <WindowTitleBar id="activity" right={<div className="cal-tools" role="group" aria-label="기간">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="이전 1년" title="이전 1년" onClick={() => { setBack(back + 1); setSelected(addDays(end, -364)); }}><ChevronLeft aria-hidden="true" /></Button>
      <span className="activity-period" aria-live="polite">{periodLabel}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="다음 1년" title="다음 1년" disabled={back === 0}
        onClick={() => { const next = Math.max(0, back - 1); setBack(next); setSelected(next === 0 ? today : addDays(today, -364 * next)); }}><ChevronRight aria-hidden="true" /></Button>
    </div>} />}>
    <div className="activity-scroll">
      {activity.isError && <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>잔디를 불러오지 못했습니다. {(activity.error as Error).message}</span></div>}
      <div className="activity-top">
        <dl className="activity-stats">
          <div><dt>총 기록</dt><dd>{number.format(activity.data?.total ?? 0)}<small>회</small></dd></div>
          <div><dt>기록한 날</dt><dd>{number.format(activity.data?.activeDays ?? 0)}<small>일</small></dd></div>
          <div><dt>세션</dt><dd>{number.format(activity.data?.sessions ?? 0)}<small>개</small></dd></div>
          <div data-accent=""><dt>{back === 0 ? "현재 연속" : "기간 끝 연속"}</dt><dd><Flame aria-hidden="true" />{back === 0 ? streaks.current : activityStreaks(activity.data?.days ?? [], end).current}<small>일</small></dd></div>
          <div><dt>최장 연속</dt><dd>{streaks.longest}<small>일</small></dd></div>
        </dl>
        <div className="planner-agents activity-providers" role="radiogroup" aria-label="에이전트">
          <button type="button" role="radio" aria-checked={provider === ""} onClick={() => setProvider("")}>전체</button>
          {PROVIDER_ORDER.map((item) => <button key={item} type="button" role="radio" aria-checked={provider === item} onClick={() => setProvider(item)}>
            <ProviderMark provider={item} size={14} />{TASK_AGENTS[item].label}</button>)}
        </div>
      </div>
      <section className="activity-card" aria-label="세션 기록 잔디" ref={cardRef}>
        <div className="activity-graph" style={{ ["--weeks" as string]: WEEKS }}>
          <div className="activity-months" aria-hidden="true">{months.map((month) => <span key={month.week} style={{ gridColumn: `${month.week + 1} / span 3` }}>{month.label}</span>)}</div>
          <div className="activity-weekdays" aria-hidden="true"><span /><span>월</span><span /><span>수</span><span /><span>금</span><span /></div>
          <div className="activity-grid" role="grid" aria-label={`${periodLabel} 세션 기록`} ref={gridRef} onKeyDown={onGridKey} data-loading={activity.isPending ? "" : undefined}
            onPointerLeave={() => setHover(null)}>
            {days.map((date) => {
              const item = counts.get(date);
              const future = date > end;
              return <button key={date} type="button" role="gridcell" className="activity-cell" data-date={date} data-level={future ? undefined : levelOf(item?.count ?? 0, max)}
                data-future={future ? "" : undefined} disabled={future} tabIndex={date === selected ? 0 : -1} aria-selected={date === selected}
                aria-label={`${longDay.format(parseDate(date))}, 기록 ${item?.count ?? 0}회${item ? `, 세션 ${item.sessions}개` : ""}`}
                onClick={() => setSelected(date)}
                onPointerEnter={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  const host = gridRef.current!.getBoundingClientRect();
                  setHover({ date, left: box.left - host.left + box.width / 2, top: box.top - host.top });
                }} />;
            })}
            {hover && <div className="activity-tip material-menu" role="presentation" style={{ left: hover.left, top: hover.top }}>
              <strong>{counts.get(hover.date)?.count ?? 0 ? `기록 ${counts.get(hover.date)!.count}회` : "기록 없음"}</strong>
              <span>{longDay.format(parseDate(hover.date))}{counts.get(hover.date) ? ` · 세션 ${counts.get(hover.date)!.sessions}개` : ""}</span>
            </div>}
          </div>
        </div>
        <div className="activity-legend" aria-hidden="true"><span>적음</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>많음</span></div>
      </section>
      <section className="activity-day" aria-label="고른 날 기록">
        <header><h3>{longDay.format(parseDate(selected))}</h3><span>{detail ? `기록 ${detail.count}회 · 세션 ${detail.sessions}개` : "기록 없음"}</span></header>
        {sessions.length ? <ul className="activity-sessions">
          {sessions.map((session) => <li key={session.id}>
            <button type="button" className="activity-session" disabled={session.deleted} data-id={session.id}
              title={session.deleted ? "보관 기간이 지나 지워진 세션입니다" : "세션 창에서 열기"} onClick={() => openSession(session.id)}>
              <ProviderMark provider={(PROVIDER_ORDER as string[]).includes(session.provider) ? session.provider as never : null} size={22} />
              <span className="activity-session-text">
                <span className="activity-session-name">{session.deleted ? "지워진 세션" : session.sessionName ?? "이름 없는 세션"}</span>
                <span className="activity-session-meta">{[session.agent, session.workingDirectory?.split(/[\\/]/).filter(Boolean).at(-1)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="activity-session-count"><strong>{session.count}</strong>회</span>
              <span className="activity-session-time">{clock.format(new Date(session.firstAt))}{session.firstAt !== session.lastAt ? `–${clock.format(new Date(session.lastAt))}` : ""}</span>
            </button>
          </li>)}
        </ul> : <div className="planner-empty activity-empty">
          <Sprout aria-hidden="true" />
          <span>{day.isPending ? "불러오는 중…" : "이날 남긴 세션 기록이 없습니다."}</span>
        </div>}
      </section>
    </div>
  </Window>;
}
