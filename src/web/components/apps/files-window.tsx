import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SubmitEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Eye, EyeOff, FileWarning, Folder, FolderOpen, HardDrive, LayoutGrid, List,
  Info, LoaderCircle, Monitor, PanelRight, RotateCw, Search, SquareArrowOutUpRight, TriangleAlert, X,
} from "lucide-react";
import { ConfirmDialog } from "../desktop/confirm-dialog";
import { PdfPreview } from "./files-pdf-preview";
import { PropertiesDialog } from "./files-properties";
import { useViewer } from "../../lib/viewer";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { DesktopMenu, type MenuEntry } from "../desktop/menu";
import { SplitView } from "../desktop/split-view";
import { FilesTree, favoritesOf, PLACE_ICONS, type Favorite, type TreeTarget } from "./files-tree";
import { useDesktop } from "../../lib/desktop-store";
import {
  COLUMN_MIN, contentUrl, deleteItems, driveName, fileType, formatDate, formatSize, getJson, listUrl, openOnSystem, parentOf, pasteItems, readTextPreview, sortEntries,
  TEXT_PREVIEW_BYTES, useFiles, viewerKind, type Clipboard, type Drive, type FileEntry, type Listing, type Location, type PasteMode, type Places, type SortKey, type ColumnKey, type ColumnWidths,
} from "../../lib/files";

/** 격자 보기에서 섬네일을 그리는 그림 크기 상한. 큰 사진 수천 장이 한꺼번에 내려오지 않게 한다. */
const THUMB_MAX_BYTES = 24 * 1024 * 1024;
const optionId = (index: number) => `files-item-${index}`;

const COLUMNS: { key: SortKey; label: string }[] = [{ key: "name", label: "이름" }, { key: "modified", label: "수정한 날짜" }, { key: "kind", label: "종류" }, { key: "size", label: "크기" }];

/** 본문 항목(entry)·빈 곳(둘 다 없음)·왼쪽 트리 항목(tree)의 오른쪽 클릭 메뉴. */
type Menu = { entry: FileEntry | null; tree?: TreeTarget; left: number; top: number; id: number };
type Notice = { text: string; tone: "info" | "error"; id: number };

