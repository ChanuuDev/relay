import { create } from "zustand";

/** 폴더와 메모는 parentId로 트리를 이룬다. null은 최상위다. 메모 본문(body)은 Markdown 원문이다.
 *  내용은 Relay 저장소(relay.db)에 두고 `/api/v1/notes`로 읽고 쓴다. 이 브라우저에는 펼친 폴더·고른 항목과 아직 보내지 못한 변경만 남는다. */
export type Folder = { id: string; kind: "folder"; parentId: string | null; name: string; createdAt: number };
export type Note = { id: string; kind: "note"; parentId: string | null; title: string; body: string; createdAt: number; updatedAt: number };
export type Item = Folder | Note;
export type Items = Record<string, Item>;
/** 트리에 실제로 보이는 한 줄. depth는 0부터, index는 형제 사이 순서(0부터), size는 형제 수. */
export type Row = { item: Item; depth: number; hasChildren: boolean; index: number; size: number };

const API = "/api/v1/notes";
/** 예전(브라우저에만 저장하던) 메모. 처음 연결될 때 DB로 옮기고 원본은 BACKUP_KEY로 남긴다. */
const LEGACY_KEY = "relay-notes-v1";
const BACKUP_KEY = "relay-notes-v1-backup";
const VIEW_KEY = "relay-notes-view-v1";
const PENDING_KEY = "relay-notes-pending-v1";
const SAVE_DELAY = 400;
const POLL_MS = 3000;
const MAX_TITLE = 200;
const MAX_BODY = 200_000;
const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

