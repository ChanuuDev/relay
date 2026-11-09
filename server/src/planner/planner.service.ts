import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { activityWindow, applyBoardAction, boardView, bucketActivity, daySessions, filterEvents, filterTasks, type ActivityDayQuery, type ActivityDayResult,
  type ActivityQuery, type ActivityResult, type BoardAction, type BoardApplied, type BoardView, type CalendarEvent, type EventBatch, type EventFilter,
  type EventList, type PlannerApplied, type Task, type TaskBatch, type TaskFilter, type TaskList } from "@relay/core";
import { DB, lockUser, schema, type Db } from "../db/database.js";

const { tasks, calendarEvents, plannerMeta, activityLog, sessions } = schema;
type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof calendarEvents.$inferSelect;

const toTask = (row: TaskRow): Task => ({ id: row.id, title: row.title, project: row.project, memo: row.memo, provider: row.provider as Task["provider"],
  status: row.status as Task["status"], board: row.board, position: row.position, notes: row.notes, createdAt: row.createdAt, updatedAt: row.updatedAt,
  completedAt: row.completedAt });
const toEvent = (row: EventRow): CalendarEvent => ({ id: row.id, title: row.title, allDay: row.allDay, start: row.startAt, end: row.endAt, memo: row.memo,
  color: row.color as CalendarEvent["color"], attachments: row.attachments, createdAt: row.createdAt, updatedAt: row.updatedAt });

