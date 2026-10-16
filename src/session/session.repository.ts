import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { GitClue, Session, SessionUpdate } from "./session.types";

const columns = `id, provider, agent, provider_session_id AS providerSessionId,
  session_name AS sessionName, model, working_directory AS workingDirectory,
  summary, parent_session_id AS parentSessionId,
  created_at AS createdAt, updated_at AS updatedAt,
  ended_at AS endedAt, end_reason AS endReason,
  status, pinned, metadata_json AS metadataJson`;

type Row = Omit<Session, "pinned" | "git"> & { pinned: number; metadataJson: string };

/** The git clue lives in the metadata column; anything else stored there is left untouched. */
function metadata(raw: string): Record<string, unknown> {
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function clue(raw: string): GitClue | null {
  const git = metadata(raw).git as Partial<GitClue> | undefined;
  if (!git || typeof git !== "object" || typeof git.at !== "string") return null;
  return { branch: typeof git.branch === "string" ? git.branch : null, commit: typeof git.commit === "string" ? git.commit : null,
    dirty: typeof git.dirty === "number" ? git.dirty : 0, at: git.at };
}

function hydrate(row: Row): Session {
  const { pinned, metadataJson, ...rest } = row;
  return { ...rest, pinned: pinned === 1, git: clue(metadataJson) };
}

export class SessionRepository {
  constructor(public db: Database) {}

  byId(id: string) {
    const row = this.db.query<Row, [string]>(`SELECT ${columns} FROM sessions WHERE id = ?`).get(id);
    return row ? hydrate(row) : null;
  }

  byProviderId(id: string, provider?: string) {
    return this.db.query<Row, SQLQueryBindings[]>(`SELECT ${columns} FROM sessions WHERE provider_session_id = ?
      ${provider ? "AND provider = ?" : ""} ORDER BY provider`).all(...(provider ? [id, provider] : [id])).map(hydrate);
  }

  rows(where: string, args: SQLQueryBindings[], limit: number, offset: number, children = false) {
    return this.db.query<Row, SQLQueryBindings[]>(`SELECT ${columns} FROM sessions ${where}
      ORDER BY ${children ? "created_at" : "updated_at"} DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map(hydrate);
  }

  count(where: string, args: SQLQueryBindings[]) {
    return this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total FROM sessions ${where}`).get(...args)!.total;
  }

  insert(s: Session) {
    this.db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, session_name, model,
      working_directory, summary, parent_session_id, created_at, updated_at, status, pinned, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.provider, s.agent, s.providerSessionId, s.sessionName, s.model,
        s.workingDirectory, s.summary, s.parentSessionId, s.createdAt, s.updatedAt, s.status, s.pinned ? 1 : 0,
        JSON.stringify(s.git ? { git: s.git } : {}));
  }

  /** Attaches an origin and fills the labels an automatic first record could not know. */
  link(s: Session) {
    this.db.query("UPDATE sessions SET parent_session_id = ?, session_name = ?, model = ? WHERE id = ?")
      .run(s.parentSessionId, s.sessionName, s.model, s.id);
  }

  /** New context means the session is live again, so any end on record goes with the change. The git
   *  clue is replaced when a new one was read and kept when none could be. */
  change(s: Session) {
    this.db.query(`UPDATE sessions SET summary = ?, updated_at = ?, ended_at = NULL, end_reason = NULL, status = ?, session_name = ?,
      metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_set(metadata_json, '$.git', json(?)) END WHERE id = ?`)
      .run(s.summary, s.updatedAt, s.status, s.sessionName, s.git ? 1 : null, JSON.stringify(s.git), s.id);
  }

  pin(id: string, pinned: boolean) {
    this.db.query("UPDATE sessions SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  }

  reopen(id: string) {
    this.db.query("UPDATE sessions SET ended_at = NULL, end_reason = NULL WHERE id = ?").run(id);
  }

  end(s: Session) {
    this.db.query("UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?").run(s.endedAt, s.endReason, s.id);
  }

  /** The children keep their records and lose only the link, so the parent can go. */
  detachChildren(id: string) {
    return this.db.query("UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?").run(id).changes;
  }

  /** History goes with the session through the cascade; a parent still referenced is refused by the foreign key. */
  remove(id: string) {
    return this.db.query("DELETE FROM sessions WHERE id = ?").run(id).changes;
  }

  append(s: Session) {
    this.db.query(`INSERT INTO session_updates (id, session_id, sequence, summary, created_at, status)
      SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ? FROM session_updates WHERE session_id = ?`)
      .run(`upd_${crypto.randomUUID()}`, s.id, s.summary, s.updatedAt, s.status, s.id);
  }

  deleteExpired(cutoff: string, keepId: string) {
    return this.db.query(`DELETE FROM sessions WHERE updated_at < ? AND id <> ? AND pinned = 0
      AND id NOT IN (SELECT parent_session_id FROM sessions WHERE parent_session_id IS NOT NULL)`).run(cutoff, keepId).changes;
  }

  firstSummary(id: string) {
    return this.db.query<{ summary: string }, [string]>("SELECT summary FROM session_updates WHERE session_id = ? AND sequence = 1").get(id)?.summary;
  }

  updates(id: string, limit: number, offset: number) {
    return this.db.query<SessionUpdate, [string, number, number]>(`SELECT id, session_id AS sessionId,
      sequence, summary, status, created_at AS createdAt FROM session_updates WHERE session_id = ?
      ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(id, limit, offset);
  }

  updateCount(id: string) {
    return this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM session_updates WHERE session_id = ?").get(id)!.total;
  }
}
