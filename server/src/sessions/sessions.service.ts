import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  ALIASES, CHAIN_LIMIT, HOOK_SUMMARY, PROVIDERS, RelayError, WEB_END_REASON, brief, directoryText, flag, gitClue, identifier, invalid,
  optionalText, pagination, sessionStatus, text, withModels,
  type ChainNode, type Filters, type GitClue, type RecordRequest, type Session, type SessionAction, type SessionChain, type SessionChainById,
  type SessionChanged, type SessionChildren, type SessionDeleted, type SessionDetail, type SessionEnded, type SessionLatest, type SessionList,
  type SessionPacket, type SessionResult, type SessionShown, type SessionStatus, type SessionUpdates,
} from "@relay/core";
import { CONFIG } from "../app.tokens.js";
import type { ServerConfig } from "../config.js";
import { DB, lockUser, schema, type Db } from "../db/database.js";
import { SessionsRepository } from "./sessions.repository.js";

const { sessions } = schema;

/** Agent Session ID로 세션을 가리키는 요청. provider는 같은 ID가 여러 제공자에 있을 때만 필요하다. */
export interface ByProvider { providerSessionId: string; provider?: string }
export interface Change { sessionName?: string; status?: string; git?: GitClue | null }

/** `src/session/session.service.ts`(Bun/SQLite)와 같은 규칙을 PostgreSQL 위에서 사용자 단위로 수행한다. */
@Injectable()
export class SessionsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: ServerConfig) {}

  repo(userId: string, tx: Db = this.db) { return new SessionsRepository(tx, userId); }

  /** 쓰기는 사용자 잠금 아래 한 트랜잭션으로 하고, 끝에 보관 기간이 지난 세션을 잎부터 지운다. */
  private async write<T extends { session: Session }>(userId: string, action: (repo: SessionsRepository, tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const repo = this.repo(userId, tx);
      const result = await action(repo, tx);
      if (this.config.retentionDays > 0) {
        const cutoff = new Date(Date.now() - this.config.retentionDays * 86_400_000);
        while (await repo.deleteExpired(cutoff, result.session.id, tx) > 0);
      }
      return result;
    });
  }

  private async read<T>(userId: string, action: (repo: SessionsRepository, tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => action(this.repo(userId, tx), tx));
  }

  private async resolve(repo: SessionsRepository, id: string, provider?: string, tx?: Db): Promise<Session> {
    const matches = await repo.byProviderId(text(id, "session-id", 256), provider === undefined ? undefined : identifier(provider, "provider"), tx);
    if (!matches.length) {
      const internal = await repo.byId(id, tx);
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

  private async internal(repo: SessionsRepository, id: string, tx?: Db): Promise<Session> {
    const session = await repo.byId(text(id, "id", 256), tx);
    if (!session) throw new RelayError("SESSION_NOT_FOUND", "요청한 세션을 찾을 수 없습니다.", 3, 404);
    return session;
  }

  record(userId: string, deviceId: string | null, input: RecordRequest, parentInput?: ByProvider): Promise<SessionResult> {
    const provider = identifier(input.provider, "provider");
    const agent = identifier(input.agent, "agent");
    const providerSessionId = text(input.sessionId, "session-id", 256);
    const summary = text(input.summary, "summary", 4000, true);
    const model = optionalText(input.model, "model", 200);
    const givenName = optionalText(input.sessionName, "session-name", 200);
    const status = sessionStatus(input.status);
    const givenCwd = input.cwd === undefined ? undefined : directoryText(input.cwd);
    const git = gitClue(input.git);
    if (parentInput !== undefined) text(parentInput?.providerSessionId, "parent.providerSessionId", 256);
    return this.write(userId, async (repo, tx) => {
      const parent = parentInput === undefined ? null : await this.resolve(repo, parentInput.providerSessionId, parentInput.provider, tx);
      const existing = (await repo.byProviderId(providerSessionId, provider, tx))[0];
      if (existing && parent) {
        if (existing.parentSessionId === null) return this.adopt(repo, tx, existing, parent, { agent, summary, name: givenName, model, status, git, input });
        if (existing.parentSessionId !== parent.id) {
          throw new RelayError("PARENT_CONFLICT", "이 세션은 이미 다른 세션에 연결되어 있습니다.", 4, 409, { parentSessionId: existing.parentSessionId });
        }
        if (existing.agent !== agent) throw new RelayError("SESSION_EXISTS", "같은 제공자·ID가 다른 도구로 저장되어 있습니다.", 4, 409, { agent: existing.agent });
        return { schemaVersion: 1, session: await this.reopen(repo, tx, existing), parentSession: brief(parent) };
      }
      const cwd = givenCwd ?? (parent?.workingDirectory ?? null);
      if (cwd === null) invalid("cwd: 작업 디렉터리 절대경로를 주세요.");
      const sessionName = input.sessionName === undefined ? parent?.sessionName ?? null : givenName;
      if (existing) {
        if (existing.agent !== agent || existing.sessionName !== sessionName || (input.model !== undefined && existing.model !== model) ||
          existing.workingDirectory !== cwd || existing.parentSessionId !== (parent?.id ?? null) ||
          (await repo.firstSummary(existing.id, tx)) !== summary) {
          throw new RelayError("SESSION_EXISTS", "같은 제공자·ID로 다른 생성 정보가 이미 저장되어 있습니다.", 4, 409);
        }
        return { schemaVersion: 1, session: await this.reopen(repo, tx, existing), ...(parent ? { parentSession: brief(parent) } : {}) };
      }
      const now = new Date().toISOString();
      const session: Session = { id: `ses_${randomUUID()}`, provider, agent, providerSessionId, sessionName, model, workingDirectory: cwd, summary,
        parentSessionId: parent?.id ?? null, createdAt: now, updatedAt: now, endedAt: null, endReason: null, status, pinned: false, git, compaction: null, deviceId };
      await repo.insert(session, deviceId, tx);
      await repo.append(session, tx);
      return { schemaVersion: 1, session, ...(parent ? { parentSession: brief(parent) } : {}) };
    });
  }

  private async reopen(repo: SessionsRepository, tx: Db, existing: Session): Promise<Session> {
    if (existing.endedAt === null && existing.endReason === null) return existing;
    await repo.reopen(existing.id, tx);
    return { ...existing, endedAt: null, endReason: null };
  }

  private async ancestors(repo: SessionsRepository, tx: Db, session: Session): Promise<string[]> {
    const chain: string[] = [];
    let current = session.parentSessionId;
    while (current && chain.length < 1000) { chain.push(current); current = (await repo.byId(current, tx))?.parentSessionId ?? null; }
    return chain;
  }

  private async adopt(repo: SessionsRepository, tx: Db, existing: Session, parent: Session,
    incoming: { agent: string; summary: string; name: string | null; model: string | null; status: SessionStatus | null; git: GitClue | null; input: RecordRequest }): Promise<SessionResult> {
    if (existing.agent !== incoming.agent) throw new RelayError("SESSION_EXISTS", "같은 제공자·ID가 다른 도구로 저장되어 있습니다.", 4, 409, { agent: existing.agent });
    if (parent.id === existing.id || (await this.ancestors(repo, tx, parent)).includes(existing.id)) {
      throw new RelayError("PARENT_CONFLICT", "세션을 자기 자신이나 자기 자손에 연결할 수 없습니다.", 4, 409);
    }
    const session: Session = { ...existing, parentSessionId: parent.id,
      sessionName: incoming.input.sessionName === undefined ? existing.sessionName : incoming.name,
      model: withModels(existing.model, [incoming.model]),
      status: incoming.input.status === undefined ? existing.status : incoming.status,
      summary: incoming.summary, updatedAt: new Date().toISOString(), endedAt: null, endReason: null, git: incoming.git ?? existing.git };
    await repo.link(session, tx);
    await repo.change({ ...session, git: incoming.git }, tx);
    await repo.append(session, tx);
    return { schemaVersion: 1, session, parentSession: brief(parent) };
  }

  update(userId: string, target: ByProvider, summaryInput: unknown, change: Change = {}): Promise<SessionChanged> {
    const summary = text(summaryInput, "summary", 4000, true);
    const sessionName = change.sessionName === undefined ? undefined : text(change.sessionName, "session-name", 200);
    const status = change.status === undefined ? undefined : sessionStatus(change.status);
    const git = gitClue(change.git);
    return this.write(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      session.summary = summary;
      if (sessionName !== undefined) session.sessionName = sessionName;
      if (status !== undefined) session.status = status;
      session.updatedAt = new Date().toISOString();
      session.endedAt = null; session.endReason = null;
      await repo.change({ ...session, git }, tx);
      await repo.append(session, tx);
      return { schemaVersion: 1, session: { ...session, git: git ?? session.git } };
    });
  }

  compact(userId: string, target: ByProvider, triggerInput?: unknown): Promise<SessionChanged> {
    const trigger = optionalText(triggerInput, "trigger", 40);
    return this.write(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      const compaction = { count: (session.compaction?.count ?? 0) + 1, lastAt: new Date().toISOString(), trigger };
      await repo.compact(session.id, compaction, tx);
      return { schemaVersion: 1, session: { ...session, compaction } };
    });
  }

  models(userId: string, target: ByProvider, reported: unknown): Promise<SessionChanged> {
    if (!Array.isArray(reported)) invalid("models: 모델 이름 배열을 보내세요.");
    return this.write(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      const model = withModels(session.model, reported);
      if (model !== session.model) await repo.model(session.id, model, tx);
      return { schemaVersion: 1, session: { ...session, model } };
    });
  }

  pin(userId: string, target: ByProvider, pinnedInput: unknown): Promise<SessionChanged> {
    const pinned = flag(pinnedInput, "pinned");
    if (pinned === undefined) invalid("pinned: true 또는 false를 입력하세요.");
    return this.write(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      if (session.pinned !== pinned) await repo.pin(session.id, pinned, tx);
      return { schemaVersion: 1, session: { ...session, pinned } };
    });
  }

  delete(userId: string, target: ByProvider, force = false): Promise<SessionDeleted> {
    return this.write(userId, async (repo, tx) => this.erase(repo, tx, await this.resolve(repo, target.providerSessionId, target.provider, tx), force));
  }

  private async erase(repo: SessionsRepository, tx: Db, session: Session, force: boolean): Promise<SessionDeleted> {
    const children = await repo.count(repo.childrenOf(session.id), tx);
    if (children && !force) {
      throw new RelayError("SESSION_LINKED", `이어받은 세션 ${children}건이 이 세션에 연결되어 있습니다. --force를 주면 연결을 끊고 삭제합니다.`, 4, 409, { children });
    }
    const detached = children ? await repo.detachChildren(session.id, tx) : 0;
    await repo.remove(session.id, tx);
    return { schemaVersion: 1, session, deleted: true, detached };
  }

  /** 화면의 정리. Relay 내부 ID로 가리킨다. */
  act(userId: string, id: string, action: SessionAction): Promise<SessionChanged | SessionDeleted> {
    return this.write(userId, async (repo, tx) => {
      const session = await this.internal(repo, id, tx);
      switch (action.action) {
        case "status":
          if (session.status !== action.status) await repo.status(session.id, action.status, tx);
          return { schemaVersion: 1, session: { ...session, status: action.status } };
        case "pin":
          if (session.pinned !== action.pinned) await repo.pin(session.id, action.pinned, tx);
          return { schemaVersion: 1, session: { ...session, pinned: action.pinned } };
        case "end": {
          if (session.endedAt !== null) return { schemaVersion: 1, session };
          const ended = { ...session, endedAt: new Date().toISOString(), endReason: WEB_END_REASON };
          await repo.end(ended, tx);
          return { schemaVersion: 1, session: ended };
        }
        case "reopen": return { schemaVersion: 1, session: await this.reopen(repo, tx, session) };
        case "delete": return this.erase(repo, tx, session, action.force);
      }
    });
  }

  end(userId: string, target: ByProvider, reasonInput?: unknown): Promise<SessionEnded> {
    const reason = optionalText(reasonInput, "reason", 200);
    return this.write(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      const untouched = !session.pinned && (await repo.updateCount(session.id, tx)) === 1 && (await repo.firstSummary(session.id, tx)) === HOOK_SUMMARY &&
        (await repo.count(repo.childrenOf(session.id), tx)) === 0;
      if (untouched) {
        await repo.remove(session.id, tx);
        return { schemaVersion: 1, session, deleted: true };
      }
      session.endedAt = new Date().toISOString();
      session.endReason = reason;
      await repo.end(session, tx);
      return { schemaVersion: 1, session, deleted: false };
    });
  }

  private async detail(repo: SessionsRepository, tx: Db, session: Session): Promise<SessionDetail> {
    const children = await repo.rows(repo.childrenOf(session.id), 50, 0, true, tx);
    return { schemaVersion: 1, session,
      parentSession: session.parentSessionId ? brief(await this.internal(repo, session.parentSessionId, tx)) : null,
      children: children.map(brief),
      childrenPage: { limit: 50, offset: 0, total: await repo.count(repo.childrenOf(session.id), tx) } };
  }

  private async historyPage(repo: SessionsRepository, tx: Db, session: Session, page: { limit: number; offset: number }) {
    return { updates: await repo.updates(session.id, page.limit, page.offset, tx), updatesPage: { ...page, total: await repo.updateCount(session.id, tx) } };
  }

  private async lineage(repo: SessionsRepository, tx: Db, session: Session): Promise<{ items: ChainNode[]; truncated: boolean }> {
    const node = (s: Session, depth: number): ChainNode => ({ id: s.id, provider: s.provider, agent: s.agent,
      providerSessionId: s.providerSessionId, sessionName: s.sessionName, summary: s.summary, status: s.status, pinned: s.pinned,
      createdAt: s.createdAt, updatedAt: s.updatedAt, endedAt: s.endedAt, parentSessionId: s.parentSessionId, depth, current: s.id === session.id });
    const aboveIds = await this.ancestors(repo, tx, session);
    const above: Session[] = [];
    for (const id of aboveIds) { const s = await repo.byId(id, tx); if (s) above.push(s); }
    above.reverse();
    const items = above.map((s, depth) => node(s, depth));
    let truncated = false;
    const descend = async (parent: Session, depth: number) => {
      if (items.length >= CHAIN_LIMIT) { truncated = true; return; }
      items.push(node(parent, depth));
      const children = (await repo.rows(repo.childrenOf(parent.id), CHAIN_LIMIT, 0, true, tx)).reverse();
      for (const child of children) await descend(child, depth + 1);
    };
    await descend(session, above.length);
    return { items, truncated };
  }

  /** show: 상세(+이력). handoff·터미널 상세: packet(상세+이력+흐름). chain: 흐름. 한 요청으로 셋 중 하나를 고른다. */
  lookup(userId: string, target: ByProvider, options: { history?: unknown; chain?: unknown; limit?: unknown; offset?: unknown } = {}): Promise<SessionShown | SessionPacket | SessionChain> {
    const page = pagination(options);
    const history = flag(options.history, "history") ?? false;
    const chain = flag(options.chain, "chain") ?? false;
    return this.read(userId, async (repo, tx) => {
      const session = await this.resolve(repo, target.providerSessionId, target.provider, tx);
      if (chain && !history) return { schemaVersion: 1, session, ...(await this.lineage(repo, tx, session)) };
      const detail = await this.detail(repo, tx, session);
      if (!history) return detail;
      const pageData = await this.historyPage(repo, tx, session, page);
      if (!chain) return { ...detail, ...pageData };
      return { ...detail, ...pageData, chain: (await this.lineage(repo, tx, session)).items };
    });
  }

  chainById(userId: string, id: string): Promise<SessionChainById> {
    return this.read(userId, async (repo, tx) => {
      const session = await this.internal(repo, id, tx);
      return { schemaVersion: 1, sessionId: session.id, ...(await this.lineage(repo, tx, session)) };
    });
  }

  byId(userId: string, id: string): Promise<SessionDetail> {
    return this.read(userId, async (repo, tx) => this.detail(repo, tx, await this.internal(repo, id, tx)));
  }

  inspect(userId: string, id: string, input: { limit?: unknown; offset?: unknown } = {}): Promise<SessionPacket> {
    const page = pagination(input);
    return this.read(userId, async (repo, tx) => {
      const session = await this.internal(repo, id, tx);
      return { ...(await this.detail(repo, tx, session)), ...(await this.historyPage(repo, tx, session, page)), chain: (await this.lineage(repo, tx, session)).items };
    });
  }

  list(userId: string, filters: Filters = {}): Promise<SessionList> {
    const { limit, offset } = pagination(filters);
    const clauses: SQL[] = [];
    if (filters.provider !== undefined) clauses.push(eq(sessions.provider, identifier(filters.provider, "provider")));
    if (filters.agent !== undefined) clauses.push(eq(sessions.agent, identifier(filters.agent, "agent")));
    if (filters.cwd !== undefined) clauses.push(cwdEquals(directoryText(filters.cwd)));
    if (filters.status !== undefined) clauses.push(eq(sessions.status, sessionStatus(filters.status) as string));
    const pinned = flag(filters.pinned, "pinned");
    if (pinned !== undefined) clauses.push(eq(sessions.pinned, pinned));
    if (filters.device !== undefined) clauses.push(eq(sessions.deviceId, text(filters.device, "device", 100)));
    if (filters.q !== undefined) {
      const q = `%${text(filters.q, "query", 4000).replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(or(ilike(sessions.sessionName, q), ilike(sessions.id, q), ilike(sessions.providerSessionId, q), ilike(sessions.summary, q), ilike(sessions.workingDirectory, q))!);
    }
    const where = clauses.length ? and(...clauses) : undefined;
    return this.read(userId, async (repo, tx) => ({ schemaVersion: 1, items: await repo.rows(where, limit, offset, false, tx), page: { limit, offset, total: await repo.count(where, tx) } }));
  }

  latest(userId: string, alias: unknown, cwd?: unknown): Promise<SessionLatest> {
    if (typeof alias !== "string" || !Object.hasOwn(PROVIDERS, alias)) invalid(`사용법: relay latest ${ALIASES.join("|")} [--cwd <절대경로>] --json`);
    const mapping = PROVIDERS[alias as keyof typeof PROVIDERS];
    const scope = { cwd: cwd === undefined ? null : directoryText(cwd) };
    return this.read(userId, async (repo, tx) => {
      const clauses: SQL[] = [eq(sessions.provider, mapping.provider), eq(sessions.agent, mapping.agent)];
      if (scope.cwd !== null) clauses.push(cwdEquals(scope.cwd));
      const session = (await repo.rows(and(...clauses), 1, 0, false, tx))[0];
      if (!session) throw new RelayError("SESSION_NOT_FOUND", `${alias}의 Relay 기록이 없습니다. 조회 범위: ${scope.cwd ?? "전체 프로젝트"}. 다른 제공자로 대체하지 않습니다.`, 3, 404, { scope });
      return { ...(await this.detail(repo, tx, session)), scope };
    });
  }

  updates(userId: string, id: string, input: { limit?: unknown; offset?: unknown } = {}): Promise<SessionUpdates> {
    const page = pagination(input);
    return this.read(userId, async (repo, tx) => {
      await this.internal(repo, id, tx);
      return { schemaVersion: 1, sessionId: id, items: await repo.updates(id, page.limit, page.offset, tx), page: { ...page, total: await repo.updateCount(id, tx) } };
    });
  }

  children(userId: string, id: string, input: { limit?: unknown; offset?: unknown } = {}): Promise<SessionChildren> {
    const page = pagination(input);
    return this.read(userId, async (repo, tx) => {
      await this.internal(repo, id, tx);
      return { schemaVersion: 1, sessionId: id, items: (await repo.rows(repo.childrenOf(id), page.limit, page.offset, true, tx)).map(brief),
        page: { ...page, total: await repo.count(repo.childrenOf(id), tx) } };
    });
  }

  /** 유지 작업: 사용자별 보관 기간 정리. */
  async expireAll(now = Date.now()) {
    if (this.config.retentionDays <= 0) return 0;
    const cutoff = new Date(now - this.config.retentionDays * 86_400_000);
    const users = await this.db.select({ id: schema.users.id }).from(schema.users);
    let removed = 0;
    for (const user of users) {
      await this.db.transaction(async (tx) => {
        await lockUser(tx, user.id);
        const repo = this.repo(user.id, tx);
        let batch: number;
        while ((batch = await repo.deleteExpired(cutoff, null, tx)) > 0) removed += batch;
      });
    }
    return removed;
  }
}

/** Windows 경로(`C:/…`)는 대소문자를 가리지 않는다. 그 밖의 경로는 그대로 비교한다. */
function cwdEquals(cwd: string): SQL {
  return /^[A-Za-z]:\//.test(cwd) ? sql`lower(${sessions.workingDirectory}) = lower(${cwd})` : eq(sessions.workingDirectory, cwd);
}
