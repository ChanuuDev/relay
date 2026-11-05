import { and, asc, count, desc, eq, isNotNull, isNull, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Compaction, GitClue, Session, SessionStatus, SessionUpdate } from "@relay/core";
import { date, iso, schema, type Db } from "../db/database.js";

const { sessions, sessionUpdates } = schema;
type Row = typeof sessions.$inferSelect;

function clue(metadata: Record<string, unknown>): GitClue | null {
  const git = metadata.git as Partial<GitClue> | undefined;
  if (!git || typeof git !== "object" || typeof git.at !== "string") return null;
  return { branch: typeof git.branch === "string" ? git.branch : null, commit: typeof git.commit === "string" ? git.commit : null,
    dirty: typeof git.dirty === "number" ? git.dirty : 0, at: git.at };
}

function compaction(metadata: Record<string, unknown>): Compaction | null {
  const value = metadata.compaction as Partial<Compaction> | undefined;
  if (!value || typeof value !== "object" || typeof value.count !== "number" || typeof value.lastAt !== "string") return null;
  return { count: value.count, lastAt: value.lastAt, trigger: typeof value.trigger === "string" ? value.trigger : null };
}

export function hydrate(row: Row): Session {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return { id: row.id, provider: row.provider, agent: row.agent, providerSessionId: row.providerSessionId, sessionName: row.sessionName,
    model: row.model, workingDirectory: row.workingDirectory, summary: row.summary, parentSessionId: row.parentSessionId,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), endedAt: iso(row.endedAt), endReason: row.endReason,
    status: row.status as SessionStatus | null, pinned: row.pinned, git: clue(metadata), compaction: compaction(metadata), deviceId: row.deviceId };
}

/** 한 사용자의 세션 표. 모든 질의가 user_id로 범위를 좁힌다. 트랜잭션 안에서 부르면 tx를 준다. */
export class SessionsRepository {
  constructor(private readonly db: Db, private readonly userId: string) {}

  private scoped(where?: SQL) { return where ? and(eq(sessions.userId, this.userId), where) : eq(sessions.userId, this.userId); }

  async byId(id: string, tx: Db = this.db): Promise<Session | null> {
    const [row] = await tx.select().from(sessions).where(this.scoped(eq(sessions.id, id))).limit(1);
    return row ? hydrate(row) : null;
  }

  async byProviderId(providerSessionId: string, provider?: string, tx: Db = this.db): Promise<Session[]> {
    const rows = await tx.select().from(sessions)
      .where(this.scoped(provider ? and(eq(sessions.providerSessionId, providerSessionId), eq(sessions.provider, provider)) : eq(sessions.providerSessionId, providerSessionId)))
      .orderBy(asc(sessions.provider));
    return rows.map(hydrate);
  }

  async rows(where: SQL | undefined, limit: number, offset: number, children = false, tx: Db = this.db): Promise<Session[]> {
    const rows = await tx.select().from(sessions).where(this.scoped(where))
      .orderBy(desc(children ? sessions.createdAt : sessions.updatedAt), desc(sessions.id)).limit(limit).offset(offset);
    return rows.map(hydrate);
  }

  async count(where: SQL | undefined, tx: Db = this.db): Promise<number> {
    const [row] = await tx.select({ total: count() }).from(sessions).where(this.scoped(where));
    return Number(row?.total ?? 0);
  }

  childrenOf = (id: string) => eq(sessions.parentSessionId, id);

