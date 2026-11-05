import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  RelayError, gitClue, identifier, integer, invalid, optionalText, parseNoteItem, sessionStatus, text, directoryText,
  type ImportCalculationRow, type ImportRequest, type ImportResult, type ImportSessionRow, type ImportUpdateRow, type Session, type SessionUpdate,
} from "@relay/core";
import { CalculatorService } from "../calculator/calculator.service.js";
import { DB, lockUser, schema, type Db } from "../db/database.js";
import { NotesService } from "../notes/notes.service.js";
import { SessionsRepository } from "../sessions/sessions.repository.js";

/** 한 요청에 받는 행 수. 전환 마법사는 1,000행씩 나눠 보낸다. */
export const MAX_IMPORT_ROWS = 5000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

const timeText = (value: unknown, field: string) => {
  const raw = text(value, field, 64);
  if (Number.isNaN(Date.parse(raw))) invalid(`${field}: ISO 8601 시각이어야 합니다.`);
  return new Date(raw).toISOString();
};
const ms = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid(`${field}: 0 이상의 ms 정수여야 합니다.`);
  return Math.floor(value);
};
const rowId = (value: unknown, field: string) => {
  if (typeof value !== "string" || !ID.test(value)) invalid(`${field}이(가) 올바르지 않습니다.`);
  return value;
};

function parseSessionRow(raw: unknown, index: number): Session {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`sessions[${index}]는 객체여야 합니다.`);
  const r = raw as Record<string, unknown>;
  const field = (name: string) => `sessions[${index}].${name}`;
  const compaction = r.compaction === null || r.compaction === undefined ? null : (() => {
    const c = r.compaction as Record<string, unknown>;
    if (!c || typeof c !== "object") invalid(`${field("compaction")}: 객체여야 합니다.`);
    return { count: integer(c.count, field("compaction.count"), 0, 0, 1_000_000), lastAt: timeText(c.lastAt, field("compaction.lastAt")), trigger: optionalText(c.trigger, field("compaction.trigger"), 40) };
  })();
  return {
    id: rowId(r.id, field("id")), provider: identifier(r.provider, field("provider")), agent: identifier(r.agent, field("agent")),
    providerSessionId: text(r.providerSessionId, field("providerSessionId"), 256), sessionName: optionalText(r.sessionName, field("sessionName"), 200),
    model: optionalText(r.model, field("model"), 200), workingDirectory: directoryText(r.workingDirectory), summary: text(r.summary, field("summary"), 4000, true),
    parentSessionId: r.parentSessionId === null || r.parentSessionId === undefined ? null : rowId(r.parentSessionId, field("parentSessionId")),
    createdAt: timeText(r.createdAt, field("createdAt")), updatedAt: timeText(r.updatedAt, field("updatedAt")),
    endedAt: r.endedAt === null || r.endedAt === undefined ? null : timeText(r.endedAt, field("endedAt")), endReason: optionalText(r.endReason, field("endReason"), 200),
    status: sessionStatus(r.status), pinned: r.pinned === true, git: gitClue(r.git), compaction,
  };
}

function parseUpdateRow(raw: unknown, index: number): SessionUpdate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`updates[${index}]는 객체여야 합니다.`);
  const r = raw as Record<string, unknown>;
  const field = (name: string) => `updates[${index}].${name}`;
  return { id: rowId(r.id, field("id")), sessionId: rowId(r.sessionId, field("sessionId")), sequence: integer(r.sequence, field("sequence"), 1, 1, 1_000_000),
    summary: text(r.summary, field("summary"), 4000, true), status: sessionStatus(r.status), createdAt: timeText(r.createdAt, field("createdAt")) };
}

function parseCalculationRow(raw: unknown, index: number): ImportCalculationRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`calculations[${index}]는 객체여야 합니다.`);
  const r = raw as Record<string, unknown>;
  const field = (name: string) => `calculations[${index}].${name}`;
  return { id: rowId(r.id, field("id")), expression: text(r.expression, field("expression"), 1000), result: text(r.result, field("result"), 100), createdAt: ms(r.createdAt, field("createdAt")) };
}

/** 로컬 SQLite 전체를 올리는 이전. id 기준 멱등 upsert라 같은 묶음을 두 번 보내도 결과가 같다. */
@Injectable()
export class ImportService {
  constructor(@Inject(DB) private readonly db: Db, private readonly notes: NotesService, private readonly calculator: CalculatorService) {}

