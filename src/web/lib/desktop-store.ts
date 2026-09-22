import { create } from "zustand";
import { APPS, APP_IDS, DOCK_RESERVED, GUIDE_MIN_VIEWPORT, MAX_Z, MENU_BAR_HEIGHT, MOBILE_DOCK_HEIGHT, MOBILE_MAX_WIDTH, type AppId, type Box } from "./app-config";

export type Win = { open: boolean; minimized: boolean; maximized: boolean; x: number; y: number; w: number; h: number; z: number };
export type Windows = Record<AppId, Win>;

const STORE_KEY = "relay-desktop-v1";

export const isMobileWidth = (width: number) => width <= MOBILE_MAX_WIDTH;
export const reservedBottom = (mobile: boolean) => (mobile ? MOBILE_DOCK_HEIGHT : DOCK_RESERVED);

export function clampBox(box: Box, W: number, H: number, min: { w: number; h: number }): Box {
  const w = Math.max(min.w, Math.min(box.w, Math.max(min.w, W)));
  const h = Math.max(min.h, Math.min(box.h, Math.max(min.h, H - MENU_BAR_HEIGHT - DOCK_RESERVED)));
  const x = Math.min(Math.max(box.x, 0), Math.max(0, W - w));
  const y = Math.min(Math.max(box.y, MENU_BAR_HEIGHT), Math.max(MENU_BAR_HEIGHT, H - DOCK_RESERVED - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function defaults(W: number, H: number, mobile: boolean): Windows {
  const guideOpen = !mobile && W >= GUIDE_MIN_VIEWPORT;
  const make = (id: AppId, open: boolean, z: number): Win =>
    ({ ...clampBox(APPS[id].box(W, H), W, H, APPS[id].min), open, minimized: false, maximized: false, z });
  // 가이드가 먼저 z를 받아 세션 창 뒤에 놓인다.
  return { guide: make("guide", guideOpen, 1), sessions: make("sessions", true, 2), command: make("command", false, 0), settings: make("settings", false, 0) };
}

type Saved = Record<string, Partial<Win>>;
function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; windows?: Saved };
    if (parsed?.version !== 1 || !parsed.windows || typeof parsed.windows !== "object") return null;
    return parsed.windows;
  } catch { return null; }
}

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

function restore(W: number, H: number, mobile: boolean): Windows {
  const base = defaults(W, H, mobile);
  const saved = mobile ? null : loadSaved();
  if (!saved) {
    if (!mobile) return base;
    // 모바일은 저장 배치를 무시하고 세션 창 하나로 시작한다.
    return { ...base, guide: { ...base.guide, open: false } };
  }
  let z = 0;
  const windows = { ...base };
  for (const id of APP_IDS) {
    const entry = saved[id];
    const fallback = base[id];
    if (!entry || typeof entry !== "object") { windows[id] = { ...fallback, open: id === "sessions" ? fallback.open : false }; continue; }
    const box = clampBox({ x: num(entry.x, fallback.x), y: num(entry.y, fallback.y), w: num(entry.w, fallback.w), h: num(entry.h, fallback.h) }, W, H, APPS[id].min);
    const open = id === "sessions" ? true : bool(entry.open, false);
    // 최대화는 사용자가 직접 켠 상태일 때만 복원한다(닫힌 창은 항상 보통 크기로 돌아온다).
    windows[id] = { ...box, open, minimized: open && bool(entry.minimized, false), maximized: open && bool(entry.maximized, false), z: open ? ++z : 0 };
  }
  // 시작 시 세션 창은 항상 열려 있고 맨 앞에 있다.
  windows.sessions = { ...windows.sessions, open: true, minimized: false, z: ++z };
  return windows;
}

const topmost = (windows: Windows, skip?: AppId): AppId | null => {
  const visible = APP_IDS.filter((id) => id !== skip && windows[id].open && !windows[id].minimized);
  return visible.length ? visible.reduce((best, id) => (windows[id].z > windows[best].z ? id : best)) : null;
};

