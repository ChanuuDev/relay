import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { MAX_HISTORY, type Calculation, type CalculationApplied, type CalculationList, type HistoryAction } from "@relay/core";
import { DB, lockUser, schema, type Db } from "../db/database.js";

const { calculations } = schema;

/** 사용자별 계산기 이력. 최근 MAX_HISTORY건만 남긴다. */
@Injectable()
export class CalculatorService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(userId: string): Promise<CalculationList> {
    const rows = await this.db.select().from(calculations).where(eq(calculations.userId, userId)).orderBy(desc(calculations.createdAt), desc(calculations.id));
    return { schemaVersion: 1, items: rows.map((row): Calculation => ({ id: row.id, expression: row.expression, result: row.result, createdAt: row.createdAt })) };
  }

  async apply(userId: string, change: HistoryAction): Promise<CalculationApplied> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      if (change.action === "add") {
        const { id, expression, result, createdAt } = change.item;
        const inserted = await tx.insert(calculations).values({ id, userId, expression, result, createdAt }).onConflictDoNothing().returning({ id: calculations.id });
        await this.trim(userId, tx);
        return { schemaVersion: 1 as const, added: inserted.length > 0 };
      }
      const deleted = change.action === "delete"
        ? await tx.delete(calculations).where(and(eq(calculations.userId, userId), eq(calculations.id, change.id))).returning({ id: calculations.id })
        : await tx.delete(calculations).where(eq(calculations.userId, userId)).returning({ id: calculations.id });
      return { schemaVersion: 1 as const, deleted: deleted.length };
    });
  }

  /** 넘친 만큼 오래된 것부터 지운다. 가져오기도 쓴다. */
  async trim(userId: string, tx: Db = this.db) {
    const keep = tx.select({ id: calculations.id }).from(calculations).where(eq(calculations.userId, userId))
      .orderBy(desc(calculations.createdAt), desc(calculations.id)).limit(MAX_HISTORY);
    await tx.delete(calculations).where(and(eq(calculations.userId, userId), notInArray(calculations.id, keep)));
  }
}
