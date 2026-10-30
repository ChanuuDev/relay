import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, Folder, FolderOpen, HardDrive, House, Image, LoaderCircle, Monitor, Music, Star, Video, type LucideIcon } from "lucide-react";
import { driveName, getJson, listUrl, useFiles, type Listing, type Location, type Place, type Places } from "../../lib/files";
import { RenameField, type RenameEntry } from "./files-rename-field";

export const PLACE_ICONS: Record<Place["id"], LucideIcon> = { home: House, desktop: Monitor, documents: FolderOpen, downloads: Download, pictures: Image, music: Music, videos: Video };

export type Favorite = { path: string; label: string; place: Place["id"] | null };
/** 트리 항목 종류: 즐겨찾기 묶음 · 이 PC · 즐겨찾기 항목 · 드라이브 · 폴더 */
export type TreeTarget = { kind: "fav-root" | "pc-root" | "favorite" | "drive" | "folder"; path: string | null; rename?: () => void };

const baseName = (target: string) => target.split(/[\\/]/).filter(Boolean).at(-1) ?? target;

/** 지금 보이는 즐겨찾기. 사용자가 고친 적이 없으면 사용자 폴더(places)가 기본값이다. */
export function favoritesOf(paths: string[] | null, places: Places | undefined): Favorite[] {
  const list = paths ?? places?.places.map((place) => place.path) ?? [];
  return list.map((path) => {
    const place = places?.places.find((item) => item.path.toLowerCase() === path.toLowerCase());
    const drive = places?.drives.find((item) => item.path.toLowerCase() === path.toLowerCase());
    return { path, label: place?.label ?? (drive ? driveName(drive) : baseName(path)), place: place?.id ?? null };
  });
}

type Shared = {
  places: Places | undefined; location: Location; expanded: Set<string>; showHidden: boolean; focusKey: string | null;
  onGo: (target: Location) => void; onToggle: (key: string, open: boolean) => void; onFocusKey: (key: string) => void;
  onMenu: (target: TreeTarget, left: number, top: number) => void;
  busy: boolean; renaming: string | null; onRenaming: (key: string | null) => void;
  onRename: (entry: RenameEntry, name: string | null) => Promise<string | null>;
};

const same = (a: string | null, b: string | null) => a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/** Windows 탐색기의 탐색 창처럼 `즐겨찾기`와 `이 PC`를 트리로 보인다. 폴더는 펼칠 때 하위 폴더를 읽는다(본문 목록과 같은 캐시). */
export function FilesTree({ places, favorites, location, showHidden, error, onGo, onMenu, busy, onRename }: {
  places: Places | undefined; favorites: Favorite[]; location: Location; showHidden: boolean; error: string | null;
  onGo: (target: Location) => void; onMenu: (target: TreeTarget, left: number, top: number) => void;
  busy: boolean; onRename: Shared["onRename"];
}) {
  const expandedList = useFiles((state) => state.expanded);
  const expanded = new Set(expandedList);
  const { setExpanded } = useFiles.getState();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const shared: Shared = { places, location, expanded, showHidden, focusKey, onGo, onToggle: setExpanded, onFocusKey: setFocusKey, onMenu,
    busy, renaming, onRenaming: setRenaming, onRename };
  const drives = places?.drives ?? [];
  // 초점을 받을 항목이 사라졌으면(접힘·새로 고침) 첫 항목이 받는다.
  const tabKey = focusKey && treeRef.current?.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) ? focusKey : "fav:";

  /** 위·아래·Home·End로 옮기고, →는 펼치기/첫 하위, ←는 접기/상위, Enter는 열기, Shift+F10·메뉴 키는 메뉴. */
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]");
    if (!item || !treeRef.current) return;
    const rows = Array.from(treeRef.current.querySelectorAll<HTMLElement>("[role=treeitem]"));
    const index = rows.indexOf(item);
    const focusAt = (row: HTMLElement | undefined) => { if (row) { event.preventDefault(); row.focus(); } };
    const open = item.getAttribute("aria-expanded");
    const key = item.dataset.key!;
    switch (event.key) {
      case "ArrowDown": focusAt(rows[index + 1]); return;
      case "ArrowUp": focusAt(rows[index - 1]); return;
      case "Home": focusAt(rows[0]); return;
      case "End": focusAt(rows.at(-1)); return;
      case "ArrowRight":
        event.preventDefault();
        if (open === "false") setExpanded(key, true);
        else if (open === "true") item.querySelector<HTMLElement>("[role=group] > [role=treeitem]")?.focus();
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (open === "true") setExpanded(key, false);
        else item.parentElement?.closest<HTMLElement>("[role=treeitem]")?.focus();
        return;
      case "Enter": case " ":
        event.preventDefault();
        item.querySelector<HTMLElement>(":scope > .tree-row")?.click();
        return;
      case "ContextMenu": case "F10":
        if (event.key === "F10" && !event.shiftKey) return;
        event.preventDefault();
        item.querySelector<HTMLElement>(":scope > .tree-row")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
          clientX: item.getBoundingClientRect().left + 40, clientY: item.getBoundingClientRect().top + 24 }));
    }
  }

  return <aside className="files-sidebar material-chrome" aria-label="탐색 창">
    <ul ref={treeRef} className="files-tree" role="tree" aria-label="폴더 트리" onKeyDown={onKeyDown}>
      <Node shared={shared} nodeKey="fav:" tabKey={tabKey} level={1} label="즐겨찾기" Icon={Star} tone="star" target={{ kind: "fav-root", path: null }}
        childNodes={favorites.map((favorite) => ({ key: `fav:${favorite.path}`, label: favorite.label, Icon: favorite.place ? PLACE_ICONS[favorite.place] : Folder,
          tone: favorite.place ? "place" : "folder", target: { kind: "favorite", path: favorite.path } as TreeTarget }))}
        empty="오른쪽 클릭 메뉴로 폴더를 즐겨찾기에 추가하세요." />
      <Node shared={shared} nodeKey="pc:" tabKey={tabKey} level={1} label="이 PC" Icon={Monitor} tone="place" target={{ kind: "pc-root", path: null }}
        childNodes={drives.map((drive) => ({ key: `pc:${drive.path}`, label: driveName(drive), Icon: HardDrive, tone: "drive", target: { kind: "drive", path: drive.path } as TreeTarget }))} />
    </ul>
    {error && <p className="files-nav-error">{error}</p>}
  </aside>;
}