interface DesktopState {
  windows: Windows;
  focused: AppId | null;
  nextZ: number;
  mobile: boolean;
  open: (id: AppId) => void;
  close: (id: AppId) => void;
  focus: (id: AppId) => void;
  minimize: (id: AppId) => void;
  toggleMaximize: (id: AppId) => void;
  move: (id: AppId, x: number, y: number) => void;
  resize: (id: AppId, w: number, h: number, x?: number, y?: number) => void;
  resetLayout: () => void;
  setMobile: (mobile: boolean) => void;
  clampAll: (W: number, H: number) => void;
}

function raise(state: DesktopState, id: AppId, patch: Partial<Win> = {}) {
  let nextZ = state.nextZ;
  let windows: Windows = { ...state.windows, [id]: { ...state.windows[id], open: true, minimized: false, ...patch, z: nextZ } };
  nextZ += 1;
  if (nextZ > MAX_Z) {
    const order = APP_IDS.filter((app) => windows[app].open).sort((a, b) => windows[a].z - windows[b].z);
    windows = { ...windows };
    order.forEach((app, index) => { windows[app] = { ...windows[app], z: index + 1 }; });
    nextZ = order.length + 1;
  }
  return { windows, nextZ, focused: id };
}

function initialState() {
  const W = window.innerWidth, H = window.innerHeight;
  const mobile = isMobileWidth(W);
  const windows = restore(W, H, mobile);
  const nextZ = Math.max(0, ...APP_IDS.map((id) => windows[id].z)) + 1;
  return { windows, focused: "sessions" as AppId | null, nextZ, mobile };
}

export const useDesktop = create<DesktopState>((set, get) => ({
  ...initialState(),
  open: (id) => set((state) => raise(state, id)),
  focus: (id) => set((state) => (state.focused === id && state.windows[id].open && !state.windows[id].minimized ? state : raise(state, id))),
  close: (id) => set((state) => {
    const windows: Windows = { ...state.windows, [id]: { ...state.windows[id], open: false, minimized: false, z: 0 } };
    return { windows, focused: topmost(windows) };
  }),
  minimize: (id) => set((state) => {
    const windows: Windows = { ...state.windows, [id]: { ...state.windows[id], minimized: true } };
    return { windows, focused: topmost(windows) };
  }),
  toggleMaximize: (id) => set((state) => raise(state, id, { maximized: !state.windows[id].maximized })),
  move: (id, x, y) => set((state) => ({ windows: { ...state.windows, [id]: { ...state.windows[id], x: Math.round(x), y: Math.round(y) } } })),
  resize: (id, w, h, x, y) => set((state) => ({ windows: { ...state.windows, [id]: {
    ...state.windows[id], w: Math.round(w), h: Math.round(h),
    ...(x === undefined ? {} : { x: Math.round(x) }), ...(y === undefined ? {} : { y: Math.round(y) }) } } })),
  resetLayout: () => set(() => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* 저장소가 없어도 기본 배치는 적용된다. */ }
    const mobile = get().mobile;
    const windows = defaults(window.innerWidth, window.innerHeight, mobile);
    return { windows, focused: "sessions", nextZ: 3, mobile };
  }),
  setMobile: (mobile) => set((state) => (state.mobile === mobile ? state : { mobile })),
  clampAll: (W, H) => set((state) => {
    if (state.mobile) return state;
    const windows = { ...state.windows };
    for (const id of APP_IDS) windows[id] = { ...windows[id], ...clampBox(windows[id], W, H, APPS[id].min) };
    return { windows };
  }),
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useDesktop.subscribe((state) => {
  if (state.mobile) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const windows: Saved = {};
    for (const id of APP_IDS) {
      const { open, minimized, maximized, x, y, w, h } = state.windows[id];
      windows[id] = { open, minimized, maximized, x, y, w, h };
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, windows })); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
  }, 200);
});
