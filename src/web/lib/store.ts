import { create } from "zustand";
import { applyTheme, readTheme, type Theme } from "./theme";
import { readWallpaper, writeWallpaper, type WallpaperChoice } from "./wallpaper";

export type DetailTab = "overview" | "history" | "connections";
export type CustomImage = { id: string; url: string; name: string };
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
  /** 내 사진 목록. url은 object URL이며, 브라우저 저장소에서 읽어 오기 전에는 비어 있다. */
  customImages: CustomImage[];
  setDraft: (patch: Partial<FilterDraft>) => void;
  setAdvanced: (open: boolean) => void;
  setTab: (tab: DetailTab) => void;
  setShell: (shell: "powershell" | "bash") => void;
  setTheme: (theme: Theme) => void;
  setWallpaper: (choice: WallpaperChoice) => void;
  setCustomImages: (images: CustomImage[]) => void;
  addCustomImage: (image: CustomImage) => void;
  removeCustomImage: (id: string) => void;
  syncLocation: () => void;
}

export const useUI = create<UIState>((set) => ({
  location: location.pathname + location.search,
  draft: readDraft(), advanced: Boolean(readDraft().agent || readDraft().cwd), tab: "overview",
  shell: navigator.platform.startsWith("Win") ? "powershell" : "bash",
  theme: readTheme(),
  wallpaper: readWallpaper(), customImages: [],
  setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setAdvanced: (advanced) => set({ advanced }), setTab: (tab) => set({ tab }), setShell: (shell) => set({ shell }),
  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  setWallpaper: (wallpaper) => { writeWallpaper(wallpaper); set({ wallpaper }); },
  setCustomImages: (images) => set((state) => {
    for (const old of state.customImages) if (!images.some((image) => image.url === old.url)) URL.revokeObjectURL(old.url);
    return { customImages: images };
  }),
  addCustomImage: (image) => set((state) => ({ customImages: [...state.customImages, image] })),
  removeCustomImage: (id) => set((state) => {
    const gone = state.customImages.find((image) => image.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    return { customImages: state.customImages.filter((image) => image.id !== id) };
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
