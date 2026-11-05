import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { RelayError, optionalText, text, type DeviceInfo, type DeviceList, type DeviceRegistered } from "@relay/core";
import { DB, iso, schema, type Db } from "../db/database.js";

@Injectable()
export class DevicesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * 연결 테스트가 부른다. 같은 토큰으로 같은 이름을 다시 등록하면 기존 기기를 돌려주고(마지막 접속만 갱신),
   * 아니면 새 기기를 만든다. 기기 id는 PC의 config.json에 남아 이후 요청의 X-Relay-Device가 된다.
   */
  async register(userId: string, tokenId: string, body: unknown): Promise<DeviceRegistered> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ name, platform? } JSON을 보내세요.");
    const { name: rawName, platform: rawPlatform, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
    const name = text(rawName, "name", 100).trim();
    const platform = optionalText(rawPlatform, "platform", 40);
    const now = new Date();
    const [existing] = await this.db.select().from(schema.devices)
      .where(and(eq(schema.devices.userId, userId), eq(schema.devices.tokenId, tokenId), eq(schema.devices.name, name))).limit(1);
    if (existing) {
      const [row] = await this.db.update(schema.devices).set({ lastSeenAt: now, platform: platform ?? existing.platform }).where(eq(schema.devices.id, existing.id)).returning();
      return { schemaVersion: 1, device: DevicesService.toInfo(row), created: false };
    }
    const [row] = await this.db.insert(schema.devices).values({ id: `dev_${randomUUID()}`, userId, tokenId, name, platform, lastSeenAt: now }).returning();
    return { schemaVersion: 1, device: DevicesService.toInfo(row), created: true };
  }

  async list(userId: string): Promise<DeviceList> {
    const rows = await this.db.select().from(schema.devices).where(eq(schema.devices.userId, userId)).orderBy(desc(schema.devices.createdAt));
    return { schemaVersion: 1, items: rows.map(DevicesService.toInfo) };
  }

  /** 기록이 들어올 때 기기의 마지막 접속 시각을 띄엄띄엄 갱신한다. */
  async touch(deviceId: string | null) {
    if (!deviceId) return;
    try { await this.db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, deviceId)); } catch { /* 부수 정보 */ }
  }

  private static toInfo(row: typeof schema.devices.$inferSelect): DeviceInfo {
    return { id: row.id, name: row.name, platform: row.platform, createdAt: row.createdAt.toISOString(), lastSeenAt: iso(row.lastSeenAt) };
  }
}
