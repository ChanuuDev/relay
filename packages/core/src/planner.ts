import { RelayError } from "./errors.js";

// ── 일정 관리: Tasks · 업무(칸반) · 캘린더 · 잔디 ────────────────────
// 항목의 모양·검사·보드 배치·잔디 집계는 로컬 서버(Bun/SQLite)와 원격 서버(NestJS/PostgreSQL), 화면이 같이 쓴다.

/** 칸반 칸이자 Task의 진행 상태. 순서가 보드의 왼쪽→오른쪽이다. */
export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: "할 일", doing: "진행 중", review: "검토", done: "완료" };

/** 일을 지시할 에이전트. Relay의 Provider 하나가 에이전트 하나다(`relay record --provider`와 같은 값). */
export const TASK_PROVIDERS = ["anthropic", "openai", "xai", "cursor"] as const;
export type TaskProvider = (typeof TASK_PROVIDERS)[number];
export const TASK_AGENTS: Record<TaskProvider, { agent: string; label: string; company: string }> = {
  anthropic: { agent: "claude-code", label: "Claude Code", company: "Anthropic" },
  openai: { agent: "codex", label: "Codex", company: "OpenAI" },
  xai: { agent: "grok", label: "Grok", company: "xAI" },
  cursor: { agent: "cursor-agent", label: "Cursor", company: "Cursor" },
};

/** 할 일 하나. board가 true면 업무 보드의 status 칸에 position 순서로 놓이고, false면(완료가 아니면) 인벤토리에 있다. */
export type Task = {
  id: string; title: string; project: string; memo: string;
  provider: TaskProvider | null; status: TaskStatus; board: boolean; position: number | null;
  /** 첨부한 Relay 메모 ID */
  notes: string[];
  createdAt: number; updatedAt: number;
  /** status가 done이 된 시각. done이 아니면 null이다. */
  completedAt: number | null;
};

export const EVENT_COLORS = ["blue", "green", "orange", "red", "purple", "gray"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];
export type EventAttachment = { kind: "note" | "task"; id: string };
/** 캘린더 일정. 종일 일정은 start·end가 날짜(YYYY-MM-DD, 끝 날짜 포함)이고, 시간 일정은 시간대 없는 벽시계 시각(YYYY-MM-DDTHH:MM)이다. */
export type CalendarEvent = {
  id: string; title: string; allDay: boolean; start: string; end: string; memo: string; color: EventColor;
  attachments: EventAttachment[]; createdAt: number; updatedAt: number;
};

export type TaskBatch = { upserts: Task[]; deletes: string[] };
export type EventBatch = { upserts: CalendarEvent[]; deletes: string[] };
export type TaskList = { schemaVersion: 1; revision: number; items: Task[] };
export type EventList = { schemaVersion: 1; revision: number; items: CalendarEvent[] };
export type PlannerApplied = { schemaVersion: 1; revision: number };
export type BoardColumn = { status: TaskStatus; label: string; items: Task[] };
export type BoardView = { schemaVersion: 1; revision: number; columns: BoardColumn[]; inventory: Task[] };
export type BoardAction =
  | { action: "place"; id: string; status: TaskStatus; index: number | null }
  | { action: "remove"; id: string }
  | { action: "clear-done" };
export type BoardApplied = { schemaVersion: 1; revision: number; changed: number };
export type TaskFilter = { status?: TaskStatus[]; provider?: TaskProvider | "none"; project?: string; board?: boolean };
export type EventFilter = { from?: string; to?: string };

export const MAX_PLANNER_TITLE = 200;
export const MAX_PLANNER_MEMO = 20_000;
export const MAX_ATTACHMENTS = 50;
/** 한 번에 받는 항목 수. 화면은 고친 항목만 모아 보낸다. */
export const MAX_PLANNER_BATCH = 1000;
/** 잔디 한 번에 보는 최대 날 수. 화면은 53주(371일)를 본다. */
export const MAX_ACTIVITY_DAYS = 400;

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const fail = (message: string): never => { throw new RelayError("INVALID_ARGUMENT", message); };
const object = (value: unknown, field: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field}은(는) 객체여야 합니다.`);
  return value as Record<string, unknown>;
};
export const plannerId = (value: unknown, field: string) => (typeof value === "string" && ID.test(value) ? value : fail(`${field}이(가) 올바르지 않습니다.`));
const time = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
const text = (value: unknown, max: number, field: string) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return fail(`${field}은(는) 문자열이어야 합니다.`);
  if (value.length > max) return fail(`${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};