/** 사용자별 일정 관리(Tasks·업무 보드·캘린더)와 잔디. 쓰기 묶음마다 revision을 하나 올린다. 로컬 PlannerStore와 같은 계약이다. */
@Injectable()
export class PlannerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async revision(userId: string, tx: Db = this.db): Promise<number> {
    const [row] = await tx.select({ revision: plannerMeta.revision }).from(plannerMeta).where(eq(plannerMeta.userId, userId)).limit(1);
    return row?.revision ?? 0;
  }

  private async bump(userId: string, tx: Db): Promise<number> {
    const [row] = await tx.insert(plannerMeta).values({ userId, revision: 1 })
      .onConflictDoUpdate({ target: plannerMeta.userId, set: { revision: sql`${plannerMeta.revision} + 1` } }).returning({ revision: plannerMeta.revision });
    return row.revision;
  }

  private async allTasks(userId: string, tx: Db): Promise<Task[]> {
    return (await tx.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.createdAt), asc(tasks.id))).map(toTask);
  }

  async tasks(userId: string, filter: TaskFilter = {}): Promise<TaskList> {
    return this.db.transaction(async (tx) => ({ schemaVersion: 1 as const, revision: await this.revision(userId, tx), items: filterTasks(await this.allTasks(userId, tx), filter) }));
  }

  async applyTasks(userId: string, batch: TaskBatch): Promise<PlannerApplied> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const revision = await this.bump(userId, tx);
      if (batch.deletes.length) await tx.delete(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, batch.deletes)));
      await this.writeTasks(userId, batch.upserts, revision, tx);
      return { schemaVersion: 1 as const, revision };
    });
  }

  async board(userId: string): Promise<BoardView> {
    return this.db.transaction(async (tx) => boardView(await this.allTasks(userId, tx), await this.revision(userId, tx)));
  }

  async applyBoard(userId: string, action: BoardAction, now = Date.now()): Promise<BoardApplied> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const changed = applyBoardAction(await this.allTasks(userId, tx), action, now);
      if (!changed.length) return { schemaVersion: 1 as const, revision: await this.revision(userId, tx), changed: 0 };
      const revision = await this.bump(userId, tx);
      await this.writeTasks(userId, changed, revision, tx);
      return { schemaVersion: 1 as const, revision, changed: changed.length };
    });
  }

  async events(userId: string, filter: EventFilter = {}): Promise<EventList> {
    return this.db.transaction(async (tx) => ({ schemaVersion: 1 as const, revision: await this.revision(userId, tx),
      items: filterEvents((await tx.select().from(calendarEvents).where(eq(calendarEvents.userId, userId))
        .orderBy(asc(calendarEvents.startAt), asc(calendarEvents.createdAt), asc(calendarEvents.id))).map(toEvent), filter) }));
  }

  async applyEvents(userId: string, batch: EventBatch): Promise<PlannerApplied> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const revision = await this.bump(userId, tx);
      if (batch.deletes.length) await tx.delete(calendarEvents).where(and(eq(calendarEvents.userId, userId), inArray(calendarEvents.id, batch.deletes)));
      for (const event of batch.upserts) {
        const values = { userId, id: event.id, title: event.title, allDay: event.allDay, startAt: event.start, endAt: event.end, memo: event.memo, color: event.color,
          attachments: event.attachments, createdAt: event.createdAt, updatedAt: event.updatedAt, revision };
        await tx.insert(calendarEvents).values(values).onConflictDoUpdate({ target: [calendarEvents.userId, calendarEvents.id],
          set: { title: values.title, allDay: values.allDay, startAt: values.startAt, endAt: values.endAt, memo: values.memo, color: values.color,
            attachments: values.attachments, updatedAt: values.updatedAt, revision } });
      }
      return { schemaVersion: 1 as const, revision };
    });
  }

  /** 잔디: 기간 안의 기록을 날마다 센다. 세션이 보관 기간으로 지워져도 activity_log에 남은 기록은 센다. */
  async activity(userId: string, query: ActivityQuery): Promise<ActivityResult> {
    const { start, end } = activityWindow(query.from, query.to);
    const rows = await this.db.select({ at: activityLog.createdAt, sessionId: activityLog.sessionId }).from(activityLog)
      .where(and(eq(activityLog.userId, userId), gte(activityLog.createdAt, new Date(start)), lt(activityLog.createdAt, new Date(end)),
        ...(query.provider ? [eq(activityLog.provider, query.provider)] : [])));
    return bucketActivity(rows.map((row) => ({ at: row.at.getTime(), sessionId: row.sessionId })), query);
  }

  /** 그날 기록한 세션. 지워진 세션은 Provider·에이전트만 남는다. */
  async activityDay(userId: string, query: ActivityDayQuery): Promise<ActivityDayResult> {
    const { start, end } = activityWindow(query.date, query.date);
    const rows = await this.db.select({ at: activityLog.createdAt, sessionId: activityLog.sessionId, provider: activityLog.provider, agent: activityLog.agent,
      providerSessionId: sessions.providerSessionId, sessionName: sessions.sessionName, workingDirectory: sessions.workingDirectory, status: sessions.status })
      .from(activityLog).leftJoin(sessions, and(eq(sessions.id, activityLog.sessionId), eq(sessions.userId, activityLog.userId)))
      .where(and(eq(activityLog.userId, userId), gte(activityLog.createdAt, new Date(start)), lt(activityLog.createdAt, new Date(end)),
        ...(query.provider ? [eq(activityLog.provider, query.provider)] : [])));
    return daySessions(rows.map((row) => ({ ...row, at: row.at.getTime() })), query);
  }

  private async writeTasks(userId: string, items: Task[], revision: number, tx: Db) {
    for (const task of items) {
      const values = { userId, id: task.id, title: task.title, project: task.project, memo: task.memo, provider: task.provider, status: task.status, board: task.board,
        position: task.position, notes: task.notes, createdAt: task.createdAt, updatedAt: task.updatedAt, completedAt: task.completedAt, revision };
      await tx.insert(tasks).values(values).onConflictDoUpdate({ target: [tasks.userId, tasks.id],
        set: { title: values.title, project: values.project, memo: values.memo, provider: values.provider, status: values.status, board: values.board,
          position: values.position, notes: values.notes, updatedAt: values.updatedAt, completedAt: values.completedAt, revision } });
    }
  }
}
