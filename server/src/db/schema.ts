import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** node-postgres는 Buffer, PGlite는 Uint8Array로 돌려준다. 둘 다 Uint8Array로 다룬다. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

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

/** 메모에 붙인 그림. id는 내용의 sha256이며, 사용자마다 따로 둔다. 본문은 /api/v1/notes/images/<id>로 가리킨다. */
export const noteImages = pgTable("note_images", {
  userId: text("user_id").notNull().references(() => users.id),
  id: text("id").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.id] }),
  check("note_images_id_check", sql`length(${t.id}) = 64`),
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

/** 일정 관리 Task. 업무 보드는 board·status·position으로 칸과 순서를 읽는다. 시각은 화면이 ms 정수로 비교하므로 bigint다. */
export const tasks = pgTable("tasks", {
  userId: text("user_id").notNull().references(() => users.id),
  id: text("id").notNull(),
  title: text("title").notNull().default(""),
  project: text("project").notNull().default(""),
  memo: text("memo").notNull().default(""),
  provider: text("provider"),
  status: text("status").notNull(),
  board: boolean("board").notNull().default(false),
  position: doublePrecision("position"),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  completedAt: bigint("completed_at", { mode: "number" }),
  revision: integer("revision").notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.id] }),
  check("tasks_status_check", sql`${t.status} IN ('todo', 'doing', 'review', 'done')`),
  check("tasks_provider_check", sql`${t.provider} IS NULL OR ${t.provider} IN ('anthropic', 'openai', 'xai', 'cursor')`),
]);

/** 캘린더 일정. start·end는 종일이면 YYYY-MM-DD, 아니면 시간대 없는 YYYY-MM-DDTHH:MM이라 글자 순서가 시간 순서다. */
export const calendarEvents = pgTable("calendar_events", {
  userId: text("user_id").notNull().references(() => users.id),
  id: text("id").notNull(),
  title: text("title").notNull().default(""),
  allDay: boolean("all_day").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  memo: text("memo").notNull().default(""),
  color: text("color").notNull(),
  attachments: jsonb("attachments").$type<Array<{ kind: "note" | "task"; id: string }>>().notNull().default([]),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  revision: integer("revision").notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.id] }),
  index("calendar_events_user_start_idx").on(t.userId, t.startAt),
  check("calendar_events_range_check", sql`${t.endAt} >= ${t.startAt}`),
]);

export const plannerMeta = pgTable("planner_meta", {
  userId: text("user_id").primaryKey().references(() => users.id),
  revision: integer("revision").notNull().default(0),
});

/** 공휴일 공공 API(한국천문연구원 특일 정보)로 받아 둔 해. 매일 서울 00:00에 올해·내년을 다시 받는다. 사용자와 무관하다. */
export const holidayYears = pgTable("holiday_years", {
  year: integer("year").primaryKey(),
  items: jsonb("items").$type<Array<{ date: string; name: string; kind: "holiday" | "substitute" | "temporary"; of?: string }>>().notNull(),
  syncedAt: stamp("synced_at").notNull(),
});

/** 잔디용 기록 로그. session_updates에 에이전트 기록이 들어올 때 트리거가 남기며, 세션이 보관 기간으로 지워져도 남는다. */
export const activityLog = pgTable("activity_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  provider: text("provider").notNull(),
  agent: text("agent").notNull(),
  createdAt: stamp("created_at").notNull(),
}, (t) => [index("activity_log_user_created_idx").on(t.userId, t.createdAt)]);