/** Windows 디스크를 둘러보는 파일 탐색기. 서버는 읽기만 하고, 열기·탐색기에서 보기는 운영체제에 넘긴다. */
export function FilesWindow() {
  const location = useFiles((state) => state.history[state.index] ?? null);
  const canBack = useFiles((state) => state.index > 0);
  const canForward = useFiles((state) => state.index < state.history.length - 1);
  const selected = useFiles((state) => state.selected);
  const view = useFiles((state) => state.view);
  const showHidden = useFiles((state) => state.hidden);
  const showPreview = useFiles((state) => state.preview);
  const sort = useFiles((state) => state.sort);
  const columns = useFiles((state) => state.columns);
  const clipboard = useFiles((state) => state.clipboard);
  const { go, back, forward, select, setView, toggleHidden, togglePreview, sortBy, setClipboard } = useFiles.getState();
  const isOpen = useDesktop((state) => state.windows.files.open);
  const focused = useDesktop((state) => state.focused === "files");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  // 닫는 트윈이 끝나기 전에 새 메뉴를 열면, 끝난 트윈이 새 메뉴를 닫지 않도록 실제로 닫는 중인지 따로 기억한다.
  const leavingRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // 휴지통으로 옮길 항목(확인 창)과 속성 창에 보일 경로. busy는 붙여넣기·삭제가 서버에서 끝나기를 기다리는 중이다.
  const [removing, setRemoving] = useState<FileEntry | null>(null);
  const [properties, setProperties] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const places = useQuery({ queryKey: ["files", "places"], enabled: isOpen, retry: false, staleTime: 30_000,
    queryFn: ({ signal }) => getJson<Places>("/api/v1/files/places", signal) });
  const listing = useQuery({ queryKey: ["files", "list", location], enabled: isOpen && location !== null, retry: false, staleTime: 2_000,
    queryFn: ({ signal }) => getJson<Listing>(listUrl(location!), signal) });
  const data = location !== null && listing.data?.path === location ? listing.data : undefined;
  const queryClient = useQueryClient();
  useEffect(() => {
    const loaded = listing.data;
    if (!loaded || location === null || loaded.path === location) return;
    queryClient.setQueryData(["files", "list", loaded.path], loaded);
    useFiles.getState().settle(loaded.path);
  }, [listing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = data?.entries ?? [];
  const hiddenCount = showHidden ? 0 : all.filter((entry) => entry.hidden).length;
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    const visible = all.filter((entry) => (showHidden || !entry.hidden) && (!needle || entry.name.toLocaleLowerCase("ko-KR").includes(needle)));
    return sortEntries(visible, sort);
  }, [all, showHidden, query, sort]);
  const selectedIndex = entries.findIndex((entry) => entry.path === selected);
  const current = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const drives = places.data?.drives ?? [];
  // 서버가 Windows면 삭제는 휴지통으로 옮기기다. 서버 정보가 아직 없으면 브라우저 플랫폼으로 짐작한다.
  const RECYCLE = places.data ? places.data.platform === "win32" : /Win/.test(navigator.platform);
  const favoritePaths = useFiles((state) => state.favorites);
  const favorites = favoritesOf(favoritePaths, places.data);
  const favoriteList = favorites.map((favorite) => favorite.path);
  const isFavorite = (target: string) => favoriteList.some((path) => path.toLowerCase() === target.toLowerCase());

  // 왼쪽 트리는 Windows 탐색기처럼 지금 폴더까지 `이 PC` 아래를 펼친다.
  useEffect(() => {
    if (data) useFiles.getState().expandAll(["pc:", ...data.crumbs.slice(0, -1).map((crumb) => `pc:${crumb.path}`)]);
  }, [data?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  // 위치가 바뀌면 거르기를 지우고, 앞에 있는 창이면 목록에 초점을 둔다.
  useEffect(() => { setQuery(""); }, [location]);
  useEffect(() => {
    if (!focused || !data) return;
    const frame = requestAnimationFrame(() => { if (!document.activeElement?.closest(".window[data-window=files] input")) listRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [focused, data?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  // 고른 항목이 보이도록 스크롤한다.
  useEffect(() => { if (selectedIndex >= 0) document.getElementById(optionId(selectedIndex))?.scrollIntoView({ block: "nearest" }); }, [selectedIndex, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((now) => (now?.id === notice.id ? null : now)), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const say = (text: string, tone: Notice["tone"] = "info") => setNotice({ text, tone, id: Date.now() });
  // 목록을 읽지 못한 위치(없거나 권한 없음)에서도 경로 글자로 상위 폴더를 찾아 올라간다.
  const up = () => { if (location !== null) go(data ? data.parent : parentOf(location), location); };
  const refresh = () => { void places.refetch(); if (location !== null) void listing.refetch(); };

  async function system(target: string, action: "open" | "reveal") {
    try {
      const done = await openOnSystem(target, action);
      say(done === "reveal" ? (action === "open" ? "실행 파일은 바로 열지 않고 탐색기에서 선택해 보여 줍니다." : "탐색기에서 보여 줍니다.") : "기본 앱으로 엽니다.");
    } catch (error) { say(error instanceof Error ? error.message : "열지 못했습니다.", "error"); }
  }
  function openEntry(entry: FileEntry) {
    if (entry.kind === "directory") go(entry.path);
    else if (viewerKind(entry)) useViewer.getState().open(entry, entries);
    else void system(entry.path, "open");
  }
  const inClipboard = (target: string, mode?: PasteMode) => Boolean(clipboard && (!mode || clipboard.mode === mode) && clipboard.paths.some((path) => path.toLowerCase() === target.toLowerCase()));
  function cutOrCopy(entry: FileEntry, mode: PasteMode) {
    const next: Clipboard = { paths: [entry.path], mode };
    setClipboard(next);
    say(mode === "cut" ? `‘${entry.name}’을(를) 잘라냈습니다. 붙여넣을 폴더에서 Ctrl+V를 누르세요.` : `‘${entry.name}’을(를) 복사했습니다.`);
  }
  /** 폴더 목록 캐시를 버린다. 붙여넣기·삭제 뒤 바뀐 폴더와 그 상위(트리의 하위 폴더 수)를 다시 읽는다. */
  const invalidate = (...folders: (string | null)[]) => {
    for (const folder of folders) if (folder) void queryClient.invalidateQueries({ queryKey: ["files", "list", folder] });
  };
  async function paste(destination: string) {
    if (!clipboard || busy) return;
    setBusy(true);
    try {
      const result = await pasteItems(clipboard.paths, destination, clipboard.mode);
      const sources = new Set(clipboard.paths.map((path) => parentOf(path)));
      invalidate(destination, ...sources);
      if (clipboard.mode === "cut") { setClipboard(null); if (result.done.length) useViewer.getState().forget(result.done.map((item) => item.from)); }
      if (result.done.length && destination.toLowerCase() === (location ?? "").toLowerCase()) select(result.done[0].to);
      if (result.failed.length) say(result.done.length ? `${result.done.length}개를 붙여 넣고 ${result.failed.length}개는 건너뛰었습니다: ${result.failed[0].message}` : result.failed[0].message, "error");
      else say(clipboard.mode === "cut" ? `${result.done.length}개를 옮겼습니다.` : `${result.done.length}개를 붙여 넣었습니다.`);
    } catch (error) { say(error instanceof Error ? error.message : "붙여 넣지 못했습니다.", "error"); }
    finally { setBusy(false); }
  }
  async function confirmRemove() {
    const entry = removing;
    setRemoving(null);
    if (!entry || busy) return;
    setBusy(true);
    try {
      const result = await deleteItems([entry.path]);
      invalidate(parentOf(entry.path));
      if (result.done.length) {
        useViewer.getState().forget(result.done);
        if (clipboard?.paths.some((path) => result.done.includes(path))) setClipboard(null);
        if (selected === entry.path) select(null);
        say(result.recycled ? `‘${entry.name}’을(를) 휴지통으로 옮겼습니다.` : `‘${entry.name}’을(를) 삭제했습니다.`);
      } else say(result.failed[0]?.message ?? "삭제하지 못했습니다.", "error");
    } catch (error) { say(error instanceof Error ? error.message : "삭제하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  }
  async function copyPath(target: string) {
    try { await navigator.clipboard.writeText(target); say("경로를 복사했습니다."); }
    catch { say("클립보드에 복사하지 못했습니다.", "error"); }
  }
  function download(target: string) {
    const link = document.createElement("a");
    link.href = contentUrl(target, true); link.download = "";
    document.body.append(link); link.click(); link.remove();
  }

  function openMenu(entry: FileEntry | null, left: number, top: number, tree?: TreeTarget) {
    if (entry) select(entry.path);
    leavingRef.current = false;
    setMenuLeaving(false);
    // 열 때마다 새로 마운트해(key) 닫히는 중인 이전 메뉴를 이어 쓰지 않는다. 그래야 첫 항목이 초점을 받고 Esc가 먹는다.
    setMenu({ entry, tree, left, top, id: Date.now() + Math.random() });
  }
  function closeMenu(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    leavingRef.current = true;
    setMenuLeaving(true);
    if (!returnFocus) return;
    // 트리에서 연 메뉴는 트리 항목으로, 본문에서 연 메뉴는 목록으로 초점을 돌려준다.
    if (menu.tree) (document.querySelector<HTMLElement>(".files-tree [role=treeitem][tabindex='0']"))?.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  }
  const favoriteEntry = (target: string): MenuEntry => (isFavorite(target)
    ? { kind: "item", id: "unpin", label: "즐겨찾기에서 제거", onSelect: () => { useFiles.getState().removeFavorite(favoriteList.find((path) => path.toLowerCase() === target.toLowerCase())!, favoriteList); say("즐겨찾기에서 뺐습니다."); } }
    : { kind: "item", id: "pin", label: "즐겨찾기에 추가", onSelect: () => { useFiles.getState().addFavorite(target, favoriteList); say("즐겨찾기에 추가했습니다."); } });
  const treeEntries = (tree: TreeTarget): MenuEntry[] => {
    const collapse: MenuEntry = { kind: "item", id: "collapse", label: "모두 접기", onSelect: () => useFiles.getState().collapseAll() };
    if (tree.kind === "fav-root") return [
      { kind: "item", id: "reset", label: "기본 즐겨찾기로 되돌리기", disabled: favoritePaths === null, onSelect: () => useFiles.getState().resetFavorites() },
      { kind: "separator", id: "sep" }, collapse,
    ];
    if (tree.kind === "pc-root" || tree.path === null) return [{ kind: "item", id: "open", label: "열기", onSelect: () => go(null) }, { kind: "separator", id: "sep" }, collapse];
    const target = tree.path;
    const at = favoriteList.indexOf(target);
    return [
      { kind: "item", id: "open", label: "열기", onSelect: () => go(target) },
      favoriteEntry(target),
      ...(tree.kind === "favorite" ? [
        { kind: "item" as const, id: "up", label: "위로 이동", disabled: at <= 0, onSelect: () => useFiles.getState().moveFavorite(target, -1, favoriteList) },
        { kind: "item" as const, id: "down", label: "아래로 이동", disabled: at < 0 || at >= favoriteList.length - 1, onSelect: () => useFiles.getState().moveFavorite(target, 1, favoriteList) },
      ] : []),
      { kind: "separator", id: "sep" },
      { kind: "item", id: "explorer", label: "탐색기에서 열기", onSelect: () => void system(target, "open") },
      { kind: "item", id: "copy", label: "경로 복사", onSelect: () => void copyPath(target) },
      { kind: "separator", id: "sep2" }, collapse,
    ];
  };
  const pasteEntry = (destination: string): MenuEntry => ({ kind: "item", id: "paste", label: "붙여넣기", disabled: !clipboard || busy, onSelect: () => void paste(destination) });
  const menuEntries = (target: Menu): MenuEntry[] => {
    if (target.tree) return treeEntries(target.tree);
    const entry = target.entry;
    if (entry) {
      const viewer = viewerKind(entry);
      return [
        { kind: "item", id: "open", label: entry.kind === "directory" ? "열기" : viewer ? "뷰어로 열기" : "기본 앱으로 열기", onSelect: () => openEntry(entry) },
        ...(viewer ? [{ kind: "item" as const, id: "system", label: "기본 앱으로 열기", onSelect: () => void system(entry.path, "open") }] : []),
        ...(entry.kind === "directory" ? [favoriteEntry(entry.path)] : []),
        { kind: "item", id: "reveal", label: "탐색기에서 보기", onSelect: () => void system(entry.path, "reveal") },
        ...(entry.kind === "file" ? [{ kind: "item" as const, id: "download", label: "내려받기", onSelect: () => download(entry.path) }] : []),
        { kind: "separator", id: "sep" },
        { kind: "item", id: "cut", label: "잘라내기", onSelect: () => cutOrCopy(entry, "cut") },
        { kind: "item", id: "copy", label: "복사", onSelect: () => cutOrCopy(entry, "copy") },
        ...(entry.kind === "directory" ? [pasteEntry(entry.path)] : []),
        { kind: "item", id: "delete", label: "삭제", danger: true, disabled: busy, onSelect: () => setRemoving(entry) },
        { kind: "separator", id: "sep2" },
        { kind: "item", id: "path", label: "경로 복사", onSelect: () => void copyPath(entry.path) },
        { kind: "item", id: "properties", label: "속성", onSelect: () => setProperties(entry.path) },
      ];
    }
    return [
      { kind: "item", id: "refresh", label: "새로 고침", onSelect: refresh },
      ...(location !== null ? [pasteEntry(location), { kind: "item" as const, id: "explorer", label: "탐색기에서 이 폴더 열기", onSelect: () => void system(location, "open") }, favoriteEntry(location)] : []),
      { kind: "separator", id: "sep" },
      { kind: "radio", id: "list", label: "목록 보기", checked: view === "list", onSelect: () => setView("list") },
      { kind: "radio", id: "grid", label: "아이콘 보기", checked: view === "grid", onSelect: () => setView("grid") },
      { kind: "separator", id: "sep2" },
      { kind: "item", id: "hidden", label: showHidden ? "숨김 항목 감추기" : "숨김 항목 보기", onSelect: toggleHidden },
      ...(location !== null ? [{ kind: "separator" as const, id: "sep3" }, { kind: "item" as const, id: "properties", label: "속성", onSelect: () => setProperties(location) }] : []),
    ];
  };

  /** 화살표·Home·End로 고르고, Enter로 열고, Backspace·Alt+↑로 위로, Alt+←/→로 뒤로·앞으로. 글자를 치면 그 이름으로 건너뛴다.
   *  Ctrl+C·X·V는 복사·잘라내기·붙여넣기, Delete는 삭제, Alt+Enter는 속성이다. */
  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); back(); return; }
    if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); forward(); return; }
    if ((event.altKey && event.key === "ArrowUp") || event.key === "Backspace") { event.preventDefault(); up(); return; }
    if (event.altKey && event.key === "Enter") { event.preventDefault(); if (current) setProperties(current.path); else if (location !== null) setProperties(location); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === "c" && current) { event.preventDefault(); cutOrCopy(current, "copy"); return; }
      if (key === "x" && current) { event.preventDefault(); cutOrCopy(current, "cut"); return; }
      if (key === "v" && location !== null) { event.preventDefault(); void paste(location); return; }
    }
    if (event.key === "Delete" && current && !event.ctrlKey && !event.altKey) { event.preventDefault(); setRemoving(current); return; }
    if (event.key === "F5") { event.preventDefault(); refresh(); return; }
    if (event.shiftKey && event.key === "F10") { event.preventDefault(); openContextAtSelection(); return; }
    if (event.key === "ContextMenu") { event.preventDefault(); openContextAtSelection(); return; }
    if (!entries.length) return;
    const columns = view === "grid" ? gridColumns(listRef.current) : 1;
    const at = selectedIndex;
    const move = (next: number) => { event.preventDefault(); select(entries[Math.max(0, Math.min(entries.length - 1, next))].path); };
    switch (event.key) {
      case "ArrowDown": move(at < 0 ? 0 : at + columns); return;
      case "ArrowUp": move(at < 0 ? 0 : at - columns); return;
      case "ArrowRight": if (view === "grid") move(at + 1); return;
      case "ArrowLeft": if (view === "grid") move(at - 1); return;
      case "Home": move(0); return;
      case "End": move(entries.length - 1); return;
      case "PageDown": move(at + columns * 10); return;
      case "PageUp": move(at - columns * 10); return;
      case "Enter": if (current) { event.preventDefault(); openEntry(current); } return;
      case " ": if (current) { event.preventDefault(); if (!showPreview) togglePreview(); } return;
      case "Escape": if (selected) { event.stopPropagation(); select(null); } return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const buffer = now - typeahead.current.at < 800 ? typeahead.current.text + event.key.toLocaleLowerCase("ko-KR") : event.key.toLocaleLowerCase("ko-KR");
      typeahead.current = { text: buffer, at: now };
      const repeat = buffer.length > 1 && [...buffer].every((char) => char === buffer[0]);
      const needle = repeat ? buffer[0] : buffer;
      const start = repeat || buffer.length === 1 ? at + 1 : Math.max(at, 0);
      const order = [...entries.slice(start), ...entries.slice(0, start)];
      const hit = order.find((entry) => entry.name.toLocaleLowerCase("ko-KR").startsWith(needle));
      if (hit) { event.preventDefault(); select(hit.path); }
    }
  }
  function openContextAtSelection() {
    const row = selectedIndex >= 0 ? document.getElementById(optionId(selectedIndex)) : null;
    const box = (row ?? listRef.current)?.getBoundingClientRect();
    if (box) openMenu(current, box.left + 24, box.top + Math.min(box.height, 28));
  }
  const onItemMenu = (entry: FileEntry) => (event: ReactMouseEvent) => { event.preventDefault(); event.stopPropagation(); openMenu(entry, event.clientX, event.clientY); };

  const status = location === null ? `드라이브 ${drives.length}개`
    : data ? `항목 ${entries.length.toLocaleString("ko-KR")}개${hiddenCount ? ` · 숨김 ${hiddenCount.toLocaleString("ko-KR")}개` : ""}${query.trim() ? ` · ‘${query.trim()}’ 거름` : ""}` : "";
  const errorMessage = location !== null && listing.isError && !data ? listing.error.message : null;

  return <Window id="files" bodyClassName="files-body" header={
    <WindowTitleBar id="files" right={<div className="files-tools" role="group" aria-label="보기 도구">
      <InputGroup className="files-filter">
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput id="files-filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이 폴더에서 찾기" aria-label="이 폴더에서 찾기"
          disabled={location === null} autoComplete="off" spellCheck={false} maxLength={200}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); }
            if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); if (entries.length && selectedIndex < 0) select(entries[0].path); listRef.current?.focus(); }
          }} />
        {query && <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="찾기 지우기" onClick={() => { setQuery(""); document.getElementById("files-filter")?.focus(); }}><X aria-hidden="true" /></InputGroupButton>
        </InputGroupAddon>}
      </InputGroup>
      <div className="files-segment" role="radiogroup" aria-label="보기">
        <button type="button" role="radio" aria-checked={view === "list"} aria-label="목록 보기" title="목록 보기" onClick={() => setView("list")}><List aria-hidden="true" /></button>
        <button type="button" role="radio" aria-checked={view === "grid"} aria-label="아이콘 보기" title="아이콘 보기" onClick={() => setView("grid")}><LayoutGrid aria-hidden="true" /></button>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="숨김 항목 보기" title={showHidden ? "숨김 항목 감추기" : "숨김 항목 보기"} aria-pressed={showHidden} onClick={toggleHidden}>
        {showHidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</Button>
      <Button type="button" variant="ghost" size="icon-sm" className="files-preview-toggle" aria-label="미리 보기 창" title="미리 보기 창" aria-pressed={showPreview} onClick={togglePreview}><PanelRight aria-hidden="true" /></Button>
    </div>}>
      <div className="files-chrome">
        <div className="browser-nav" role="group" aria-label="탐색">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="뒤로" title="뒤로 (Alt+←)" disabled={!canBack} onClick={back}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="앞으로" title="앞으로 (Alt+→)" disabled={!canForward} onClick={forward}><ChevronRight aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="위로" title="상위 폴더 (Alt+↑)" disabled={location === null} onClick={up}><ArrowUp aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="새로 고침" title="새로 고침 (F5)" onClick={refresh}>
            <RotateCw aria-hidden="true" data-spinning={listing.isFetching || places.isFetching ? "" : undefined} /></Button>
        </div>
        <PathBar location={location} listing={data} drives={drives} onGo={(target) => go(target)} />
      </div>
    </WindowTitleBar>}>
    <SplitView name="files" label="탐색 창" className="files-layout" defaultWidth={240} minWidth={168} maxWidth={520} minMain={320} side={
      <FilesTree places={places.data} favorites={favorites} location={location} showHidden={showHidden} error={places.isError ? places.error.message : null}
        onGo={(target) => go(target)} onMenu={(tree, left, top) => openMenu(null, left, top, tree)} />} main={
    <div className="files-content">
      {(() => { const main = <section className="files-main" aria-label="폴더 내용" style={columnStyle(columns)} onContextMenu={(event) => { if (location === null || event.defaultPrevented) return; event.preventDefault(); select(null); openMenu(null, event.clientX, event.clientY); }}>
        {location === null
          ? <ThisPC places={places.data} favorites={favorites} loading={places.isPending} onGo={(target) => go(target)} />
          : errorMessage
            ? <div className="files-empty" role="alert"><FileWarning aria-hidden="true" /><strong>이 위치를 열 수 없습니다</strong><span>{errorMessage}</span>
              <div className="files-empty-actions"><Button type="button" size="sm" variant="secondary" onClick={up}><ChevronUp aria-hidden="true" />상위 폴더</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void listing.refetch()}>다시 시도</Button></div></div>
            : !data
              ? <div className="files-loading" role="status"><LoaderCircle aria-hidden="true" /><span>불러오는 중…</span></div>
              : <>
                {data.truncated && <div className="browser-notice" role="status"><TriangleAlert aria-hidden="true" /><span>항목이 너무 많아 이름 순으로 앞 {data.entries.length.toLocaleString("ko-KR")}개만 보입니다(전체 {data.total.toLocaleString("ko-KR")}개).</span></div>}
                {view === "list" && <div className="files-columns" role="row">
                  {COLUMNS.map((column) => <button key={column.key} type="button" role="columnheader" data-column={column.key}
                    aria-sort={sort.key === column.key ? (sort.desc ? "descending" : "ascending") : undefined} onClick={() => sortBy(column.key)}>
                    <span>{column.label}</span>{sort.key === column.key && <ChevronUp aria-hidden="true" data-desc={sort.desc ? "" : undefined} />}
                    {column.key !== "name" && <span className="files-col-resize" aria-hidden="true" title="끌어서 열 너비 조절 · 두 번 눌러 기본 너비"
                      onPointerDown={(event) => resizeColumn(event, column.key as ColumnKey)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                      onDoubleClick={(event) => { event.stopPropagation(); useFiles.getState().setColumns({}); }} />}
                  </button>)}
                </div>}
                <div ref={listRef} className="files-list" data-view={view} role="listbox" tabIndex={0} aria-label={`${data.name} 내용`}
                  aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined} onKeyDown={onListKey}
                  onClick={(event) => { if (event.target === event.currentTarget) select(null); }}>
                  {entries.length === 0
                    ? <div className="files-list-empty">{query.trim() ? `‘${query.trim()}’과 맞는 항목이 없습니다.` : hiddenCount ? `숨김 항목 ${hiddenCount}개만 있습니다.` : "이 폴더는 비어 있습니다."}</div>
                    : entries.map((entry, index) => view === "list"
                      ? <ListRow key={entry.path} entry={entry} index={index} selected={index === selectedIndex} cut={inClipboard(entry.path, "cut")}
                          onSelect={() => select(entry.path)} onOpen={() => openEntry(entry)} onMenu={onItemMenu(entry)} />
                      : <GridTile key={entry.path} entry={entry} index={index} selected={index === selectedIndex} cut={inClipboard(entry.path, "cut")}
                          onSelect={() => select(entry.path)} onOpen={() => openEntry(entry)} onMenu={onItemMenu(entry)} />)}
                </div>
              </>}
        <footer className="files-status" aria-live="polite"><span>{status}</span>
          {current && <span className="files-status-selection">{current.name}{current.size !== null ? ` · ${formatSize(current.size)}` : ""}</span>}</footer>
      </section>;
      if (!showPreview || location === null) return main;
      return <SplitView name="files-preview" label="미리 보기 창" className="files-preview-split" position="end" defaultWidth={272} minWidth={200} maxWidth={560} minMain={280}
        main={main} side={<PreviewPane entry={current} folder={data} onOpen={openEntry} onSystem={(target, action) => void system(target, action)}
          onDownload={download} onCopy={(target) => void copyPath(target)} onProperties={setProperties} />} />; })()}
    </div>} />
    <ConfirmDialog open={removing !== null} title={removing ? `‘${removing.name}’을(를) ${RECYCLE ? "휴지통으로 옮길까요?" : "삭제할까요?"}` : ""}
      description={<p>{RECYCLE ? "휴지통에서 되돌릴 수 있습니다. 휴지통이 없는 드라이브에서는 바로 지워집니다." : "이 작업은 되돌릴 수 없습니다."}</p>}
      confirmLabel={RECYCLE ? "휴지통으로 이동" : "삭제"} confirmDisabled={busy} onConfirm={() => void confirmRemove()} onClose={() => setRemoving(null)}
      onCloseFocus={() => listRef.current?.focus({ preventScroll: true })} />
    <PropertiesDialog path={properties} onClose={() => setProperties(null)} onCopy={(target) => void copyPath(target)} />
    {notice && <div className="files-toast material-toast" role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone}><span>{notice.text}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="알림 닫기" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button></div>}
    {menu && <DesktopMenu key={menu.id} items={menuEntries(menu)} position={{ left: menu.left, top: Math.min(menu.top, window.innerHeight - 200) }} leaving={menuLeaving}
      onClose={closeMenu} onExited={() => { if (!leavingRef.current) return; leavingRef.current = false; setMenu(null); setMenuLeaving(false); }} />}
  </Window>;
}