  async insert(s: Session, deviceId: string | null, tx: Db = this.db) {
    await tx.insert(sessions).values({ id: s.id, userId: this.userId, deviceId, provider: s.provider, agent: s.agent, providerSessionId: s.providerSessionId,
      sessionName: s.sessionName, model: s.model, workingDirectory: s.workingDirectory, summary: s.summary, parentSessionId: s.parentSessionId,
      metadata: s.git ? { git: s.git } : {}, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt), endedAt: date(s.endedAt), endReason: s.endReason,
      status: s.status, pinned: s.pinned });
  }

  /** Attaches an origin and fills the labels an automatic first record could not know. */
  async link(s: Session, tx: Db = this.db) {
    await tx.update(sessions).set({ parentSessionId: s.parentSessionId, sessionName: s.sessionName, model: s.model }).where(this.scoped(eq(sessions.id, s.id)));
  }

  /** New context means the session is live again, so any end on record goes with the change. The git clue is replaced when a new one was given and kept when none was. */
  async change(s: Session, tx: Db = this.db) {
    await tx.update(sessions).set({ summary: s.summary, updatedAt: new Date(s.updatedAt), endedAt: null, endReason: null, status: s.status, sessionName: s.sessionName,
      ...(s.git ? { metadata: sql`${sessions.metadata} || jsonb_build_object('git', ${JSON.stringify(s.git)}::jsonb)` } : {}) })
      .where(this.scoped(eq(sessions.id, s.id)));
  }

  async status(id: string, status: SessionStatus, tx: Db = this.db) {
    await tx.update(sessions).set({ status }).where(this.scoped(eq(sessions.id, id)));
  }

  async pin(id: string, pinned: boolean, tx: Db = this.db) {
    await tx.update(sessions).set({ pinned }).where(this.scoped(eq(sessions.id, id)));
  }

  async compact(id: string, value: Compaction, tx: Db = this.db) {
    await tx.update(sessions).set({ metadata: sql`${sessions.metadata} || jsonb_build_object('compaction', ${JSON.stringify(value)}::jsonb)` })
      .where(this.scoped(eq(sessions.id, id)));
  }

  async model(id: string, model: string | null, tx: Db = this.db) {
    await tx.update(sessions).set({ model }).where(this.scoped(eq(sessions.id, id)));
  }

  async reopen(id: string, tx: Db = this.db) {
    await tx.update(sessions).set({ endedAt: null, endReason: null }).where(this.scoped(eq(sessions.id, id)));
  }

  async end(s: Session, tx: Db = this.db) {
    await tx.update(sessions).set({ endedAt: date(s.endedAt), endReason: s.endReason }).where(this.scoped(eq(sessions.id, s.id)));
  }

  async detachChildren(id: string, tx: Db = this.db): Promise<number> {
    const rows = await tx.update(sessions).set({ parentSessionId: null }).where(this.scoped(eq(sessions.parentSessionId, id))).returning({ id: sessions.id });
    return rows.length;
  }

  async remove(id: string, tx: Db = this.db): Promise<number> {
    const rows = await tx.delete(sessions).where(this.scoped(eq(sessions.id, id))).returning({ id: sessions.id });
    return rows.length;
  }

  async append(s: Session, tx: Db = this.db) {
    await tx.execute(sql`INSERT INTO session_updates (id, session_id, sequence, summary, created_at, status)
      SELECT ${`upd_${randomUUID()}`}, ${s.id}, COALESCE(MAX(sequence), 0) + 1, ${s.summary}, ${new Date(s.updatedAt)}, ${s.status}
      FROM session_updates WHERE session_id = ${s.id}`);
  }

  /** 잎부터 지운다: 자식이 아직 가리키는 부모와 고정한 세션은 남긴다. 지운 수를 돌려준다. */
  async deleteExpired(cutoff: Date, keepId: string | null, tx: Db = this.db): Promise<number> {
    const parents = tx.select({ id: sessions.parentSessionId }).from(sessions).where(and(eq(sessions.userId, this.userId), isNotNull(sessions.parentSessionId)));
    const conditions = [lt(sessions.updatedAt, cutoff), eq(sessions.pinned, false), notInArray(sessions.id, parents)];
    if (keepId) conditions.push(ne(sessions.id, keepId));
    const rows = await tx.delete(sessions).where(this.scoped(and(...conditions))).returning({ id: sessions.id });
    return rows.length;
  }

  async firstSummary(id: string, tx: Db = this.db): Promise<string | undefined> {
    const [row] = await tx.select({ summary: sessionUpdates.summary }).from(sessionUpdates)
      .where(and(eq(sessionUpdates.sessionId, id), eq(sessionUpdates.sequence, 1))).limit(1);
    return row?.summary;
  }

  async updates(id: string, limit: number, offset: number, tx: Db = this.db): Promise<SessionUpdate[]> {
    const rows = await tx.select().from(sessionUpdates).where(eq(sessionUpdates.sessionId, id)).orderBy(desc(sessionUpdates.sequence)).limit(limit).offset(offset);
    return rows.map((row) => ({ id: row.id, sessionId: row.sessionId, sequence: row.sequence, summary: row.summary, status: row.status as SessionStatus | null, createdAt: row.createdAt.toISOString() }));
  }

  async updateCount(id: string, tx: Db = this.db): Promise<number> {
    const [row] = await tx.select({ total: count() }).from(sessionUpdates).where(eq(sessionUpdates.sessionId, id));
    return Number(row?.total ?? 0);
  }

  /** 가져오기가 쓴다: 이력 행을 id 기준으로 넣되 같은 순번이 이미 있으면 건너뛴다. */
  async insertUpdateIfAbsent(row: SessionUpdate, tx: Db = this.db): Promise<boolean> {
    const inserted = await tx.insert(sessionUpdates).values({ id: row.id, sessionId: row.sessionId, sequence: row.sequence, summary: row.summary, status: row.status, createdAt: new Date(row.createdAt) })
      .onConflictDoNothing().returning({ id: sessionUpdates.id });
    return inserted.length > 0;
  }

  static readonly orphanParents = isNull(sessions.parentSessionId);
}
