import { create } from "zustand";

/** 폴더와 메모는 parentId로 트리를 이룬다. null은 최상위다. */
export type Folder = { id: string; kind: "folder"; parentId: string | null; name: string; createdAt: number };
export type Note = { id: string; kind: "note"; parentId: string | null; title: string; body: string; createdAt: number; updatedAt: number };
export type Item = Folder | Note;
export type Items = Record<string, Item>;
/** 트리에 실제로 보이는 한 줄. depth는 0부터, index는 형제 사이 순서(0부터), size는 형제 수. */
export type Row = { item: Item; depth: number; hasChildren: boolean; index: number; size: number };

const STORE_KEY = "relay-notes-v1";
const MAX_TITLE = 200;
const MAX_BODY = 200_000;
const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

/** 본문 전체를 나누지 않고 첫 번째 비어 있지 않은 줄만 찾는다(긴 메모에서 입력마다 부른다). */
const firstLine = (text: string) => /\S[^\n]*/.exec(text)?.[0].trim() ?? "";
/** 트리와 카드에 보일 이름. 메모는 제목이 없으면 본문 첫 줄을 쓴다. */
export const labelOf = (item: Item) => (item.kind === "folder" ? item.name : item.title.trim() || firstLine(item.body).slice(0, 80) || "새 메모");
/** 메모 카드의 미리 보기. 제목을 본문 첫 줄에서 빌렸으면 그 다음 줄부터 보인다. */
export function previewOf(note: Note) {
  const lines = note.body.split("\n").map((line) => line.trim()).filter(Boolean);
  return (note.title.trim() ? lines : lines.slice(1)).join(" ").slice(0, 160);
}
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

/** 저장본을 읽고 모양이 틀린 항목은 버린다. 부모가 없거나 순환하는 항목은 최상위로 올린다. */
export function sanitize(raw: unknown): Saved {
  const empty: Saved = { items: {}, selected: null, expanded: {} };
  if (!raw || typeof raw !== "object") return empty;
  const data = raw as { version?: unknown; items?: unknown; selected?: unknown; expanded?: unknown };
  if (data.version !== 1 || !Array.isArray(data.items)) return empty;
  const items: Items = {};
  for (const value of data.items as Array<Record<string, unknown>>) {
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id || items[value.id]) continue;
    const parentId = typeof value.parentId === "string" ? value.parentId : null;
    const createdAt = num(value.createdAt, 0);
    if (value.kind === "folder") items[value.id] = { id: value.id, kind: "folder", parentId, name: str(value.name, MAX_TITLE).trim() || "새 폴더", createdAt };
    else if (value.kind === "note") items[value.id] = { id: value.id, kind: "note", parentId, title: str(value.title, MAX_TITLE), body: str(value.body, MAX_BODY), createdAt, updatedAt: num(value.updatedAt, createdAt) };
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

function load(): Saved {
  try { return sanitize(JSON.parse(localStorage.getItem(STORE_KEY) ?? "null")); } catch { return sanitize(null); }
}

/** 지운 항목을 되살릴 수 있게 한 번만 남겨 둔다. */
export type Trash = { items: Item[]; label: string; kind: Item["kind"]; notes: number; expanded: string[]; at: number };

interface NotesState extends Saved {
  /** 이름을 고치는 중인 항목. */
  renaming: string | null;
  trash: Trash | null;
  /** 브라우저 저장소에 쓰지 못했을 때(용량 초과 등) 켜진다. */
  saveFailed: boolean;
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
  reload: () => void;
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
  ...load(), renaming: null, trash: null, saveFailed: false,
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
  // 다른 탭이 저장하면 그 내용을 따른다.
  reload: () => set({ ...load(), renaming: null }),
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saved = (() => { const { items, selected, expanded } = useNotes.getState(); return { items, selected, expanded }; })();

/** 미뤄 둔 저장을 바로 쓴다. 탭을 닫거나 가릴 때 부른다. */
export function flushNotes() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const { items, selected, expanded } = useNotes.getState();
  if (saved.items === items && saved.selected === selected && saved.expanded === expanded) return;
  saved = { items, selected, expanded };
  try {
    if (!Object.keys(items).length) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, items: Object.values(items), selected, expanded: Object.keys(expanded) }));
    if (useNotes.getState().saveFailed) useNotes.setState({ saveFailed: false });
  } catch {
    // 다음 변경 때 다시 시도하도록 저장본 표시를 되돌린다.
    saved = { items: {}, selected: null, expanded: {} };
    useNotes.setState({ saveFailed: true });
  }
}

useNotes.subscribe((state) => {
  if (saved.items === state.items && saved.selected === state.selected && saved.expanded === state.expanded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNotes, 250);
});
window.addEventListener("pagehide", flushNotes);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNotes(); });
window.addEventListener("storage", (event: StorageEvent) => {
  if (event.key !== STORE_KEY && event.key !== null) return;
  // 이 탭에 아직 쓰지 않은 변경이 있으면 그것이 이긴다.
  if (saveTimer !== undefined) return;
  useNotes.getState().reload();
  const { items, selected, expanded } = useNotes.getState();
  saved = { items, selected, expanded };
});
