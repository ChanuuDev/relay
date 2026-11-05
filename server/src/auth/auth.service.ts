import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { RelayError, text, type WhoAmI } from "@relay/core";
import { DB, iso, schema, type Db } from "../db/database.js";

export interface TokenInfo { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** 마지막 사용 시각은 토큰마다 1분에 한 번만 쓴다(훅이 초 단위로 부르므로). */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class AuthService {
  private touched = new Map<string, number>();
  constructor(@Inject(DB) private readonly db: Db) {}

  static hash(token: string) { return createHash("sha256").update(token, "utf8").digest("hex"); }

  /** 토큰 원문은 32바이트 난수의 base64url이다. 서버는 해시만 둔다. */
  async createToken(userId: string, nameInput: unknown): Promise<{ token: string; info: TokenInfo }> {
    const name = text(nameInput, "name", 100);
    const token = randomBytes(32).toString("base64url");
    const id = `tok_${randomUUID()}`;
    const [row] = await this.db.insert(schema.apiTokens).values({ id, userId, name, tokenHash: AuthService.hash(token) }).returning();
    return { token, info: AuthService.toInfo(row) };
  }

  async listTokens(userId: string): Promise<TokenInfo[]> {
    const rows = await this.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, userId)).orderBy(desc(schema.apiTokens.createdAt));
    return rows.map(AuthService.toInfo);
  }

  async revokeToken(userId: string, id: string): Promise<TokenInfo> {
    const [row] = await this.db.update(schema.apiTokens).set({ revokedAt: new Date() })
      .where(and(eq(schema.apiTokens.id, text(id, "id", 100)), eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt))).returning();
    if (!row) throw new RelayError("NOT_FOUND", "토큰이 없거나 이미 폐기되었습니다.", 3, 404);
    return AuthService.toInfo(row);
  }

  /** 가드가 부른다. 폐기되지 않은 토큰이면 사용자·토큰 id를 돌려주고 마지막 사용 시각을 띄엄띄엄 갱신한다. */
  async verify(token: string): Promise<{ userId: string; tokenId: string } | null> {
    const [row] = await this.db.select({ id: schema.apiTokens.id, userId: schema.apiTokens.userId })
      .from(schema.apiTokens).where(and(eq(schema.apiTokens.tokenHash, AuthService.hash(token)), isNull(schema.apiTokens.revokedAt))).limit(1);
    if (!row) return null;
    const now = Date.now();
    if ((this.touched.get(row.id) ?? 0) + TOUCH_INTERVAL_MS < now) {
      this.touched.set(row.id, now);
      void this.db.update(schema.apiTokens).set({ lastUsedAt: new Date(now) }).where(eq(schema.apiTokens.id, row.id)).catch(() => {});
    }
    return { userId: row.userId, tokenId: row.id };
  }

  async deviceBelongs(userId: string, deviceId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.devices.id }).from(schema.devices)
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId))).limit(1);
    return Boolean(row);
  }

  async whoami(userId: string, tokenId: string): Promise<WhoAmI> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const [token] = await this.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, tokenId)).limit(1);
    if (!user || !token) throw new RelayError("UNAUTHORIZED", "토큰이 올바르지 않습니다.", 7, 401);
    return { schemaVersion: 1, user: { id: user.id, name: user.name },
      token: { id: token.id, name: token.name, createdAt: token.createdAt.toISOString(), lastUsedAt: iso(token.lastUsedAt) } };
  }

  /** 첫 실행: 사용자가 없으면 기본 사용자를 만든다. 있으면 그대로 둔다. */
  async bootstrap(name: string): Promise<{ id: string; name: string; created: boolean }> {
    const [existing] = await this.db.select().from(schema.users).orderBy(schema.users.createdAt).limit(1);
    if (existing) return { id: existing.id, name: existing.name, created: false };
    const id = `usr_${randomUUID()}`;
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id, name: text(name, "name", 100) });
      await tx.insert(schema.notesMeta).values({ userId: id, revision: 0 });
    });
    return { id, name, created: true };
  }

  /** 단일 사용자 모델: 가장 먼저 만든 사용자. CLI가 토큰을 만들 때 쓴다. */
  async defaultUser(): Promise<{ id: string; name: string } | null> {
    const [row] = await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(schema.users.createdAt).limit(1);
    return row ?? null;
  }

  private static toInfo(row: typeof schema.apiTokens.$inferSelect): TokenInfo {
    return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: iso(row.lastUsedAt), revokedAt: iso(row.revokedAt) };
  }
}
