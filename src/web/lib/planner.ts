import { create } from "zustand";
import { placeOnBoard, removeFromBoard, TASK_AGENTS, TASK_STATUS_LABELS, type CalendarEvent, type Task, type TaskProvider, type TaskStatus } from "@relay/core";
import { useDesktop } from "./desktop-store";
import { useNotes, labelOf as noteLabel } from "./notes";
import { navigate } from "./store";

/* 일정 관리(Tasks · 업무 보드 · 캘린더)의 화면 상태. 내용은 Relay 저장소에 두고 `/api/v1/tasks`·`/api/v1/events`로 읽고 쓴다.
   고치면 화면에 바로 보이고 0.3초 모아 보낸다. 보내지 못한 변경은 이 브라우저에 남겨 두었다가 연결되면 다시 보낸다(메모 앱과 같은 규칙). */

export type { CalendarEvent, Task, TaskProvider, TaskStatus };
export { TASK_AGENTS, TASK_STATUS_LABELS };
const TASKS_API = "/api/v1/tasks";
const EVENTS_API = "/api/v1/events";
const PENDING_KEY = "relay-planner-pending-v1";
const SAVE_DELAY = 300;
const POLL_MS = 3000;

export type PlannerSync = "saved" | "saving" | "offline" | "rejected";
/** 지운 뒤 잠시 되살릴 수 있는 항목 */
export type PlannerTrash = { kind: "task"; item: Task; at: number } | { kind: "event"; item: CalendarEvent; at: number };

interface PlannerState {
  tasks: Record<string, Task>;
  events: Record<string, CalendarEvent>;
  status: "loading" | "ready" | "error";
  sync: PlannerSync;
  /** Tasks 창에서 고른 Task */
  selectedTask: string | null;
  trash: PlannerTrash | null;
  selectTask: (id: string | null) => void;
  createTask: (init?: Partial<Omit<Task, "id">>) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "createdAt">>) => void;
  /** 상태만 바꾼다. 완료로 바꾸면 완료 시각을 남기고, 보드에 있으면 그 칸 맨 아래로 간다. */
  setTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  /** 업무 보드의 status 칸 index 자리에 놓는다(null이면 맨 아래). */
  placeTask: (id: string, status: TaskStatus, index: number | null) => void;
  unboardTask: (id: string) => void;
  /** 완료 칸을 비운다(Task는 Tasks에 남는다). */
  clearDone: () => void;
  createEvent: (init: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">) => string;
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, "id" | "createdAt">>) => void;
  removeEvent: (id: string) => void;
  undoRemove: () => void;
  dismissTrash: () => void;
}

type Entry<T> = { value: T | null; stamp: number };
const pending = { tasks: new Map<string, Entry<Task>>(), events: new Map<string, Entry<CalendarEvent>>() };
const server = { tasks: {} as Record<string, Task>, events: {} as Record<string, CalendarEvent> };
let stamp = 0;
let revision = -1;
let flushing = false;
let polling = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 3000;

const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function readPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { tasks?: Record<string, Task | null>; events?: Record<string, CalendarEvent | null> } | null;
    for (const [id, value] of Object.entries(raw?.tasks ?? {})) pending.tasks.set(id, { value, stamp: ++stamp });
    for (const [id, value] of Object.entries(raw?.events ?? {})) pending.events.set(id, { value, stamp: ++stamp });
  } catch { /* 저장된 변경이 없거나 깨졌으면 비운 채 시작한다. */ }
}
function writePending() {
  try {
    if (!hasPending()) { localStorage.removeItem(PENDING_KEY); return; }
    const pick = <T,>(map: Map<string, Entry<T>>) => Object.fromEntries([...map].map(([id, entry]) => [id, entry.value]));
    localStorage.setItem(PENDING_KEY, JSON.stringify({ tasks: pick(pending.tasks), events: pick(pending.events) }));
  } catch { /* 저장 공간이 없어도 이 창에서는 보인다. */ }
}
const hasPending = () => pending.tasks.size > 0 || pending.events.size > 0;
const overlay = <T,>(base: Record<string, T>, changes: Map<string, Entry<T>>) => {
  const result = { ...base };
  for (const [id, entry] of changes) { if (entry.value === null) delete result[id]; else result[id] = entry.value; }
  return result;
};
const refresh = () => usePlanner.setState({ tasks: overlay(server.tasks, pending.tasks), events: overlay(server.events, pending.events) });
const setSync = (sync: PlannerSync) => { if (usePlanner.getState().sync !== sync) usePlanner.setState({ sync }); };

