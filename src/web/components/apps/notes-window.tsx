import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, FileText, Folder as FolderIcon, FolderOpen, FolderPlus, Search, SquarePen, Trash, TriangleAlert, X } from "lucide-react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { AppIcon } from "../desktop/app-icons";
import { DesktopMenu, type MenuEntry } from "../desktop/menu";
import { NoteDocument } from "./note-editor";
import {
  childMap, isWithin, labelOf, noteCounts, pathOf, previewOf, search, targetFolder, useNotes, visibleRows,
  type Folder, type Item, type Items, type Note, type Row,
} from "../../lib/notes";

const DRAG_TYPE = "application/x-relay-note";
const UNDO_MS = 8000;
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });
const timeOnly = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
/** 카드에는 오늘이면 시각만, 아니면 날짜만 보인다. */
const cardDate = (time: number) => (new Date(time).toDateString() === new Date().toDateString() ? timeOnly : shortDate).format(time);

const rowId = (id: string) => `notes-row-${id}`;
const focusRow = (id: string | null) => {
  const row = id ? document.getElementById(rowId(id)) : null;
  (row ?? document.querySelector<HTMLElement>(".notes-tree [role=treeitem]"))?.focus({ preventScroll: false });
};
const focusField = (field: "title" | "body") => requestAnimationFrame(() => document.getElementById(`note-${field}`)?.focus());

type Menu = { kind: "item" | "move" | "root"; id: string | null; left: number; top: number };
/** 메뉴가 화면 아래로 넘치지 않게 위로 올린다(항목 26px, 구분선 9px). */
const menuTop = (top: number, entries: MenuEntry[]) => {
  const height = Math.min(entries.reduce((sum, entry) => sum + (entry.kind === "separator" ? 9 : 26), 8), window.innerHeight * .6);
  return Math.max(8, Math.min(top, window.innerHeight - height - 8));
};