const oneOf = <T extends string>(value: unknown, list: readonly T[], field: string, fallback?: T): T => {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  return typeof value === "string" && (list as readonly string[]).includes(value) ? value as T : fail(`${field}: ${list.join(" | ")} 중 하나를 입력하세요.`);
};
const position = (value: unknown, field: string) => {
  if (value === undefined || value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : fail(`${field}은(는) 숫자나 null이어야 합니다.`);
};
const batchShape = (raw: unknown) => {
  const value = object(raw, "저장 묶음");
  const { upserts = [], deletes = [] } = value as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) fail("upserts와 deletes는 배열이어야 합니다.");
  if ((upserts as unknown[]).length + (deletes as unknown[]).length > MAX_PLANNER_BATCH) fail(`한 번에 ${MAX_PLANNER_BATCH}개까지 저장합니다.`);
  return { upserts: upserts as unknown[], deletes: (deletes as unknown[]).map((id, index) => plannerId(id, `deletes[${index}]`)) };
};

// ── 날짜 ───────────────────────────────────────────────────
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const realDate = (year: number, month: number, day: number) => {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
/** 달력에 있는 날짜(YYYY-MM-DD)인가 */
export function isDate(value: unknown): value is string {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  return Boolean(match) && realDate(Number(match![1]), Number(match![2]), Number(match![3]));
}
/** 달력에 있는 벽시계 시각(YYYY-MM-DDTHH:MM)인가 */
export function isDateTime(value: unknown): value is string {
  const match = typeof value === "string" ? DATE_TIME.exec(value) : null;
  return Boolean(match) && realDate(Number(match![1]), Number(match![2]), Number(match![3])) && Number(match![4]) < 24 && Number(match![5]) < 60;
}
const utcDay = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const formatUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** date에 days일을 더한 날짜 */
export const addDays = (date: string, days: number) => formatUtc(utcDay(date) + days * 86_400_000);
/** b - a (날 수) */
export const daysBetween = (a: string, b: string) => Math.round((utcDay(b) - utcDay(a)) / 86_400_000);
/** 요일(0=일요일) */
export const weekdayOf = (date: string) => new Date(utcDay(date)).getUTCDay();
/** 일정이 걸친 첫날·끝날 */
export const eventDays = (event: Pick<CalendarEvent, "start" | "end">) => ({ first: event.start.slice(0, 10), last: event.end.slice(0, 10) });

// ── Task ───────────────────────────────────────────────────

/** Task 하나의 모양을 고정한다. 모르는 키는 버리고(목록에서 받은 그대로 다시 보내도 된다), completedAt은 status에 맞춘다. */
export function parseTask(value: unknown, field: string, now: number): Task {
  const entry = object(value, field);
  const notes = entry.notes === undefined || entry.notes === null ? [] : entry.notes;
  if (!Array.isArray(notes)) fail(`${field}.notes는 메모 ID 배열이어야 합니다.`);
  const noteIds = [...new Set((notes as unknown[]).map((id, index) => plannerId(id, `${field}.notes[${index}]`)))];
  if (noteIds.length > MAX_ATTACHMENTS) fail(`${field}.notes는 ${MAX_ATTACHMENTS}개까지 첨부합니다.`);
  const status = oneOf(entry.status, TASK_STATUSES, `${field}.status`, "todo");
  if (entry.board !== undefined && typeof entry.board !== "boolean") fail(`${field}.board는 true 또는 false여야 합니다.`);
  const updatedAt = time(entry.updatedAt, now);
  return {
    id: plannerId(entry.id, `${field}.id`),
    title: text(entry.title, MAX_PLANNER_TITLE, "제목"),
    project: text(entry.project, MAX_PLANNER_TITLE, "프로젝트"),
    memo: text(entry.memo, MAX_PLANNER_MEMO, "메모"),
    provider: entry.provider === undefined || entry.provider === null || entry.provider === "" ? null : oneOf(entry.provider, TASK_PROVIDERS, `${field}.provider`),
    status,
    board: entry.board === true,
    position: position(entry.position, `${field}.position`),
    notes: noteIds,
    createdAt: time(entry.createdAt, now),
    updatedAt,
    completedAt: status === "done" ? time(entry.completedAt, updatedAt) : null,
  };
}

/** 화면이나 에이전트가 보낸 Task 저장 묶음. 하나라도 틀리면 아무것도 쓰지 않고 거부한다. */
export function parseTaskBatch(raw: unknown, now = Date.now()): TaskBatch {
  const { upserts, deletes } = batchShape(raw);
  return { upserts: upserts.map((value, index) => parseTask(value, `upserts[${index}]`, now)), deletes };
}

/** Task 목록 query. 모두 선택 사항이다. */
export function parseTaskFilter(query: Record<string, string>): TaskFilter {
  const filter: TaskFilter = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === "status") filter.status = value.split(",").map((part) => oneOf(part.trim(), TASK_STATUSES, "status"));
    else if (key === "provider") filter.provider = value === "none" ? "none" : oneOf(value, TASK_PROVIDERS, "provider");
    else if (key === "project") filter.project = text(value, MAX_PLANNER_TITLE, "project");
    else if (key === "board") filter.board = value === "true" ? true : value === "false" ? false : fail("board는 true 또는 false여야 합니다.");
    else fail(`허용하지 않는 query key: ${key}`);
  }
  return filter;
}
export const filterTasks = (tasks: Task[], filter: TaskFilter) => tasks.filter((task) =>
  (!filter.status || filter.status.includes(task.status))
  && (!filter.provider || (filter.provider === "none" ? task.provider === null : task.provider === filter.provider))
  && (filter.project === undefined || task.project === filter.project)
  && (filter.board === undefined || task.board === filter.board));