function queueTasks(items: Task[]) {
  for (const task of items) pending.tasks.set(task.id, { value: task, stamp: ++stamp });
  refresh(); writePending(); schedule();
}
function queueEvent(id: string, value: CalendarEvent | null) {
  pending.events.set(id, { value, stamp: ++stamp });
  refresh(); writePending(); schedule();
}
function schedule(delay = SAVE_DELAY) {
  if (usePlanner.getState().sync === "rejected") setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), delay);
}

class Rejected extends Error {}
/** 한 종류의 변경을 묶어 보낸다. 보내는 사이 다시 고친 항목은 남겨 두었다가 다음에 보낸다. */
async function send<T>(url: string, map: Map<string, Entry<T>>, base: Record<string, T>) {
  const sent = [...map];
  if (!sent.length) return null;
  const response = await fetch(url, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upserts: sent.filter(([, entry]) => entry.value !== null).map(([, entry]) => entry.value), deletes: sent.filter(([, entry]) => entry.value === null).map(([id]) => id) }) });
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    // 받지 않는 변경은 버려 다른 변경이 막히지 않게 한다. 화면은 서버 목록으로 돌아간다.
    for (const [id, entry] of sent) if (map.get(id)?.stamp === entry.stamp) map.delete(id);
    throw new Rejected(String(response.status));
  }
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json() as { revision: number };
  for (const [id, entry] of sent) {
    if (entry.value === null) delete base[id]; else base[id] = entry.value;
    if (map.get(id)?.stamp === entry.stamp) map.delete(id);
  }
  return data.revision;
}

