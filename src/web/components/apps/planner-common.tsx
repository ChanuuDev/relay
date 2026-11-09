import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { Ban, Check, ClipboardCopy, FileText, Fingerprint, KanbanSquare, ListTodo, Paperclip, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { TASK_STATUSES } from "@relay/core";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { useNotes, labelOf as noteLabel, pathOf, type Note } from "../../lib/notes";
import { agentLabel, noteTitle, openNote, openTask, PROVIDER_ORDER, providerIcon, TASK_AGENTS, TASK_STATUS_LABELS, taskLabel, taskPrompt, usePlanner,
  type Task, type TaskProvider } from "../../lib/planner";
import { cn } from "../../lib/utils";

/** Provider 아이콘. 지정하지 않았으면 빈 원을 그린다. */
export function ProviderMark({ provider, size = 16 }: { provider: TaskProvider | null; size?: number }) {
  if (!provider) return <span className="planner-provider-none" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="planner-provider" src={providerIcon(provider)} alt="" width={size} height={size} draggable={false} decoding="async" data-provider={provider} />;
}

/** 진행 상태 점과 이름 */
export function StatusDot({ status }: { status: Task["status"] }) {
  return <span className="planner-status-dot" data-status={status} aria-hidden="true" />;
}

/** 바닥줄의 저장 상태. 메모·계산기와 같은 문구와 색 점을 쓴다. */
export function PlannerSync() {
  const status = usePlanner((state) => state.status);
  const sync = usePlanner((state) => state.sync);
  const label = status === "loading" ? "불러오는 중…" : status === "error" ? "서버 연결 대기"
    : sync === "saving" ? "저장 중…" : sync === "offline" ? "저장 대기 · 다시 시도 중" : sync === "rejected" ? "저장 실패" : "Relay DB에 저장됨";
  return <span className="notes-sync" data-sync={status === "ready" ? sync : status}>{label}</span>;
}

/** 서버에 닿지 못했거나 저장이 막혔을 때 본문 위에 띄우는 안내 */
export function PlannerNotice() {
  const status = usePlanner((state) => state.status);
  const sync = usePlanner((state) => state.sync);
  if (status === "error") return <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>일정 데이터를 불러오지 못했습니다. Relay 서버에 다시 연결하는 중입니다.</span></div>;
  if (status === "ready" && sync === "offline") return <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>서버에 저장하지 못했습니다. 변경은 이 브라우저에 남겨 두었다가 연결되면 다시 저장합니다.</span></div>;
  if (status === "ready" && sync === "rejected") return <div className="browser-notice" role="alert"><TriangleAlert aria-hidden="true" /><span>서버가 마지막 변경을 받지 않았습니다. 다시 고치면 다시 저장을 시도합니다.</span></div>;
  return null;
}

/** 지운 Task·일정을 되살리는 안내. kind가 맞는 창에서만 보인다. 8초 뒤 저절로 닫힌다. */
export function PlannerUndo({ kind }: { kind: "task" | "event" }) {
  const trash = usePlanner((state) => state.trash);
  useEffect(() => {
    if (!trash) return;
    const timer = setTimeout(() => { if (usePlanner.getState().trash === trash) usePlanner.getState().dismissTrash(); }, 8000);
    return () => clearTimeout(timer);
  }, [trash]);
  if (!trash || trash.kind !== kind) return null;
  const label = trash.kind === "task" ? taskLabel(trash.item) : trash.item.title.trim() || "새 일정";
  return <div className="notes-undo material-toast planner-undo" role="status">
    <span>‘{label}’ {trash.kind === "task" ? "Task" : "일정"}를 삭제했습니다.</span>
    <Button type="button" size="xs" variant="secondary" onClick={() => usePlanner.getState().undoRemove()}>실행 취소</Button>
    <Button type="button" variant="ghost" size="icon-xs" aria-label="안내 닫기" onClick={() => usePlanner.getState().dismissTrash()}><X aria-hidden="true" /></Button>
  </div>;
}

/** 프로젝트 이름 후보: 이미 쓴 프로젝트와 최근 세션의 작업 폴더 이름 */
export function useProjects() {
  const tasks = usePlanner((state) => state.tasks);
  const sessions = useQuery({ queryKey: ["relay", "planner-projects"], staleTime: 60_000, retry: false,
    queryFn: async () => {
      const response = await fetch("/api/v1/sessions?limit=100", { cache: "no-store" });
      if (!response.ok) return [] as string[];
      const data = await response.json() as { items?: Array<{ workingDirectory?: string }> };
      return (data.items ?? []).map((item) => (item.workingDirectory ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "").filter(Boolean);
    } });
  return useMemo(() => {
    const names = new Set<string>();
    for (const task of Object.values(tasks)) if (task.project.trim()) names.add(task.project.trim());
    for (const name of sessions.data ?? []) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [tasks, sessions.data]);
}

/** 고르기 창의 틀: 제목·검색·목록. 항목을 누르면 고르고, Esc·바깥 클릭은 닫기다. */
function PickerDialog({ open, title, placeholder, onClose, children, query, setQuery }: {
  open: boolean; title: string; placeholder: string; onClose: () => void; children: ReactNode; query: string; setQuery: (value: string) => void;
}) {
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <div className="confirm-overlay planner-picker-overlay" aria-hidden="true" />
      <Dialog.Content className="planner-picker material-menu" aria-describedby={undefined}>
        <div className="planner-picker-head">
          <Dialog.Title className="properties-title">{title}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" size="icon-xs" aria-label="닫기"><X aria-hidden="true" /></Button></Dialog.Close>
        </div>
        <InputGroup className="planner-picker-search">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" spellCheck={false} />
        </InputGroup>
        <div className="planner-picker-list" role="listbox" aria-label={title}>{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Relay 메모 고르기. 이미 첨부한 메모는 체크로 보이고, 누르면 첨부를 더한다. */
export function NotePicker({ open, attached, onPick, onClose }: { open: boolean; attached: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const items = useNotes((state) => state.items);
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const notes = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return Object.values(items).filter((item): item is Note => item.kind === "note")
      .filter((note) => !words.length || words.every((word) => `${noteLabel(note)}\n${note.body}`.toLowerCase().includes(word)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
  }, [items, query]);
  return <PickerDialog open={open} title="메모 첨부" placeholder="메모 검색" onClose={onClose} query={query} setQuery={setQuery}>
    {notes.length ? notes.map((note) => {
      const picked = attached.includes(note.id);
      const folder = pathOf(items, note.parentId).map((item) => item.name).join(" / ");
      return <button key={note.id} type="button" role="option" aria-selected={picked} className="planner-picker-item" disabled={picked} data-id={note.id}
        onClick={() => onPick(note.id)}>
        <FileText aria-hidden="true" />
        <span className="planner-picker-text"><span className="planner-picker-label">{noteLabel(note)}</span>{folder && <span className="planner-picker-meta">{folder}</span>}</span>
        {picked && <Check aria-hidden="true" className="planner-picker-check" />}
      </button>;
    }) : <p className="planner-picker-empty">{Object.keys(items).length ? "찾는 메모가 없습니다." : "메모가 없습니다. 메모 앱에서 먼저 작성하세요."}</p>}
  </PickerDialog>;
}

/** Task 고르기(캘린더 일정에 첨부) */
export function TaskPicker({ open, attached, onPick, onClose }: { open: boolean; attached: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const tasks = usePlanner((state) => state.tasks);
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const list = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return Object.values(tasks).filter((task) => !words.length || words.every((word) => `${task.title}\n${task.project}\n${task.memo}`.toLowerCase().includes(word)))
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt).slice(0, 200);
  }, [tasks, query]);
  return <PickerDialog open={open} title="Task 첨부" placeholder="Task 검색" onClose={onClose} query={query} setQuery={setQuery}>
    {list.length ? list.map((task) => {
      const picked = attached.includes(task.id);
      return <button key={task.id} type="button" role="option" aria-selected={picked} className="planner-picker-item" disabled={picked} data-id={task.id}
        onClick={() => onPick(task.id)}>
        <StatusDot status={task.status} />
        <span className="planner-picker-text"><span className="planner-picker-label">{taskLabel(task)}</span>
          <span className="planner-picker-meta">{[TASK_STATUS_LABELS[task.status], task.project.trim(), task.provider ? agentLabel(task.provider) : ""].filter(Boolean).join(" · ")}</span></span>
        {picked && <Check aria-hidden="true" className="planner-picker-check" />}
      </button>;
    }) : <p className="planner-picker-empty">{Object.keys(tasks).length ? "찾는 Task가 없습니다." : "Task가 없습니다. Tasks 앱에서 먼저 추가하세요."}</p>}
  </PickerDialog>;
}

/** 첨부 하나. 누르면 그 앱에서 열고, ×로 뺀다. 지워진 항목은 흐리게 「찾을 수 없음」으로 보인다. */
export function AttachmentChip({ kind, id, onRemove }: { kind: "note" | "task"; id: string; onRemove?: () => void }) {
  const notes = useNotes((state) => state.items);
  const task = usePlanner((state) => (kind === "task" ? state.tasks[id] : undefined));
  const label = kind === "note" ? (notes[id]?.kind === "note" ? noteLabel(notes[id] as Note) : null) : task ? taskLabel(task) : null;
  const Icon = kind === "note" ? FileText : ListTodo;
  return <span className="planner-chip" data-kind={kind} data-missing={label === null ? "" : undefined}>
    <button type="button" className="planner-chip-open" disabled={label === null} title={label === null ? undefined : kind === "note" ? "메모 앱에서 열기" : "Tasks에서 열기"}
      onClick={() => (kind === "note" ? openNote(id) : openTask(id))}>
      <Icon aria-hidden="true" /><span>{label ?? (kind === "note" ? "찾을 수 없는 메모" : "찾을 수 없는 Task")}</span>
    </button>
    {onRemove && <button type="button" className="planner-chip-remove" aria-label={`${label ?? "첨부"} 빼기`} onClick={onRemove}><X aria-hidden="true" /></button>}
  </span>;
}

/** 진행 상태 고르기(세그먼트) */
export function StatusPicker({ value, onChange, id }: { value: Task["status"]; onChange: (status: Task["status"]) => void; id?: string }) {
  return <div className="planner-segment" role="radiogroup" aria-label="진행 상태" id={id}>
    {TASK_STATUSES.map((status) => <button key={status} type="button" role="radio" aria-checked={value === status} data-status={status}
      onClick={() => onChange(status)}><StatusDot status={status} />{TASK_STATUS_LABELS[status]}</button>)}
  </div>;
}

/** 일을 지시할 에이전트 고르기 */
export function ProviderPicker({ value, onChange }: { value: TaskProvider | null; onChange: (provider: TaskProvider | null) => void }) {
  return <div className="planner-agents" role="radiogroup" aria-label="에이전트">
    <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)}><Ban aria-hidden="true" />없음</button>
    {PROVIDER_ORDER.map((provider) => <button key={provider} type="button" role="radio" aria-checked={value === provider} title={`${TASK_AGENTS[provider].label} · ${TASK_AGENTS[provider].company}`}
      onClick={() => onChange(provider)}><ProviderMark provider={provider} size={14} />{TASK_AGENTS[provider].label}</button>)}
  </div>;
}

const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Task 편집기. 고치면 바로 저장 대기열에 들어간다(0.3초 뒤 저장). Tasks 상세와 업무 보드의 편집 창이 같이 쓴다. */
export function TaskForm({ task, copy, onDeleted, autoFocusTitle }: { task: Task; copy: (value: string) => void; onDeleted?: () => void; autoFocusTitle?: boolean }) {
  const update = usePlanner((state) => state.updateTask);
  const setStatus = usePlanner((state) => state.setTaskStatus);
  const projects = useProjects();
  const [picking, setPicking] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocusTitle && !task.title) titleRef.current?.focus(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = task.status === "done";
  const listId = `planner-projects-${task.id}`;
  return <div className="planner-form" data-task={task.id}>
    <div className="planner-form-title">
      <button type="button" className="planner-check" role="checkbox" aria-checked={done} aria-label={done ? "완료 취소" : "완료로 표시"}
        onClick={() => setStatus(task.id, done ? "todo" : "done")}>{done && <Check aria-hidden="true" />}</button>
      <input ref={titleRef} className="planner-title-input" value={task.title} placeholder="제목 없는 Task" aria-label="Task 제목" maxLength={200}
        onChange={(event) => update(task.id, { title: event.target.value })} />
    </div>
    <dl className="planner-fields">
      <dt>진행 상태</dt>
      <dd><StatusPicker value={task.status} onChange={(status) => setStatus(task.id, status)} /></dd>
      <dt>에이전트</dt>
      <dd><ProviderPicker value={task.provider} onChange={(provider) => update(task.id, { provider })} /></dd>
      <dt><label htmlFor={`project-${task.id}`}>프로젝트</label></dt>
      <dd><Input id={`project-${task.id}`} className="planner-project-input" value={task.project} placeholder="예: relay" list={listId} maxLength={200}
        onChange={(event) => update(task.id, { project: event.target.value })} />
        <datalist id={listId}>{projects.map((name) => <option key={name} value={name} />)}</datalist></dd>
      <dt>업무 보드</dt>
      <dd className="planner-board-field">{task.board
        ? <><span className="planner-board-state"><KanbanSquare aria-hidden="true" />{TASK_STATUS_LABELS[task.status]} 칸에 있음</span>
          <Button type="button" size="xs" variant="ghost" onClick={() => usePlanner.getState().unboardTask(task.id)}>보드에서 내리기</Button></>
        : done ? <span className="planner-board-state">완료한 Task는 인벤토리에 보이지 않습니다</span>
          : <><span className="planner-board-state">인벤토리에 있음</span>
            <Button type="button" size="xs" variant="secondary" onClick={() => usePlanner.getState().placeTask(task.id, task.status, null)}>보드에 올리기</Button></>}</dd>
      <dt><label htmlFor={`memo-${task.id}`}>메모</label></dt>
      <dd><Textarea id={`memo-${task.id}`} className="planner-memo" value={task.memo} placeholder="할 일의 내용, 완료 조건, 참고 사항" maxLength={20000}
        onChange={(event) => update(task.id, { memo: event.target.value })} /></dd>
      <dt>첨부 메모</dt>
      <dd className="planner-attachments">
        {task.notes.map((id) => <AttachmentChip key={id} kind="note" id={id} onRemove={() => update(task.id, { notes: task.notes.filter((note) => note !== id) })} />)}
        <Button type="button" size="xs" variant="ghost" className="planner-attach" onClick={() => setPicking(true)}><Paperclip aria-hidden="true" />메모 첨부</Button>
      </dd>
    </dl>
    <div className="planner-form-foot">
      <span className="planner-form-meta">만든 날 {dateTime.format(task.createdAt)}{task.completedAt ? ` · 완료 ${dateTime.format(task.completedAt)}` : ""}</span>
      <div className="planner-form-actions">
        <Button type="button" size="xs" variant="ghost" title="에이전트에게 붙여 넣을 지시문을 복사합니다" onClick={() => copy(taskPrompt(task))}><ClipboardCopy aria-hidden="true" />지시문 복사</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => copy(`Relay Task를 참조해 주세요. Task ID: ${task.id}`)}><Fingerprint aria-hidden="true" />ID 복사</Button>
        <Button type="button" size="xs" variant="ghost" className="planner-danger" onClick={() => { usePlanner.getState().removeTask(task.id); onDeleted?.(); }}><Trash2 aria-hidden="true" />삭제</Button>
      </div>
    </div>
    <NotePicker open={picking} attached={task.notes} onClose={() => setPicking(false)}
      onPick={(id) => { const current = usePlanner.getState().tasks[task.id]; if (current && !current.notes.includes(id)) update(task.id, { notes: [...current.notes, id] }); }} />
  </div>;
}

/** 업무 보드에서 카드를 눌렀을 때 여는 Task 편집 창 */
export function TaskDialog({ id, copy, onClose }: { id: string | null; copy: (value: string) => void; onClose: () => void }) {
  const task = usePlanner((state) => (id ? state.tasks[id] : undefined));
  return <Dialog.Root open={Boolean(id && task)} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <div className="confirm-overlay" aria-hidden="true" />
      <Dialog.Content className="planner-dialog material-menu" aria-describedby={undefined}>
        <div className="planner-dialog-head">
          <Dialog.Title className="properties-title">Task</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" size="icon-xs" aria-label="닫기"><X aria-hidden="true" /></Button></Dialog.Close>
        </div>
        {task && <TaskForm task={task} copy={copy} onDeleted={onClose} autoFocusTitle />}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** 새 Task 빠른 추가 칸. Enter로 추가하고 칸을 비운다. */
export function QuickAdd({ placeholder, onAdd, className, id }: { placeholder: string; onAdd: (title: string) => void; className?: string; id?: string }) {
  const [value, setValue] = useState("");
  return <form className={cn("planner-quick", className)} onSubmit={(event) => {
    event.preventDefault();
    const title = value.trim();
    if (!title) return;
    onAdd(title);
    setValue("");
  }}>
    <Plus aria-hidden="true" />
    <input id={id} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={200} autoComplete="off" />
  </form>;
}

export { noteTitle };
