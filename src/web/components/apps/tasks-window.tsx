import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, KanbanSquare, ListTodo, Paperclip, Search, X } from "lucide-react";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { SplitView } from "../desktop/split-view";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { agentLabel, PROVIDER_ORDER, TASK_STATUS_LABELS, taskLabel, usePlanner, type Task } from "../../lib/planner";
import { PlannerNotice, PlannerSync, PlannerUndo, ProviderMark, QuickAdd, StatusDot, TaskForm } from "./planner-common";

type View = "open" | "done" | "all";
const VIEWS: Array<{ id: View; label: string }> = [{ id: "open", label: "진행 중" }, { id: "done", label: "완료" }, { id: "all", label: "전체" }];
const ORDER: Record<Task["status"], number> = { doing: 0, review: 1, todo: 2, done: 3 };

/** Tasks: 할 일을 적고 프로젝트·메모·지시할 에이전트·첨부 메모를 남긴다. 왼쪽 목록, 오른쪽 편집기. */
export function TasksWindow({ copy }: { copy: (value: string) => void }) {
  const tasks = usePlanner((state) => state.tasks);
  const status = usePlanner((state) => state.status);
  const selected = usePlanner((state) => state.selectedTask);
  const select = usePlanner((state) => state.selectTask);
  const [view, setView] = useState<View>("open");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [agent, setAgent] = useState("");
  const [pane, setPane] = useState<"list" | "detail">("list");
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => Object.values(tasks), [tasks]);
  const projects = useMemo(() => [...new Set(all.map((task) => task.project.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [all]);
  const counts = useMemo(() => ({ open: all.filter((task) => task.status !== "done").length, done: all.filter((task) => task.status === "done").length }), [all]);
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((task) => (view === "all" || (view === "done") === (task.status === "done"))
      && (!project || task.project.trim() === project)
      && (!agent || (agent === "none" ? task.provider === null : task.provider === agent))
      && (!words.length || words.every((word) => `${task.title}\n${task.project}\n${task.memo}`.toLowerCase().includes(word))))
      .sort((a, b) => (view === "done" ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : ORDER[a.status] - ORDER[b.status] || b.createdAt - a.createdAt));
  }, [all, view, query, project, agent]);
  const current = selected ? tasks[selected] : undefined;

  // 다른 앱이 Task를 고르게 하면(캘린더 첨부 열기 등) 그 Task가 보이도록 보기를 넓히고 편집기를 연다.
  useEffect(() => {
    if (!current) return;
    if (!visible.some((task) => task.id === current.id)) { setView("all"); setQuery(""); setProject(""); setAgent(""); }
    setPane("detail");
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${current.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(title: string) {
    const id = usePlanner.getState().createTask({ title, project, provider: agent && agent !== "none" ? agent as Task["provider"] : null });
    if (view === "done") setView("open");
    select(id);
  }
  function onRowKey(event: KeyboardEvent<HTMLLIElement>, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) { select(next.id); listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus(); }
  }

  return <Window id="tasks" bodyClassName="planner-body" header={<WindowTitleBar id="tasks" />}>
    <PlannerNotice />
    <SplitView name="tasks" label="Task 목록" className="tasks-layout" data-pane={pane} defaultWidth={360} minWidth={280} maxWidth={560} minMain={340} side={
      <aside className="tasks-sidebar material-chrome" aria-label="Task 목록">
        <div className="tasks-tools">
          <QuickAdd id="tasks-new" placeholder="새 Task 추가" onAdd={add} />
          <div className="planner-segment planner-segment-fill" role="tablist" aria-label="보기">
            {VIEWS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)}>
              {item.label}{item.id !== "all" && <span className="planner-count">{counts[item.id]}</span>}</button>)}
          </div>
          <div className="tasks-filters">
            <InputGroup className="tasks-search">
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색" aria-label="Task 검색" autoComplete="off" spellCheck={false}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }} />
              {query && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="검색어 지우기" onClick={() => setQuery("")}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
            </InputGroup>
            <NativeSelect size="sm" aria-label="프로젝트" value={project} onChange={(event) => setProject(event.target.value)}>
              <NativeSelectOption value="">모든 프로젝트</NativeSelectOption>
              {projects.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect size="sm" aria-label="에이전트" value={agent} onChange={(event) => setAgent(event.target.value)}>
              <NativeSelectOption value="">모든 에이전트</NativeSelectOption>
              {PROVIDER_ORDER.map((provider) => <NativeSelectOption key={provider} value={provider}>{agentLabel(provider)}</NativeSelectOption>)}
              <NativeSelectOption value="none">지정 안 함</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        {visible.length ? <ul className="tasks-list" ref={listRef} role="listbox" aria-label="Task">
          {visible.map((task, index) => <li key={task.id} role="option" aria-selected={task.id === selected} tabIndex={task.id === selected || (!selected && index === 0) ? 0 : -1}
            className="tasks-row" data-id={task.id} data-status={task.status}
            onClick={() => { select(task.id); setPane("detail"); }} onKeyDown={(event) => onRowKey(event, index)}>
            <button type="button" className="planner-check" role="checkbox" aria-checked={task.status === "done"} aria-label={task.status === "done" ? "완료 취소" : "완료로 표시"}
              onClick={(event) => { event.stopPropagation(); usePlanner.getState().setTaskStatus(task.id, task.status === "done" ? "todo" : "done"); }}>
              {task.status === "done" && <Check aria-hidden="true" />}</button>
            <span className="tasks-row-main">
              <span className="tasks-row-title" data-empty={task.title.trim() ? undefined : ""}>{taskLabel(task)}</span>
              <span className="tasks-row-meta">
                <span className="planner-status-tag" data-status={task.status}><StatusDot status={task.status} />{TASK_STATUS_LABELS[task.status]}</span>
                {task.board && <span className="tasks-row-flag" title="업무 보드에 있음"><KanbanSquare aria-hidden="true" /></span>}
                {task.project.trim() && <span className="planner-project">{task.project.trim()}</span>}
                {task.notes.length > 0 && <span className="tasks-row-flag" title={`첨부 메모 ${task.notes.length}개`}><Paperclip aria-hidden="true" />{task.notes.length}</span>}
              </span>
            </span>
            {task.provider && <span className="tasks-row-agent" title={agentLabel(task.provider)}><ProviderMark provider={task.provider} size={18} /></span>}
          </li>)}
        </ul> : <div className="planner-empty">
          <ListTodo aria-hidden="true" />
          <strong>{status !== "ready" ? "불러오는 중…" : all.length ? "조건에 맞는 Task가 없습니다" : "Task가 없습니다"}</strong>
          <span>{status !== "ready" ? "" : all.length ? "보기나 필터를 바꿔 보세요." : "위 칸에 할 일을 적고 Enter를 누르세요."}</span>
        </div>}
        <div className="notes-footer"><span>Task {all.length}개 · 진행 중 {counts.open}개</span><PlannerSync /></div>
      </aside>} main={
      <section className="tasks-detail" aria-label="Task 편집">
        {current ? <>
          <div className="tasks-detail-bar"><Button type="button" variant="ghost" size="xs" className="tasks-back" onClick={() => setPane("list")}><ArrowLeft aria-hidden="true" />목록</Button></div>
          <TaskForm key={current.id} task={current} copy={copy} onDeleted={() => setPane("list")} autoFocusTitle />
        </> : <div className="planner-empty planner-empty-detail">
          <ListTodo aria-hidden="true" />
          <strong>Task를 고르세요</strong>
          <span>왼쪽에서 Task를 고르면 프로젝트·에이전트·메모·첨부 메모를 고칠 수 있습니다.</span>
        </div>}
      </section>} />
    <PlannerUndo kind="task" />
  </Window>;
}
