import { Fragment, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowLeftToLine, Archive, Inbox, Paperclip, Plus, Search, X } from "lucide-react";
import { columnOf, inventoryOf, TASK_STATUSES } from "@relay/core";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { SplitView } from "../desktop/split-view";
import { DesktopMenu, type MenuEntry } from "../desktop/menu";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { agentLabel, openTask, TASK_STATUS_LABELS, taskLabel, usePlanner, type Task, type TaskStatus } from "../../lib/planner";
import { PlannerNotice, PlannerSync, PlannerUndo, ProviderMark, QuickAdd, StatusDot, TaskDialog } from "./planner-common";

const DRAG_TYPE = "application/x-relay-task";
type Drop = { target: TaskStatus | "inventory"; index: number };
type Menu = { id: number; task: Task; left: number; top: number };

/** 커서 높이로 놓을 자리를 센다: 끌고 있는 카드를 뺀 카드 가운데 커서보다 위에 있는 수. */
function dropIndex(list: HTMLElement, clientY: number, dragging: string | null) {
  let index = 0;
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(":scope > .board-card"))) {
    if (card.dataset.id === dragging) continue;
    const rect = card.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) index++;
  }
  return index;
}

/** 카드 하나: 제목·프로젝트·첨부 수·에이전트 */
function Card({ task, dragging, menuOpen, onOpen, onMenu, onKey, onDragStart, onDragEnd, inventory }: {
  task: Task; dragging: boolean; menuOpen: boolean; inventory?: boolean;
  onOpen: () => void; onMenu: (left: number, top: number) => void; onKey: (event: KeyboardEvent<HTMLLIElement>) => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void; onDragEnd: () => void;
}) {
  return <li className="board-card" data-id={task.id} data-status={task.status} draggable tabIndex={0} aria-roledescription="끌 수 있는 카드"
    aria-label={`${taskLabel(task)}${task.provider ? `, ${agentLabel(task.provider)}` : ""}`}
    title={inventory ? "끌어서 보드 칸에 놓기 · Enter로 열기" : "끌어서 옮기기 · Alt+←/→ 칸 이동 · Alt+↑/↓ 순서 · Enter로 열기"}
    data-dragging={dragging ? "" : undefined} data-menu={menuOpen ? "" : undefined}
    onClick={onOpen} onKeyDown={onKey} onDragStart={onDragStart} onDragEnd={onDragEnd}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}>
    <span className="board-card-title" data-empty={task.title.trim() ? undefined : ""}>{taskLabel(task)}</span>
    {(task.project.trim() || task.notes.length > 0 || task.provider) && <span className="board-card-meta">
      {task.project.trim() && <span className="planner-project">{task.project.trim()}</span>}
      {task.notes.length > 0 && <span className="board-card-flag" title={`첨부 메모 ${task.notes.length}개`}><Paperclip aria-hidden="true" />{task.notes.length}</span>}
      {task.provider && <span className="board-card-agent" title={agentLabel(task.provider)}><ProviderMark provider={task.provider} size={16} /></span>}
    </span>}
    {inventory && <button type="button" className="board-card-place" aria-label={`${taskLabel(task)} 보드에 올리기`} title="할 일 칸에 올리기"
      onClick={(event) => { event.stopPropagation(); usePlanner.getState().placeTask(task.id, task.status === "done" ? "todo" : task.status, null); }}>
      <ArrowLeftToLine aria-hidden="true" /></button>}
  </li>;
}