/** 격자 보기의 한 줄에 놓인 칸 수. 첫 칸과 같은 높이에 있는 칸을 센다. */
function gridColumns(list: HTMLElement | null): number {
  const items = list ? Array.from(list.querySelectorAll<HTMLElement>("[role=option]")) : [];
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  const count = items.findIndex((item) => item.offsetTop !== top);
  return count === -1 ? items.length : count;
}

/** 위치 경로. 누르면 그 폴더로 가고, 빈 곳을 누르거나 Ctrl+L이면 경로를 직접 친다. */
function PathBar({ location, listing, drives, onGo }: { location: Location; listing: Listing | undefined; drives: Drive[]; onGo: (target: Location) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey && event.key.toLowerCase() === "l") && !(event.altKey && event.key.toLowerCase() === "d")) return;
      if (useDesktop.getState().focused !== "files") return;
      event.preventDefault(); start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { if (editing) requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, [editing]);
  const crumbs = location === null ? [] : listing?.crumbs ?? [{ name: location, path: location }];
  // 경로가 칸을 넘치면 앞쪽 폴더부터 `…` 하나로 접는다. 칸 너비나 위치가 바뀌면 다시 잰다.
  const navRef = useRef<HTMLElement>(null);
  const [folded, setFolded] = useState(0);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [editing]);
  useLayoutEffect(() => { setFolded(0); }, [location, listing?.path, width, drives.length]);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav && nav.scrollWidth > nav.clientWidth + 1 && folded < crumbs.length - 1) setFolded(folded + 1);
  });
  function start() { setValue(location ?? ""); setEditing(true); }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = value.trim().replace(/^"(.*)"$/, "$1");
    setEditing(false);
    if (target && target !== location) onGo(target);
  }
  if (editing) return <form className="files-path" onSubmit={submit}>
    <InputGroup className="address-field">
      <InputGroupAddon><FolderOpen aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} aria-label="경로" placeholder="C:\Users\…"
        onBlur={() => setEditing(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(false); } }}
        autoComplete="off" spellCheck={false} maxLength={4096} />
    </InputGroup>
  </form>;
  const label = (name: string, index: number) => {
    if (index !== 0) return name;
    const drive = drives.find((item) => item.path.replace(/\\$/, "") === name || item.path === name);
    return drive ? driveName(drive) : name;
  };
  const hidden = crumbs.slice(0, folded);
  return <nav ref={navRef} className="files-path address-field" aria-label="위치" data-tight={folded > 0 && folded >= crumbs.length - 1 ? "" : undefined} onClick={(event) => { if (event.target === event.currentTarget) start(); }}>
    <button type="button" className="files-crumb" data-root="" aria-label="이 PC" title="이 PC" aria-current={location === null ? "location" : undefined} onClick={() => onGo(null)}>
      <Monitor aria-hidden="true" />{location === null && <span>이 PC</span>}</button>
    {folded > 0 && <span className="files-crumb-wrap" data-folded="">
      <ChevronRight aria-hidden="true" />
      <button type="button" className="files-crumb" aria-label={`접힌 경로: ${hidden.map((crumb, index) => label(crumb.name, index)).join(" › ")}`}
        title={hidden.map((crumb, index) => label(crumb.name, index)).join(" › ")} onClick={() => onGo(hidden.at(-1)!.path)}><span>…</span></button>
    </span>}
    {crumbs.map((crumb, index) => index < folded ? null : <span key={crumb.path} className="files-crumb-wrap">
      <ChevronRight aria-hidden="true" />
      <button type="button" className="files-crumb" aria-current={index === crumbs.length - 1 ? "location" : undefined} onClick={() => onGo(crumb.path)}>
        <span>{label(crumb.name, index)}</span></button>
    </span>)}
    <button type="button" className="files-path-edit" aria-label="경로 직접 입력 (Ctrl+L)" title="경로 직접 입력 (Ctrl+L)" onClick={start} />
  </nav>;
}

