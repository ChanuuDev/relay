import type { Database } from "bun:sqlite";
import { MAX_HISTORY, RelayError, type Calculation, type HistoryAction } from "@relay/core";
import { storageError } from "../errors";

// 계산 항목의 모양·검사는 원격 서버와 같이 쓰므로 공용 코어에 있다. 여기에는 SQLite 저장소만 남긴다.
export { MAX_EXPRESSION, MAX_HISTORY, MAX_RESULT, parseHistoryAction, type Calculation, type HistoryAction } from "@relay/core";

type Row = { id: string; expression: string; result: string; created_at: number };

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