/** 글로 보이지 않는 줄: 코드 울타리, 구분선, 표 구분 줄. */
const SKIP_LINE = /^\s*(?:`{3,}|~{3,}|(?:[-*_]\s*){3,}$|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$)/;
/** Markdown 한 줄에서 문법 기호를 걷어 낸 글. 트리 이름과 카드 미리 보기에 쓴다. */
export function plainLine(line: string) {
  if (SKIP_LINE.test(line)) return "";
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|(?:>\s?)+)/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_]*?\S)[*_](?=$|[^\w*])/g, "$1$2")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}
/** 본문 전체를 나누지 않고 글이 있는 첫 줄만 찾는다(긴 메모에서 입력마다 부른다). */
function firstLine(text: string) {
  for (let start = 0; start < text.length;) {
    const end = text.indexOf("\n", start);
    const line = plainLine(text.slice(start, end === -1 ? undefined : end));
    if (line) return line;
    if (end === -1) break;
    start = end + 1;
  }
  return "";
}
/** 트리와 카드에 보일 이름. 메모는 제목이 없으면 본문 첫 줄을 쓴다. */
export const labelOf = (item: Item) => (item.kind === "folder" ? item.name : item.title.trim() || firstLine(item.body).slice(0, 80) || "새 메모");
/** 메모 카드의 미리 보기(서식 기호 없이). 제목을 본문 첫 줄에서 빌렸으면 그 다음 줄부터 보인다. */
export function previewOf(note: Note) {
  const lines = note.body.split("\n").map(plainLine).filter(Boolean);
  return (note.title.trim() ? lines : lines.slice(1)).join(" ").slice(0, 160);
}
/** 내려받을 .md 파일 내용. 제목이 있으면 맨 위 제목 1로 넣는다. */
export function markdownFile(note: Note) {
  const body = note.body.replace(/\s+$/, "");
  const title = note.title.trim();
  return `${title ? `# ${title}\n\n` : ""}${body}\n`;
}
/** 파일 이름으로 쓸 수 없는 글자를 걷어 낸 이름. */
export const fileNameOf = (note: Note) => `${labelOf(note).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "메모"}.md`;
export const isEmptyNote = (item: Item | undefined): item is Note => item?.kind === "note" && !item.title.trim() && !item.body.trim();

/** 폴더가 먼저, 같은 종류끼리는 이름 순(숫자는 크기 순). 이름은 미리 구해 둔 것을 쓴다. */
function sortItems(list: Item[]) {
  const labels = new Map(list.map((item) => [item.id, labelOf(item)]));
  return list.sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1)
    : collator.compare(labels.get(a.id)!, labels.get(b.id)!) || a.createdAt - b.createdAt));
}

/** 부모별 자식 목록(정렬됨). 트리를 그릴 때 한 번만 만든다. */
export function childMap(items: Items) {
  const map = new Map<string | null, Item[]>();
  for (const item of Object.values(items)) {
    const list = map.get(item.parentId);
    if (list) list.push(item); else map.set(item.parentId, [item]);
  }
  for (const list of map.values()) sortItems(list);
  return map;
}

export const childrenOf = (items: Items, parentId: string | null) => sortItems(Object.values(items).filter((item) => item.parentId === parentId));

/** 최상위부터 parent까지의 폴더 목록. */
export function pathOf(items: Items, parentId: string | null): Folder[] {
  const path: Folder[] = [];
  for (let id = parentId; id !== null;) {
    const folder = items[id];
    if (folder?.kind !== "folder" || path.includes(folder)) break;
    path.unshift(folder);
    id = folder.parentId;
  }
  return path;
}

/** id가 folderId 자신이거나 그 하위에 있는가. 폴더를 제 안으로 옮기지 못하게 막는다. */
export function isWithin(items: Items, id: string | null, folderId: string) {
  for (let current = id, guard = 0; current !== null && guard < 10_000; guard++) {
    if (current === folderId) return true;
    current = items[current]?.parentId ?? null;
  }
  return false;
}

export function descendantsOf(items: Items, id: string): Item[] {
  const result: Item[] = [];
  const walk = (parentId: string) => {
    for (const child of Object.values(items)) if (child.parentId === parentId) { result.push(child); if (child.kind === "folder") walk(child.id); }
  };
  walk(id);
  return result;
}

/** 폴더마다 하위 폴더까지 포함한 메모 수. */
export function noteCounts(items: Items, map = childMap(items)) {
  const counts = new Map<string, number>();
  const count = (id: string): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    counts.set(id, 0);
    let total = 0;
    for (const child of map.get(id) ?? []) total += child.kind === "note" ? 1 : count(child.id);
    counts.set(id, total);
    return total;
  };
  for (const item of Object.values(items)) if (item.kind === "folder") count(item.id);
  return counts;
}

/** 펼친 폴더를 따라 보이는 줄을 위에서부터 늘어놓는다. */
export function visibleRows(items: Items, expanded: Record<string, true>, map = childMap(items)): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = map.get(parentId) ?? [];
    list.forEach((item, index) => {
      const hasChildren = item.kind === "folder" && Boolean(map.get(item.id)?.length);
      rows.push({ item, depth, hasChildren, index, size: list.length });
      if (hasChildren && expanded[item.id]) walk(item.id, depth + 1);
    });
  };
  walk(null, 0);
  return rows;
}

/** 제목·본문·폴더 이름에서 찾는다. 대소문자는 가리지 않는다. */
export function search(items: Items, query: string): Item[] {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  if (!needle) return [];
  const hit = (text: string) => text.toLocaleLowerCase("ko-KR").includes(needle);
  return Object.values(items)
    .filter((item) => (item.kind === "folder" ? hit(item.name) : hit(item.title) || hit(item.body)))
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1)
      : a.kind === "note" && b.kind === "note" ? b.updatedAt - a.updatedAt : collator.compare(labelOf(a), labelOf(b))));
}

const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

type Saved = { items: Items; selected: string | null; expanded: Record<string, true> };

/** 항목 하나의 모양을 고정한다. 틀리면 null. 부모 관계는 보지 않는다. */
function shape(raw: unknown): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const parentId = typeof value.parentId === "string" ? value.parentId : null;
  const createdAt = num(value.createdAt, 0);
  if (value.kind === "folder") return { id: value.id, kind: "folder", parentId, name: str(value.name, MAX_TITLE).trim() || "새 폴더", createdAt };
  if (value.kind === "note") return { id: value.id, kind: "note", parentId, title: str(value.title, MAX_TITLE), body: str(value.body, MAX_BODY), createdAt, updatedAt: num(value.updatedAt, createdAt) };
  return null;
}

/** 예전 저장본을 읽고 모양이 틀린 항목은 버린다. 부모가 없거나 순환하는 항목은 최상위로 올린다. */
export function sanitize(raw: unknown): Saved {
  const empty: Saved = { items: {}, selected: null, expanded: {} };
  if (!raw || typeof raw !== "object") return empty;
  const data = raw as { version?: unknown; items?: unknown; selected?: unknown; expanded?: unknown };
  if (data.version !== 1 || !Array.isArray(data.items)) return empty;
  const items: Items = {};
  for (const value of data.items) {
    const item = shape(value);
    if (item && !items[item.id]) items[item.id] = item;
  }
  for (const item of Object.values(items)) {
    const parent = item.parentId === null ? null : items[item.parentId];
    if (item.parentId !== null && (parent?.kind !== "folder" || isWithin(items, parent.id, item.id))) item.parentId = null;
  }
  const selected = typeof data.selected === "string" && items[data.selected] ? data.selected : null;
  const expanded: Record<string, true> = {};
  if (Array.isArray(data.expanded)) for (const id of data.expanded) if (typeof id === "string" && items[id]?.kind === "folder") expanded[id] = true;
  return { items, selected, expanded };
}

/** 이 브라우저에 남기는 보기 상태(고른 항목·펼친 폴더). 예전 저장본이 있으면 그 상태를 이어받는다. */
function loadView(): Pick<Saved, "selected" | "expanded"> {
  try {
    const view = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as { selected?: unknown; expanded?: unknown } | null;
    const source = view ?? JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null") as { selected?: unknown; expanded?: unknown } | null;
    const expanded: Record<string, true> = {};
    if (Array.isArray(source?.expanded)) for (const id of source.expanded) if (typeof id === "string") expanded[id] = true;
    return { selected: typeof source?.selected === "string" ? source.selected : null, expanded };
  } catch { return { selected: null, expanded: {} }; }
}

/** 지운 항목을 되살릴 수 있게 한 번만 남겨 둔다. */
export type Trash = { items: Item[]; label: string; kind: Item["kind"]; notes: number; expanded: string[]; at: number };

/** 처음 불러오기: loading → ready, 서버에 닿지 않으면 error(다시 시도한다). */
export type NotesStatus = "loading" | "ready" | "error";
/** 저장: 모두 보냄(saved) · 보내는 중(saving) · 연결이 끊겨 다시 시도 중(offline) · 서버가 거부함(rejected). */
export type NotesSync = "saved" | "saving" | "offline" | "rejected";

interface NotesState extends Saved {
  /** 이름을 고치는 중인 항목. */
  renaming: string | null;
  trash: Trash | null;
  status: NotesStatus;
  sync: NotesSync;
  select: (id: string | null) => void;
  setExpanded: (id: string, open: boolean) => void;
  createNote: (parentId: string | null) => string;
  createFolder: (parentId: string | null) => string;
  startRename: (id: string | null) => void;
  rename: (id: string, name: string) => void;
  update: (id: string, patch: Partial<Pick<Note, "title" | "body">>) => void;
  /** 옮길 수 없으면(제 안으로 옮기기 등) false. */
  move: (id: string, parentId: string | null) => boolean;
  remove: (id: string) => void;
  undoRemove: () => void;
  dismissTrash: () => void;
}

/** 새 항목을 넣을 폴더: 고른 것이 폴더면 그 안, 메모면 그 메모가 있는 폴더. */
export function targetFolder(items: Items, selected: string | null): string | null {
  const item = selected ? items[selected] : undefined;
  if (!item) return null;
  return item.kind === "folder" ? item.id : item.parentId;
}

/** 다른 항목으로 옮겨 가면 비어 있는 메모는 남기지 않는다. */
function leave(items: Items, from: string | null, to: string | null): Items {
  if (!from || from === to || !isEmptyNote(items[from])) return items;
  const next = { ...items }; delete next[from]; return next;
}

/** parentId까지의 폴더를 모두 펼친다. */
function reveal(items: Items, expanded: Record<string, true>, parentId: string | null) {
  const path = pathOf(items, parentId);
  if (path.every((folder) => expanded[folder.id])) return expanded;
  const next = { ...expanded };
  for (const folder of path) next[folder.id] = true;
  return next;
}

export const useNotes = create<NotesState>((set, get) => ({
  items: {}, ...loadView(), renaming: null, trash: null, status: "loading", sync: "saved",
  select: (id) => set((state) => {
    if (state.selected === id) return state;
    const items = leave(state.items, state.selected, id);
    const target = id && items[id] ? id : null;
    return { items, selected: target, renaming: null, expanded: target ? reveal(items, state.expanded, items[target]!.parentId) : state.expanded };
  }),
  setExpanded: (id, open) => set((state) => {
    if (Boolean(state.expanded[id]) === open) return state;
    const expanded = { ...state.expanded };
    if (open) expanded[id] = true; else delete expanded[id];
    return { expanded };
  }),
  createNote: (parentId) => {
    const id = newId();
    const now = Date.now();
    set((state) => {
      const items = leave(state.items, state.selected, id);
      const parent = parentId !== null && items[parentId]?.kind === "folder" ? parentId : null;
      const next = { ...items, [id]: { id, kind: "note", parentId: parent, title: "", body: "", createdAt: now, updatedAt: now } satisfies Note };
      return { items: next, selected: id, renaming: null, expanded: reveal(next, state.expanded, parent) };
    });
    return id;
  },
  createFolder: (parentId) => {
    const id = newId();
    set((state) => {
      const items = leave(state.items, state.selected, id);
      const parent = parentId !== null && items[parentId]?.kind === "folder" ? parentId : null;
      const names = new Set(childrenOf(items, parent).filter((item) => item.kind === "folder").map(labelOf));
      let name = "새 폴더";
      for (let n = 2; names.has(name); n++) name = `새 폴더 ${n}`;
      const next = { ...items, [id]: { id, kind: "folder", parentId: parent, name, createdAt: Date.now() } satisfies Folder };
      return { items: next, selected: id, renaming: id, expanded: reveal(next, state.expanded, parent) };
    });
    return id;
  },
  startRename: (id) => set({ renaming: id }),
  rename: (id, name) => set((state) => {
    const item = state.items[id];
    if (!item) return { renaming: null };
    const value = name.trim().slice(0, MAX_TITLE);
    if (item.kind === "folder") {
      // 폴더 이름은 비울 수 없다. 비우면 원래 이름으로 돌아간다.
      if (!value || value === item.name) return { renaming: null };
      return { renaming: null, items: { ...state.items, [id]: { ...item, name: value } } };
    }
    if (value === item.title) return { renaming: null };
    return { renaming: null, items: { ...state.items, [id]: { ...item, title: value, updatedAt: Date.now() } } };
  }),
  update: (id, patch) => set((state) => {
    const item = state.items[id];
    if (item?.kind !== "note") return state;
    const title = patch.title === undefined ? item.title : patch.title.slice(0, MAX_TITLE);
    const body = patch.body === undefined ? item.body : patch.body.slice(0, MAX_BODY);
    if (title === item.title && body === item.body) return state;
    return { items: { ...state.items, [id]: { ...item, title, body, updatedAt: Date.now() } } };
  }),
  move: (id, parentId) => {
    const { items, expanded } = get();
    const item = items[id];
    if (!item) return false;
    if (parentId !== null && (items[parentId]?.kind !== "folder" || (item.kind === "folder" && isWithin(items, parentId, id)))) return false;
    if (item.parentId === parentId) return true;
    const next = { ...items, [id]: { ...item, parentId } };
    set({ items: next, expanded: reveal(next, expanded, parentId) });
    return true;
  },
  remove: (id) => set((state) => {
    const item = state.items[id];
    if (!item) return state;
    const removed = [item, ...(item.kind === "folder" ? descendantsOf(state.items, id) : [])];
    const items = { ...state.items };
    for (const entry of removed) delete items[entry.id];
    const gone = new Set(removed.map((entry) => entry.id));
    // 지운 뒤에는 같은 폴더(없으면 위 폴더)를 고른다.
    const selected = state.selected && gone.has(state.selected) ? item.parentId : state.selected;
    const expanded = { ...state.expanded };
    for (const key of Object.keys(expanded)) if (gone.has(key)) delete expanded[key];
    // 빈 메모는 되살릴 것이 없으므로 조용히 지운다.
    const trash: Trash | null = isEmptyNote(item) ? state.trash
      : { items: removed, label: labelOf(item), kind: item.kind, notes: removed.filter((entry) => entry.kind === "note").length, expanded: [...gone].filter((key) => state.expanded[key]), at: Date.now() };
    return { items, selected, expanded, trash, renaming: null };
  }),
  undoRemove: () => set((state) => {
    if (!state.trash) return state;
    const items = { ...state.items };
    for (const entry of state.trash.items) items[entry.id] = { ...entry };
    // 지우는 사이 부모 폴더가 사라졌으면 최상위로 되살린다.
    const [root] = state.trash.items;
    if (root && root.parentId !== null && items[root.parentId]?.kind !== "folder") items[root.id] = { ...root, parentId: null };
    const selected = root ? root.id : state.selected;
    // 지울 때 펼쳐 두었던 폴더는 다시 펼친다.
    const expanded = { ...state.expanded };
    for (const key of state.trash.expanded) expanded[key] = true;
    return { items, selected, trash: null, expanded: root ? reveal(items, expanded, items[root.id]!.parentId) : expanded };
  }),
  dismissTrash: () => set({ trash: null }),
}));

/** 본문을 서식이 보이게 쓸지(rich), Markdown 원문으로 쓸지(source). 메모마다가 아니라 창 전체 설정이다. */
export type NoteMode = "rich" | "source";
const MODE_KEY = "relay-notes-mode";
export const useNoteMode = create<{ mode: NoteMode; setMode: (mode: NoteMode) => void }>((set) => ({
  mode: (() => { try { return localStorage.getItem(MODE_KEY) === "source" ? "source" : "rich"; } catch { return "rich"; } })(),
  setMode: (mode) => {
    try { if (mode === "rich") localStorage.removeItem(MODE_KEY); else localStorage.setItem(MODE_KEY, mode); } catch { /* 저장하지 못해도 지금 창에서는 바뀐다. */ }
    set({ mode });
  },
}));

// ── DB와 맞추기 ─────────────────────────────────────────────
// 고친 항목만 모아 SAVE_DELAY 뒤에 한 번에 보낸다(POST). 보내지 못한 변경은 PENDING_KEY에 남겨 창을 닫아도 다음에 보낸다.
// POLL_MS마다 저장 번호(ETag)만 묻고, 다른 탭·창이 고쳤을 때만 목록을 다시 받는다. 아직 보내지 못한 이 창의 변경이 이긴다.

type Pending = { upserts: Map<string, Item>; deletes: Map<string, number> };
let stamp = 0;
const pending: Pending = readPending();
/** 마지막으로 반영한 서버 저장 번호. */
let revision = -1;
let remote = false;
let seen = useNotes.getState().items;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
let polling = false;
let retryDelay = 3000;

function readPending(): Pending {
  const result: Pending = { upserts: new Map(), deletes: new Map() };
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { upserts?: unknown; deletes?: unknown } | null;
    if (Array.isArray(raw?.upserts)) for (const value of raw.upserts) { const item = shape(value); if (item) result.upserts.set(item.id, item); }
    if (Array.isArray(raw?.deletes)) for (const id of raw.deletes) if (typeof id === "string" && !result.upserts.has(id)) result.deletes.set(id, ++stamp);
  } catch { /* 읽지 못하면 보낼 것이 없다. */ }
  return result;
}
const hasPending = () => pending.upserts.size > 0 || pending.deletes.size > 0;
function writePending() {
  try {
    if (!hasPending()) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify({ upserts: [...pending.upserts.values()], deletes: [...pending.deletes.keys()] }));
  } catch { /* 브라우저에 남기지 못해도 서버로는 보낸다. */ }
}
const setSync = (sync: NotesSync) => { if (useNotes.getState().sync !== sync) useNotes.setState({ sync }); };
const batchOf = () => ({ upserts: [...pending.upserts.values()], deletes: [...pending.deletes.entries()] });

function schedule(delay = SAVE_DELAY) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), delay);
}

/** 모아 둔 변경을 서버에 보낸다. 보내는 사이 다시 고친 항목은 남겨 두었다가 다음에 보낸다. */
export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  writePending();
  if (flushing || useNotes.getState().status !== "ready" || !hasPending()) return;
  const batch = batchOf();
  flushing = true;
  setSync("saving");
  let retry = false;
  try {
    const response = await fetch(API, {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upserts: batch.upserts, deletes: batch.deletes.map(([id]) => id) }),
    });
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      setSync("rejected");
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { revision: number };
    for (const item of batch.upserts) if (pending.upserts.get(item.id) === item) pending.upserts.delete(item.id);
    for (const [id, mark] of batch.deletes) if (pending.deletes.get(id) === mark) pending.deletes.delete(id);
    writePending();
    retryDelay = 3000;
    // 그사이 다른 곳에서도 저장했다면 목록을 다시 받는다.
    const missed = data.revision !== revision + 1;
    revision = data.revision;
    setSync(hasPending() ? "saving" : "saved");
    if (missed) void poll(true);
  } catch {
    setSync("offline");
    retry = true;
  } finally {
    flushing = false;
    if (retry) { schedule(retryDelay); retryDelay = Math.min(retryDelay * 2, 30000); }
    else if (hasPending() && useNotes.getState().sync !== "rejected") schedule();
  }
}

const sameItem = (a: Item | undefined, b: Item) => Boolean(a) && a!.kind === b.kind && a!.parentId === b.parentId && a!.createdAt === b.createdAt
  && (a!.kind === "folder" ? a!.name === (b as Folder).name : a!.title === (b as Note).title && a!.body === (b as Note).body && a!.updatedAt === (b as Note).updatedAt);

/** 서버 목록을 반영한다. 보내지 못한 이 창의 변경(넣기·지우기)은 그대로 두고, 내용이 같은 항목은 이전 객체를 다시 쓴다. */
function applyRemote(list: unknown[]) {
  const state = useNotes.getState();
  const items: Items = {};
  for (const value of list) {
    const item = shape(value);
    if (!item || pending.deletes.has(item.id)) continue;
    items[item.id] = sameItem(state.items[item.id], item) ? state.items[item.id]! : item;
  }
  for (const [id, item] of pending.upserts) items[id] = item;
  const expanded = { ...state.expanded };
  for (const id of Object.keys(expanded)) if (items[id]?.kind !== "folder") delete expanded[id];
  remote = true;
  try {
    useNotes.setState({ items, status: "ready", expanded, selected: state.selected && items[state.selected] ? state.selected : null,
      renaming: state.renaming && items[state.renaming] ? state.renaming : null });
  } finally { remote = false; }
}

/** 저장 번호가 바뀌었을 때만 목록을 다시 받는다. 보내는 중이면 건너뛴다(보낸 뒤 번호를 맞춘다). */
async function poll(force = false) {
  if (polling || flushing || (!force && document.hidden)) return;
  polling = true;
  try {
    const response = await fetch(API, { cache: "no-store", headers: revision >= 0 && !force ? { "If-None-Match": `"${revision}"` } : {} });
    if (response.status === 304) return;
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { revision: number; items: unknown[] };
    // 보내는 사이 받은 오래된 목록은 버린다.
    if (flushing || data.revision < revision) return;
    revision = data.revision;
    applyRemote(data.items);
  } catch { /* 다음 확인 때 다시 묻는다. */ } finally { polling = false; }
}

// ── 다른 환경으로 옮기기 ─────────────────────────────────────
// 내보내기·가져오기 모두 보내지 못한 변경을 먼저 보낸 뒤 서버에서 한다. 가져오기는 서버가 합치고, 이 창은 바뀐 목록을 다시 받는다.

/** 가져오기 한 번에 서버가 받는 크기(security.ts의 MAX_IMPORT_BYTES와 같다). */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
/** kept는 같거나 이 환경 쪽이 더 최근이라 그대로 둔 항목 수. */
export type ImportResult = { added: number; updated: number; kept: number };

/** 서버가 준 오류 문구. 없으면 상태 번호와 함께 fallback을 쓴다. */
async function failure(response: Response, fallback: string) {
  try {
    const data = await response.json() as { error?: { message?: unknown } };
    if (typeof data.error?.message === "string") return data.error.message;
  } catch { /* 본문이 JSON이 아니면 기본 문구를 쓴다. */ }
  return `${fallback}(${response.status})`;
}

/** 모든 메모와 폴더를 JSON 파일 하나로 내려받는다. 내려받은 파일 이름과 담은 수를 돌려준다. */
export async function exportNotes(): Promise<{ name: string; notes: number; folders: number }> {
  await flush();
  const response = await fetch(`${API}/export`, { cache: "no-store" });
  if (!response.ok) throw new Error(await failure(response, "서버가 내보내기를 거절했습니다."));
  const text = await response.text();
  const items = (JSON.parse(text) as { items: Array<{ kind: string }> }).items;
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "relay-notes.json";
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, notes: items.filter((item) => item.kind === "note").length, folders: items.filter((item) => item.kind === "folder").length };
}

/** 내보낸 파일을 서버에 합친다. 없는 항목은 넣고, 같은 항목은 더 최근에 고친 쪽을 남기며, 아무것도 지우지 않는다. */
export async function importNotes(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("64MB 이하의 파일을 골라 주세요.");
  const text = await file.text();
  try { JSON.parse(text); } catch { throw new Error("JSON 파일이 아닙니다."); }
  await flush();
  const response = await fetch(`${API}/import`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: text });
  if (!response.ok) throw new Error(await failure(response, "서버가 가져오기를 거절했습니다."));
  const { added, updated, kept, revision: saved } = await response.json() as ImportResult & { revision: number };
  // 다른 확인이나 저장이 진행 중이면 poll이 건너뛰므로, 합친 저장 번호를 받을 때까지 잠깐씩 다시 묻는다.
  for (let tries = 0; revision < saved && tries < 20; tries++) {
    await poll(true);
    if (revision < saved) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { added, updated, kept };
}

/** 예전에 이 브라우저에만 저장하던 메모를 DB로 옮긴다. 서버에 없는 항목만 보내고, 원본은 백업으로 남긴다. */
function migrateLegacy(serverIds: Set<string>) {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const legacy = sanitize(JSON.parse(raw));
    for (const item of Object.values(legacy.items)) if (!serverIds.has(item.id) && !pending.upserts.has(item.id)) pending.upserts.set(item.id, item);
    localStorage.setItem(BACKUP_KEY, raw);
    localStorage.removeItem(LEGACY_KEY);
    writePending();
  } catch { /* 옮기지 못한 원본은 그대로 둔다. */ }
}

/** 처음 목록을 받는다. 서버에 닿지 않으면 error로 두고 3초 뒤 다시 시도한다. */
async function start() {
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { revision: number; items: unknown[] };
    migrateLegacy(new Set(data.items.map((item) => (item as { id?: string }).id ?? "")));
    revision = data.revision;
    applyRemote(data.items);
    if (hasPending()) schedule(0);
    setInterval(() => void poll(), POLL_MS);
  } catch {
    useNotes.setState({ status: "error" });
    setTimeout(() => void start(), 3000);
  }
}

useNotes.subscribe((state) => {
  if (state.items !== seen && !remote) {
    for (const [id, item] of Object.entries(state.items)) if (seen[id] !== item) { pending.upserts.set(id, item); pending.deletes.delete(id); }
    for (const id of Object.keys(seen)) if (!state.items[id]) { pending.upserts.delete(id); pending.deletes.set(id, ++stamp); }
    if (state.sync === "rejected") setSync("saving");
    schedule();
  }
  seen = state.items;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const { selected, expanded } = useNotes.getState();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ selected, expanded: Object.keys(expanded) })); } catch { /* 보기 상태는 잃어도 된다. */ }
  }, 250);
});
// 창을 닫거나 가릴 때: 보내지 못한 변경을 브라우저에 남기고, 작으면 바로 보낸다(keepalive는 64KB까지).
function leaveNow() {
  writePending();
  if (!hasPending() || useNotes.getState().status !== "ready") return;
  const body = JSON.stringify({ upserts: [...pending.upserts.values()], deletes: [...pending.deletes.keys()] });
  if (body.length < 60_000) void fetch(API, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => {});
}
window.addEventListener("pagehide", leaveNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); else void poll(); });
void start();
