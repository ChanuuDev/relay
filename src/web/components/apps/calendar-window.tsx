import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Dialog } from "radix-ui";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, FileText, ListTodo, Paperclip, Plus, Trash2, X } from "lucide-react";
import { addDays, compareEvents, daysBetween, EVENT_COLORS, eventDays, weekdayOf, type EventAttachment, type EventColor } from "@relay/core";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { SplitView } from "../desktop/split-view";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { eventLabel, parseDate, todayKey, usePlanner, type CalendarEvent } from "../../lib/planner";
import { AttachmentChip, NotePicker, PlannerNotice, PlannerSync, PlannerUndo, TaskPicker } from "./planner-common";

const DRAG_TYPE = "application/x-relay-event";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const COLOR_LABELS: Record<EventColor, string> = { blue: "파랑", green: "초록", orange: "주황", red: "빨강", purple: "보라", gray: "회색" };
const monthTitle = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });
const dayTitle = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" });
const fullDay = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

/** 일정 편집 창에서 다루는 값. 날짜와 시각을 따로 둔다. */
type Draft = { id: string | null; title: string; allDay: boolean; startDate: string; startTime: string; endDate: string; endTime: string;
  color: EventColor; memo: string; attachments: EventAttachment[] };

const nextHour = () => {
  const hour = Math.min(22, new Date().getHours() + 1);
  return { start: `${String(hour).padStart(2, "0")}:00`, end: `${String(hour + 1).padStart(2, "0")}:00` };
};
const draftFor = (date: string, allDay: boolean): Draft => {
  const hours = nextHour();
  return { id: null, title: "", allDay, startDate: date, startTime: hours.start, endDate: date, endTime: hours.end, color: "blue", memo: "", attachments: [] };
};
const draftOf = (event: CalendarEvent): Draft => ({ id: event.id, title: event.title, allDay: event.allDay, startDate: event.start.slice(0, 10),
  startTime: event.allDay ? "09:00" : event.start.slice(11, 16), endDate: event.end.slice(0, 10), endTime: event.allDay ? "10:00" : event.end.slice(11, 16),
  color: event.color, memo: event.memo, attachments: event.attachments });
const rangeOf = (draft: Draft) => (draft.allDay ? { start: draft.startDate, end: draft.endDate }
  : { start: `${draft.startDate}T${draft.startTime}`, end: `${draft.endDate}T${draft.endTime}` });
/** 같은 길이를 지키며 days일 옮긴다. */
const shifted = (event: CalendarEvent, days: number) => ({
  start: `${addDays(event.start.slice(0, 10), days)}${event.start.slice(10)}`,
  end: `${addDays(event.end.slice(0, 10), days)}${event.end.slice(10)}`,
});
const timeText = (event: CalendarEvent, day: string) => {
  if (event.allDay) return "종일";
  const { first, last } = eventDays(event);
  const start = first === day ? event.start.slice(11, 16) : "00:00";
  const end = last === day ? event.end.slice(11, 16) : "24:00";
  return `${start}–${end}`;
};

