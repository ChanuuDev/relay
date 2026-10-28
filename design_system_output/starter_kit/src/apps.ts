import { Shapes, type LucideIcon } from "lucide-react";
import { DOCK_RESERVED, MENU_BAR_HEIGHT, type Box } from "@/lib/layout";

/** 앱 아이콘: 256px squircle PNG(권장) 또는 코드로 그린 그라디언트 타일. */
export type AppIconSpec = { src: string } | { glyph: LucideIcon; from: string; to: string };

export type AppDef = {
  id: AppId;
  title: string;
  icon: AppIconSpec;
  /** 최소 크기(px). 리사이즈와 화면 맞춤이 이 아래로 줄이지 않는다. */
  min: { w: number; h: number };
  /** 기본 배치. W·H는 뷰포트 크기. */
  box: (W: number, H: number) => Box;
  /** 처음 열 때(저장된 배치가 없을 때) 열어 둘지. 뷰포트 너비를 받는다. */
  openByDefault?: (viewportWidth: number) => boolean;
};

/** ── 여기만 고치면 새 프로젝트의 앱(창) 목록이 된다. 순서가 곧 Dock 순서다. ── */
export const APP_IDS = ["library", "docs", "gallery", "terminal", "settings", "welcome"] as const;
export type AppId = (typeof APP_IDS)[number];
/** 시작할 때 늘 열려 있고 맨 앞에 오는 주 창. */
export const PRIMARY_APP: AppId = "library";

/** 메뉴바와 Dock을 뺀 세로 공간 */
const free = (H: number) => H - MENU_BAR_HEIGHT - DOCK_RESERVED;
const centered = (W: number, w: number) => Math.round((W - w) / 2);

export const APPS: Record<AppId, AppDef> = {
  library: { id: "library", title: "기록", icon: { src: "/icons/sample-sessions.png" }, min: { w: 640, h: 440 },
    box: (W, H) => ({ x: 40, y: 44, w: Math.min(1000, W - 80), h: Math.min(720, free(H) - 24) }), openByDefault: () => true },
  docs: { id: "docs", title: "문서", icon: { src: "/icons/sample-notes.png" }, min: { w: 480, h: 360 },
    box: (W, H) => { const w = Math.min(1000, W - 80); return { x: centered(W, w), y: 72, w, h: Math.min(620, free(H) - 32) }; } },
  gallery: { id: "gallery", title: "컴포넌트", icon: { glyph: Shapes, from: "#8a96ff", to: "#4f46e5" }, min: { w: 520, h: 400 },
    box: (W, H) => { const w = Math.min(980, W - 80); return { x: centered(W, w), y: 60, w, h: Math.min(680, free(H) - 20) }; } },
  terminal: { id: "terminal", title: "터미널", icon: { src: "/icons/sample-command.png" }, min: { w: 480, h: 240 },
    box: (W) => ({ x: centered(W, 720), y: 180, w: 720, h: 360 }) },
  settings: { id: "settings", title: "설정", icon: { src: "/icons/sample-settings.png" }, min: { w: 480, h: 400 },
    box: (W, H) => ({ x: centered(W, 560), y: 100, w: 560, h: Math.min(640, free(H)) }) },
  welcome: { id: "welcome", title: "시작하기", icon: { src: "/icons/sample-guide.png" }, min: { w: 320, h: 360 },
    box: (W, H) => ({ x: W - 420, y: 92, w: 380, h: Math.min(560, free(H) - 100) }), openByDefault: (W) => W >= 1280 },
};
