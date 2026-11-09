import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { activityStreaks, bucketActivity, dayKey, isDate, isDateTime, parseActivityQuery, parseEvent, parseTask, placeOnBoard, removeFromBoard, type Task } from "@relay/core";
import { handler } from "../src/web/server";
import { loadConfig } from "../src/config";
import { DB_VERSION, openDatabase } from "../src/db/database";
import { HOOK_SUMMARY } from "../src/session/session.service";
import { PlannerStore } from "../src/planner/planner.store";
import { cleanup, fixture, input, temporary } from "./helpers";
import v8Schema from "../src/db/migrations/008_init.sql" with { type: "text" };
import v9Schema from "../src/db/migrations/009_init.sql" with { type: "text" };

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, project: "", memo: "", provider: null, status: "todo", board: false, position: null, notes: [],
  createdAt: 1, updatedAt: 1, completedAt: null, ...extra });

describe("일정 관리 공용 규칙", () => {
  test("날짜·시각은 달력에 있는 값만 받는다", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDateTime("2026-11-09T23:59")).toBe(true);
    expect(isDateTime("2026-11-09T24:00")).toBe(false);
    expect(isDateTime("2026-11-09")).toBe(false);
  });

  test("Task: 모르는 키는 버리고, 첨부 메모 중복을 없애고, 완료 시각은 상태를 따른다", () => {
    const parsed = parseTask({ id: "a", title: "할 일", status: "done", notes: ["m1", "m1", "m2"], updatedAt: 50, extra: true }, "t", 99);
    expect(parsed).toEqual({ id: "a", title: "할 일", project: "", memo: "", provider: null, status: "done", board: false, position: null, notes: ["m1", "m2"],
      createdAt: 99, updatedAt: 50, completedAt: 50 });
    expect(parseTask({ id: "a", status: "doing", completedAt: 5 }, "t", 1).completedAt).toBeNull();
    expect(() => parseTask({ id: "a", provider: "google" }, "t", 1)).toThrow("provider");
    expect(() => parseTask({ id: "a", title: "x".repeat(201) }, "t", 1)).toThrow("너무 깁니다");
    expect(() => parseTask({ id: "bad id" }, "t", 1)).toThrow("올바르지 않습니다");
  });

  test("일정: 종일은 날짜, 시간 일정은 시각이고 끝이 시작보다 앞이면 거부한다", () => {
    expect(parseEvent({ id: "e", allDay: true, start: "2026-11-09", end: "2026-11-10" }, "e", 1)).toMatchObject({ color: "blue", attachments: [], title: "" });
    expect(() => parseEvent({ id: "e", allDay: true, start: "2026-11-09T10:00", end: "2026-11-09T11:00" }, "e", 1)).toThrow("YYYY-MM-DD");
    expect(() => parseEvent({ id: "e", allDay: false, start: "2026-11-09T11:00", end: "2026-11-09T10:00" }, "e", 1)).toThrow("앞일 수 없습니다");
    expect(() => parseEvent({ id: "e", allDay: false, start: "2026-11-09T10:00", end: "2026-11-09T11:00", color: "pink" }, "e", 1)).toThrow("color");
    const attached = parseEvent({ id: "e", allDay: true, start: "2026-11-09", end: "2026-11-09", attachments: [{ kind: "note", id: "n" }, { kind: "task", id: "n" }, { kind: "note", id: "n" }] }, "e", 1);
    expect(attached.attachments).toEqual([{ kind: "note", id: "n" }, { kind: "task", id: "n" }]);
  });

  test("보드: 사이에 끼우면 중간값, 틈이 없거나 순서 없는 카드가 섞이면 칸을 다시 매긴다", () => {
    const tasks = [task("a", { board: true, status: "doing", position: 1 }), task("b", { board: true, status: "doing", position: 2 }), task("c")];
    const [placed] = placeOnBoard(tasks, "c", "doing", 1, 10);
    expect(placed).toMatchObject({ id: "c", board: true, status: "doing", position: 1.5, updatedAt: 10 });
    expect(placeOnBoard(tasks, "c", "doing", 0, 10)[0]!.position).toBe(0);
    expect(placeOnBoard(tasks, "c", "doing", null, 10)[0]!.position).toBe(3);
    const tight = [task("a", { board: true, position: 1 }), task("b", { board: true, position: 1 + 1e-9 }), task("c")];
    expect(placeOnBoard(tight, "c", "todo", 1, 10).map((item) => `${item.id}:${item.position}`)).toEqual(["c:2", "b:3"]);
    const unordered = [task("a", { board: true }), task("c")];
    expect(placeOnBoard(unordered, "c", "todo", 0, 10).map((item) => `${item.id}:${item.position}`)).toEqual(["c:1", "a:2"]);
    // 완료 칸에 놓으면 완료 시각을 남기고, 다시 빼면 지운다. 완료를 보드에서 내리면 할 일로 돌아간다.
    const done = placeOnBoard(tasks, "a", "done", null, 20)[0]!;
    expect(done).toMatchObject({ status: "done", completedAt: 20 });
    expect(placeOnBoard([done], "a", "review", null, 30)[0]).toMatchObject({ status: "review", completedAt: null });
    expect(removeFromBoard([done], "a", 40)[0]).toMatchObject({ board: false, position: null, status: "todo", completedAt: null });
    expect(() => placeOnBoard(tasks, "zzz", "todo", null)).toThrow("Task가 없습니다");
  });

  test("잔디: 시간대 경계로 날을 나누고 연속 기록을 센다", () => {
    // 서울 자정 직전·직후의 UTC 시각은 서로 다른 날이다.
    const rows = [{ at: Date.parse("2026-11-08T14:59:00Z"), sessionId: "s1" }, { at: Date.parse("2026-11-08T15:01:00Z"), sessionId: "s1" },
      { at: Date.parse("2026-11-08T15:02:00Z"), sessionId: "s2" }];
    expect(dayKey(rows[0]!.at, "Asia/Seoul")).toBe("2026-11-08");
    expect(dayKey(rows[1]!.at, "Asia/Seoul")).toBe("2026-11-09");
    const query = parseActivityQuery({ from: "2026-11-01", to: "2026-11-09", tz: "Asia/Seoul" }, { tz: "UTC" });
    expect(bucketActivity(rows, query)).toMatchObject({ total: 3, activeDays: 2, sessions: 2,
      days: [{ date: "2026-11-08", count: 1, sessions: 1 }, { date: "2026-11-09", count: 2, sessions: 2 }] });
    expect(bucketActivity(rows, { ...query, tz: "UTC" }).days).toEqual([{ date: "2026-11-08", count: 3, sessions: 2 }]);
    expect(activityStreaks([{ date: "2026-11-01", count: 1 }, { date: "2026-11-02", count: 2 }, { date: "2026-11-03", count: 1 }, { date: "2026-11-08", count: 1 }], "2026-11-09"))
      .toEqual({ current: 1, longest: 3 });
    expect(parseActivityQuery({}, { tz: "Asia/Seoul", now: Date.parse("2026-11-09T00:00:00Z") })).toMatchObject({ from: "2025-11-10", to: "2026-11-09" });
    expect(() => parseActivityQuery({ tz: "Nowhere/City" }, { tz: "UTC" })).toThrow("IANA");
    expect(() => parseActivityQuery({ from: "2024-01-01", to: "2026-01-01" }, { tz: "UTC" })).toThrow("400일");
  });
});

