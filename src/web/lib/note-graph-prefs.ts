import { create } from "zustand";
import { GRAPH_VIEWS, type GraphView } from "./graph-layout";

/** 메모 그래프의 보기 설정. 보기 종류·보일 연결·점 종류·이름표는 이 브라우저에 남기고, 그래프를 연 상태는 남기지 않는다(다시 열면 편집기부터). */
export type GraphLinkKind = "link" | "mention" | "similar" | "semantic";
export type GraphPrefs = {
  view: GraphView;
  links: Record<GraphLinkKind, boolean>;
  /** 폴더 점과 폴더 선. */
  folders: boolean;
  /** 태그 점과 태그 선. */
  tags: boolean;
  /** 어떤 선에도 닿지 않은 메모. */
  orphans: boolean;
  /** 확대와 상관없이 이름표를 늘 보인다. */
  labels: boolean;
  /** 메모와 이어진 작업 세션(에이전트가 Relay에 남긴 기록)을 함께 놓는다. */
  sessions: boolean;
  /** 점의 색을 가르는 기준: 최상위 폴더 또는 내용으로 묶은 주제. */
  colorBy: "folder" | "topic";
};
const KEY = "relay-notes-graph-v1";
const DEFAULTS: GraphPrefs = { view: "network", links: { link: true, mention: true, similar: true, semantic: true }, folders: true, tags: true, orphans: true, labels: false, sessions: true, colorBy: "folder" };

function load(): GraphPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<GraphPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
    const links = raw.links && typeof raw.links === "object" ? raw.links : DEFAULTS.links;
    return {
      view: GRAPH_VIEWS.includes(raw.view as GraphView) ? raw.view as GraphView : DEFAULTS.view,
      links: { link: bool(links.link, true), mention: bool(links.mention, true), similar: bool(links.similar, true), semantic: bool(links.semantic, true) },
      folders: bool(raw.folders, DEFAULTS.folders), tags: bool(raw.tags, DEFAULTS.tags), orphans: bool(raw.orphans, DEFAULTS.orphans), labels: bool(raw.labels, DEFAULTS.labels),
      sessions: bool(raw.sessions, DEFAULTS.sessions), colorBy: raw.colorBy === "topic" ? "topic" : "folder",
    };
  } catch { return DEFAULTS; }
}

type GraphState = GraphPrefs & {
  open: boolean;
  setOpen: (open: boolean) => void;
  setView: (view: GraphView) => void;
  set: (patch: Partial<Omit<GraphPrefs, "view" | "links">>) => void;
  setLink: (kind: GraphLinkKind, on: boolean) => void;
  reset: () => void;
};

export const useNoteGraph = create<GraphState>((set) => ({
  ...load(), open: false,
  setOpen: (open) => set({ open }),
  setView: (view) => set({ view }),
  set: (patch) => set(patch),
  setLink: (kind, on) => set((state) => ({ links: { ...state.links, [kind]: on } })),
  reset: () => set({ ...DEFAULTS, view: useNoteGraph.getState().view }),
}));

useNoteGraph.subscribe((state) => {
  const { view, links, folders, tags, orphans, labels, sessions, colorBy } = state;
  try { localStorage.setItem(KEY, JSON.stringify({ view, links, folders, tags, orphans, labels, sessions, colorBy })); } catch { /* 저장하지 못해도 지금 창에서는 바뀐다. */ }
});