/** 일정 만들기·고치기 창 */
function EventDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [value, setValue] = useState<Draft | null>(draft);
  const [picking, setPicking] = useState<"note" | "task" | null>(null);
  useEffect(() => setValue(draft), [draft]);
  const range = value ? rangeOf(value) : null;
  const invalid = Boolean(range && range.end < range.start);
  const set = (patch: Partial<Draft>) => setValue((current) => {
    if (!current) return current;
    const next = { ...current, ...patch };
    // 시작을 끝보다 뒤로 옮기면 끝도 같이 민다(시간 일정은 한 시간 뒤).
    if ((patch.startDate || patch.startTime) && rangeOf(next).end < rangeOf(next).start) {
      next.endDate = next.startDate;
      if (!next.allDay) { const hour = Math.min(23, Number(next.startTime.slice(0, 2)) + 1); next.endTime = `${String(hour).padStart(2, "0")}:${next.startTime.slice(3, 5)}`; }
    }
    return next;
  });
  function save() {
    if (!value || invalid) return;
    const { start, end } = rangeOf(value);
    const fields = { title: value.title.trim(), allDay: value.allDay, start, end, memo: value.memo, color: value.color, attachments: value.attachments };
    if (value.id) usePlanner.getState().updateEvent(value.id, fields);
    else usePlanner.getState().createEvent(fields);
    onClose();
  }
  const attach = (kind: "note" | "task", id: string) => set({ attachments: value!.attachments.some((item) => item.kind === kind && item.id === id) ? value!.attachments : [...value!.attachments, { kind, id }] });
  return <Dialog.Root open={Boolean(draft)} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <div className="confirm-overlay" aria-hidden="true" />
      <Dialog.Content className="planner-dialog cal-dialog material-menu" aria-describedby={undefined}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } }}>
        {value && <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="planner-dialog-head">
            <span className="cal-dialog-swatch" data-color={value.color} aria-hidden="true" />
            <Dialog.Title className="properties-title">{value.id ? "일정 고치기" : "새 일정"}</Dialog.Title>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon-xs" aria-label="닫기"><X aria-hidden="true" /></Button></Dialog.Close>
          </div>
          <input className="planner-title-input cal-title-input" autoFocus value={value.title} onChange={(event) => set({ title: event.target.value })}
            placeholder="새 일정" aria-label="일정 제목" maxLength={200} />
          <div className="cal-form">
            <span className="cal-form-label">종일</span>
            <label className="planner-switch"><input type="checkbox" role="switch" checked={value.allDay} aria-label="종일" onChange={(event) => set({ allDay: event.target.checked })} /><span aria-hidden="true" /></label>
            <label className="cal-form-label" htmlFor="cal-start-date">시작</label>
            <div className="cal-when">
              <Input id="cal-start-date" type="date" value={value.startDate} required onChange={(event) => event.target.value && set({ startDate: event.target.value })} />
              {!value.allDay && <Input type="time" aria-label="시작 시각" value={value.startTime} required onChange={(event) => event.target.value && set({ startTime: event.target.value })} />}
            </div>
            <label className="cal-form-label" htmlFor="cal-end-date">끝</label>
            <div className="cal-when">
              <Input id="cal-end-date" type="date" value={value.endDate} required aria-invalid={invalid || undefined} onChange={(event) => event.target.value && set({ endDate: event.target.value })} />
              {!value.allDay && <Input type="time" aria-label="끝 시각" value={value.endTime} required aria-invalid={invalid || undefined} onChange={(event) => event.target.value && set({ endTime: event.target.value })} />}
            </div>
            {invalid && <p className="cal-error" role="alert">끝이 시작보다 앞입니다.</p>}
            <span className="cal-form-label">색</span>
            <div className="cal-colors" role="radiogroup" aria-label="색">
              {EVENT_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={value.color === color} aria-label={COLOR_LABELS[color]}
                title={COLOR_LABELS[color]} data-color={color} onClick={() => set({ color })} />)}
            </div>
            <label className="cal-form-label" htmlFor="cal-memo">메모</label>
            <Textarea id="cal-memo" className="planner-memo" value={value.memo} onChange={(event) => set({ memo: event.target.value })} placeholder="장소, 준비물, 참고 사항" maxLength={20000} />
            <span className="cal-form-label">첨부</span>
            <div className="planner-attachments">
              {value.attachments.map((item) => <AttachmentChip key={`${item.kind}:${item.id}`} kind={item.kind} id={item.id}
                onRemove={() => set({ attachments: value.attachments.filter((other) => other !== item) })} />)}
              <Button type="button" size="xs" variant="ghost" className="planner-attach" onClick={() => setPicking("note")}><FileText aria-hidden="true" />메모 첨부</Button>
              <Button type="button" size="xs" variant="ghost" className="planner-attach" onClick={() => setPicking("task")}><ListTodo aria-hidden="true" />Task 첨부</Button>
            </div>
          </div>
          <div className="planner-dialog-foot">
            {value.id && <Button type="button" size="sm" variant="ghost" className="planner-danger" onClick={() => { usePlanner.getState().removeEvent(value.id!); onClose(); }}>
              <Trash2 aria-hidden="true" />삭제</Button>}
            <span className="planner-dialog-spacer" />
            <Dialog.Close asChild><Button type="button" size="sm" variant="outline">취소</Button></Dialog.Close>
            <Button type="submit" size="sm" disabled={invalid}>저장</Button>
          </div>
          <NotePicker open={picking === "note"} attached={value.attachments.filter((item) => item.kind === "note").map((item) => item.id)} onClose={() => setPicking(null)} onPick={(id) => attach("note", id)} />
          <TaskPicker open={picking === "task"} attached={value.attachments.filter((item) => item.kind === "task").map((item) => item.id)} onClose={() => setPicking(null)} onPick={(id) => attach("task", id)} />
        </form>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** 캘린더: 월 달력과 고른 날의 일정. 일정은 종일·시간 단위이며 메모와 Task를 첨부한다. */