describe("일정 관리 로컬 저장소와 HTTP API", () => {
  let f: ReturnType<typeof fixture>;
  let send: (url: string, init?: RequestInit) => Promise<Response>;
  const origin = "http://127.0.0.1:7474";
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) => send(route, {
    method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });
  beforeEach(() => {
    f = fixture();
    const handle = handler(f.service, f.config, { planner: new PlannerStore(f.db) });
    send = async (url, init = {}) => handle(new Request(`${origin}${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  });
  afterEach(() => f.close());

  test("Task·일정 저장, ETag 304, 필터, 같은 출처만 쓰기", async () => {
    expect(await (await send("/api/v1/tasks")).json()).toEqual({ schemaVersion: 1, revision: 0, items: [] });
    const saved = await post("/api/v1/tasks", { upserts: [task("a", { provider: "anthropic" }), task("b", { status: "done", project: "relay" })], deletes: [] });
    expect(await saved.json()).toEqual({ schemaVersion: 1, revision: 1 });
    const list = await send("/api/v1/tasks");
    expect(list.headers.get("etag")).toBe('"1"');
    expect((await list.json()).items.map((item: Task) => item.id)).toEqual(["a", "b"]);
    expect((await send("/api/v1/tasks", { headers: { "if-none-match": '"1"' } })).status).toBe(304);
    expect((await (await send("/api/v1/tasks?provider=anthropic")).json()).items.map((item: Task) => item.id)).toEqual(["a"]);
    expect((await (await send("/api/v1/tasks?project=relay&status=done")).json()).items.map((item: Task) => item.id)).toEqual(["b"]);
    expect((await send("/api/v1/tasks?nope=1")).status).toBe(400);
    // 다른 출처나 Origin 없는 쓰기는 거부한다.
    expect((await post("/api/v1/tasks", { upserts: [task("c")] }, { origin: "http://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post("/api/v1/tasks", { upserts: [task("c", { status: "later" as never })] })).status).toBe(400);
    await post("/api/v1/events", { upserts: [{ id: "e1", allDay: false, start: "2026-11-09T10:00", end: "2026-11-09T11:00", title: "회의",
      attachments: [{ kind: "task", id: "a" }], createdAt: 5, updatedAt: 5 }] });
    const events = await (await send("/api/v1/events?from=2026-11-01&to=2026-11-30")).json();
    expect(events).toMatchObject({ revision: 2, items: [{ id: "e1", allDay: false, start: "2026-11-09T10:00", color: "blue", attachments: [{ kind: "task", id: "a" }] }] });
    expect((await (await send("/api/v1/events?from=2026-12-01")).json()).items).toEqual([]);
    expect((await send("/api/v1/events", { method: "PUT" })).status).toBe(405);
  });

  test("업무 보드 API: 칸에 놓기·내리기·완료 비우기, 바뀐 것이 없으면 저장 번호도 그대로", async () => {
    await post("/api/v1/tasks", { upserts: [task("a", { createdAt: 1 }), task("b", { createdAt: 2 })] });
    expect((await (await send("/api/v1/board")).json()).inventory.map((item: Task) => item.id)).toEqual(["b", "a"]);
    expect(await (await post("/api/v1/board", { action: "place", id: "a", status: "review" })).json()).toEqual({ schemaVersion: 1, revision: 2, changed: 1 });
    await post("/api/v1/board", { action: "place", id: "b", status: "review", index: 0 });
    const board = await (await send("/api/v1/board")).json();
    expect(board.columns[2]).toMatchObject({ status: "review", label: "검토" });
    expect(board.columns[2].items.map((item: Task) => item.id)).toEqual(["b", "a"]);
    expect(await (await post("/api/v1/board", { action: "remove", id: "zzz" })).json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    await post("/api/v1/board", { action: "place", id: "a", status: "done" });
    expect((await (await post("/api/v1/board", { action: "clear-done" })).json()).changed).toBe(1);
    expect(await (await post("/api/v1/board", { action: "clear-done" })).json()).toEqual({ schemaVersion: 1, revision: 5, changed: 0 });
    expect((await send("/api/v1/board?x=1")).status).toBe(400);
  });

  test("잔디 API: 에이전트 기록을 날마다 세고 훅 자동 기록은 빼며, 세션이 지워져도 남는다", async () => {
    f.service.record(input("hooked", { summary: HOOK_SUMMARY }));
    f.service.update("hooked", "첫 작업");
    f.service.record(input("claude", { provider: "anthropic", agent: "claude-code" }));
    const tz = "Asia/Seoul";
    const today = dayKey(Date.now(), tz);
    const year = await (await send(`/api/v1/activity?tz=${tz}`)).json();
    expect(year).toMatchObject({ schemaVersion: 1, tz, to: today, total: 2, activeDays: 1, sessions: 2, days: [{ date: today, count: 2, sessions: 2 }] });
    expect((await (await send(`/api/v1/activity?tz=${tz}&provider=anthropic`)).json()).total).toBe(1);
    const day = await (await send(`/api/v1/activity/day?date=${today}&tz=${tz}`)).json();
    expect(day.sessions.map((session: { providerSessionId: string }) => session.providerSessionId).sort()).toEqual(["claude", "hooked"]);
    f.db.query("DELETE FROM sessions WHERE provider_session_id = 'claude'").run();
    expect((await (await send(`/api/v1/activity?tz=${tz}`)).json()).total).toBe(2);
    expect((await (await send(`/api/v1/activity/day?date=${today}&tz=${tz}`)).json()).sessions.find((session: { deleted: boolean }) => session.deleted))
      .toMatchObject({ provider: "anthropic", agent: "claude-code", providerSessionId: null });
    expect((await send("/api/v1/activity/day")).status).toBe(400);
    expect((await send("/api/v1/activity", { method: "POST", headers: { origin, "content-type": "application/json" } })).status).toBe(405);
  });

  test("일정 관리 저장소가 없으면 쓰기 경로가 열리지 않는다", async () => {
    const handle = handler(f.service, f.config);
    const response = await handle(new Request(`${origin}/api/v1/tasks`, { method: "POST", body: "{}", headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json" } }));
    expect(response.status).toBe(405);
  });
});

describe("스키마 v8 → v9", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));

  test("일정 관리 표를 더하고, 지금까지의 에이전트 기록을 잔디 로그로 옮기며, 새 스키마와 같아진다", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v8Schema);
    db.exec("PRAGMA user_version = 8");
    const at = "2026-10-01T00:00:00.000Z";
    db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, working_directory, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("ses_old", "openai", "codex", "old", dir, "맥락", at, at);
    db.query("INSERT INTO session_updates (id, session_id, sequence, summary, created_at) VALUES (?, ?, ?, ?, ?)").run("u1", "ses_old", 1, HOOK_SUMMARY, at);
    db.query("INSERT INTO session_updates (id, session_id, sequence, summary, created_at) VALUES (?, ?, ?, ?, ?)").run("u2", "ses_old", 2, "작업", at);
    db.close();
    const fresh = new Database(":memory:");
    fresh.exec(v9Schema);
    const schemaOf = (target: Database) => target.query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const writer = openDatabase(loadConfig(dir));
    try {
      expect(writer.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(schemaOf(writer)).toEqual(schemaOf(fresh));
      expect(writer.query("SELECT session_id, provider, agent, created_at FROM activity_log").all()).toEqual([{ session_id: "ses_old", provider: "openai", agent: "codex", created_at: at }]);
      const store = new PlannerStore(writer);
      expect(store.applyTasks({ upserts: [task("t")], deletes: [] }).revision).toBe(1);
      expect(writer.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { writer.close(); fresh.close(); }
  });
});