/** 폴더 트리로 정리하는 여러 메모. 내용은 이 브라우저(localStorage)에만 남는다. */
export function NotesWindow() {
  const items = useNotes((state) => state.items);
  const selected = useNotes((state) => state.selected);
  const expanded = useNotes((state) => state.expanded);
  const trash = useNotes((state) => state.trash);
  const status = useNotes((state) => state.status);
  const sync = useNotes((state) => state.sync);
  const { select, createNote, createFolder, remove, startRename, move, undoRemove, dismissTrash, setExpanded } = useNotes.getState();
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<"tree" | "content">("tree");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  // 닫히는 메뉴의 종료 트윈이 끝나기 전에 새 메뉴를 열면, 늦게 오는 종료 알림은 무시한다.
  const leavingRef = useRef(false);
  const menuNext = useRef<{ focus: string | null | false; then?: Menu }>({ focus: null });
  const current = selected ? items[selected] : undefined;
  // 부모별 자식 목록과 폴더별 메모 수는 항목이 바뀔 때 한 번만 구해 트리·카드가 함께 쓴다.
  const tree = useMemo(() => { const map = childMap(items); return { map, notes: noteCounts(items, map) }; }, [items]);
  const counts = useMemo(() => {
    let notes = 0, folders = 0;
    for (const item of Object.values(items)) if (item.kind === "note") notes++; else folders++;
    return { notes, folders };
  }, [items]);

  // 되살리기 안내는 잠시 뒤 스스로 사라진다.
  useEffect(() => {
    if (!trash) return;
    const timer = setTimeout(dismissTrash, UNDO_MS);
    return () => clearTimeout(timer);
  }, [trash, dismissTrash]);

  function newNote(parentId = targetFolder(items, selected)) {
    createNote(parentId);
    setQuery("");
    setPane("content");
    focusField("title");
  }
  function newFolder(parentId = targetFolder(items, selected)) {
    createFolder(parentId);
    setQuery("");
    setPane("tree");
  }
  function open(id: string) {
    select(id);
    if (useNotes.getState().items[id]?.kind === "note") setPane("content");
  }
  function removeItem(id: string | null) {
    if (!id) return;
    remove(id);
    // 좁은 창에서 보던 메모를 지우면 목록으로 돌아간다.
    const { items: next, selected: now } = useNotes.getState();
    if (!now || next[now]?.kind !== "note") setPane("tree");
  }

  function openMenu(kind: Menu["kind"], id: string | null, left: number, top: number) {
    menuNext.current = { focus: id ?? selected };
    leavingRef.current = false;
    setMenuLeaving(false);
    setMenu({ kind, id, left, top });
  }
  function closeMenu(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    leavingRef.current = true;
    setMenuLeaving(true);
    const { focus } = menuNext.current;
    if (returnFocus && focus !== false) focusRow(focus ?? null);
  }
  function menuExited() {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    const then = menuNext.current.then;
    setMenu(null);
    setMenuLeaving(false);
    // "다른 폴더로 이동…"은 첫 메뉴가 닫힌 뒤 같은 자리에 폴더 목록을 연다.
    if (then) { menuNext.current = { focus: then.id }; setMenu(then); }
  }
  /** 메뉴 항목이 초점을 직접 옮기면 메뉴가 닫힐 때 초점을 행으로 되돌리지 않는다. */
  const keepFocus = (action: () => void) => () => { menuNext.current.focus = false; action(); };

  function menuItems(target: Menu): MenuEntry[] {
    if (target.kind === "root") return [
      { kind: "item", id: "note", label: "새 메모", onSelect: keepFocus(() => newNote(null)) },
      { kind: "item", id: "folder", label: "새 폴더", onSelect: keepFocus(() => newFolder(null)) },
    ];
    const item = target.id ? items[target.id] : undefined;
    if (!item) return [];
    if (target.kind === "move") {
      const folders: Array<{ folder: Folder; depth: number }> = [];
      const walk = (parentId: string | null, depth: number) => {
        for (const child of tree.map.get(parentId) ?? []) if (child.kind === "folder") { folders.push({ folder: child, depth }); walk(child.id, depth + 1); }
      };
      walk(null, 0);
      const to = (parentId: string | null) => () => { move(item.id, parentId); menuNext.current.focus = item.id; };
      return [
        { kind: "radio", id: "move-root", label: "최상위", checked: item.parentId === null, onSelect: to(null) },
        ...(folders.length ? [{ kind: "separator", id: "move-sep" } satisfies MenuEntry] : []),
        ...folders.map(({ folder, depth }): MenuEntry => ({
          kind: "radio", id: `move-${folder.id}`, label: `${" ".repeat(depth)}${folder.name}`, checked: item.parentId === folder.id,
          disabled: item.kind === "folder" && isWithin(items, folder.id, item.id), onSelect: to(folder.id),
        })),
      ];
    }
    const moveTo = () => { menuNext.current.then = { ...target, kind: "move" }; };
    const rename = keepFocus(() => { select(item.id); startRename(item.id); });
    return [
      ...(item.kind === "folder" ? [
        { kind: "item", id: "note", label: "이 폴더에 새 메모", onSelect: keepFocus(() => newNote(item.id)) },
        { kind: "item", id: "folder", label: "이 폴더에 새 폴더", onSelect: keepFocus(() => newFolder(item.id)) },
        { kind: "separator", id: "sep-new" },
      ] satisfies MenuEntry[] : []),
      { kind: "item", id: "rename", label: item.kind === "folder" ? "이름 바꾸기" : "제목 바꾸기", onSelect: rename },
      { kind: "item", id: "move", label: "다른 폴더로 이동…", onSelect: moveTo },
      { kind: "separator", id: "sep-del" },
      { kind: "item", id: "delete", label: "삭제", onSelect: () => { menuNext.current.focus = item.parentId ?? null; removeItem(item.id); } },
    ];
  }
  const entries = menu ? menuItems(menu) : [];

  return <Window id="notes" bodyClassName="notes-body" header={
    <WindowTitleBar id="notes" right={<div className="notes-tools" role="group" aria-label="메모 도구">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="새 폴더" title="새 폴더" onClick={() => newFolder()}><FolderPlus aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="새 메모" title="새 메모" onClick={() => newNote()}><SquarePen aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="삭제" title="삭제" disabled={!current} onClick={() => removeItem(selected)}><Trash aria-hidden="true" /></Button>
    </div>} />}>
    <div className="notes-layout" data-pane={pane}>
      <aside className="notes-sidebar material-chrome" aria-label="메모 목록"
        onContextMenu={(event) => { if (event.defaultPrevented) return; event.preventDefault(); openMenu("root", null, event.clientX, event.clientY); }}>
        <div className="notes-search">
          <InputGroup>
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput id="notes-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메모 검색" aria-label="메모 검색"
              onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }} autoComplete="off" spellCheck={false} maxLength={200} />
            {query && <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="검색어 지우기" onClick={() => { setQuery(""); document.getElementById("notes-search")?.focus(); }}><X aria-hidden="true" /></InputGroupButton>
            </InputGroupAddon>}
          </InputGroup>
        </div>
        {query.trim()
          ? <SearchResults items={items} query={query} selected={selected} onOpen={open} />
          : <NotesTree items={items} map={tree.map} counts={tree.notes} expanded={expanded} selected={selected} onOpen={open}
              onMenu={(id, left, top) => openMenu("item", id, left, top)} onDelete={removeItem} onToggle={setExpanded} />}
        <div className="notes-footer"><span>메모 {counts.notes}개{counts.folders ? ` · 폴더 ${counts.folders}개` : ""}</span><span className="notes-sync" data-sync={status === "ready" ? sync : status}>{status === "loading" ? "불러오는 중…" : status === "error" ? "서버 연결 대기"
          : sync === "saving" ? "저장 중…" : sync === "offline" ? "저장 대기 · 다시 시도 중" : sync === "rejected" ? "저장 실패" : "Relay DB에 저장됨"}</span></div>
      </aside>
      <section className="notes-content" aria-label={current?.kind === "note" ? "메모 편집" : "폴더 내용"}>
        {status === "error" && <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>메모를 불러오지 못했습니다. Relay 서버에 다시 연결하는 중입니다.</span></div>}
        {status === "ready" && sync === "offline" && <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>서버에 저장하지 못했습니다. 변경은 이 브라우저에 남겨 두었다가 연결되면 다시 저장합니다.</span></div>}
        {status === "ready" && sync === "rejected" && <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>서버가 마지막 변경을 받지 않았습니다. 다시 고치면 다시 저장을 시도합니다.</span></div>}
        {current?.kind === "note"
          ? <NoteEditor key={current.id} note={current} items={items} onBack={() => setPane("tree")} onOpen={open} />
          : <FolderView folder={current?.kind === "folder" ? current : null} items={items} map={tree.map} counts={tree.notes} onOpen={open} onBack={() => setPane("tree")}
              onNewNote={(id) => newNote(id)} onNewFolder={(id) => newFolder(id)} empty={counts.notes + counts.folders === 0} loading={status !== "ready"} />}
      </section>
    </div>
    {trash && <div className="notes-undo material-toast" role="status">
      <span>{trash.kind === "folder" ? `‘${trash.label}’ 폴더${trash.notes ? `와 메모 ${trash.notes}개` : ""}를 삭제했습니다.` : `‘${trash.label}’ 메모를 삭제했습니다.`}</span>
      <Button type="button" size="xs" variant="secondary" onClick={() => { undoRemove(); requestAnimationFrame(() => focusRow(useNotes.getState().selected)); }}>실행 취소</Button>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="안내 닫기" onClick={dismissTrash}><X aria-hidden="true" /></Button>
    </div>}
    {menu && entries.length > 0 && <DesktopMenu items={entries} position={{ left: menu.left, top: menuTop(menu.top, entries) }} leaving={menuLeaving}
      onClose={closeMenu} onExited={menuExited} className={menu.kind === "move" ? "notes-move-menu" : undefined} />}
  </Window>;
}