/** 시작 화면: 즐겨찾기 카드와 드라이브 사용량. */
function ThisPC({ places, favorites, loading, onGo }: { places: Places | undefined; favorites: Favorite[]; loading: boolean; onGo: (target: Location) => void }) {
  if (loading) return <div className="files-loading" role="status"><LoaderCircle aria-hidden="true" /><span>불러오는 중…</span></div>;
  return <div className="files-home">
    <section aria-labelledby="files-home-places">
      <h3 id="files-home-places">즐겨찾기</h3>
      <ul className="files-place-grid">
        {favorites.map((favorite) => {
          const Icon = favorite.place ? PLACE_ICONS[favorite.place] : Folder;
          return <li key={favorite.path}><button type="button" className="files-place" onClick={() => onGo(favorite.path)} title={favorite.path}>
            <span className="files-place-icon" data-place={favorite.place ?? "folder"}><Icon aria-hidden="true" /></span>
            <span className="files-place-text"><strong>{favorite.label}</strong><small>{favorite.path}</small></span>
          </button></li>;
        })}
      </ul>
    </section>
    <section aria-labelledby="files-home-drives">
      <h3 id="files-home-drives">장치 및 드라이브</h3>
      <ul className="files-drive-grid">
        {(places?.drives ?? []).map((drive) => {
          const used = drive.total && drive.free !== null ? 1 - drive.free / drive.total : null;
          return <li key={drive.path}><button type="button" className="files-drive" onClick={() => onGo(drive.path)}>
            <span className="files-drive-icon"><HardDrive aria-hidden="true" /></span>
            <span className="files-drive-text">
              <strong>{driveName(drive)}</strong>
              {used !== null ? <>
                <span className="files-meter" data-full={used > .9 ? "" : undefined} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label={`${driveName(drive)} 사용량`}>
                  <span style={{ width: `${Math.max(2, Math.round(used * 100))}%` }} /></span>
                <small>{formatSize(drive.total!)} 중 {formatSize(drive.free)} 사용 가능</small>
              </> : <small>{drive.type === "network" ? "네트워크 위치" : drive.type === "optical" ? "디스크 정보 없음" : "용량 정보 없음"}</small>}
            </span>
          </button></li>;
        })}
      </ul>
    </section>
  </div>;
}

