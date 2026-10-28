import type { Database } from "bun:sqlite";
import { RelayError, storageError } from "../errors";

/** 끝낸 계산 하나. 식과 결과는 화면에 보인 그대로(천 단위 구분, × ÷ − 기호) 남긴다. */
export type Calculation = { id: string; expression: string; result: string; createdAt: number };
/** 화면이 보내는 이력 변경 한 건. add는 같은 id를 다시 보내도 한 번만 남는다(보내지 못해 다시 보낸 경우). */
export type HistoryAction = { action: "add"; item: Calculation } | { action: "delete"; id: string } | { action: "clear" };

/** 남기는 계산 수. 넘으면 오래된 것부터 지운다. */
export const MAX_HISTORY = 500;
export const MAX_EXPRESSION = 1000;
export const MAX_RESULT = 100;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

type Row = { id: string; expression: string; result: string; created_at: number };

const invalid = (message: string): never => { throw new RelayError("INVALID_ARGUMENT", message); };
const id = (value: unknown, field: string) => (typeof value === "string" && ID.test(value) ? value : invalid(`${field}이(가) 올바르지 않습니다.`));
const text = (value: unknown, max: number, field: string) => {
  if (typeof value !== "string" || !value.trim()) return invalid(`${field}은(는) 비어 있지 않은 문자열이어야 합니다.`);
  if (value.length > max) return invalid(`${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};

/** 화면이 보낸 변경을 검사해 모양을 고정한다. 동작마다 받는 키가 정해져 있고, 틀리면 아무것도 쓰지 않고 거부한다. */
export function parseHistoryAction(raw: unknown, now = Date.now()): HistoryAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("본문은 { action } 객체여야 합니다.");
  const value = raw as Record<string, unknown>;
  const only = (...keys: string[]) => {
    for (const key of Object.keys(value)) if (key !== "action" && !keys.includes(key)) invalid(`허용하지 않는 키: ${key}`);
  };
  switch (value.action) {
    case "add": {
      only("item");
      const item = value.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) return invalid("item은 객체여야 합니다.");
      const entry = item as Record<string, unknown>;
      for (const key of Object.keys(entry)) if (!["id", "expression", "result", "createdAt"].includes(key)) invalid(`허용하지 않는 키: item.${key}`);
      const createdAt = typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) && entry.createdAt >= 0 ? Math.floor(entry.createdAt) : now;
      return { action: "add", item: { id: id(entry.id, "item.id"), expression: text(entry.expression, MAX_EXPRESSION, "식"), result: text(entry.result, MAX_RESULT, "결과"), createdAt } };
    }
    case "delete":
      only("id");
      return { action: "delete", id: id(value.id, "id") };
    case "clear":
      only();
      return { action: "clear" };
    default:
      return invalid("action: add | delete | clear 중 하나를 입력하세요.");
  }
}

/** 계산기 이력. 세션·메모와 같은 Relay 저장소(relay.db)의 calculations 표에 둔다. */
export class CalculatorStore {
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

  /** 최근 계산부터 전부(최대 MAX_HISTORY건). */
  list() {
    return this.run(false, () => ({ schemaVersion: 1 as const, items: this.db.query<Row, []>(
      "SELECT id, expression, result, created_at FROM calculations ORDER BY created_at DESC, id DESC").all().map((row): Calculation =>
      ({ id: row.id, expression: row.expression, result: row.result, createdAt: row.created_at })) }));
  }

  apply(change: HistoryAction) {
    return this.run(true, () => {
      if (change.action === "add") {
        const { id: key, expression, result, createdAt } = change.item;
        const added = this.db.query("INSERT OR IGNORE INTO calculations (id, expression, result, created_at) VALUES (?, ?, ?, ?)")
          .run(key, expression, result, createdAt).changes;
        // 넘친 만큼 오래된 것부터 지운다.
        this.db.query(`DELETE FROM calculations WHERE id IN (SELECT id FROM calculations ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)`).run(MAX_HISTORY);
        return { schemaVersion: 1 as const, added: added > 0 };
      }
      const deleted = change.action === "delete"
        ? this.db.query("DELETE FROM calculations WHERE id = ?").run(change.id).changes
        : this.db.query("DELETE FROM calculations").run().changes;
      return { schemaVersion: 1 as const, deleted };
    });
  }
}