/** 폴더와 메모의 트리. 끌어서 폴더로 옮기고, 화살표·F2·Delete·메뉴 키로 다룬다. */
function NotesTree({ items, map, counts, expanded, selected, onOpen, onMenu, onDelete, onToggle }: {
  items: Items; map: Map<string | null, Item[]>; counts: Map<string, number>; expanded: Record<string, true>; selected: string | null;
  onOpen: (id: string) => void; onMenu: (id: string, left: number, top: number) => void; onDelete: (id: string) => void; onToggle: (id: string, open: boolean) => void;
}) {
  const renaming = useNotes((state) => state.renaming);
  const { select, startRename, move } = useNotes.getState();
  const rows = useMemo(() => visibleRows(items, expanded, map), [items, expanded, map]);
  const treeRef = useRef<HTMLUListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null | undefined>(undefined);
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // 고른 항목이 접힌 폴더 안에 있으면 보이는 가장 가까운 조상이 초점을 받는다.
  const visible = new Set(rows.map((row) => row.item.id));
  let tabbable: string | null = selected;
  while (tabbable && !visible.has(tabbable)) tabbable = items[tabbable]?.parentId ?? null;
  tabbable ??= rows[0]?.item.id ?? null;

  // 키보드로 고른 항목을 따라 초점을 옮긴다(클릭은 브라우저가 옮긴다).
  useEffect(() => {
    if (!selected || !treeRef.current?.contains(document.activeElement) || document.activeElement?.tagName === "INPUT") return;
    document.getElementById(rowId(selected))?.focus();
  }, [selected]);

  /** 끌고 있는 항목을 넣을 폴더. 옮길 수 없으면 undefined. */
  function dropTarget(row: Row | null): string | null | undefined {
    const item = dragging ? items[dragging] : undefined;
    if (!item) return undefined;
    const target = row ? (row.item.kind === "folder" ? row.item.id : row.item.parentId) : null;
    if (target === item.parentId) return undefined;
    if (item.kind === "folder" && target !== null && isWithin(items, target, item.id)) return undefined;
    return target;
  }
  function clearHover() { if (hover.current) clearTimeout(hover.current.timer); hover.current = null; }
  function onDragOver(event: DragEvent, row: Row | null) {
    if (!dragging || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.stopPropagation();
    const target = dropTarget(row);
    if (target === undefined) { setDrop(undefined); event.dataTransfer.dropEffect = "none"; return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrop(target);
    // 닫힌 폴더 위에 잠시 머무르면 펼친다.
    const folder = row?.item.kind === "folder" && row.hasChildren && !expanded[row.item.id] ? row.item.id : null;
    if (hover.current?.id === folder) return;
    clearHover();
    if (folder) hover.current = { id: folder, timer: setTimeout(() => onToggle(folder, true), 650) };
  }
  function onDrop(event: DragEvent, row: Row | null) {
    event.preventDefault();
    event.stopPropagation();
    const target = dropTarget(row);
    if (dragging && target !== undefined) move(dragging, target);
    endDrag();
  }
  function endDrag() { clearHover(); setDragging(null); setDrop(undefined); }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if ((event.target as HTMLElement).tagName === "INPUT" || event.altKey || event.ctrlKey || event.metaKey) return;
    // 초점이 있는 행을 기준으로 움직인다(클릭 없이 초점만 옮겨 온 경우 포함).
    const focused = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]")?.dataset.id ?? tabbable;
    const index = rows.findIndex((row) => row.item.id === focused);
    const row = rows[index];
    const go = (next: Row | undefined) => { event.preventDefault(); if (next) { select(next.item.id); requestAnimationFrame(() => focusRow(next.item.id)); } };
    switch (event.key) {
      case "ArrowDown": return go(rows[index + 1]);
      case "ArrowUp": return go(rows[Math.max(0, index - 1)]);
      case "Home": return go(rows[0]);
      case "End": return go(rows[rows.length - 1]);
      case "ArrowRight":
        if (row?.item.kind !== "folder") return;
        event.preventDefault();
        if (!expanded[row.item.id] && row.hasChildren) onToggle(row.item.id, true);
        else if (row.hasChildren) go(rows[index + 1]);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (row?.item.kind === "folder" && expanded[row.item.id]) onToggle(row.item.id, false);
        else if (row?.item.parentId) go(rows.find((entry) => entry.item.id === row.item.parentId));
        return;
      case "Enter":
        if (!row) return;
        event.preventDefault();
        if (row.item.kind === "folder") onToggle(row.item.id, !expanded[row.item.id]);
        else { onOpen(row.item.id); focusField("body"); }
        return;
      case "F2":
        if (!row) return;
        event.preventDefault();
        select(row.item.id); startRename(row.item.id);
        return;
      case "Delete":
        if (!row) return;
        event.preventDefault();
        onDelete(row.item.id);
        requestAnimationFrame(() => focusRow(useNotes.getState().selected));
        return;
      case "ContextMenu":
        if (!row) return;
        event.preventDefault();
        openRowMenu(row.item.id);
        return;
      default:
        if (event.key === "F10" && event.shiftKey && row) { event.preventDefault(); openRowMenu(row.item.id); }
    }
  }
  function openRowMenu(id: string) {
    const rect = document.getElementById(rowId(id))?.getBoundingClientRect();
    if (rect) onMenu(id, rect.left + 24, rect.bottom + 4);
  }

  if (!rows.length) return <div className="notes-tree-empty">폴더나 메모가 없습니다.<br />위의 단추로 만들어 보세요.</div>;
  return <ul ref={treeRef} role="tree" aria-label="메모 폴더" className="notes-tree" onKeyDown={onKeyDown}
    data-drop-root={drop === null ? "" : undefined}
    onDragOver={(event) => onDragOver(event, null)} onDrop={(event) => onDrop(event, null)}
    onDragLeave={(event) => { if (!treeRef.current?.contains(event.relatedTarget as Node | null)) { setDrop(undefined); clearHover(); } }}>
    {rows.map((row) => {
      const { item, depth, hasChildren } = row;
      const open = item.kind === "folder" && Boolean(expanded[item.id]);
      return <li key={item.id} id={rowId(item.id)} role="treeitem" className="tree-item" data-id={item.id} data-kind={item.kind} aria-label={labelOf(item)}
        aria-level={depth + 1} aria-setsize={row.size} aria-posinset={row.index + 1}
        aria-selected={item.id === selected} aria-expanded={item.kind === "folder" && hasChildren ? open : undefined}
        tabIndex={item.id === tabbable ? 0 : -1} draggable={renaming !== item.id}
        data-dragging={dragging === item.id ? "" : undefined} data-drop={drop !== undefined && drop === item.id ? "" : undefined}
        onClick={(event) => {
          if (renaming === item.id) return;
          // 폴더는 고르면서 펼치고, 이미 고른 폴더를 다시 누르면 접는다. 더블클릭(이름 바꾸기)의 둘째 클릭은 접지 않는다.
          if (item.kind === "folder" && hasChildren && event.detail < 2) onToggle(item.id, item.id === selected ? !open : true);
          onOpen(item.id);
        }}
        onDoubleClick={(event) => { if (renaming !== item.id) { event.preventDefault(); startRename(item.id); } }}
        onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); select(item.id); onMenu(item.id, event.clientX, event.clientY); }}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, item.id);
          event.dataTransfer.setData("text/plain", labelOf(item));
          event.dataTransfer.effectAllowed = "move";
          setDragging(item.id);
        }}
        onDragEnd={endDrag} onDragOver={(event) => onDragOver(event, row)} onDrop={(event) => onDrop(event, row)}
        style={{ "--depth": depth } as CSSProperties}>
        <div className="tree-row">
          <span className="tree-chevron" aria-hidden="true" data-hidden={item.kind === "folder" && hasChildren ? undefined : ""}
            onClick={(event) => { event.stopPropagation(); if (hasChildren) onToggle(item.id, !open); }}><ChevronRight /></span>
          {item.kind === "folder" ? (open ? <FolderOpen className="tree-icon" aria-hidden="true" /> : <FolderIcon className="tree-icon" aria-hidden="true" />)
            : <FileText className="tree-icon" aria-hidden="true" />}
          {renaming === item.id ? <RenameField item={item} /> : <span className="tree-label">{labelOf(item)}</span>}
          {item.kind === "folder" && renaming !== item.id && <span className="tree-count" aria-hidden="true">{counts.get(item.id) || ""}</span>}
          {renaming !== item.id && <span className="tree-more" aria-hidden="true" title="더 보기"
            onClick={(event) => { event.stopPropagation(); select(item.id); const rect = event.currentTarget.getBoundingClientRect(); onMenu(item.id, rect.left, rect.bottom + 4); }}><Ellipsis /></span>}
        </div>
      </li>;
    })}
  </ul>;
}