type ChildNode = { key: string; label: string; Icon: LucideIcon; tone: string; target: TreeTarget; hidden?: boolean };

/** folder가 location 자신이거나 그 상위 폴더인가 */
function onPath(folder: string, location: string | null) {
  if (location === null) return false;
  const base = folder.toLowerCase().replace(/[\\/]+$/, "");
  const target = location.toLowerCase();
  return target === base || target.startsWith(`${base}\\`) || target.startsWith(`${base}/`);
}

function Node({ shared, nodeKey, tabKey, level, label, Icon, tone, target, childNodes, empty, hidden }: {
  shared: Shared; nodeKey: string; tabKey: string; level: number; label: string; Icon: LucideIcon; tone: string; target: TreeTarget;
  childNodes?: ChildNode[]; empty?: string; hidden?: boolean;
}) {
  const { location, expanded, showHidden, onGo, onToggle, onFocusKey, onMenu } = shared;
  const open = expanded.has(nodeKey);
  const folderLike = target.path !== null;
  // 폴더·드라이브·즐겨찾기는 펼칠 때 하위 폴더를 읽는다. 본문 목록과 같은 키라 이미 연 폴더는 다시 받지 않는다.
  const children = useQuery({ queryKey: ["files", "list", target.path], enabled: open && folderLike, retry: false, staleTime: 10_000,
    queryFn: ({ signal }) => getJson<Listing>(listUrl(target.path!), signal) });
  const folders = folderLike && children.data
    // 숨김 폴더라도 지금 폴더로 가는 길에 있으면 보인다(AppData 아래를 열었을 때처럼). 흐리게 표시한다.
    ? children.data.entries.filter((entry) => entry.kind === "directory" && (showHidden || !entry.hidden || onPath(entry.path, location)))
      .map((entry): ChildNode => ({ key: `${nodeKey.startsWith("fav:") ? "fav" : "pc"}:${entry.path}`, label: entry.name, Icon: Folder, tone: "folder",
        target: { kind: "folder", path: entry.path }, hidden: entry.hidden }))
    : null;
  // 항목이 많아 목록이 잘렸더라도 지금 폴더로 가는 다음 폴더는 트리에 넣는다.
  if (folders && target.path !== null && location !== null && !same(target.path, location) && onPath(target.path, location)
    && !folders.some((folder) => onPath(folder.target.path!, location))) {
    const rest = location.slice(target.path.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "");
    const name = rest.split(/[\\/]/)[0];
    const separator = location.includes("\\") ? "\\" : "/";
    const path = `${target.path.replace(/[\\/]+$/, "")}${separator}${name}`;
    if (name) folders.push({ key: `${nodeKey.startsWith("fav:") ? "fav" : "pc"}:${path}`, label: name, Icon: Folder, tone: "folder", target: { kind: "folder", path } });
  }
  const list = childNodes ?? folders;
  // 읽어 보니 하위 폴더가 없거나 열 수 없으면 펼침 단추를 감춘다.
  const leaf = folderLike && !childNodes && (children.isError || (folders !== null && folders.length === 0));
  const current = target.kind === "pc-root" ? location === null : target.kind !== "fav-root" && same(target.path, location);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => { if (current && nodeKey.startsWith("pc:")) rowRef.current?.scrollIntoView({ block: "nearest" }); }, [current, nodeKey]);

  const activate = () => {
    rowRef.current?.focus({ preventScroll: true });
    onFocusKey(nodeKey);
    if (target.kind === "fav-root") onToggle(nodeKey, !open);
    else onGo(target.path);
  };
  const canRename = (target.kind === "folder" || target.kind === "favorite") && target.path !== null
    && !same(target.path, shared.places?.home ?? null) && !shared.places?.drives.some((drive) => same(target.path, drive.path));
  const startRename = () => { if (canRename && !shared.busy) shared.onRenaming(nodeKey); };
  const menu = (event: ReactMouseEvent) => { event.preventDefault(); event.stopPropagation(); onFocusKey(nodeKey); rowRef.current?.focus();
    onMenu({ ...target, rename: canRename ? startRename : undefined }, event.clientX, event.clientY); };
  async function finishRename(name: string | null, focus: boolean) {
    const tree = rowRef.current?.closest(".files-tree");
    const to = await shared.onRename({ path: target.path!, name: baseName(target.path!), kind: "directory" }, name);
    if (to === null) return false;
    shared.onRenaming(null);
    const key = nodeKey.slice(0, nodeKey.indexOf(":") + 1) + to;
    onFocusKey(key);
    if (focus) requestAnimationFrame(() => tree?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
    return true;
  }

  return <li ref={rowRef} role="treeitem" className="tree-item files-tree-item" data-key={nodeKey} data-node={target.kind} data-hidden={hidden ? "" : undefined} aria-level={level}
    aria-expanded={leaf ? undefined : open} aria-selected={current} aria-label={label} tabIndex={tabKey === nodeKey ? 0 : -1}
    onFocus={(event) => { if (event.target === event.currentTarget) onFocusKey(nodeKey); }}
    onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "F2") { event.preventDefault(); event.stopPropagation(); startRename(); } }}>
    <div className="tree-row" style={{ ["--depth" as string]: level - 1 }} title={target.path ?? label} onClick={activate} onContextMenu={menu}>
      <span className="tree-chevron" data-hidden={leaf ? "" : undefined} aria-hidden="true"
        onClick={(event) => { event.stopPropagation(); onFocusKey(nodeKey); if (!leaf) onToggle(nodeKey, !open); }}><ChevronRight /></span>
      <Icon className="tree-icon files-tree-icon" data-tone={tone} aria-hidden="true" />
      {shared.renaming === nodeKey && canRename
        ? <RenameField entry={{ path: target.path!, name: baseName(target.path!), kind: "directory" }} onDone={finishRename} />
        : <span className="tree-label">{label}</span>}
    </div>
    {open && !leaf && <ul role="group" className="files-tree-group">
      {list === null
        ? <li className="files-tree-note" style={{ ["--depth" as string]: level }} role="none"><LoaderCircle aria-hidden="true" />불러오는 중…</li>
        : list.length === 0
          ? empty ? <li className="files-tree-note" style={{ ["--depth" as string]: level }} role="none">{empty}</li> : null
          : list.map((child) => <Node key={child.key} shared={shared} nodeKey={child.key} tabKey={tabKey} level={level + 1} label={child.label}
              Icon={child.Icon} tone={child.tone} target={child.target} hidden={child.hidden} />)}
    </ul>}
  </li>;
}
