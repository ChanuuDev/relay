import { create } from "zustand";
import { APPS, APP_IDS, PRIMARY_APP, type AppId } from "@/apps";
import { DOCK_RESERVED, MAX_Z, isMobileWidth, menuBarHeight, type Box } from "./layout";
import { captureFrame } from "./motion";

/** 창 하나의 상태. 좌표는 px, z는 1–MAX_Z. */
export type Win = { open: boolean; minimized: boolean; maximized: boolean; x: number; y: number; w: number; h: number; z: number };
export type Windows = Record<AppId, Win>;
/** 종료·최소화 애니메이션이 끝날 때까지만 켜지는 과도 상태. 컴포넌트가 트윈을 마친 뒤 finalize*를 부른다. */
export type Transient = Partial<Record<AppId, boolean>>;

const STORE_KEY = "app-desktop-v1";

/** 창을 화면 안(메뉴바 아래 ~ Dock 예약 위)으로 맞춘다. */
export function clampBox(box: Box, W: number, H: number, min: { w: number; h: number }): Box {
  const top = menuBarHeight();
  const w = Math.max(min.w, Math.min(box.w, Math.max(min.w, W)));
  const h = Math.max(min.h, Math.min(box.h, Math.max(min.h, H - top - DOCK_RESERVED)));
  const x = Math.min(Math.max(box.x, 0), Math.max(0, W - w));
  const y = Math.min(Math.max(box.y, top), Math.max(top, H - DOCK_RESERVED - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function defaults(W: number, H: number, mobile: boolean): Windows {
  const windows = {} as Windows;
  let z = 0;
  for (const id of APP_IDS) {
    const open = id === PRIMARY_APP || (!mobile && Boolean(APPS[id].openByDefault?.(W)));
    windows[id] = { ...clampBox(APPS[id].box(W, H), W, H, APPS[id].min), open, minimized: false, maximized: false, z: open && id !== PRIMARY_APP ? ++z : 0 };
  }
  // 주 창은 맨 앞
  windows[PRIMARY_APP] = { ...windows[PRIMARY_APP], z: ++z };
  return windows;
}

type Saved = Record<string, Partial<Win>>;
function loadSaved(): Saved | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { version?: number; windows?: Saved } | null;
    return parsed?.version === 1 && parsed.windows && typeof parsed.windows === "object" ? parsed.windows : null;
  } catch { return null; }
}

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

function restore(W: number, H: number, mobile: boolean): Windows {
  const base = defaults(W, H, mobile);
  const saved = mobile ? null : loadSaved();
  if (!saved) return base;
  let z = 0;
  const windows = { ...base };
  for (const id of APP_IDS) {
    const entry = saved[id];
    const fallback = base[id];
    if (!entry || typeof entry !== "object") { windows[id] = { ...fallback, open: id === PRIMARY_APP }; continue; }
    const box = clampBox({ x: num(entry.x, fallback.x), y: num(entry.y, fallback.y), w: num(entry.w, fallback.w), h: num(entry.h, fallback.h) }, W, H, APPS[id].min);
    const open = id === PRIMARY_APP ? true : bool(entry.open, false);
    windows[id] = { ...box, open, minimized: open && bool(entry.minimized, false), maximized: open && bool(entry.maximized, false), z: open ? ++z : 0 };
  }
  windows[PRIMARY_APP] = { ...windows[PRIMARY_APP], open: true, minimized: false, z: ++z };
  return windows;
}

const topmost = (windows: Windows, busy: { closing: Transient; minimizing: Transient }, skip?: AppId): AppId | null => {
  const visible = APP_IDS.filter((id) => id !== skip && !busy.closing[id] && !busy.minimizing[id] && windows[id].open && !windows[id].minimized);
  return visible.length ? visible.reduce((best, id) => (windows[id].z > windows[best].z ? id : best)) : null;
};

const without = (map: Transient, id: AppId): Transient => {
  if (!map[id]) return map;
  const next = { ...map }; delete next[id]; return next;
};

interface DesktopState {
  windows: Windows;
  focused: AppId | null;
  nextZ: number;
  mobile: boolean;
  closing: Transient;
  minimizing: Transient;
  open: (id: AppId) => void;
  close: (id: AppId) => void;
  finalizeClose: (id: AppId) => void;
  focus: (id: AppId) => void;
  minimize: (id: AppId) => void;
  finalizeMinimize: (id: AppId) => void;
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
  // 닫는 중·줄이는 중에 다시 열면 과도 상태를 걷어 낸다.
  return { windows, nextZ, focused: id, closing: without(state.closing, id), minimizing: without(state.minimizing, id) };
}

function initialState() {
  const W = window.innerWidth, H = window.innerHeight;
  const mobile = isMobileWidth(W);
  const windows = restore(W, H, mobile);
  const nextZ = Math.max(0, ...APP_IDS.map((id) => windows[id].z)) + 1;
  return { windows, focused: PRIMARY_APP as AppId | null, nextZ, mobile, closing: {} as Transient, minimizing: {} as Transient };
}

export const useDesktop = create<DesktopState>((set, get) => ({
  ...initialState(),
  open: (id) => set((state) => raise(state, id)),
  focus: (id) => set((state) => (state.focused === id && state.windows[id].open && !state.windows[id].minimized ? state : raise(state, id))),
  close: (id) => set((state) => (state.closing[id] || !state.windows[id].open ? state : {
    closing: { ...state.closing, [id]: true },
    focused: topmost(state.windows, state, id),
  })),
  finalizeClose: (id) => set((state) => {
    if (!state.closing[id]) return state;
    const windows: Windows = { ...state.windows, [id]: { ...state.windows[id], open: false, minimized: false, z: 0 } };
    const closing = without(state.closing, id);
    return { windows, closing, focused: topmost(windows, { closing, minimizing: state.minimizing }) };
  }),
  minimize: (id) => set((state) => {
    const win = state.windows[id];
    if (!win.open || win.minimized || state.minimizing[id] || state.closing[id]) return state;
    return { minimizing: { ...state.minimizing, [id]: true }, focused: topmost(state.windows, state, id) };
  }),
  finalizeMinimize: (id) => set((state) => {
    if (!state.minimizing[id]) return state;
    const windows: Windows = { ...state.windows, [id]: { ...state.windows[id], minimized: true } };
    const minimizing = without(state.minimizing, id);
    return { windows, minimizing, focused: topmost(windows, { closing: state.closing, minimizing }) };
  }),
  // 최대화는 상태를 바꾸기 전에 프레임 모양을 떠 두고(Flip), 컴포넌트가 그 상태에서 새 자리로 옮긴다.
  toggleMaximize: (id) => { captureFrame(id); set((state) => raise(state, id, { maximized: !state.windows[id].maximized })); },
  move: (id, x, y) => set((state) => ({ windows: { ...state.windows, [id]: { ...state.windows[id], x: Math.round(x), y: Math.round(y) } } })),
  resize: (id, w, h, x, y) => set((state) => ({ windows: { ...state.windows, [id]: {
    ...state.windows[id], w: Math.round(w), h: Math.round(h),
    ...(x === undefined ? {} : { x: Math.round(x) }), ...(y === undefined ? {} : { y: Math.round(y) }) } } })),
  resetLayout: () => set(() => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* 저장소가 없어도 기본 배치는 적용된다. */ }
    const mobile = get().mobile;
    const windows = defaults(window.innerWidth, window.innerHeight, mobile);
    return { windows, focused: PRIMARY_APP, nextZ: Math.max(...APP_IDS.map((id) => windows[id].z)) + 1, mobile, closing: {}, minimizing: {} };
  }),
  setMobile: (mobile) => set((state) => (state.mobile === mobile ? state : { mobile })),
  clampAll: (W, H) => set((state) => {
    if (state.mobile) return state;
    const windows = { ...state.windows };
    for (const id of APP_IDS) windows[id] = { ...windows[id], ...clampBox(windows[id], W, H, APPS[id].min) };
    return { windows };
  }),
}));

// 배치를 200ms 모아 저장한다(모바일은 저장하지 않는다).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useDesktop.subscribe((state) => {
  if (state.mobile) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const windows: Saved = {};
    for (const id of APP_IDS) {
      const { open, minimized, maximized, x, y, w, h } = state.windows[id];
      windows[id] = { open: open && !state.closing[id], minimized: minimized || Boolean(state.minimizing[id]), maximized, x, y, w, h };
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, windows })); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
  }, 200);
});