/** 트리 안에서 이름을 고치는 입력. Enter·바깥 클릭은 저장, Esc는 취소. */
function RenameField({ item }: { item: Item }) {
  const { rename, startRename } = useNotes.getState();
  const done = useRef(false);
  const initial = item.kind === "folder" ? item.name : item.title;
  const finish = (value: string | null, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    if (value === null) startRename(null); else rename(item.id, value);
    if (refocus) requestAnimationFrame(() => focusRow(item.id));
  };
  return <input className="tree-rename" defaultValue={initial} placeholder={item.kind === "note" ? labelOf(item) : undefined}
    aria-label={item.kind === "folder" ? "폴더 이름" : "메모 제목"} maxLength={200} autoFocus spellCheck={false}
    onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value, true); }
      else if (event.key === "Escape") { event.preventDefault(); finish(null, true); }
    }}
    onBlur={(event) => finish(event.currentTarget.value, false)} />;
}

function SearchResults({ items, query, selected, onOpen }: { items: Items; query: string; selected: string | null; onOpen: (id: string) => void }) {
  const results = useMemo(() => search(items, query), [items, query]);
  if (!results.length) return <div className="notes-tree-empty" role="status">‘{query.trim()}’와 일치하는 메모가 없습니다.</div>;
  return <ul className="notes-results" aria-label="검색 결과">
    {results.map((item) => {
      const path = pathOf(items, item.parentId).map((folder) => folder.name).join(" › ");
      return <li key={item.id}>
        <button type="button" className="notes-result" aria-current={item.id === selected || undefined} onClick={() => onOpen(item.id)}>
          {item.kind === "folder" ? <FolderIcon className="tree-icon" data-kind="folder" aria-hidden="true" /> : <FileText className="tree-icon" aria-hidden="true" />}
          <span className="notes-result-text"><span className="tree-label">{labelOf(item)}</span><span className="notes-result-path">{path || "최상위"}</span></span>
        </button>
      </li>;
    })}
  </ul>;
}