// ── 업무 보드 ──────────────────────────────────────────────

const byPosition = (a: Task, b: Task) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** 보드의 한 칸(위→아래 순서) */
export const columnOf = (tasks: Task[], status: TaskStatus) => tasks.filter((task) => task.board && task.status === status).sort(byPosition);
/** 인벤토리: 보드에 없고 완료가 아닌 Task(최근에 만든 것부터) */
export const inventoryOf = (tasks: Task[]) => tasks.filter((task) => !task.board && task.status !== "done")
  .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
export const boardView = (tasks: Task[], revision: number): BoardView => ({
  schemaVersion: 1, revision,
  columns: TASK_STATUSES.map((status) => ({ status, label: TASK_STATUS_LABELS[status], items: columnOf(tasks, status) })),
  inventory: inventoryOf(tasks),
});

const withStatus = (task: Task, status: TaskStatus, now: number): Pick<Task, "status" | "completedAt"> =>
  ({ status, completedAt: status === "done" ? (task.status === "done" && task.completedAt !== null ? task.completedAt : now) : null });

/** id를 status 칸의 index 자리(자기를 뺀 목록 기준, null이면 맨 아래)에 놓는다. 바뀐 Task들을 돌려준다.
 *  앞뒤 position의 중간값을 쓰고, 틈이 없거나 순서 없는 카드가 섞여 있으면 그 칸을 1, 2, 3…으로 다시 매긴다. */
export function placeOnBoard(tasks: Task[], id: string, status: TaskStatus, index: number | null, now = Date.now()): Task[] {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw new RelayError("NOT_FOUND", "Task가 없습니다.", 3, 404);
  const column = columnOf(tasks, status).filter((item) => item.id !== id);
  const at = index === null ? column.length : Math.max(0, Math.min(Math.floor(index), column.length));
  const before = column[at - 1]?.position ?? undefined, after = column[at]?.position ?? undefined;
  const moved = (positionValue: number): Task => ({ ...task, board: true, position: positionValue, updatedAt: now, ...withStatus(task, status, now) });
  const unordered = column.some((item) => item.position === null);
  if (!unordered) {
    if (before === undefined && after === undefined) return [moved(1)];
    if (before === undefined) return [moved(after! - 1)];
    if (after === undefined) return [moved(before + 1)];
    if (after! - before! > 1e-6) return [moved((before! + after!) / 2)];
  }
  const ordered = [...column.slice(0, at), task, ...column.slice(at)];
  return ordered.flatMap((item, order) => {
    if (item.id === id) return [moved(order + 1)];
    return item.position === order + 1 ? [] : [{ ...item, position: order + 1, updatedAt: now }];
  });
}

