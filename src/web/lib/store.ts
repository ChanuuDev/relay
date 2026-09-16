import { create } from "zustand";

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
  setDraft: (patch: Partial<FilterDraft>) => void;
  setAdvanced: (open: boolean) => void;
  setTab: (tab: DetailTab) => void;
  setShell: (shell: "powershell" | "bash") => void;
  syncLocation: () => void;
}

export const useUI = create<UIState>((set) => ({
  location: location.pathname + location.search,
  draft: readDraft(), advanced: Boolean(readDraft().agent || readDraft().cwd), tab: "overview",
  shell: navigator.platform.startsWith("Win") ? "powershell" : "bash",
  setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setAdvanced: (advanced) => set({ advanced }), setTab: (tab) => set({ tab }), setShell: (shell) => set({ shell }),
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