/** 위치(폴더 경로) 표시. 누르면 그 폴더로 간다. */
function Crumbs({ items, parentId, onOpen, current }: { items: Items; parentId: string | null; onOpen: (id: string) => void; current?: string }) {
  const path = pathOf(items, parentId);
  return <nav className="notes-crumbs" aria-label="위치">
    <button type="button" onClick={() => useNotes.getState().select(null)}>모든 메모</button>
    {path.map((folder) => <span key={folder.id} className="notes-crumb"><ChevronRight aria-hidden="true" /><button type="button" onClick={() => onOpen(folder.id)}>{folder.name}</button></span>)}
    {current && <span className="notes-crumb"><ChevronRight aria-hidden="true" /><span aria-current="page">{current}</span></span>}
  </nav>;
}

function NoteEditor({ note, items, onBack, onOpen }: { note: Note; items: Items; onBack: () => void; onOpen: (id: string) => void }) {
  return <div className="note-editor">
    <div className="notes-content-bar">
      <Button type="button" variant="ghost" size="xs" className="notes-back" onClick={onBack}><ChevronLeft aria-hidden="true" />목록</Button>
      <Crumbs items={items} parentId={note.parentId} onOpen={onOpen} />
      <time className="note-time" dateTime={new Date(note.updatedAt).toISOString()}>{dateFormat.format(note.updatedAt)}</time>
    </div>
    <NoteDocument note={note} />
  </div>;
}

