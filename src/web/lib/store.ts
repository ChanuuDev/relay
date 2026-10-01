import { create } from "zustand";
import { applyTheme, readTheme, type Theme } from "./theme";
import { readWallpaper, writeWallpaper, type WallpaperChoice } from "./wallpaper";

export type DetailTab = "overview" | "history" | "connections";
export type FilterDraft = { q: string; provider: string; agent: string; cwd: string; limit: string };

export function listLocation() {
  if (location.pathname === "/") return location.pathname + location.search;
  const back = new URLSearchParams(location.search).get("back");
  return back === "/" || back?.startsWith("/?") ? back : "/";
}

export function readDraft(): FilterDraft {
  const query = new URL(listLocation(), location.origin).searchParams;
  return { q: query.get("q") ?? "", provider: query.get("provider") ?? "",
    agent: query.get("agent") ?? "", cwd: query.get("cwd") ?? "", limit: query.get("limit") ?? "50" };
}

interface UIState {
  location: string;
  draft: FilterDraft;
  advanced: boolean;
  tab: DetailTab;
  shell: "powershell" | "bash";
  theme: Theme;
  wallpaper: WallpaperChoice;
  /** 내 사진의 object URL. 브라우저 저장소에서 읽어 오기 전이거나 없으면 null. */
  customImage: string | null;
  setDraft: (patch: Partial<FilterDraft>) => void;
  setAdvanced: (open: boolean) => void;
  setTab: (tab: DetailTab) => void;
  setShell: (shell: "powershell" | "bash") => void;
  setTheme: (theme: Theme) => void;
  setWallpaper: (choice: WallpaperChoice) => void;
  setCustomImage: (url: string | null) => void;
  syncLocation: () => void;
}

export const useUI = create<UIState>((set) => ({
  location: location.pathname + location.search,
  draft: readDraft(), advanced: Boolean(readDraft().agent || readDraft().cwd), tab: "overview",
  shell: navigator.platform.startsWith("Win") ? "powershell" : "bash",
  theme: readTheme(),
  wallpaper: readWallpaper(), customImage: null,
  setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setAdvanced: (advanced) => set({ advanced }), setTab: (tab) => set({ tab }), setShell: (shell) => set({ shell }),
  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  setWallpaper: (wallpaper) => { writeWallpaper(wallpaper); set({ wallpaper }); },
  setCustomImage: (url) => set((state) => {
    if (state.customImage && state.customImage !== url) URL.revokeObjectURL(state.customImage);
    return { customImage: url };
  }),
  syncLocation: () => set((state) => {
    const next = location.pathname + location.search;
    const changedSession = state.location.split("?")[0] !== location.pathname;
    return { location: next, draft: readDraft(), ...(changedSession ? { tab: "overview" as const } : {}) };
  }),
}));

export function navigate(href: string) {
  history.pushState({}, "", href);
  useUI.getState().syncLocation();
}

export function sessionUrl(id: string) {
  return `/sessions/${encodeURIComponent(id)}?${new URLSearchParams({ back: listLocation() })}`;
}

export function pageTo(key: string, offset: number) {
  const url = new URL(location.href);
  url.searchParams.set(key, String(offset));
  navigate(url.pathname + url.search);
}