/** 모아 둔 변경을 서버에 보낸다. */
export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (flushing || usePlanner.getState().status !== "ready" || !hasPending()) return;
  flushing = true;
  setSync("saving");
  let retry = false, rejected = false, missed = false;
  try {
    for (const [url, map, base] of [[TASKS_API, pending.tasks, server.tasks], [EVENTS_API, pending.events, server.events]] as const) {
      try {
        const next = await send(url, map as Map<string, Entry<unknown>>, base as Record<string, unknown>);
        if (next !== null) { missed ||= next !== revision + 1; revision = next; }
      } catch (error) {
        if (!(error instanceof Rejected)) throw error;
        rejected = true; missed = true;
      }
    }
    retryDelay = 3000;
    setSync(rejected ? "rejected" : hasPending() ? "saving" : "saved");
  } catch {
    setSync("offline");
    retry = true;
  } finally {
    flushing = false;
    writePending();
    refresh();
    if (retry) { schedule(retryDelay); retryDelay = Math.min(retryDelay * 2, 30000); setSync("offline"); }
    else if (hasPending()) schedule();
    if (missed) void poll(true);
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 서버 목록을 반영한다. 내용이 같은 항목은 이전 객체를 다시 써서 화면이 다시 그리지 않게 한다. */
function applyRemote(tasks: Task[], events: CalendarEvent[]) {
  const keep = <T extends { id: string }>(list: T[], previous: Record<string, T>) =>
    Object.fromEntries(list.map((item) => [item.id, previous[item.id] && same(previous[item.id], item) ? previous[item.id]! : item]));
  server.tasks = keep(tasks, server.tasks);
  server.events = keep(events, server.events);
  const state = usePlanner.getState();
  refresh();
  const next = usePlanner.getState();
  usePlanner.setState({ status: "ready", selectedTask: state.selectedTask && next.tasks[state.selectedTask] ? state.selectedTask : null });
}

/** 저장 번호가 바뀌었을 때만 목록을 다시 받는다. Task와 일정은 같은 번호를 쓴다. */
async function poll(force = false) {
  if (polling || flushing || (!force && document.hidden)) return;
  polling = true;
  try {
    const head = await fetch(TASKS_API, { cache: "no-store", headers: revision >= 0 && !force ? { "If-None-Match": `"${revision}"` } : {} });
    if (head.status === 304) return;
    if (!head.ok) throw new Error(String(head.status));
    const tasks = await head.json() as { revision: number; items: Task[] };
    const events = await fetch(EVENTS_API, { cache: "no-store" });
    if (!events.ok) throw new Error(String(events.status));
    const eventList = await events.json() as { revision: number; items: CalendarEvent[] };
    if (flushing || tasks.revision < revision) return;
    revision = Math.max(tasks.revision, eventList.revision);
    applyRemote(tasks.items, eventList.items);
  } catch {
    if (usePlanner.getState().status === "loading") usePlanner.setState({ status: "error" });
  } finally { polling = false; }
}

const freshTask = (init: Partial<Omit<Task, "id">> = {}): Task => {
  const now = Date.now();
  return { id: newId(), title: "", project: "", memo: "", provider: null, status: "todo", board: false, position: null, notes: [], createdAt: now, updatedAt: now,
    completedAt: null, ...init };
};

export const usePlanner = create<PlannerState>((set, get) => ({
  tasks: {}, events: {}, status: "loading", sync: "saved", selectedTask: null, trash: null,
  selectTask: (id) => set({ selectedTask: id }),
  createTask: (init) => {
    const task = freshTask(init);
    if (task.status === "done") task.completedAt = task.createdAt;
    if (task.board) {
      // 보드에 바로 만들면 그 칸 맨 아래에 놓는다.
      const placed = placeOnBoard([...Object.values(get().tasks), { ...task, board: false }], task.id, task.status, null, task.createdAt);
      queueTasks(placed);
    } else queueTasks([task]);
    return task.id;
  },
  updateTask: (id, patch) => {
    const task = get().tasks[id];
    if (!task) return;
    queueTasks([{ ...task, ...patch, updatedAt: Date.now() }]);
  },
  setTaskStatus: (id, status) => {
    const task = get().tasks[id];
    if (!task || task.status === status) return;
    if (task.board) { queueTasks(placeOnBoard(Object.values(get().tasks), id, status, null)); return; }
    const now = Date.now();
    queueTasks([{ ...task, status, completedAt: status === "done" ? now : null, updatedAt: now }]);
  },
  removeTask: (id) => {
    const task = get().tasks[id];
    if (!task) return;
    pending.tasks.set(id, { value: null, stamp: ++stamp });
    refresh(); writePending(); schedule();
    set({ trash: { kind: "task", item: task, at: Date.now() }, selectedTask: get().selectedTask === id ? null : get().selectedTask });
  },
  placeTask: (id, status, index) => queueTasks(placeOnBoard(Object.values(get().tasks), id, status, index)),
  unboardTask: (id) => queueTasks(removeFromBoard(Object.values(get().tasks), id)),
  clearDone: () => {
    const now = Date.now();
    queueTasks(Object.values(get().tasks).filter((task) => task.board && task.status === "done").map((task) => ({ ...task, board: false, position: null, updatedAt: now })));
  },
  createEvent: (init) => {
    const now = Date.now();
    const event: CalendarEvent = { ...init, id: newId(), createdAt: now, updatedAt: now };
    queueEvent(event.id, event);
    return event.id;
  },
  updateEvent: (id, patch) => {
    const event = get().events[id];
    if (event) queueEvent(id, { ...event, ...patch, updatedAt: Date.now() });
  },
  removeEvent: (id) => {
    const event = get().events[id];
    if (!event) return;
    queueEvent(id, null);
    set({ trash: { kind: "event", item: event, at: Date.now() } });
  },
  undoRemove: () => {
    const trash = get().trash;
    if (!trash) return;
    if (trash.kind === "task") queueTasks([{ ...trash.item, updatedAt: Date.now() }]);
    else queueEvent(trash.item.id, { ...trash.item, updatedAt: Date.now() });
    set({ trash: null, ...(trash.kind === "task" ? { selectedTask: trash.item.id } : {}) });
  },
  dismissTrash: () => set({ trash: null }),
}));

// ── 이름과 다른 앱 열기 ───────────────────────────────────

export const taskLabel = (task: Pick<Task, "title">) => task.title.trim() || "제목 없는 Task";
export const eventLabel = (event: Pick<CalendarEvent, "title">) => event.title.trim() || "새 일정";
export const agentLabel = (provider: TaskProvider | null) => (provider ? TASK_AGENTS[provider].label : "지정 안 함");
export const providerIcon = (provider: string) => `/icons/providers/${provider}.png`;
export const PROVIDER_ORDER: TaskProvider[] = ["anthropic", "openai", "xai", "cursor"];

/** 메모 이름. 지워졌거나 아직 받지 못한 메모면 null이다. */
export function noteTitle(id: string) {
  const item = useNotes.getState().items[id];
  return item?.kind === "note" ? noteLabel(item) : null;
}

/** 메모 앱에서 그 메모를 연다. */
export function openNote(id: string) {
  useNotes.getState().select(id);
  useDesktop.getState().open("notes");
}
/** Tasks 앱에서 그 Task를 고른다. */
export function openTask(id: string) {
  usePlanner.getState().selectTask(id);
  useDesktop.getState().open("tasks");
}
/** 세션 창에서 그 세션 상세를 연다. */
export function openSession(id: string) {
  navigate(`/sessions/${encodeURIComponent(id)}`);
  useDesktop.getState().open("sessions");
}

/** 에이전트에게 붙여 넣을 지시문. 에이전트는 첨부 메모를 `relay memo --find`로 읽고, 끝나면 보드 API로 상태를 옮긴다. */
export function taskPrompt(task: Task, origin = location.origin) {
  const lines = [`Relay Task를 처리해 주세요. Task ID: ${task.id}`, "", `제목: ${taskLabel(task)}`];
  if (task.project.trim()) lines.push(`프로젝트: ${task.project.trim()}`);
  if (task.provider) lines.push(`담당 에이전트: ${TASK_AGENTS[task.provider].label} (${TASK_AGENTS[task.provider].company})`);
  lines.push(`상태: ${TASK_STATUS_LABELS[task.status]}`);
  if (task.memo.trim()) lines.push("", "내용:", task.memo.trim());
  if (task.notes.length) {
    lines.push("", "첨부 메모(relay memo --find <ID>로 읽으세요):");
    for (const id of task.notes) lines.push(`- ${noteTitle(id) ?? "메모"} · 메모 ID: ${id}`);
  }
  lines.push("", `진행 상태는 업무 보드 API로 바꿀 수 있습니다: POST ${origin}/api/v1/board {"action":"place","id":"${task.id}","status":"doing|review|done"} (헤더 Origin: ${origin})`);
  return lines.join("\n");
}

// ── 날짜 ───────────────────────────────────────────────────

const pad = (value: number) => String(value).padStart(2, "0");
/** 이 컴퓨터 시간대의 날짜(YYYY-MM-DD) */
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const todayKey = () => dateKey(new Date());
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
/** YYYY-MM-DD를 이 컴퓨터의 자정 Date로 */
export const parseDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

// ── 시작 ───────────────────────────────────────────────────

readPending();
refresh();
async function start() {
  await poll(true);
  if (usePlanner.getState().status !== "ready") { setTimeout(() => void start(), 3000); return; }
  if (hasPending()) schedule(0);
  setInterval(() => void poll(), POLL_MS);
}
function leaveNow() {
  writePending();
  if (!hasPending() || usePlanner.getState().status !== "ready") return;
  const body = (map: Map<string, Entry<unknown>>) => JSON.stringify({ upserts: [...map.values()].filter((entry) => entry.value !== null).map((entry) => entry.value),
    deletes: [...map].filter(([, entry]) => entry.value === null).map(([id]) => id) });
  for (const [url, map] of [[TASKS_API, pending.tasks], [EVENTS_API, pending.events]] as const) {
    if (!map.size) continue;
    const text = body(map as Map<string, Entry<unknown>>);
    if (text.length < 60_000) void fetch(url, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: text }).catch(() => {});
  }
}
window.addEventListener("pagehide", leaveNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); else void poll(); });
void start();