type ItemProps = { entry: FileEntry; index: number; selected: boolean; cut: boolean; onSelect: () => void; onOpen: () => void; onMenu: (event: ReactMouseEvent) => void };

const columnStyle = (columns: ColumnWidths) => Object.fromEntries(Object.entries(columns).map(([key, width]) => [`--files-${key}`, `${width}px`])) as CSSProperties;
/** 이름 열이 끝까지 지키는 폭 */
const NAME_MIN = 120;

/**
 * 머리글 사이 경계를 끌어 열 너비를 바꾼다. 경계가 포인터를 따라가도록 경계 양쪽 열을 함께 바꾸며(합은 그대로),
 * 왼쪽이 이름 열이면 오른쪽 열만 바꾸고 이름 열이 남는 폭을 받는다. 끄는 동안은 CSS 변수만 바꾸고 놓을 때 저장한다.
 */
function resizeColumn(event: ReactPointerEvent<HTMLSpanElement>, key: ColumnKey) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const handle = event.currentTarget;
  const main = handle.closest<HTMLElement>(".files-main");
  const headers = Array.from(handle.closest(".files-columns")?.querySelectorAll<HTMLElement>("[role=columnheader]") ?? []).filter((item) => item.offsetWidth > 0);
  const at = headers.findIndex((item) => item.dataset.column === key);
  if (!main || at < 1) return;
  const leftKey = headers[at - 1].dataset.column as SortKey;
  const width = (element: HTMLElement) => element.getBoundingClientRect().width;
  const startLeft = width(headers[at - 1]), startRight = width(headers[at]);
  const startX = event.clientX;
  const changed: ColumnWidths = {};
  handle.setPointerCapture(event.pointerId);
  handle.dataset.active = "";
  const move = (moveEvent: PointerEvent) => {
    const leftMin = leftKey === "name" ? Math.min(startLeft, NAME_MIN) : COLUMN_MIN[leftKey as ColumnKey];
    const dx = Math.min(startRight - COLUMN_MIN[key], Math.max(leftMin - startLeft, moveEvent.clientX - startX));
    changed[key] = Math.round(startRight - dx);
    if (leftKey !== "name") changed[leftKey as ColumnKey] = Math.round(startLeft + dx);
    for (const [column, value] of Object.entries(changed)) main.style.setProperty(`--files-${column}`, `${value}px`);
  };
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    delete handle.dataset.active;
    if (Object.keys(changed).length) useFiles.getState().setColumns({ ...useFiles.getState().columns, ...changed });
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function ListRow({ entry, index, selected, cut, onSelect, onOpen, onMenu }: ItemProps) {
  const type = fileType(entry);
  const Icon = type.icon;
  return <div id={optionId(index)} role="option" aria-selected={selected} className="files-row" data-hidden={entry.hidden ? "" : undefined} data-cut={cut ? "" : undefined}
    onMouseDown={onSelect} onDoubleClick={onOpen} onContextMenu={onMenu} title={entry.name}>
    <span className="files-cell-name"><Icon aria-hidden="true" className="files-icon" data-tone={type.tone} /><span>{entry.name}</span>
      {entry.link && <SquareArrowOutUpRight aria-label="바로 가기" className="files-link-badge" />}</span>
    <span className="files-cell" data-column="modified">{formatDate(entry.modified)}</span>
    <span className="files-cell" data-column="kind">{type.label}</span>
    <span className="files-cell" data-column="size">{formatSize(entry.size)}</span>
  </div>;
}