export function CalendarWindow() {
  const events = usePlanner((state) => state.events);
  const [today, setToday] = useState(todayKey);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [pane, setPane] = useState<"month" | "agenda">("month");
  const gridRef = useRef<HTMLDivElement>(null);
  // 자정이 지나면 오늘 표시를 옮긴다.
  useEffect(() => { const timer = setInterval(() => setToday(todayKey()), 60_000); return () => clearInterval(timer); }, []);

  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(start, index)), [start]);
  const last = days[41]!;
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of Object.values(events).sort(compareEvents)) {
      const span = eventDays(event);
      const from = span.first < start ? start : span.first;
      const to = span.last > last ? last : span.last;
      for (let day = from; day <= to; day = addDays(day, 1)) { const list = map.get(day) ?? []; list.push(event); map.set(day, list); }
    }
    return map;
  }, [events, start, last]);
  const agenda = useMemo(() => Object.values(events).filter((event) => { const span = eventDays(event); return span.first <= selected && span.last >= selected; }).sort(compareEvents),
    [events, selected]);

  const go = (date: string, focus = false) => {
    setSelected(date);
    if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
    if (focus) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus());
  };
  const shiftMonth = (delta: number) => {
    const date = parseDate(`${month}-01`);
    date.setMonth(date.getMonth() + delta);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    setMonth(next);
    const day = Math.min(Number(selected.slice(8, 10)), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    setSelected(`${next}-${String(day).padStart(2, "0")}`);
  };
  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (steps[event.key] !== undefined) { event.preventDefault(); go(addDays(selected, steps[event.key]!), true); return; }
    if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); shiftMonth(event.key === "PageUp" ? -1 : 1); return; }
    if (event.key === "Home") { event.preventDefault(); go(today, true); return; }
    if (event.key === "Enter") { event.preventDefault(); setDraft(draftFor(selected, false)); }
  }
  function onDrop(event: DragEvent<HTMLElement>, day: string) {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    event.preventDefault();
    setDropDay(null);
    const target = id ? usePlanner.getState().events[id] : undefined;
    if (!target) return;
    const delta = daysBetween(target.start.slice(0, 10), day);
    if (delta) usePlanner.getState().updateEvent(id, shifted(target, delta));
    setSelected(day);
  }

  const chip = (event: CalendarEvent, day: string) => <li key={event.id} className="cal-chip" data-color={event.color} data-all-day={event.allDay ? "" : undefined}
    data-id={event.id} draggable title={`${eventLabel(event)} · ${timeText(event, day)}`}
    onDragStart={(drag) => { drag.dataTransfer.setData(DRAG_TYPE, event.id); drag.dataTransfer.effectAllowed = "move"; drag.stopPropagation(); }}
    onClick={(click) => { click.stopPropagation(); setSelected(day); setDraft(draftOf(event)); }}>
    {!event.allDay && <span className="cal-chip-time">{eventDays(event).first === day ? event.start.slice(11, 16) : ""}</span>}
    <span className="cal-chip-title">{eventLabel(event)}</span>
  </li>;

  return <Window id="calendar" bodyClassName="planner-body" header={
    <WindowTitleBar id="calendar" right={<div className="cal-tools" role="group" aria-label="달력 이동">
      <div className="planner-segment planner-pane-toggle" role="tablist" aria-label="보기">
        <button type="button" role="tab" aria-selected={pane === "month"} onClick={() => setPane("month")}>달력</button>
        <button type="button" role="tab" aria-selected={pane === "agenda"} onClick={() => setPane("agenda")}>일정</button>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="이전 달" title="이전 달" onClick={() => shiftMonth(-1)}><ChevronLeft aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="sm" className="cal-today" onClick={() => go(today, true)}>오늘</Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="다음 달" title="다음 달" onClick={() => shiftMonth(1)}><ChevronRight aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="새 일정" title="새 일정" onClick={() => setDraft(draftFor(selected, false))}><CalendarPlus aria-hidden="true" /></Button>
    </div>} />}>
    <PlannerNotice />
    <SplitView name="calendar" label="고른 날 일정" position="end" className="cal-layout" data-pane={pane} defaultWidth={280} minWidth={220} maxWidth={420} minMain={420} side={
      <aside className="cal-agenda material-chrome" aria-label="고른 날 일정">
        <header className="cal-agenda-head">
          <div><h3>{dayTitle.format(parseDate(selected))}</h3><span>{selected === today ? "오늘" : `${parseDate(selected).getFullYear()}년`}</span></div>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="이날 새 일정" title="이날 새 일정" onClick={() => setDraft(draftFor(selected, false))}><Plus aria-hidden="true" /></Button>
        </header>
        {agenda.length ? <ol className="cal-agenda-list">
          {agenda.map((event) => <li key={event.id}>
            <button type="button" className="cal-agenda-item" data-color={event.color} data-id={event.id} onClick={() => setDraft(draftOf(event))}>
              <span className="cal-agenda-time">{timeText(event, selected)}</span>
              <span className="cal-agenda-text">
                <span className="cal-agenda-title">{eventLabel(event)}</span>
                {event.memo.trim() && <span className="cal-agenda-memo">{event.memo.trim().split("\n")[0]}</span>}
              </span>
              {event.attachments.length > 0 && <span className="board-card-flag" title={`첨부 ${event.attachments.length}개`}><Paperclip aria-hidden="true" />{event.attachments.length}</span>}
            </button>
            {event.attachments.length > 0 && <div className="cal-agenda-attachments">
              {event.attachments.map((item) => <AttachmentChip key={`${item.kind}:${item.id}`} kind={item.kind} id={item.id} />)}
            </div>}
          </li>)}
        </ol> : <div className="planner-empty">
          <CalendarDays aria-hidden="true" />
          <strong>일정이 없습니다</strong>
          <span>날짜를 두 번 누르면 종일 일정을, + 단추로 시간 일정을 만듭니다.</span>
        </div>}
        <div className="notes-footer"><span>{monthTitle.format(parseDate(`${month}-01`))} 일정 {new Set(days.filter((day) => day.startsWith(month)).flatMap((day) => (byDay.get(day) ?? []).map((event) => event.id))).size}개</span><PlannerSync /></div>
      </aside>} main={
      <section className="cal-month" aria-label="월 달력">
        <h2 className="cal-month-title">{monthTitle.format(parseDate(`${month}-01`))}</h2>
        <div className="cal-weekdays" aria-hidden="true">{WEEKDAYS.map((name, index) => <span key={name} data-weekday={index}>{name}</span>)}</div>
        <div className="cal-grid" role="grid" aria-label={`${monthTitle.format(parseDate(`${month}-01`))} 달력`} ref={gridRef} onKeyDown={onGridKey}>
          {Array.from({ length: 6 }, (_, week) => <div key={week} className="cal-week" role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const list = byDay.get(day) ?? [];
              const more = list.length - 3;
              return <div key={day} role="gridcell" className="cal-day" data-date={day} tabIndex={day === selected ? 0 : -1}
                aria-selected={day === selected} aria-label={`${fullDay.format(parseDate(day))}${list.length ? `, 일정 ${list.length}개` : ""}`}
                data-out={day.slice(0, 7) !== month ? "" : undefined} data-today={day === today ? "" : undefined} data-weekday={weekdayOf(day)}
                data-drop={dropDay === day ? "" : undefined}
                onClick={() => setSelected(day)} onDoubleClick={() => setDraft(draftFor(day, true))}
                onDragOver={(event) => { if (!event.dataTransfer.types.includes(DRAG_TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dropDay !== day) setDropDay(day); }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropDay === day) setDropDay(null); }}
                onDrop={(event) => onDrop(event, day)}>
                <span className="cal-day-num">{Number(day.slice(8, 10))}</span>
                {list.length > 0 && <ul className="cal-chips">{list.slice(0, more > 0 ? 2 : 3).map((event) => chip(event, day))}</ul>}
                {more > 0 && <span className="cal-more">+{more + 1}개</span>}
              </div>;
            })}
          </div>)}
        </div>
      </section>} />
    <EventDialog draft={draft} onClose={() => setDraft(null)} />
    <PlannerUndo kind="event" />
  </Window>;
}
