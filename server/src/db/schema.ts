import { sql } from "drizzle-orm";
import { bigint, boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** 1인 모델: 부트스트랩 때 기본 사용자 1행. 계정 기능은 나중에 여기에 붙는다. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: stamp("created_at").notNull().defaultNow(),
});

/** 기기별 API 토큰. 원문은 저장하지 않고 sha256 해시만 둔다. */
export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: stamp("created_at").notNull().defaultNow(),
  lastUsedAt: stamp("last_used_at"),
  revokedAt: stamp("revoked_at"),
}, (t) => [uniqueIndex("api_tokens_hash_idx").on(t.tokenHash)]);

/** 원격 저장소에 기록을 남기는 PC. */
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenId: text("token_id").references(() => apiTokens.id),
  name: text("name").notNull(),
  platform: text("platform"),
  createdAt: stamp("created_at").notNull().defaultNow(),
  lastSeenAt: stamp("last_seen_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  deviceId: text("device_id").references(() => devices.id),
  provider: text("provider").notNull(),
  agent: text("agent").notNull(),
  providerSessionId: text("provider_session_id").notNull(),
  sessionName: text("session_name"),
  model: text("model"),
  workingDirectory: text("working_directory").notNull(),
  summary: text("summary").notNull(),
  parentSessionId: text("parent_session_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: stamp("created_at").notNull(),
  updatedAt: stamp("updated_at").notNull(),
  endedAt: stamp("ended_at"),
  endReason: text("end_reason"),
  status: text("status"),
  pinned: boolean("pinned").notNull().default(false),
}, (t) => [
  uniqueIndex("sessions_user_provider_idx").on(t.userId, t.provider, t.providerSessionId),
  index("sessions_user_updated_idx").on(t.userId, t.updatedAt, t.id),
  index("sessions_parent_idx").on(t.parentSessionId),
  check("sessions_status_check", sql`${t.status} IS NULL OR ${t.status} IN ('working', 'blocked', 'handoff', 'done')`),
  check("sessions_parent_check", sql`${t.parentSessionId} IS NULL OR ${t.parentSessionId} <> ${t.id}`),
]);

export const sessionUpdates = pgTable("session_updates", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  summary: text("summary").notNull(),
  status: text("status"),
  createdAt: stamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("session_updates_sequence_idx").on(t.sessionId, t.sequence),
  check("session_updates_sequence_check", sql`${t.sequence} > 0`),
  check("session_updates_status_check", sql`${t.status} IS NULL OR ${t.status} IN ('working', 'blocked', 'handoff', 'done')`),
]);

/** 메모 시각은 화면이 ms 정수로 비교하므로 bigint로 둔다. */
export const notes = pgTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  parentId: text("parent_id"),
  name: text("name").notNull().default(""),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  revision: integer("revision").notNull(),
  position: doublePrecision("position"),
}, (t) => [
  index("notes_user_parent_idx").on(t.userId, t.parentId),
  check("notes_kind_check", sql`${t.kind} IN ('folder', 'note')`),
  check("notes_parent_check", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
]);

export const notesMeta = pgTable("notes_meta", {
  userId: text("user_id").primaryKey().references(() => users.id),
  revision: integer("revision").notNull().default(0),
});

export const calculations = pgTable("calculations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expression: text("expression").notNull(),
  result: text("result").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [index("calculations_user_created_idx").on(t.userId, t.createdAt, t.id)]);

/** outbox 재전송이 같은 쓰기를 두 번 하지 않도록 첫 응답을 24시간 보관한다. */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  status: integer("status").notNull(),
  body: jsonb("body").$type<unknown>().notNull(),
  createdAt: stamp("created_at").notNull().defaultNow(),
});