function GridTile({ entry, index, selected, cut, onSelect, onOpen, onMenu }: ItemProps) {
  const type = fileType(entry);
  const Icon = type.icon;
  const [broken, setBroken] = useState(false);
  const thumb = type.preview === "image" && !broken && (entry.size ?? 0) <= THUMB_MAX_BYTES;
  return <div id={optionId(index)} role="option" aria-selected={selected} className="files-tile" data-hidden={entry.hidden ? "" : undefined} data-cut={cut ? "" : undefined}
    onMouseDown={onSelect} onDoubleClick={onOpen} onContextMenu={onMenu} title={entry.name}>
    <span className="files-tile-art" data-tone={type.tone}>
      {thumb ? <img src={contentUrl(entry.path)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
        : <Icon aria-hidden="true" className="files-icon" data-tone={type.tone} />}
    </span>
    <span className="files-tile-name">{entry.name}</span>
  </div>;
}

type TextState = { path: string; status: "loading" | "ready" | "binary" | "error"; text?: string; message?: string };

/** 오른쪽 미리 보기: 그림·영상·소리·글·PDF 첫 쪽을 보이고, 정보와 열기·탐색기·내려받기·경로 복사·속성 단추를 둔다. */
function PreviewPane({ entry, folder, onOpen, onSystem, onDownload, onCopy, onProperties }: {
  entry: FileEntry | null; folder: Listing | undefined; onOpen: (entry: FileEntry) => void; onSystem: (target: string, action: "open" | "reveal") => void;
  onDownload: (target: string) => void; onCopy: (target: string) => void; onProperties: (target: string) => void;
}) {
  const type = entry ? fileType(entry) : null;
  const [text, setText] = useState<TextState | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  // PDF 첫 쪽은 창 안쪽 폭에 맞춰 그린다. 경계를 끌면 다시 그린다.
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const observer = new ResizeObserver(([item]) => setWidth(Math.max(0, Math.round(item.contentRect.width))));
    observer.observe(aside);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!entry || type?.preview !== "text") return;
    const controller = new AbortController();
    setText({ path: entry.path, status: "loading" });
    readTextPreview(entry.path, controller.signal)
      .then((value) => setText(value === null ? { path: entry.path, status: "binary" } : { path: entry.path, status: "ready", text: value }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setText({ path: entry.path, status: "error", message: error instanceof Error ? error.message : "읽지 못했습니다." }); });
    return () => controller.abort();
  }, [entry?.path, entry?.modified, type?.preview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entry || !type) {
    if (!folder) return <aside ref={asideRef} className="files-preview" aria-label="미리 보기" />;
    const folders = folder.entries.filter((item) => item.kind === "directory").length;
    return <aside ref={asideRef} className="files-preview" aria-label="미리 보기">
      <div className="files-preview-art" data-tone="folder"><FolderOpen aria-hidden="true" className="files-icon" data-tone="folder" /></div>
      <h3 className="files-preview-name">{folder.name}</h3>
      <p className="files-preview-kind">폴더 · 하위 폴더 {folders.toLocaleString("ko-KR")}개 · 파일 {(folder.total - folders).toLocaleString("ko-KR")}개</p>
      <div className="files-preview-actions">
        <Button type="button" size="sm" variant="secondary" onClick={() => onSystem(folder.path, "open")}><SquareArrowOutUpRight aria-hidden="true" />탐색기에서 열기</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(folder.path)}><Copy aria-hidden="true" />경로 복사</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onProperties(folder.path)}><Info aria-hidden="true" />속성</Button>
      </div>
    </aside>;
  }
  const viewer = viewerKind(entry);
  const Icon = type.icon;
  const textState = text?.path === entry.path ? text : null;
  const art = type.preview === "image" && broken !== entry.path
    ? <img key={entry.path} src={contentUrl(entry.path)} alt={entry.name} decoding="async" draggable={false} onError={() => setBroken(entry.path)} />
    : type.preview === "video" && broken !== entry.path
      ? <video key={entry.path} src={contentUrl(entry.path)} controls preload="metadata" onError={() => setBroken(entry.path)} />
      : <Icon aria-hidden="true" className="files-icon" data-tone={type.tone} />;
  return <aside ref={asideRef} className="files-preview" aria-label="미리 보기">
    {type.preview === "pdf" ? <PdfPreview key={entry.path} entry={entry} width={width} />
    : type.preview === "text"
      ? <div className="files-preview-text">
        {!textState || textState.status === "loading" ? <span className="files-preview-note">불러오는 중…</span>
          : textState.status === "binary" ? <span className="files-preview-note">글자로 읽을 수 없는 파일입니다.</span>
            : textState.status === "error" ? <span className="files-preview-note">{textState.message}</span>
              : <pre>{textState.text}</pre>}
      </div>
      : <div className="files-preview-art" data-tone={type.tone} data-media={type.preview === "image" || type.preview === "video" ? "" : undefined}>{art}</div>}
    {type.preview === "audio" && <audio key={entry.path} className="files-preview-audio" src={contentUrl(entry.path)} controls preload="metadata" />}
    <h3 className="files-preview-name">{entry.name}</h3>
    <p className="files-preview-kind">{type.label}{entry.size !== null ? ` · ${formatSize(entry.size)}` : ""}</p>
    {type.preview === "text" && (entry.size ?? 0) > TEXT_PREVIEW_BYTES && <p className="files-preview-note">앞 256KB만 미리 봅니다.</p>}
    <dl className="files-preview-info">
      <dt>수정한 날짜</dt><dd>{formatDate(entry.modified) || "알 수 없음"}</dd>
      <dt>위치</dt><dd title={entry.path}>{entry.path}</dd>
    </dl>
    <div className="files-preview-actions">
      <Button type="button" size="sm" onClick={() => onOpen(entry)}>{entry.kind === "directory" ? <><FolderOpen aria-hidden="true" />열기</> : viewer ? <><Eye aria-hidden="true" />뷰어로 열기</> : <><SquareArrowOutUpRight aria-hidden="true" />기본 앱으로 열기</>}</Button>
      {viewer && <Button type="button" size="sm" variant="secondary" onClick={() => onSystem(entry.path, "open")}><SquareArrowOutUpRight aria-hidden="true" />기본 앱으로 열기</Button>}
      <Button type="button" size="sm" variant="secondary" onClick={() => onSystem(entry.path, "reveal")}><FolderOpen aria-hidden="true" />탐색기에서 보기</Button>
      {entry.kind === "file" && <Button type="button" size="sm" variant="ghost" onClick={() => onDownload(entry.path)}><Download aria-hidden="true" />내려받기</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(entry.path)}><Copy aria-hidden="true" />경로 복사</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => onProperties(entry.path)}><Info aria-hidden="true" />속성</Button>
    </div>
  </aside>;
}
