export type AppId = "sessions" | "guide" | "command" | "notes" | "files" | "settings" | "youtube";

export const MENU_BAR_HEIGHT = 28;
/** 창이 비워 두는 화면 아래 높이. Dock 아래 여백 12 + 막대 안쪽 여백 7 + 가장 커진 아이콘 80 = 99에 5px를 더해, 커진 아이콘이 창을 덮지 않는다. */
export const DOCK_RESERVED = 104;
export const MOBILE_DOCK_HEIGHT = 64;
export const MOBILE_MAX_WIDTH = 760;
export const CORNER_SIZE = 12;
export const EDGE_SIZE = 6;
/** 가이드 창은 이만큼 넓은 화면에서만 기본으로 열린다. */
export const GUIDE_MIN_VIEWPORT = 1280;
export const MAX_Z = 50;

export type Box = { x: number; y: number; w: number; h: number };
export type AppDef = { id: AppId; title: string; min: { w: number; h: number }; box: (W: number, H: number) => Box };

export const APP_IDS: AppId[] = ["sessions", "guide", "command", "notes", "files", "settings", "youtube"];

const free = (H: number) => H - MENU_BAR_HEIGHT - DOCK_RESERVED;

export const APPS: Record<AppId, AppDef> = {
  sessions: { id: "sessions", title: "세션", min: { w: 640, h: 440 },
    box: (W, H) => ({ x: 40, y: 44, w: Math.min(1000, W - 80), h: Math.min(720, free(H) - 24) }) },
  guide: { id: "guide", title: "가이드", min: { w: 320, h: 360 },
    box: (W, H) => ({ x: W - 420, y: 92, w: 380, h: Math.min(560, free(H) - 100) }) },
  command: { id: "command", title: "명령", min: { w: 480, h: 240 },
    box: (W) => ({ x: Math.round((W - 720) / 2), y: 180, w: 720, h: 360 }) },
  notes: { id: "notes", title: "메모", min: { w: 480, h: 360 },
    box: (W, H) => { const w = Math.min(920, W - 80); return { x: Math.round((W - w) / 2), y: 72, w, h: Math.min(620, free(H) - 32) }; } },
  files: { id: "files", title: "파일 탐색기", min: { w: 520, h: 360 },
    box: (W, H) => { const w = Math.min(1040, W - 80); return { x: Math.round((W - w) / 2), y: 64, w, h: Math.min(660, free(H) - 24) }; } },
  settings: { id: "settings", title: "설정", min: { w: 480, h: 400 },
    box: (W, H) => ({ x: Math.round((W - 560) / 2), y: 120, w: 560, h: Math.min(600, free(H)) }) },
  youtube: { id: "youtube", title: "YouTube", min: { w: 480, h: 360 },
    box: (W, H) => { const w = Math.min(960, W - 80); return { x: Math.round((W - w) / 2), y: 84, w, h: Math.min(640, free(H) - 40) }; } },
};

export const appIcon = (id: AppId) => `/icons/${id}.png`;