function FolderView({ folder, items, map, counts, empty, loading, onOpen, onBack, onNewNote, onNewFolder }: {
  folder: Folder | null; items: Items; map: Map<string | null, Item[]>; counts: Map<string, number>; empty: boolean; loading: boolean; onOpen: (id: string) => void; onBack: () => void;
  onNewNote: (parentId: string | null) => void; onNewFolder: (parentId: string | null) => void;
}) {
  const id = folder?.id ?? null;
  const children = map.get(id) ?? [];
  const notes = children.filter((item): item is Note => item.kind === "note");
  const folders = children.filter((item): item is Folder => item.kind === "folder");
  if (empty && loading) return <div className="notes-empty" role="status"><div className="start-hero"><AppIcon app="notes" size={72} /><h3>메모</h3><p>메모를 불러오는 중…</p></div></div>;
  if (empty) return <div className="notes-empty">
    <div className="start-hero">
      <AppIcon app="notes" size={72} />
      <h3>메모</h3>
      <p>메모를 여러 개 쓰고 폴더와 하위 폴더로 정리할 수 있습니다. 메모는 끌어서 다른 폴더로 옮기고, 내용은 Relay 저장소(relay.db)에 저장되어 어느 브라우저에서 열어도 같습니다.</p>
      <div className="notes-empty-actions">
        <Button type="button" size="sm" onClick={() => onNewNote(null)}><SquarePen aria-hidden="true" />새 메모</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onNewFolder(null)}><FolderPlus aria-hidden="true" />새 폴더</Button>
      </div>
    </div>
  </div>;
  return <div className="folder-view">
    <div className="notes-content-bar">
      <Button type="button" variant="ghost" size="xs" className="notes-back" onClick={onBack}><ChevronLeft aria-hidden="true" />목록</Button>
      {folder && <Crumbs items={items} parentId={folder.parentId} onOpen={onOpen} current={folder.name} />}
    </div>
    <div className="folder-sheet">
      <header className="folder-head">
        <div>
          <h3>{folder ? folder.name : "모든 메모"}</h3>
          <p>{[folders.length ? `폴더 ${folders.length}개` : "", `메모 ${notes.length}개`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="folder-actions">
          <Button type="button" size="xs" variant="outline" onClick={() => onNewFolder(id)}><FolderPlus aria-hidden="true" />새 폴더</Button>
          <Button type="button" size="xs" variant="outline" onClick={() => onNewNote(id)}><SquarePen aria-hidden="true" />새 메모</Button>
        </div>
      </header>
      {children.length === 0
        ? <p className="folder-empty">이 폴더는 비어 있습니다. 새 메모를 만들거나 왼쪽 목록에서 메모를 끌어다 놓으세요.</p>
        : <ul className="folder-grid">
          {folders.map((child) => <li key={child.id}>
            <button type="button" className="note-card" data-kind="folder" onClick={() => onOpen(child.id)}>
              <FolderIcon aria-hidden="true" />
              <span className="note-card-title">{child.name}</span>
              <span className="note-card-meta">메모 {counts.get(child.id) ?? 0}개</span>
            </button>
          </li>)}
          {notes.map((note) => <li key={note.id}>
            <button type="button" className="note-card" data-kind="note" onClick={() => onOpen(note.id)}>
              <span className="note-card-title">{labelOf(note)}</span>
              <span className="note-card-preview">{previewOf(note) || "추가 텍스트 없음"}</span>
              <time className="note-card-meta" dateTime={new Date(note.updatedAt).toISOString()}>{cardDate(note.updatedAt)}</time>
            </button>
          </li>)}
        </ul>}
    </div>
  </div>;
}
