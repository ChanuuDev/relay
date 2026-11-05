import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import type { Response } from "express";
import { IDEMPOTENCY_HEADER, RelayError } from "@relay/core";
import { from, of, tap, switchMap, type Observable } from "rxjs";
import { DB, schema, type Db } from "../db/database.js";
import type { AuthedRequest } from "./decorators.js";

const KEY = /^[A-Za-z0-9_-]{8,128}$/;
/** 같은 키의 첫 응답을 보관하는 시간. outbox 재전송은 길어야 며칠이지만 표는 하루면 충분하다. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 쓰기 요청이 `Idempotency-Key`를 가져오면 같은 사용자의 같은 키로 보관된 첫 응답을 그대로 돌려준다.
 * 성공(2xx)만 보관하므로, 실패한 요청은 다시 시도하면 다시 실행된다.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const auth = request.relayAuth;
    if (!auth || typeof raw !== "string" || !raw || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next.handle();
    if (!KEY.test(raw)) throw new RelayError("INVALID_ARGUMENT", "Idempotency-Key는 8~128자의 영문·숫자·-_ 이어야 합니다.");
    const key = `${auth.userId}:${raw}`;
    return from(this.db.select({ status: schema.idempotencyKeys.status, body: schema.idempotencyKeys.body }).from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.key, key)).limit(1)).pipe(switchMap((rows) => {
        const stored = rows[0];
        if (stored) {
          response.status(stored.status);
          response.setHeader("Idempotent-Replayed", "true");
          return of(stored.body);
        }
        return next.handle().pipe(tap({ next: (body) => {
          const status = response.statusCode;
          if (status < 200 || status >= 300 || body === undefined) return;
          void this.remember(key, auth.userId, status, body);
        } }));
      }));
  }

  private async remember(key: string, userId: string, status: number, body: unknown) {
    try {
      await this.db.insert(schema.idempotencyKeys).values({ key, userId, status, body }).onConflictDoNothing();
    } catch { /* 보관에 실패해도 응답은 이미 나갔다. 다음 재전송은 다시 실행된다. */ }
  }

  /** 하루 지난 키를 비운다(유지 작업이 부른다). */
  static async purge(db: Db, now = Date.now()) {
    await db.delete(schema.idempotencyKeys).where(and(lt(schema.idempotencyKeys.createdAt, new Date(now - IDEMPOTENCY_TTL_MS))));
  }
}
