import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { Session, SessionUpdate } from "./session.types";

const columns = `id, provider, agent, provider_session_id AS providerSessionId,
  session_name AS sessionName, model, working_directory AS workingDirectory,
  status, summary, parent_session_id AS parentSessionId,
  started_at AS startedAt, updated_at AS updatedAt, ended_at AS endedAt`;

export class SessionRepository {
  constructor(public db: Database) {}

  byId(id: string) { return this.db.query<Session, [string]>(`SELECT ${columns} FROM sessions WHERE id = ?`).get(id); }

  byProviderId(id: string, provider?: string) {
    return this.db.query<Session, SQLQueryBindings[]>(`SELECT ${columns} FROM sessions WHERE provider_session_id = ?
      ${provider ? "AND provider = ?" : ""} ORDER BY provider`).all(...(provider ? [id, provider] : [id]));
  }

  rows(where: string, args: SQLQueryBindings[], limit: number, offset: number, children = false) {
    return this.db.query<Session, SQLQueryBindings[]>(`SELECT ${columns} FROM sessions ${where}
      ORDER BY ${children ? "started_at" : "updated_at"} DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  }

  count(where: string, args: SQLQueryBindings[]) {
    return this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total FROM sessions ${where}`).get(...args)!.total;
  }

  insert(s: Session) {
    this.db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, session_name, model,
      working_directory, status, summary, parent_session_id, started_at, updated_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(s.id, s.provider, s.agent, s.providerSessionId,
      s.sessionName, s.model, s.workingDirectory, s.status, s.summary, s.parentSessionId, s.startedAt, s.updatedAt, s.endedAt);
  }

  change(s: Session) {
    this.db.query("UPDATE sessions SET summary = ?, status = ?, updated_at = ?, ended_at = ? WHERE id = ?")
      .run(s.summary, s.status, s.updatedAt, s.endedAt, s.id);
  }

  append(s: Session, type: SessionUpdate["type"]) {
    this.db.query(`INSERT INTO session_updates (id, session_id, sequence, type, summary, created_at)
      SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ? FROM session_updates WHERE session_id = ?`)
      .run(`upd_${crypto.randomUUID()}`, s.id, type, s.summary, s.updatedAt, s.id);
  }

  deleteExpired(cutoff: string, keepId: string) {
    return this.db.query(`DELETE FROM sessions WHERE updated_at < ? AND id <> ?
      AND id NOT IN (SELECT parent_session_id FROM sessions WHERE parent_session_id IS NOT NULL)`).run(cutoff, keepId).changes;
  }

  firstSummary(id: string) {
    return this.db.query<{ summary: string }, [string]>("SELECT summary FROM session_updates WHERE session_id = ? AND sequence = 1").get(id)?.summary;
  }

  updates(id: string, limit: number, offset: number) {
    return this.db.query<SessionUpdate, [string, number, number]>(`SELECT id, session_id AS sessionId,
      sequence, type, summary, created_at AS createdAt FROM session_updates WHERE session_id = ?
      ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(id, limit, offset);
  }

  updateCount(id: string) {
    return this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM session_updates WHERE session_id = ?").get(id)!.total;
  }
}
