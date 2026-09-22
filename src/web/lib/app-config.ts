export type AppId = "sessions" | "guide" | "command" | "settings";

export const MENU_BAR_HEIGHT = 28;
export const DOCK_RESERVED = 88;
export const MOBILE_DOCK_HEIGHT = 64;
export const MOBILE_MAX_WIDTH = 760;
export const CORNER_SIZE = 12;
export const EDGE_SIZE = 6;
/** 가이드 창은 이만큼 넓은 화면에서만 기본으로 열린다. */
export const GUIDE_MIN_VIEWPORT = 1280;
export const MAX_Z = 50;

export type Box = { x: number; y: number; w: number; h: number };
export type AppDef = { id: AppId; title: string; min: { w: number; h: number }; box: (W: number, H: number) => Box };

export const APP_IDS: AppId[] = ["sessions", "guide", "command", "settings"];

const free = (H: number) => H - MENU_BAR_HEIGHT - DOCK_RESERVED;

export const APPS: Record<AppId, AppDef> = {
  sessions: { id: "sessions", title: "세션", min: { w: 640, h: 440 },
    box: (W, H) => ({ x: 40, y: 44, w: Math.min(1000, W - 80), h: Math.min(720, free(H) - 24) }) },
  guide: { id: "guide", title: "가이드", min: { w: 320, h: 360 },
    box: (W, H) => ({ x: W - 420, y: 92, w: 380, h: Math.min(560, free(H) - 100) }) },
  command: { id: "command", title: "명령", min: { w: 480, h: 240 },
    box: (W) => ({ x: Math.round((W - 720) / 2), y: 180, w: 720, h: 360 }) },
  settings: { id: "settings", title: "설정", min: { w: 480, h: 400 },
    box: (W, H) => ({ x: Math.round((W - 560) / 2), y: 120, w: 560, h: Math.min(600, free(H)) }) },
};

export const appIcon = (id: AppId) => `/icons/${id}.png`;
