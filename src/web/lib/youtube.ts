import { create } from "zustand";
import { LIST_ID, PLAYER_PATH, playerQuery, VIDEO_ID, type Target } from "../youtube-shared";

export type { Target };
export type Page = { kind: "home" } | Target;
export type Recent = { target: Target; title?: string; at: number };

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const STORE_KEY = "relay-youtube-v1";
const MAX_RECENT = 12;

/** `t=1h2m3s`, `t=90`, `start=90` 같은 시작 시각을 초로 바꾼다. */
function startSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) > 0 ? Number(value) : undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match?.[0]) return undefined;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : undefined;
}

/** 주소창에 넣은 유튜브 주소나 영상 ID를 재생 대상으로 바꾼다. 알아볼 수 없으면 null. */
export function parseTarget(input: string): Target | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (VIDEO_ID.test(text)) return { kind: "video", id: text };
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host) || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const rawList = url.searchParams.get("list");
  const list = rawList && LIST_ID.test(rawList) ? rawList : undefined;
  const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const video = (id: string | null | undefined): Target | null =>
    (id && VIDEO_ID.test(id) ? { kind: "video", id, ...(list ? { list } : {}), ...(start ? { start } : {}) } : null);
  const playlist = (): Target | null => (list ? { kind: "playlist", list } : null);
  const parts = url.pathname.split("/").filter(Boolean);
  if (host.endsWith("youtu.be")) return video(parts[0]);
  switch (parts[0]) {
    case "watch": return video(url.searchParams.get("v")) ?? playlist();
    case "playlist": return playlist();
    case "shorts": case "live": case "v": case "e": return video(parts[1]);
    case "embed": return parts[1] === undefined || parts[1] === "videoseries" ? playlist() : video(parts[1]);
    default: return null;
  }
}

export const keyOf = (target: Target) => (target.kind === "video" ? `video:${target.id}` : `playlist:${target.list}`);

/** 창 안에 넣는 플레이어 래퍼 주소. 유튜브는 Referer가 IP 주소(127.0.0.1)면 광고 영상을 거부하므로 localhost 출처의 래퍼 페이지가 플레이어를 띄운다. */
export function playerUrl(target: Target): string {
  return `http://localhost${location.port ? `:${location.port}` : ""}${PLAYER_PATH}?${playerQuery(target)}`;
}

/** 브라우저 탭으로 열거나 복사할 원래 주소. */
export function canonicalUrl(target: Target): string {
  if (target.kind === "playlist") return `https://www.youtube.com/playlist?${new URLSearchParams({ list: target.list })}`;
  const params = new URLSearchParams({ v: target.id });
  if (target.list) params.set("list", target.list);
  if (target.start) params.set("t", `${target.start}s`);
  return `https://www.youtube.com/watch?${params}`;
}

/** 주소창에 보여 줄 짧은 주소. 크롬처럼 `https://www.`를 뗀다. */
export const displayUrl = (target: Target) => canonicalUrl(target).replace(/^https:\/\/www\./, "");
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const searchUrl = (query: string) => `https://www.youtube.com/results?${new URLSearchParams({ search_query: query })}`;

/** oEmbed로 영상 제목을 읽는다. 재생목록은 oEmbed가 없고, 실패하면 null. */
export async function fetchTitle(target: Target, signal?: AbortSignal): Promise<string | null> {
  if (target.kind !== "video") return null;
  try {
    const query = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${target.id}`, format: "json" });
    const response = await fetch(`https://www.youtube.com/oembed?${query}`, { signal, mode: "cors", credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
  } catch { return null; }
}

function sanitizeTarget(value: unknown): Target | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { kind?: unknown; id?: unknown; list?: unknown; start?: unknown };
  const list = typeof raw.list === "string" && LIST_ID.test(raw.list) ? raw.list : undefined;
  if (raw.kind === "playlist") return list ? { kind: "playlist", list } : null;
  if (raw.kind === "video" && typeof raw.id === "string" && VIDEO_ID.test(raw.id)) {
    const start = typeof raw.start === "number" && Number.isFinite(raw.start) && raw.start > 0 ? Math.floor(raw.start) : undefined;
    return { kind: "video", id: raw.id, ...(list ? { list } : {}), ...(start ? { start } : {}) };
  }
  return null;
}

function loadRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; recent?: unknown };
    if (parsed?.version !== 1 || !Array.isArray(parsed.recent)) return [];
    const recent: Recent[] = [];
    for (const item of parsed.recent as Array<{ target?: unknown; title?: unknown; at?: unknown }>) {
      const target = sanitizeTarget(item?.target);
      if (!target || recent.some((entry) => keyOf(entry.target) === keyOf(target))) continue;
      recent.push({ target, ...(typeof item.title === "string" && item.title ? { title: item.title } : {}), at: typeof item.at === "number" ? item.at : 0 });
      if (recent.length >= MAX_RECENT) break;
    }
    return recent;
  } catch { return []; }
}

function saveRecent(recent: Recent[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, recent })); } catch { /* 저장 실패는 재생에 영향이 없다. */ }
}

interface YouTubeState {
  /** 창 안 탐색 이력. 브라우저의 뒤로·앞으로처럼 쓴다. */
  pages: Page[];
  index: number;
  /** 같은 주소를 다시 불러올 때 올린다. */
  reloadKey: number;
  recent: Recent[];
  /** 알아볼 수 없는 입력 원문. YouTube 검색으로 넘길 수 있게 둔다. */
  error: string | null;
  go: (input: string) => boolean;
  open: (target: Target) => void;
  home: () => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  dismissError: () => void;
  setTitle: (target: Target, title: string) => void;
  removeRecent: (target: Target) => void;
  clearRecent: () => void;
}

const push = (state: YouTubeState, page: Page) => ({ pages: [...state.pages.slice(0, state.index + 1), page], index: state.index + 1, error: null });

export const useYouTube = create<YouTubeState>((set, get) => ({
  pages: [{ kind: "home" }], index: 0, reloadKey: 0, recent: loadRecent(), error: null,
  go: (input) => {
    const target = parseTarget(input);
    if (!target) { set({ error: input.trim() }); return false; }
    get().open(target);
    return true;
  },
  open: (target) => set((state) => {
    const key = keyOf(target);
    const title = state.recent.find((entry) => keyOf(entry.target) === key)?.title;
    const recent = [{ target, ...(title ? { title } : {}), at: Date.now() }, ...state.recent.filter((entry) => keyOf(entry.target) !== key)].slice(0, MAX_RECENT);
    const current = state.pages[state.index];
    // 보고 있던 주소를 다시 열면 이력을 늘리지 않고 새로 고친다.
    if (current && current.kind !== "home" && canonicalUrl(current) === canonicalUrl(target)) return { recent, reloadKey: state.reloadKey + 1, error: null };
    return { ...push(state, target), recent };
  }),
  home: () => set((state) => (state.pages[state.index]?.kind === "home" ? { error: null } : push(state, { kind: "home" }))),
  back: () => set((state) => (state.index > 0 ? { index: state.index - 1, error: null } : state)),
  forward: () => set((state) => (state.index < state.pages.length - 1 ? { index: state.index + 1, error: null } : state)),
  reload: () => set((state) => ({ reloadKey: state.reloadKey + 1 })),
  dismissError: () => set({ error: null }),
  setTitle: (target, title) => set((state) => {
    const key = keyOf(target);
    if (!state.recent.some((entry) => keyOf(entry.target) === key && entry.title !== title)) return state;
    return { recent: state.recent.map((entry) => (keyOf(entry.target) === key ? { ...entry, title } : entry)) };
  }),
  removeRecent: (target) => set((state) => ({ recent: state.recent.filter((entry) => keyOf(entry.target) !== keyOf(target)) })),
  clearRecent: () => set({ recent: [] }),
}));

let savedRecent = useYouTube.getState().recent;
useYouTube.subscribe((state) => {
  if (state.recent === savedRecent) return;
  savedRecent = state.recent;
  saveRecent(state.recent);
});
