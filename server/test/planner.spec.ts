import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { HOOK_SUMMARY, dayKey } from "@relay/core";
import { recordInput, testApp, type TestApp } from "./helpers.js";

const task = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `할 일 ${id}`, project: "relay", memo: "", provider: "anthropic", status: "todo", board: false, position: null, notes: [], createdAt: 1000, updatedAt: 1000, ...extra });
const event = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `일정 ${id}`, allDay: true, start: "2026-11-09", end: "2026-11-09", memo: "", color: "blue", attachments: [], createdAt: 1000, updatedAt: 1000, ...extra });

describe("원격 일정 관리 API", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("Task: 저장·ETag 304·필터·삭제, 완료 시각은 상태를 따른다", async () => {
    const empty = await t.get("/api/v1/tasks").expect(200);
    expect(empty.body).toEqual({ schemaVersion: 1, revision: 0, items: [] });
    const saved = (await t.post("/api/v1/tasks", { upserts: [task("a", { notes: ["memo-1", "memo-1"] }), task("b", { provider: null, status: "done" })], deletes: [] }).expect(200)).body;
    expect(saved.revision).toBe(1);
    const list = await t.get("/api/v1/tasks").expect(200);
    expect(list.headers.etag).toBe('"1"');
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual(["a", "b"]);
    expect(list.body.items[0].notes).toEqual(["memo-1"]);
    expect(list.body.items[1].completedAt).toBe(1000);
    await t.get("/api/v1/tasks").set("If-None-Match", '"1"').expect(304);
    expect((await t.get("/api/v1/tasks?provider=none").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(["b"]);
    expect((await t.get("/api/v1/tasks?status=todo,doing&provider=anthropic").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
    expect((await t.get("/api/v1/tasks?bogus=1")).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/tasks", { upserts: [task("c", { provider: "someone" })] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/tasks", { upserts: [task("c", { status: "later" })] })).body.error.code).toBe("INVALID_ARGUMENT");
    await t.post("/api/v1/tasks", { upserts: [], deletes: ["a"] }).expect(200);
    expect((await t.get("/api/v1/tasks").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(["b"]);
  });

  test("업무 보드: 인벤토리에서 칸으로 놓기, 사이에 끼우기, 내리기, 완료 비우기", async () => {
    await t.post("/api/v1/tasks", { upserts: [task("a", { createdAt: 1 }), task("b", { createdAt: 2 }), task("c", { createdAt: 3 }), task("d", { status: "done", createdAt: 4 })] }).expect(200);
    let board = (await t.get("/api/v1/board").expect(200)).body;
    expect(board.columns.map((column: { status: string; label: string }) => `${column.status}:${column.label}`)).toEqual(["todo:할 일", "doing:진행 중", "review:검토", "done:완료"]);
    // 완료 Task는 인벤토리에 보이지 않는다.
    expect(board.inventory.map((item: { id: string }) => item.id)).toEqual(["c", "b", "a"]);
    await t.post("/api/v1/board", { action: "place", id: "a", status: "doing" }).expect(200);
    await t.post("/api/v1/board", { action: "place", id: "b", status: "doing" }).expect(200);
    await t.post("/api/v1/board", { action: "place", id: "c", status: "doing", index: 1 }).expect(200);
    board = (await t.get("/api/v1/board").expect(200)).body;
    expect(board.columns[1].items.map((item: { id: string }) => item.id)).toEqual(["a", "c", "b"]);
    expect(board.inventory).toEqual([]);
    const done = (await t.post("/api/v1/board", { action: "place", id: "c", status: "done", index: 0 }).expect(200)).body;
    expect(done.changed).toBe(1);
    board = (await t.get("/api/v1/board").expect(200)).body;
    expect(board.columns[3].items[0]).toMatchObject({ id: "c", status: "done", board: true });
    expect(board.columns[3].items[0].completedAt).toBeGreaterThan(0);
    // 완료를 보드에서 내리면 할 일로 돌아가 인벤토리에 다시 보인다.
    await t.post("/api/v1/board", { action: "remove", id: "c" }).expect(200);
    board = (await t.get("/api/v1/board").expect(200)).body;
    expect(board.inventory.map((item: { id: string }) => item).find((item: { id: string }) => item.id === "c")).toMatchObject({ status: "todo", board: false, completedAt: null });
    await t.post("/api/v1/board", { action: "place", id: "a", status: "done" }).expect(200);
    expect((await t.post("/api/v1/board", { action: "clear-done" }).expect(200)).body.changed).toBe(1);
    board = (await t.get("/api/v1/board").expect(200)).body;
    expect(board.columns[3].items).toEqual([]);
    expect((await t.post("/api/v1/board", { action: "place", id: "zzz", status: "todo" })).body.error.code).toBe("NOT_FOUND");
    expect((await t.post("/api/v1/board", { action: "place", id: "a", status: "todo", extra: 1 })).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("캘린더: 종일·시간 일정, 기간 조회, 끝이 시작보다 앞이면 거부", async () => {
    await t.post("/api/v1/events", { upserts: [
      event("e1", { attachments: [{ kind: "note", id: "memo-1" }, { kind: "task", id: "a" }, { kind: "note", id: "memo-1" }] }),
      event("e2", { allDay: false, start: "2026-11-20T09:30", end: "2026-11-20T11:00", color: "green" }),
    ] }).expect(200);
    const list = (await t.get("/api/v1/events").expect(200)).body;
    expect(list.items.map((item: { id: string }) => item.id)).toEqual(["e1", "e2"]);
    expect(list.items[0].attachments).toEqual([{ kind: "note", id: "memo-1" }, { kind: "task", id: "a" }]);
    expect((await t.get("/api/v1/events?from=2026-11-15&to=2026-11-30").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(["e2"]);
    expect((await t.post("/api/v1/events", { upserts: [event("e3", { start: "2026-11-10", end: "2026-11-09" })] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/events", { upserts: [event("e3", { start: "2026-02-30", end: "2026-02-30" })] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/events", { upserts: [event("e3", { allDay: false, start: "2026-11-10", end: "2026-11-10" })] })).body.error.code).toBe("INVALID_ARGUMENT");
    await t.post("/api/v1/events", { deletes: ["e1"] }).expect(200);
    expect((await t.get("/api/v1/events").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(["e2"]);
  });

  test("잔디: 에이전트 기록만 날마다 세고, 세션이 지워져도 남는다", async () => {
    await t.post("/api/v1/sessions", recordInput("s1", { summary: HOOK_SUMMARY })).expect(200);
    await t.post("/api/v1/sessions/update", { providerSessionId: "s1", summary: "첫 작업" }).expect(200);
    await t.post("/api/v1/sessions/update", { providerSessionId: "s1", summary: "둘째 작업" }).expect(200);
    await t.post("/api/v1/sessions", recordInput("s2", { provider: "anthropic", agent: "claude-code" })).expect(200);
    const today = dayKey(Date.now(), "Asia/Seoul");
    const year = (await t.get("/api/v1/activity?tz=Asia/Seoul").expect(200)).body;
    expect(year).toMatchObject({ tz: "Asia/Seoul", to: today, total: 3, activeDays: 1, sessions: 2 });
    expect(year.days).toEqual([{ date: today, count: 3, sessions: 2 }]);
    expect((await t.get("/api/v1/activity?tz=Asia/Seoul&provider=anthropic").expect(200)).body.total).toBe(1);
    const day = (await t.get(`/api/v1/activity/day?date=${today}&tz=Asia/Seoul`).expect(200)).body;
    expect(day.sessions.map((session: { providerSessionId: string; count: number }) => `${session.providerSessionId}:${session.count}`).sort()).toEqual(["s1:2", "s2:1"]);
    // 보관 기간 정리로 세션이 지워져도 기록 수는 남고, 그날 목록에는 지워진 세션으로 보인다.
    await t.db.execute(sql`DELETE FROM sessions WHERE provider_session_id = 's2'`);
    expect((await t.get("/api/v1/activity?tz=Asia/Seoul").expect(200)).body.total).toBe(3);
    const after = (await t.get(`/api/v1/activity/day?date=${today}&tz=Asia/Seoul`).expect(200)).body;
    expect(after.sessions.find((session: { deleted: boolean }) => session.deleted)).toMatchObject({ provider: "anthropic", agent: "claude-code", providerSessionId: null });
    expect((await t.get("/api/v1/activity?tz=Mars/Base")).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.get("/api/v1/activity?from=2024-01-01&to=2026-01-01")).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("공휴일 API: 계산한 공휴일·대체공휴일·선거일을 준다", async () => {
    const list = (await t.get("/api/v1/holidays?from=2026-10-01&to=2026-10-31").expect(200)).body;
    expect(list.items).toEqual([
      { date: "2026-10-03", name: "개천절", kind: "holiday" },
      { date: "2026-10-05", name: "대체공휴일", kind: "substitute", of: "개천절" },
      { date: "2026-10-09", name: "한글날", kind: "holiday" },
    ]);
    expect((await t.get("/api/v1/holidays?year=2026&from=2026-01-01")).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("사용자마다 따로 둔다: 다른 사용자의 같은 id는 서로 덮지 않는다", async () => {
    await t.post("/api/v1/tasks", { upserts: [task("same")] }).expect(200);
    await t.db.execute(sql`INSERT INTO users (id, name) VALUES ('other', 'other')`);
    await t.db.execute(sql`INSERT INTO tasks (user_id, id, title, status, created_at, updated_at, revision) VALUES ('other', 'same', '남의 것', 'todo', 1, 1, 1)`);
    await t.post("/api/v1/tasks", { upserts: [task("same", { title: "내 것" })] }).expect(200);
    expect((await t.get("/api/v1/tasks").expect(200)).body.items.map((item: { title: string }) => item.title)).toEqual(["내 것"]);
  });
});
