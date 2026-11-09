import type { Database } from "bun:sqlite";
import { applyBoardAction, boardView, filterEvents, filterTasks, RelayError, type BoardAction, type BoardApplied, type BoardView, type CalendarEvent,
  type EventBatch, type EventFilter, type EventList, type PlannerApplied, type Task, type TaskBatch, type TaskFilter, type TaskList } from "@relay/core";
import { storageError } from "../errors";

// Task·일정의 모양·검사·보드 배치는 원격 서버와 같이 쓰므로 공용 코어에 있다. 여기에는 SQLite 저장소만 남긴다.
export { parseBoardAction, parseEventBatch, parseEventFilter, parseTaskBatch, parseTaskFilter } from "@relay/core";

type TaskRow = { id: string; title: string; project: string; memo: string; provider: Task["provider"]; status: Task["status"]; board: number;
  position: number | null; notes_json: string; created_at: number; updated_at: number; completed_at: number | null };
type EventRow = { id: string; title: string; all_day: number; start_at: string; end_at: string; memo: string; color: CalendarEvent["color"];
  attachments_json: string; created_at: number; updated_at: number };

const list = <T>(json: string): T[] => { try { const value = JSON.parse(json) as unknown; return Array.isArray(value) ? value as T[] : []; } catch { return []; } };
const toTask = (row: TaskRow): Task => ({ id: row.id, title: row.title, project: row.project, memo: row.memo, provider: row.provider, status: row.status,
  board: row.board === 1, position: row.position, notes: list<string>(row.notes_json), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at });
const toEvent = (row: EventRow): CalendarEvent => ({ id: row.id, title: row.title, allDay: row.all_day === 1, start: row.start_at, end: row.end_at, memo: row.memo,
  color: row.color, attachments: list<CalendarEvent["attachments"][number]>(row.attachments_json), createdAt: row.created_at, updatedAt: row.updated_at });

const TASK_COLUMNS = "id, title, project, memo, provider, status, board, position, notes_json, created_at, updated_at, completed_at";
const EVENT_COLUMNS = "id, title, all_day, start_at, end_at, memo, color, attachments_json, created_at, updated_at";

/** 일정 관리 저장소(Tasks·업무 보드·캘린더). 쓰기 묶음마다 revision을 하나 올려, 화면은 그 값만 보고 다시 읽을지 정한다. */
export class PlannerStore {
  constructor(private db: Database) {}

  private run<T>(write: boolean, action: () => T): T {
    try {
      const tx = this.db.transaction(action);
      return write ? tx.immediate() : tx.deferred();
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw storageError(error);
    }
  }

  revision(): number {
    try { return (this.db.query("SELECT value FROM planner_meta WHERE key = 'revision'").get() as { value: number } | null)?.value ?? 0; }
    catch (error) { throw storageError(error); }
  }

  private bump(): number {
    return (this.db.query("UPDATE planner_meta SET value = value + 1 WHERE key = 'revision' RETURNING value").get() as { value: number }).value;
  }

  private allTasks(): Task[] {
    return (this.db.query(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY created_at, id`).all() as TaskRow[]).map(toTask);
  }

  tasks(filter: TaskFilter = {}): TaskList {
    return this.run(false, () => ({ schemaVersion: 1 as const, revision: this.revision(), items: filterTasks(this.allTasks(), filter) }));
  }

  /** 지우기 뒤 넣기·고치기를 한 트랜잭션으로 적용한다. 이미 있는 Task의 만든 시각은 그대로 둔다. */
  applyTasks(batch: TaskBatch): PlannerApplied {
    return this.run(true, () => {
      const revision = this.bump();
      const remove = this.db.query("DELETE FROM tasks WHERE id = ?");
      for (const id of batch.deletes) remove.run(id);
      this.writeTasks(batch.upserts, revision);
      return { schemaVersion: 1 as const, revision };
    });
  }

  board(): BoardView {
    return this.run(false, () => boardView(this.allTasks(), this.revision()));
  }

  /** 칸·자리에 놓기, 보드에서 내리기, 완료 비우기. 바뀐 Task가 없으면 저장 번호도 그대로다. */
  applyBoard(action: BoardAction, now = Date.now()): BoardApplied {
    return this.run(true, () => {
      const changed = applyBoardAction(this.allTasks(), action, now);
      if (!changed.length) return { schemaVersion: 1 as const, revision: this.revision(), changed: 0 };
      const revision = this.bump();
      this.writeTasks(changed, revision);
      return { schemaVersion: 1 as const, revision, changed: changed.length };
    });
  }

  events(filter: EventFilter = {}): EventList {
    return this.run(false, () => ({ schemaVersion: 1 as const, revision: this.revision(),
      items: filterEvents((this.db.query(`SELECT ${EVENT_COLUMNS} FROM calendar_events ORDER BY start_at, created_at, id`).all() as EventRow[]).map(toEvent), filter) }));
  }

  applyEvents(batch: EventBatch): PlannerApplied {
    return this.run(true, () => {
      const revision = this.bump();
      const remove = this.db.query("DELETE FROM calendar_events WHERE id = ?");
      for (const id of batch.deletes) remove.run(id);
      const upsert = this.db.query(`INSERT INTO calendar_events (${EVENT_COLUMNS}, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, all_day = excluded.all_day, start_at = excluded.start_at, end_at = excluded.end_at,
          memo = excluded.memo, color = excluded.color, attachments_json = excluded.attachments_json, updated_at = excluded.updated_at, revision = excluded.revision`);
      for (const event of batch.upserts) {
        upsert.run(event.id, event.title, event.allDay ? 1 : 0, event.start, event.end, event.memo, event.color, JSON.stringify(event.attachments),
          event.createdAt, event.updatedAt, revision);
      }
      return { schemaVersion: 1 as const, revision };
    });
  }

  private writeTasks(tasks: Task[], revision: number) {
    const upsert = this.db.query(`INSERT INTO tasks (${TASK_COLUMNS}, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, project = excluded.project, memo = excluded.memo, provider = excluded.provider,
        status = excluded.status, board = excluded.board, position = excluded.position, notes_json = excluded.notes_json,
        updated_at = excluded.updated_at, completed_at = excluded.completed_at, revision = excluded.revision`);
    for (const task of tasks) {
      upsert.run(task.id, task.title, task.project, task.memo, task.provider, task.status, task.board ? 1 : 0, task.position, JSON.stringify(task.notes),
        task.createdAt, task.updatedAt, task.completedAt, revision);
    }
  }
}