/** 보드에서 내린다. 완료였다면 인벤토리에 보이도록 할 일로 되돌린다. */
export function removeFromBoard(tasks: Task[], id: string, now = Date.now()): Task[] {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw new RelayError("NOT_FOUND", "Task가 없습니다.", 3, 404);
  if (!task.board) return [];
  return [{ ...task, board: false, position: null, updatedAt: now, ...withStatus(task, task.status === "done" ? "todo" : task.status, now) }];
}

/** 보드 동작 하나를 적용해 바뀐 Task들을 돌려준다. */
export function applyBoardAction(tasks: Task[], action: BoardAction, now = Date.now()): Task[] {
  if (action.action === "place") return placeOnBoard(tasks, action.id, action.status, action.index, now);
  if (action.action === "remove") return removeFromBoard(tasks, action.id, now);
  return tasks.filter((task) => task.board && task.status === "done").map((task) => ({ ...task, board: false, position: null, updatedAt: now }));
}

/** 보드 동작 본문 */
export function parseBoardAction(raw: unknown): BoardAction {
  const value = object(raw, "본문");
  const only = (...keys: string[]) => { for (const key of Object.keys(value)) if (key !== "action" && !keys.includes(key)) fail(`허용하지 않는 키: ${key}`); };
  switch (value.action) {
    case "place": {
      only("id", "status", "index");
      const index = value.index === undefined || value.index === null ? null
        : typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 ? value.index : fail("index는 0 이상의 정수여야 합니다.");
      return { action: "place", id: plannerId(value.id, "id"), status: oneOf(value.status, TASK_STATUSES, "status"), index };
    }
    case "remove":
      only("id");
      return { action: "remove", id: plannerId(value.id, "id") };
    case "clear-done":
      only();
      return { action: "clear-done" };
    default:
      return fail("action: place | remove | clear-done 중 하나를 입력하세요.");
  }
}

// ── 캘린더 ─────────────────────────────────────────────────

/** 일정 하나의 모양을 고정한다. 종일이면 날짜, 아니면 벽시계 시각이어야 하고, 끝이 시작보다 앞일 수 없다. */
export function parseEvent(value: unknown, field: string, now: number): CalendarEvent {
  const entry = object(value, field);
  if (typeof entry.allDay !== "boolean") fail(`${field}.allDay는 true 또는 false여야 합니다.`);
  const allDay = entry.allDay as boolean;
  const valid = allDay ? isDate : isDateTime;
  const shape = allDay ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:MM";
  if (!valid(entry.start)) fail(`${field}.start는 ${shape} 형식의 실제 ${allDay ? "날짜" : "시각"}여야 합니다.`);
  if (!valid(entry.end)) fail(`${field}.end는 ${shape} 형식의 실제 ${allDay ? "날짜" : "시각"}여야 합니다.`);
  if ((entry.end as string) < (entry.start as string)) fail(`${field}: 끝이 시작보다 앞일 수 없습니다.`);
  const raw = entry.attachments === undefined || entry.attachments === null ? [] : entry.attachments;
  if (!Array.isArray(raw)) fail(`${field}.attachments는 배열이어야 합니다.`);
  const seen = new Set<string>();
  const attachments: EventAttachment[] = [];
  (raw as unknown[]).forEach((item, index) => {
    const attachment = object(item, `${field}.attachments[${index}]`);
    const kind = oneOf(attachment.kind, ["note", "task"] as const, `${field}.attachments[${index}].kind`);
    const id = plannerId(attachment.id, `${field}.attachments[${index}].id`);
    if (!seen.has(`${kind}:${id}`)) { seen.add(`${kind}:${id}`); attachments.push({ kind, id }); }
  });
  if (attachments.length > MAX_ATTACHMENTS) fail(`${field}.attachments는 ${MAX_ATTACHMENTS}개까지 첨부합니다.`);
  return {
    id: plannerId(entry.id, `${field}.id`),
    title: text(entry.title, MAX_PLANNER_TITLE, "제목"),
    allDay, start: entry.start as string, end: entry.end as string,
    memo: text(entry.memo, MAX_PLANNER_MEMO, "메모"),
    color: oneOf(entry.color, EVENT_COLORS, `${field}.color`, "blue"),
    attachments,
    createdAt: time(entry.createdAt, now),
    updatedAt: time(entry.updatedAt, now),
  };
}

