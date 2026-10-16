import type { SQLQueryBindings } from "bun:sqlite";
import { checkVersion } from "../db/database";
import { invalid, RelayError, storageError } from "../errors";
import { directory, flag, identifier, optionalText, pagination, sessionStatus, text } from "../validation";
import { SessionRepository } from "./session.repository";
import { brief, type ChainNode, type Filters, type GitClue, type NewSession, type Session, type SessionStatus } from "./session.types";

/** The note a session hook stores before the agent has said anything about the work. */
export const HOOK_SUMMARY = "세션 첫 기록 (훅 자동 기록)";

/** How many sessions a chain lists before it stops; a store this deep is beyond what anyone reads. */
export const CHAIN_LIMIT = 200;

export const PROVIDERS = {
  codex: { provider: "openai", agent: "codex" },
  claude: { provider: "anthropic", agent: "claude-code" },
  grok: { provider: "xai", agent: "grok" },
} as const;

export type ClueReader = (cwd: string) => GitClue | null;

export interface Change { sessionName?: string; status?: string }

export class SessionService {
  /** `clue` reads the working tree when a record is written; without it records carry no git clue. */
  constructor(public repo: SessionRepository, private retentionDays = 0, private clue: ClueReader = () => null) {}

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
    if (!matches.length) {
      const internal = this.repo.byId(id);
      if (internal && (provider === undefined || internal.provider === identifier(provider, "provider"))) {
        throw new RelayError("SESSION_NOT_FOUND", "Relay 내부 ID를 입력하셨습니다. Agent Session ID로 조회하세요.", 3, 404,
          { relayId: internal.id, providerSessionId: internal.providerSessionId, provider: internal.provider });
      }
      throw new RelayError("SESSION_NOT_FOUND", "요청한 세션을 찾을 수 없습니다.", 3, 404);
    }
    if (matches.length > 1) throw new RelayError("AMBIGUOUS_SESSION_ID", "동일 ID가 여러 제공자에 있습니다. provider를 지정하세요.", 4, 409,
      { providers: matches.map(s => s.provider) });
    return matches[0];
  }

  private internal(id: string): Session {
    const session = this.repo.byId(text(id, "id", 256));
    if (!session) throw new RelayError("SESSION_NOT_FOUND", "요청한 세션을 찾을 수 없습니다.", 3, 404);
    return session;
  }

  /** The working tree as it stands now; a reader that throws is treated as a tree that could not be read. */
  private readClue(cwd: string): GitClue | null {
    try { return this.clue(cwd); } catch { return null; }
  }

  record(input: NewSession, parentId?: string, parentProvider?: string) {
    const provider = identifier(input.provider, "provider");
    const agent = identifier(input.agent, "agent");
    const providerSessionId = text(input.sessionId, "session-id", 256);
    const summary = text(input.summary, "summary", 4000, true);
    const model = optionalText(input.model, "model", 200);
    const givenName = optionalText(input.sessionName, "session-name", 200);
    const status = sessionStatus(input.status);
    const givenCwd = input.cwd === undefined ? undefined : directory(input.cwd, true);
    return this.write(() => {
      const parent = parentId === undefined ? null : this.resolve(parentId, parentProvider);
      const existing = this.repo.byProviderId(providerSessionId, provider)[0];
      // A session hook may have recorded this session before the agent ran; `continue` links that
      // record instead of failing, so taking work over does not depend on the hook being off.
      if (existing && parent) {
        if (existing.parentSessionId === null) return this.adopt(existing, parent, { agent, summary, name: givenName, model, status, input });
        if (existing.parentSessionId !== parent.id) {
          throw new RelayError("PARENT_CONFLICT", "이 세션은 이미 다른 세션에 연결되어 있습니다.", 4, 409, { parentSessionId: existing.parentSessionId });
        }
        if (existing.agent !== agent) {
          throw new RelayError("SESSION_EXISTS", "같은 제공자·ID가 다른 도구로 저장되어 있습니다.", 4, 409, { agent: existing.agent });
        }
        // Already linked to this parent, so a retry has nothing to do; further context belongs in `update`.
        return { schemaVersion: 1, session: this.reopen(existing), parentSession: brief(parent) };
      }
      const cwd = givenCwd ?? directory(parent?.workingDirectory ?? process.cwd(), true);
      const sessionName = input.sessionName === undefined ? parent?.sessionName ?? null : givenName;
      if (existing) {
        if (existing.agent !== agent || existing.sessionName !== sessionName || existing.model !== model ||
          existing.workingDirectory !== cwd || existing.parentSessionId !== (parent?.id ?? null) ||
          this.repo.firstSummary(existing.id) !== summary) {
          throw new RelayError("SESSION_EXISTS", "같은 제공자·ID로 다른 생성 정보가 이미 저장되어 있습니다.", 4, 409);
        }
        // A host that resumes the same session starts it again, so an end on record no longer holds.
        return { schemaVersion: 1, session: this.reopen(existing), ...(parent ? { parentSession: brief(parent) } : {}) };
      }
      const now = new Date().toISOString();
      const session: Session = { id: `ses_${crypto.randomUUID()}`, provider, agent, providerSessionId,
        sessionName, model, workingDirectory: cwd, summary,
        parentSessionId: parent?.id ?? null, createdAt: now, updatedAt: now, endedAt: null, endReason: null,
        status, pinned: false, git: this.readClue(cwd) };
      this.repo.insert(session);
      this.repo.append(session);
      return { schemaVersion: 1, session, ...(parent ? { parentSession: brief(parent) } : {}) };
    });
  }

  private reopen(existing: Session): Session {
    if (existing.endedAt === null && existing.endReason === null) return existing;
    this.repo.reopen(existing.id);
    return { ...existing, endedAt: null, endReason: null };
  }

  /** Ancestor ids, nearest first. Links are kept acyclic, so the depth cap only guards a damaged store. */
  private ancestors(session: Session): string[] {
    const chain: string[] = [];
    let current = session.parentSessionId;
    while (current && chain.length < 1000) { chain.push(current); current = this.repo.byId(current)?.parentSessionId ?? null; }
    return chain;
  }

  // Identity and origin stay fixed: the tool, the project and the creation time never move. Only the
  // parent and the labels an automatic first record could not know are written, and the takeover note
  // lands in the history like any other update.
  private adopt(existing: Session, parent: Session,
    incoming: { agent: string; summary: string; name: string | null; model: string | null; status: SessionStatus | null; input: NewSession }) {
    if (existing.agent !== incoming.agent) {
      throw new RelayError("SESSION_EXISTS", "같은 제공자·ID가 다른 도구로 저장되어 있습니다.", 4, 409, { agent: existing.agent });
    }
    if (parent.id === existing.id || this.ancestors(parent).includes(existing.id)) {
      throw new RelayError("PARENT_CONFLICT", "세션을 자기 자신이나 자기 자손에 연결할 수 없습니다.", 4, 409);
    }
    const session: Session = { ...existing, parentSessionId: parent.id,
      sessionName: incoming.input.sessionName === undefined ? existing.sessionName : incoming.name,
      model: incoming.input.model === undefined ? existing.model : incoming.model,
      status: incoming.input.status === undefined ? existing.status : incoming.status,
      summary: incoming.summary, updatedAt: new Date().toISOString(), endedAt: null, endReason: null,
      git: this.readClue(existing.workingDirectory) ?? existing.git };
    this.repo.link(session);
    this.repo.change(session);
    this.repo.append(session);
    return { schemaVersion: 1, session, parentSession: brief(parent) };
  }

  /** New context, and with it any new name or state the agent declares. What is not given stays as it was. */
  update(id: string, summaryInput: string, provider?: string, change: Change = {}) {
    const summary = text(summaryInput, "summary", 4000, true);
    const sessionName = change.sessionName === undefined ? undefined : text(change.sessionName, "session-name", 200);
    const status = change.status === undefined ? undefined : sessionStatus(change.status);
    return this.write(() => {
      const session = this.resolve(id, provider);
      session.summary = summary;
      if (sessionName !== undefined) session.sessionName = sessionName;
      if (status !== undefined) session.status = status;
      session.updatedAt = new Date().toISOString();
      session.endedAt = null; session.endReason = null;
      session.git = this.readClue(session.workingDirectory) ?? session.git;
      this.repo.change(session);
      this.repo.append(session);
      return { schemaVersion: 1, session };
    });
  }

  /** A pin is not context: the record keeps its time of last update and its history. */
  pin(id: string, pinned: boolean, provider?: string) {
    return this.write(() => {
      const session = this.resolve(id, provider);
      if (session.pinned !== pinned) this.repo.pin(session.id, pinned);
      return { schemaVersion: 1, session: { ...session, pinned } };
    });
  }

  /**
   * Removes the record and its history. Sessions that took over from it keep their records; without
   * `force` they hold the record in place, with it they lose only the link.
   */
  delete(id: string, provider?: string, force = false) {
    return this.write(() => {
      const session = this.resolve(id, provider);
      const children = this.repo.count("WHERE parent_session_id = ?", [session.id]);
      if (children && !force) {
        throw new RelayError("SESSION_LINKED", `이어받은 세션 ${children}건이 이 세션에 연결되어 있습니다. --force를 주면 연결을 끊고 삭제합니다.`, 4, 409,
          { children });
      }
      const detached = children ? this.repo.detachChildren(session.id) : 0;
      this.repo.remove(session.id);
      return { schemaVersion: 1, session, deleted: true, detached };
    });
  }

  /**
   * The host closed the session. A record holding only the automatic first entry never received any
   * context from the agent, so it is dropped instead of filling the list; every other session keeps
   * when and why it ended. `updatedAt` stays put: it is the time of the last context, not of the close.
   */
  end(id: string, provider?: string, reasonInput?: unknown) {
    const reason = optionalText(reasonInput, "reason", 200);
    return this.write(() => {
      const session = this.resolve(id, provider);
      const untouched = !session.pinned && this.repo.updateCount(session.id) === 1 && this.repo.firstSummary(session.id) === HOOK_SUMMARY &&
        this.repo.count("WHERE parent_session_id = ?", [session.id]) === 0;
      if (untouched) {
        this.repo.remove(session.id);
        return { schemaVersion: 1, session, deleted: true };
      }
      session.endedAt = new Date().toISOString();
      session.endReason = reason;
      this.repo.end(session);
      return { schemaVersion: 1, session, deleted: false };
    });
  }

  private detail(session: Session) {
    const children = this.repo.rows("WHERE parent_session_id = ?", [session.id], 50, 0, true);
    return { schemaVersion: 1, session,
      parentSession: session.parentSessionId ? brief(this.internal(session.parentSessionId)) : null,
      children: children.map(brief),
      childrenPage: { limit: 50, offset: 0, total: this.repo.count("WHERE parent_session_id = ?", [session.id]) } };
  }

  private historyPage(session: Session, page: { limit: number; offset: number }) {
    return { updates: this.repo.updates(session.id, page.limit, page.offset),
      updatesPage: { ...page, total: this.repo.updateCount(session.id) } };
  }

  /**
   * The whole line of work this session belongs to: from the first session down to this one, then
   * everything that took over from it, each child under its parent in the order they were created.
   */
  private lineage(session: Session): { items: ChainNode[]; truncated: boolean } {
    const node = (s: Session, depth: number): ChainNode => ({ id: s.id, provider: s.provider, agent: s.agent,
      providerSessionId: s.providerSessionId, sessionName: s.sessionName, summary: s.summary, status: s.status, pinned: s.pinned,
      createdAt: s.createdAt, updatedAt: s.updatedAt, endedAt: s.endedAt, parentSessionId: s.parentSessionId, depth, current: s.id === session.id });
    const above = this.ancestors(session).map(id => this.repo.byId(id)).filter((s): s is Session => s !== null).reverse();
    const items = above.map((s, depth) => node(s, depth));
    let truncated = false;
    const descend = (parent: Session, depth: number) => {
      if (items.length >= CHAIN_LIMIT) { truncated = true; return; }
      items.push(node(parent, depth));
      // Oldest first, so the list reads in the order the work was taken over.
      const children = this.repo.rows("WHERE parent_session_id = ?", [parent.id], CHAIN_LIMIT, 0, true).reverse();
      for (const child of children) descend(child, depth + 1);
    };
    descend(session, above.length);
    return { items, truncated };
  }

  show(id: string, provider?: string, history = false, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      const session = this.resolve(id, provider);
      return { ...this.detail(session), ...(history ? this.historyPage(session, page) : {}) };
    });
  }

  chain(id: string, provider?: string) {
    return this.transaction(false, () => {
      const session = this.resolve(id, provider);
      return { schemaVersion: 1, session, ...this.lineage(session) };
    });
  }

  chainById(id: string) {
    return this.transaction(false, () => {
      const session = this.internal(id);
      return { schemaVersion: 1, sessionId: session.id, ...this.lineage(session) };
    });
  }

  /** Everything a hand-over note needs in one read: the detail, the newest history page and the chain. */
  packet(id: string, provider?: string, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      const session = this.resolve(id, provider);
      return { ...this.detail(session), ...this.historyPage(session, page), chain: this.lineage(session).items };
    });
  }

  byId(id: string) { return this.transaction(false, () => this.detail(this.internal(id))); }

  /** Everything the detail view shows in one read: the session, its relations and the newest history page. */
  inspect(id: string, input: { limit?: unknown; offset?: unknown } = {}) {
    const page = pagination(input);
    return this.transaction(false, () => {
      const session = this.internal(id);
      return { ...this.detail(session), ...this.historyPage(session, page), chain: this.lineage(session).items };
    });
  }

  list(filters: Filters = {}) {
    const { limit, offset } = pagination(filters);
    const clauses: string[] = [];
    const args: SQLQueryBindings[] = [];
    if (filters.provider !== undefined) { clauses.push("provider = ?"); args.push(identifier(filters.provider, "provider")); }
    if (filters.agent !== undefined) { clauses.push("agent = ?"); args.push(identifier(filters.agent, "agent")); }
    if (filters.cwd !== undefined) { clauses.push(`working_directory = ?${process.platform === "win32" ? " COLLATE NOCASE" : ""}`); args.push(directory(filters.cwd, false)); }
    if (filters.status !== undefined) { clauses.push("status = ?"); args.push(sessionStatus(filters.status)); }
    const pinned = flag(filters.pinned, "pinned");
    if (pinned !== undefined) { clauses.push("pinned = ?"); args.push(pinned ? 1 : 0); }
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
    const scope = { cwd: cwd === undefined ? null : directory(cwd, false) };
    return this.transaction(false, () => {
      const args: string[] = [mapping.provider, mapping.agent];
      let where = "WHERE provider = ? AND agent = ?";
      if (scope.cwd !== null) { where += ` AND working_directory = ?${process.platform === "win32" ? " COLLATE NOCASE" : ""}`; args.push(scope.cwd); }
      const session = this.repo.rows(where, args, 1, 0)[0];
      if (!session) throw new RelayError("SESSION_NOT_FOUND", `${alias}의 Relay 기록이 없습니다. 조회 범위: ${scope.cwd ?? "전체 프로젝트"}. 다른 제공자로 대체하지 않습니다.`, 3, 404, { scope });
      return { ...this.detail(session), scope };
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