/** 업무: 왼쪽 칸반 보드(할 일·진행 중·검토·완료), 오른쪽 인벤토리(보드에 없고 완료가 아닌 Task). 카드를 끌어 칸과 순서를 바꾼다. */
export function BoardWindow({ copy }: { copy: (value: string) => void }) {
  const tasks = usePlanner((state) => state.tasks);
  const status = usePlanner((state) => state.status);
  const all = useMemo(() => Object.values(tasks), [tasks]);
  const columns = useMemo(() => TASK_STATUSES.map((column) => ({ status: column, items: columnOf(all, column) })), [all]);
  const [query, setQuery] = useState("");
  const inventory = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return inventoryOf(all).filter((task) => !words.length || words.every((word) => `${task.title}\n${task.project}\n${task.memo}`.toLowerCase().includes(word)));
  }, [all, query]);
  const inventoryTotal = useMemo(() => inventoryOf(all).length, [all]);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  const [pane, setPane] = useState<"board" | "inventory">("board");
  const leavingRef = useRef(false);

  const focusCard = (id: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.board-card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false }));
  function startDrag(event: DragEvent<HTMLLIElement>, id: string) {
    event.dataTransfer.setData(DRAG_TYPE, id);
    event.dataTransfer.setData("text/plain", taskLabel(tasks[id] ?? { title: "" }));
    event.dataTransfer.effectAllowed = "move";
    setDrag(id);
  }
  const endDrag = () => { setDrag(null); setDrop(null); };
  const dragged = (event: DragEvent) => event.dataTransfer.getData(DRAG_TYPE) || drag;
  function overColumn(event: DragEvent<HTMLElement>, target: TaskStatus) {
    if (!drag && !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const list = event.currentTarget.querySelector<HTMLElement>(".board-cards");
    const index = list ? dropIndex(list, event.clientY, drag) : 0;
    if (drop?.target !== target || drop.index !== index) setDrop({ target, index });
  }
  function dropColumn(event: DragEvent<HTMLElement>, target: TaskStatus) {
    const id = dragged(event);
    event.preventDefault();
    if (id && tasks[id]) {
      const list = event.currentTarget.querySelector<HTMLElement>(".board-cards");
      usePlanner.getState().placeTask(id, target, list ? dropIndex(list, event.clientY, id) : null);
      focusCard(id);
    }
    endDrag();
  }
  function overInventory(event: DragEvent<HTMLElement>) {
    if (!drag && !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    if (drag && !tasks[drag]?.board) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drop?.target !== "inventory") setDrop({ target: "inventory", index: 0 });
  }
  function dropInventory(event: DragEvent<HTMLElement>) {
    const id = dragged(event);
    event.preventDefault();
    if (id && tasks[id]?.board) usePlanner.getState().unboardTask(id);
    endDrag();
  }

  /** 키보드로 옮기기: Alt+←/→는 옆 칸 맨 아래로, Alt+↑/↓는 칸 안에서 한 칸씩. */
  function onCardKey(event: KeyboardEvent<HTMLLIElement>, task: Task) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditing(task.id); return; }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(task, rect.left + 24, rect.top + 30);
      return;
    }
    if (!task.board || !event.altKey) return;
    const at = TASK_STATUSES.indexOf(task.status);
    const column = columns[at]!.items;
    const index = column.findIndex((item) => item.id === task.id);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const next = TASK_STATUSES[at + (event.key === "ArrowLeft" ? -1 : 1)];
      event.preventDefault();
      if (next) { usePlanner.getState().placeTask(task.id, next, null); focusCard(task.id); }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < column.length) { usePlanner.getState().placeTask(task.id, task.status, to); focusCard(task.id); }
    }
  }

  function openMenu(task: Task, left: number, top: number) {
    leavingRef.current = false;
    setMenuLeaving(false);
    setMenu({ id: Date.now(), task, left, top });
  }
  function closeMenu(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    leavingRef.current = true;
    setMenuLeaving(true);
    if (returnFocus) focusCard(menu.task.id);
  }
  function menuExited() {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    setMenu(null);
    setMenuLeaving(false);
  }
  const menuItems = (task: Task): MenuEntry[] => [
    { kind: "item", id: "open", label: "열기", onSelect: () => setEditing(task.id) },
    { kind: "separator", id: "sep-move" },
    ...TASK_STATUSES.filter((target) => !task.board || target !== task.status).map((target): MenuEntry =>
      ({ kind: "item", id: `move-${target}`, label: `${TASK_STATUS_LABELS[target]} 칸으로${task.board ? " 옮기기" : " 올리기"}`, onSelect: () => usePlanner.getState().placeTask(task.id, target, null) })),
    ...(task.board ? [{ kind: "item", id: "unboard", label: "보드에서 내리기", onSelect: () => usePlanner.getState().unboardTask(task.id) } as MenuEntry] : []),
    { kind: "separator", id: "sep-open" },
    { kind: "item", id: "tasks", label: "Tasks에서 열기", onSelect: () => openTask(task.id) },
    { kind: "item", id: "copy", label: "Task ID 복사", onSelect: () => copy(`Relay Task를 참조해 주세요. Task ID: ${task.id}`) },
    { kind: "separator", id: "sep-del" },
    { kind: "item", id: "delete", label: "삭제", danger: true, onSelect: () => usePlanner.getState().removeTask(task.id) },
  ];
  const doneCount = columns[3]!.items.length;

  const card = (task: Task, inventoryCard = false) => <Card key={task.id} task={task} inventory={inventoryCard} dragging={drag === task.id}
    menuOpen={menu?.task.id === task.id && !menuLeaving} onOpen={() => setEditing(task.id)} onMenu={(left, top) => openMenu(task, left, top)}
    onKey={(event) => onCardKey(event, task)} onDragStart={(event) => startDrag(event, task.id)} onDragEnd={endDrag} />;

  return <Window id="board" bodyClassName="planner-body" header={<WindowTitleBar id="board" right={
    <div className="planner-segment planner-pane-toggle" role="tablist" aria-label="보기">
      <button type="button" role="tab" aria-selected={pane === "board"} onClick={() => setPane("board")}>보드</button>
      <button type="button" role="tab" aria-selected={pane === "inventory"} onClick={() => setPane("inventory")}>인벤토리<span className="planner-count">{inventoryTotal}</span></button>
    </div>} />}>
    <PlannerNotice />
    <SplitView name="board" label="인벤토리" position="end" className="board-layout" data-pane={pane} defaultWidth={288} minWidth={220} maxWidth={420} minMain={420} side={
      <aside className="board-inventory material-chrome" aria-label="인벤토리" data-drop={drop?.target === "inventory" ? "" : undefined}
        onDragOver={overInventory} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && drop?.target === "inventory") setDrop(null); }}
        onDrop={dropInventory}>
        <div className="board-inventory-head">
          <h3><Inbox aria-hidden="true" />인벤토리<span className="planner-count">{inventoryTotal}</span></h3>
          <p>완료가 아닌 Task를 왼쪽 보드 칸으로 끌어 놓으세요.</p>
        </div>
        <div className="board-inventory-tools">
          <QuickAdd id="board-new" placeholder="새 Task 추가" onAdd={(title) => usePlanner.getState().createTask({ title })} />
          <InputGroup className="tasks-search">
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="인벤토리 검색" aria-label="인벤토리 검색" autoComplete="off" spellCheck={false} />
            {query && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="검색어 지우기" onClick={() => setQuery("")}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
          </InputGroup>
        </div>
        {inventory.length ? <ol className="board-cards board-inventory-cards" aria-label="인벤토리 Task">{inventory.map((task) => card(task, true))}</ol>
          : <div className="planner-empty board-inventory-empty">
            <Inbox aria-hidden="true" />
            <strong>{status !== "ready" ? "불러오는 중…" : inventoryTotal ? "찾는 Task가 없습니다" : "인벤토리가 비었습니다"}</strong>
            <span>{status !== "ready" ? "" : inventoryTotal ? "" : drag && tasks[drag]?.board ? "여기에 놓으면 보드에서 내립니다." : "새 Task를 추가하거나 Tasks 앱에서 만드세요."}</span>
          </div>}
        <div className="notes-footer"><span>보드 {all.filter((task) => task.board).length}개 · 인벤토리 {inventoryTotal}개</span><PlannerSync /></div>
      </aside>} main={
      <div className="board-columns" role="group" aria-label="업무 보드">
        {columns.map(({ status: column, items }) => {
          let slot = 0;
          const line = drop?.target === column ? drop.index : -1;
          return <section key={column} className="board-column" data-status={column} aria-label={`${TASK_STATUS_LABELS[column]} 칸, ${items.length}개`}
            data-drop={drop?.target === column ? "" : undefined}
            onDragOver={(event) => overColumn(event, column)} onDrop={(event) => dropColumn(event, column)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && drop?.target === column) setDrop(null); }}>
            <header className="board-column-head">
              <StatusDot status={column} />
              <h3>{TASK_STATUS_LABELS[column]}</h3>
              <span className="planner-count">{items.length}</span>
              <span className="board-column-actions">
                {column === "done" && doneCount > 0 && <Button type="button" variant="ghost" size="icon-xs" aria-label="완료 비우기" title="완료 비우기 — 보드에서 내리고 Tasks에는 남깁니다"
                  onClick={() => usePlanner.getState().clearDone()}><Archive aria-hidden="true" /></Button>}
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`${TASK_STATUS_LABELS[column]} 칸에 Task 추가`} title="이 칸에 Task 추가"
                  onClick={() => setAdding(adding === column ? null : column)}><Plus aria-hidden="true" /></Button>
              </span>
            </header>
            {adding === column && <QuickAdd className="board-column-add" placeholder={`${TASK_STATUS_LABELS[column]}에 추가`}
              onAdd={(title) => usePlanner.getState().createTask({ title, status: column, board: true })} />}
            <ol className="board-cards" aria-label={`${TASK_STATUS_LABELS[column]} Task`}>
              {items.map((task) => {
                const before = task.id !== drag && slot++ === line;
                return <Fragment key={task.id}>{before && <li className="board-drop-line" aria-hidden="true" />}{card(task)}</Fragment>;
              })}
              {items.length > 0 && line >= 0 && line >= slot && <li className="board-drop-line" aria-hidden="true" />}
              {!items.length && <li className="board-column-empty" aria-hidden="true" data-drop={line >= 0 ? "" : undefined}>{column === "todo" ? "인벤토리에서 끌어 오세요" : "여기에 놓기"}</li>}
            </ol>
          </section>;
        })}
      </div>} />
    <TaskDialog id={editing} copy={copy} onClose={() => { const id = editing; setEditing(null); if (id) focusCard(id); }} />
    {menu && <DesktopMenu key={menu.id} items={menuItems(menu.task)} position={{ left: menu.left, top: Math.max(8, Math.min(menu.top, window.innerHeight - 320)) }}
      leaving={menuLeaving} onClose={closeMenu} onExited={menuExited} />}
    <PlannerUndo kind="task" />
  </Window>;
}