export function parseEventBatch(raw: unknown, now = Date.now()): EventBatch {
  const { upserts, deletes } = batchShape(raw);
  return { upserts: upserts.map((value, index) => parseEvent(value, `upserts[${index}]`, now)), deletes };
}

/** 일정 목록 query: from·to(YYYY-MM-DD) 사이에 걸친 일정만 */
export function parseEventFilter(query: Record<string, string>): EventFilter {
  const filter: EventFilter = {};
  for (const [key, value] of Object.entries(query)) {
    if (key !== "from" && key !== "to") fail(`허용하지 않는 query key: ${key}`);
    if (!isDate(value)) fail(`${key}는 YYYY-MM-DD 형식의 날짜여야 합니다.`);
    filter[key as "from" | "to"] = value;
  }
  if (filter.from && filter.to && filter.to < filter.from) fail("to가 from보다 앞일 수 없습니다.");
  return filter;
}
export const filterEvents = (events: CalendarEvent[], filter: EventFilter) => events.filter((event) => {
  const { first, last } = eventDays(event);
  return (!filter.to || first <= filter.to) && (!filter.from || last >= filter.from);
});
/** 시작 순서(같으면 종일 먼저, 그다음 만든 순서) */
export const compareEvents = (a: CalendarEvent, b: CalendarEvent) =>
  (a.start.slice(0, 10) < b.start.slice(0, 10) ? -1 : a.start.slice(0, 10) > b.start.slice(0, 10) ? 1 : 0)
  || Number(b.allDay) - Number(a.allDay) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || a.createdAt - b.createdAt;

// ── 잔디(세션 기록 활동) ───────────────────────────────────
// 기록 한 번 = 에이전트가 남긴 session_updates 한 행(record·update·continue). 훅이 자동으로 남긴 첫 기록은 세지 않는다.
// 세션은 보관 기간이 지나면 지워지므로, 저장소는 이력이 들어올 때 트리거로 activity_log에 따로 남겨 1년 잔디를 유지한다.
// 날은 화면이 준 시간대(IANA)로 나눈다.

export type ActivityQuery = { from: string; to: string; tz: string; provider: string | null };
export type ActivityDayQuery = { date: string; tz: string; provider: string | null };
/** 저장소가 읽어 오는 기록 한 건 */
export type ActivityRow = { at: number; sessionId: string };
/** 그날 목록에 쓰는 기록 한 건. 세션이 지워졌으면(보관 기간 정리 등) 세션 쪽 값이 null이다. */
export type ActivitySessionRow = ActivityRow & { provider: string; agent: string; providerSessionId: string | null; sessionName: string | null;
  workingDirectory: string | null; status: string | null };
export type ActivityDay = { date: string; count: number; sessions: number };
export type ActivityResult = { schemaVersion: 1; tz: string; from: string; to: string; provider: string | null;
  total: number; activeDays: number; sessions: number; days: ActivityDay[] };
export type ActivitySession = { id: string; provider: string; agent: string; providerSessionId: string | null; sessionName: string | null;
  workingDirectory: string | null; status: string | null; deleted: boolean; count: number; firstAt: string; lastAt: string };
export type ActivityDayResult = { schemaVersion: 1; date: string; tz: string; provider: string | null; total: number; sessions: ActivitySession[] };

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (tz: string) => {
  let format = formatters.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(tz, format);
  }
  return format;
};
/** 시간대 tz에서 ms 시각이 속한 날짜(YYYY-MM-DD) */
export function dayKey(ms: number, tz: string) {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** IANA 시간대 이름인가 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try { formatter(value); return true; } catch { return false; }
}
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const zone = (value: string | undefined, fallback: string) => {
  if (value === undefined) return fallback;
  return isTimeZone(value) ? value : fail("tz는 IANA 시간대 이름이어야 합니다(예: Asia/Seoul).");
};
const provider = (value: string | undefined) => (value === undefined || value === "" ? null : PROVIDER.test(value) ? value : fail("provider가 올바르지 않습니다."));