  parse(body: unknown): { sessions: Session[]; updates: SessionUpdate[]; notes: ReturnType<typeof parseNoteItem>[]; calculations: ImportCalculationRow[] } {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ sessions?, updates?, notes?, calculations? } JSON을 보내세요.");
    const value = body as ImportRequest & Record<string, unknown>;
    for (const key of Object.keys(value)) if (!["sessions", "updates", "notes", "calculations"].includes(key)) invalid(`허용하지 않는 키: ${key}`);
    const list = (name: string, raw: unknown): unknown[] => {
      if (raw === undefined) return [];
      if (!Array.isArray(raw)) invalid(`${name}는 배열이어야 합니다.`);
      if (raw.length > MAX_IMPORT_ROWS) invalid(`${name}는 한 번에 ${MAX_IMPORT_ROWS}행까지 보냅니다.`);
      return raw;
    };
    const now = Date.now();
    return {
      sessions: list("sessions", value.sessions).map(parseSessionRow),
      updates: list("updates", value.updates).map(parseUpdateRow),
      notes: list("notes", value.notes).map((item, index) => parseNoteItem(item, `notes[${index}]`, now)),
      calculations: list("calculations", value.calculations).map(parseCalculationRow),
    };
  }

  async run(userId: string, deviceId: string | null, body: unknown): Promise<ImportResult> {
    const input = this.parse(body);
    const result: ImportResult = { schemaVersion: 1, sessions: { added: 0, updated: 0, kept: 0 }, updates: { added: 0, kept: 0 },
      notes: { added: 0, updated: 0, kept: 0 }, calculations: { added: 0, kept: 0 } };
    await this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const repo = new SessionsRepository(tx, userId);
      // 1) 세션은 부모 없이 먼저 넣고, 2) 부모가 (이 묶음이나 저장소에) 있으면 연결한다. 같은 (provider, providerSessionId)가 다른 id로 있으면 그쪽을 둔다.
      const linked: Session[] = [];
      for (const session of input.sessions) {
        const existing = await repo.byId(session.id, tx);
        if (existing) {
          if (Date.parse(session.updatedAt) > Date.parse(existing.updatedAt)) {
            await tx.update(schema.sessions).set({ sessionName: session.sessionName, model: session.model, summary: session.summary, updatedAt: new Date(session.updatedAt),
              endedAt: session.endedAt ? new Date(session.endedAt) : null, endReason: session.endReason, status: session.status, pinned: session.pinned,
              metadata: { ...(session.git ? { git: session.git } : {}), ...(session.compaction ? { compaction: session.compaction } : {}) } })
              .where(eq(schema.sessions.id, session.id));
            result.sessions.updated++;
          } else result.sessions.kept++;
          if (session.parentSessionId && existing.parentSessionId === null) linked.push(session);
          continue;
        }
        const clash = await repo.byProviderId(session.providerSessionId, session.provider, tx);
        if (clash.length) { result.sessions.kept++; continue; }
        await tx.insert(schema.sessions).values({ id: session.id, userId, deviceId, provider: session.provider, agent: session.agent, providerSessionId: session.providerSessionId,
          sessionName: session.sessionName, model: session.model, workingDirectory: session.workingDirectory, summary: session.summary, parentSessionId: null,
          metadata: { ...(session.git ? { git: session.git } : {}), ...(session.compaction ? { compaction: session.compaction } : {}) },
          createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt), endedAt: session.endedAt ? new Date(session.endedAt) : null,
          endReason: session.endReason, status: session.status, pinned: session.pinned });
        result.sessions.added++;
        if (session.parentSessionId) linked.push(session);
      }
      for (const session of linked) {
        if (session.parentSessionId === session.id) continue;
        const parent = await repo.byId(session.parentSessionId!, tx);
        if (parent) await tx.update(schema.sessions).set({ parentSessionId: parent.id }).where(eq(schema.sessions.id, session.id));
      }
      for (const update of input.updates) {
        const owner = await repo.byId(update.sessionId, tx);
        if (!owner) { result.updates.kept++; continue; }
        if (await repo.insertUpdateIfAbsent(update, tx)) result.updates.added++; else result.updates.kept++;
      }
      for (const row of input.calculations) {
        const inserted = await tx.insert(schema.calculations).values({ id: row.id, userId, expression: row.expression, result: row.result, createdAt: row.createdAt })
          .onConflictDoNothing().returning({ id: schema.calculations.id });
        if (inserted.length) result.calculations.added++; else result.calculations.kept++;
      }
      if (input.calculations.length) await this.calculator.trim(userId, tx);
    });
    if (input.notes.length) {
      const merged = await this.notes.merge(userId, input.notes);
      result.notes = { added: merged.added, updated: merged.updated, kept: merged.kept };
    }
    return result;
  }
}

export type { ImportSessionRow, ImportUpdateRow };
