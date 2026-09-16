import type { SQLQueryBindings } from "bun:sqlite";
import { checkVersion } from "../db/database";
import { invalid, RelayError, storageError } from "../errors";
import { directory, identifier, optionalText, pagination, text } from "../validation";
import { SessionRepository } from "./session.repository";
import { brief, type Filters, type NewSession, type Session } from "./session.types";

export const PROVIDERS = {
  codex: { provider: "openai", agent: "codex" },
  claude: { provider: "anthropic", agent: "claude-code" },
  grok: { provider: "xai", agent: "grok" },
} as const;

export class SessionService {
  constructor(public repo: SessionRepository, private retentionDays = 0) {}

  private transaction<T>(write: boolean, action: () => T): T {
    try {
      const tx = this.repo.db.transaction(() => { checkVersion(this.repo.db); return action(); });
      return write ? tx.immediate() : tx.deferred();
    } catch (error) { throw storageError(error); }
  }

  // Retention runs with the write it follows, so a read connection never needs the writer lock.
  private write<T extends { session: Session }>(action: () => T): T {
    return this.transaction(true, () => {
      const result = action();
      if (this.retentionDays > 0) {
        const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000).toISOString();
        // Delete expired sessions leaf first: an ancestor stays while any surviving session still points to it.
        while (this.repo.deleteExpired(cutoff, result.session.id) > 0);
      }
      return result;
    });
  }

  private resolve(id: string, provider?: string): Session {
    const matches = this.repo.byProviderId(text(id, "session-id", 256), provider === undefined ? undefined : identifier(provider, "provider"));
    if (!matches.length) throw new RelayError("SESSION_NOT_FOUND", "요청한 세션을 찾을 수 없습니다.", 3, 404);
    if (matches.length > 1) throw new RelayError("AMBIGUOUS_SESSION_ID", "동일 ID가 여러 제공자에 있습니다. provider를 지정하세요.", 4, 409,
      { providers: matches.map(s => s.provider) });
    return matches[0];
  }

  private internal(id: string): Session {
    const session = this.repo.byId(text(id, "id", 256));
    if (!session) throw new RelayError("SESSION_NOT_FOUND", "요청한 세션을 찾을 수 없습니다.", 3, 404);
    return session;
  }

  record(input: NewSession, parentId?: string, parentProvider?: string) {
    const provider = identifier(input.provider, "provider");
    const agent = identifier(input.agent, "agent");
    const providerSessionId = text(input.sessionId, "session-id", 256);
    const summary = text(input.summary, "summary", 4000, true);
    const model = optionalText(input.model, "model", 200);
    const givenName = optionalText(input.sessionName, "session-name", 200);
    const givenCwd = input.cwd === undefined ? undefined : directory(input.cwd, true);
    return this.write(() => {
      const parent = parentId === undefined ? null : this.resolve(parentId, parentProvider);
      const cwd = givenCwd ?? directory(parent?.workingDirectory ?? process.cwd(), true);
      const sessionName = input.sessionName === undefined ? parent?.sessionName ?? null : givenName;
      const existing = this.repo.byProviderId(providerSessionId, provider)[0];
      if (existing) {
        if (existing.agent !== agent || existing.sessionName !== sessionName || existing.model !== model ||
          existing.workingDirectory !== cwd || existing.parentSessionId !== (parent?.id ?? null) ||
          this.repo.firstSummary(existing.id) !== summary) {
          throw new RelayError("SESSION_EXISTS", "같은 제공자·ID로 다른 생성 정보가 이미 저장되어 있습니다.", 4, 409);
        }
        return { schemaVersion: 1, session: existing, ...(parent ? { parentSession: brief(parent) } : {}) };
      }
      const now = new Date().toISOString();
      const session: Session = { id: `ses_${crypto.randomUUID()}`, provider, agent, providerSessionId,
        sessionName, model, workingDirectory: cwd, summary,
        parentSessionId: parent?.id ?? null, createdAt: now, updatedAt: now };
      this.repo.insert(session);
      this.repo.append(session);
      return { schemaVersion: 1, session, ...(parent ? { parentSession: brief(parent) } : {}) };
    });
  }

  update(id: string, summaryInput: string, provider?: string) {
    return this.change(id, summaryInput, provider);
  }

  private change(id: string, summaryInput: string, provider?: string) {
    const summary = text(summaryInput, "summary", 4000, true);
    return this.write(() => {
      const session = this.resolve(id, provider);
      session.summary = summary;
      session.updatedAt = new Date().toISOString();
      this.repo.change(session);
      this.repo.append(session);
      return { schemaVersion: 1, session };
    });
  }

  private detail(session: Session) {
    const children = this.repo.rows("WHERE parent_session_id = ?", [session.id], 50, 0, true);
    return { schemaVersion: 1, session,
      parentSession: session.parentSessionId ? brief(this.internal(session.parentSessionId)) : null,
      children: children.map(brief),
      childrenPage: { limit: 50, offset: 0, total: this.repo.count("WHERE parent_session_id = ?", [session.id]) } };
  }

  show(id: string, provider?: string, history = false, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      const session = this.resolve(id, provider);
      return { ...this.detail(session), ...(history ? { updates: this.repo.updates(session.id, page.limit, page.offset),
        updatesPage: { ...page, total: this.repo.updateCount(session.id) } } : {}) };
    });
  }

  byId(id: string) { return this.transaction(false, () => this.detail(this.internal(id))); }

  list(filters: Filters = {}) {
    const { limit, offset } = pagination(filters);
    const clauses: string[] = [];
    const args: SQLQueryBindings[] = [];
    if (filters.provider !== undefined) { clauses.push("provider = ?"); args.push(identifier(filters.provider, "provider")); }
    if (filters.agent !== undefined) { clauses.push("agent = ?"); args.push(identifier(filters.agent, "agent")); }
    if (filters.cwd !== undefined) { clauses.push(`working_directory = ?${process.platform === "win32" ? " COLLATE NOCASE" : ""}`); args.push(directory(filters.cwd, false)); }
    if (filters.q !== undefined) {
      const q = text(filters.q, "query", 4000).replace(/[\\%_]/g, "\\$&");
      const searchColumns = ["session_name", "id", "provider_session_id", "summary", "working_directory"];
      clauses.push(`(${searchColumns.map(c => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      args.push(...searchColumns.map(() => `%${q}%`));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.transaction(false, () => ({ schemaVersion: 1,
      items: this.repo.rows(where, args, limit, offset), page: { limit, offset, total: this.repo.count(where, args) } }));
  }

  latest(alias: string, cwd?: string) {
    if (!Object.hasOwn(PROVIDERS, alias)) invalid("사용법: relay latest codex|claude|grok [--cwd <절대경로>] --json");
    const mapping = PROVIDERS[alias as keyof typeof PROVIDERS];
    return this.transaction(false, () => {
      const args: string[] = [mapping.provider, mapping.agent];
      let where = "WHERE provider = ? AND agent = ?";
      if (cwd !== undefined) { where += ` AND working_directory = ?${process.platform === "win32" ? " COLLATE NOCASE" : ""}`; args.push(directory(cwd, false)); }
      const session = this.repo.rows(where, args, 1, 0)[0];
      if (!session) throw new RelayError("SESSION_NOT_FOUND", `${alias}의 Relay 기록이 없습니다. 다른 제공자로 대체하지 않습니다.`, 3, 404);
      return this.detail(session);
    });
  }

  updates(id: string, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      this.internal(id);
      return { schemaVersion: 1, sessionId: id, items: this.repo.updates(id, page.limit, page.offset),
        page: { ...page, total: this.repo.updateCount(id) } };
    });
  }

  children(id: string, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      this.internal(id);
      return { schemaVersion: 1, sessionId: id,
        items: this.repo.rows("WHERE parent_session_id = ?", [id], page.limit, page.offset, true).map(brief),
        page: { ...page, total: this.repo.count("WHERE parent_session_id = ?", [id]) } };
    });
  }
}