/** 잔디 query. 기본은 오늘(그 시간대)까지 365일이다. */
export function parseActivityQuery(query: Record<string, string>, defaults: { tz: string; now?: number }): ActivityQuery {
  for (const key of Object.keys(query)) if (!["from", "to", "tz", "provider"].includes(key)) fail(`허용하지 않는 query key: ${key}`);
  const tz = zone(query.tz, defaults.tz);
  for (const key of ["from", "to"] as const) if (query[key] !== undefined && !isDate(query[key])) fail(`${key}는 YYYY-MM-DD 형식의 날짜여야 합니다.`);
  const to = query.to ?? dayKey(defaults.now ?? Date.now(), tz);
  const from = query.from ?? addDays(to, -364);
  if (to < from) fail("to가 from보다 앞일 수 없습니다.");
  if (daysBetween(from, to) + 1 > MAX_ACTIVITY_DAYS) fail(`잔디는 한 번에 ${MAX_ACTIVITY_DAYS}일까지 봅니다.`);
  return { from, to, tz, provider: provider(query.provider) };
}
export function parseActivityDayQuery(query: Record<string, string>, defaults: { tz: string }): ActivityDayQuery {
  for (const key of Object.keys(query)) if (!["date", "tz", "provider"].includes(key)) fail(`허용하지 않는 query key: ${key}`);
  if (!isDate(query.date)) fail("date는 YYYY-MM-DD 형식의 날짜여야 합니다.");
  return { date: query.date, tz: zone(query.tz, defaults.tz), provider: provider(query.provider) };
}
/** 저장소가 읽을 UTC 범위(ms). 시간대 차이(-12h…+14h)를 넉넉히 덮고, 정확한 날 나누기는 dayKey가 한다. */
export const activityWindow = (from: string, to: string) => ({ start: utcDay(from) - 15 * 3_600_000, end: utcDay(to) + 39 * 3_600_000 });

/** 기록을 날마다 센다. 기록 있는 날만 날짜 순으로 돌려준다. */
export function bucketActivity(rows: ActivityRow[], query: ActivityQuery): ActivityResult {
  const days = new Map<string, { count: number; sessions: Set<string> }>();
  const all = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const date = dayKey(row.at, query.tz);
    if (date < query.from || date > query.to) continue;
    let day = days.get(date);
    if (!day) { day = { count: 0, sessions: new Set() }; days.set(date, day); }
    day.count++; day.sessions.add(row.sessionId); all.add(row.sessionId); total++;
  }
  return { schemaVersion: 1, tz: query.tz, from: query.from, to: query.to, provider: query.provider, total, activeDays: days.size, sessions: all.size,
    days: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, day]) => ({ date, count: day.count, sessions: day.sessions.size })) };
}

/** 그날 기록한 세션(마지막 기록이 늦은 것부터). */
export function daySessions(rows: ActivitySessionRow[], query: ActivityDayQuery): ActivityDayResult {
  const sessions = new Map<string, ActivitySession & { first: number; last: number }>();
  let total = 0;
  for (const row of rows) {
    if (dayKey(row.at, query.tz) !== query.date) continue;
    total++;
    const found = sessions.get(row.sessionId);
    if (found) { found.count++; found.first = Math.min(found.first, row.at); found.last = Math.max(found.last, row.at); continue; }
    sessions.set(row.sessionId, { id: row.sessionId, provider: row.provider, agent: row.agent, providerSessionId: row.providerSessionId, sessionName: row.sessionName,
      workingDirectory: row.workingDirectory, status: row.status, deleted: row.providerSessionId === null, count: 1, firstAt: "", lastAt: "", first: row.at, last: row.at });
  }
  return { schemaVersion: 1, date: query.date, tz: query.tz, provider: query.provider, total,
    sessions: [...sessions.values()].sort((a, b) => b.last - a.last).map(({ first, last, ...session }) =>
      ({ ...session, firstAt: new Date(first).toISOString(), lastAt: new Date(last).toISOString() })) };
}

/** 연속 기록: today에서 거꾸로 이어진 날 수(오늘 기록이 없으면 어제부터)와 가장 긴 연속. */
export function activityStreaks(days: Array<Pick<ActivityDay, "date" | "count">>, today: string) {
  const active = new Set(days.filter((day) => day.count > 0).map((day) => day.date));
  let longest = 0, run = 0, previous: string | null = null;
  for (const date of [...active].sort()) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  let current = 0;
  for (let date = active.has(today) ? today : addDays(today, -1); active.has(date); date = addDays(date, -1)) current++;
  return { current, longest };
}
