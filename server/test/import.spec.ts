import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { recordInput, testApp, type TestApp } from "./helpers.js";

const at = (offset: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, offset)).toISOString();
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id, provider: "openai", agent: "codex", providerSessionId: `p-${id}`, sessionName: null, model: null, workingDirectory: "C:/work",
  summary: `요약 ${id}`, parentSessionId: null, createdAt: at(1), updatedAt: at(2), endedAt: null, endReason: null, status: null, pinned: false, git: null, compaction: null, ...extra,
});

describe("로컬→원격 이전(import)", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("세션·이력·메모·계산을 id 기준으로 넣고, 다시 보내면 kept", async () => {
    const body = {
      sessions: [session("ses_a"), session("ses_b", { parentSessionId: "ses_a", provider: "anthropic", agent: "claude-code", status: "handoff", git: { branch: "main", commit: "abc", dirty: 0, at: at(1) } })],
      updates: [{ id: "upd_1", sessionId: "ses_a", sequence: 1, summary: "요약 ses_a", status: null, createdAt: at(1) },
        { id: "upd_2", sessionId: "ses_a", sequence: 2, summary: "다음", status: "working", createdAt: at(2) },
        { id: "upd_x", sessionId: "ses_missing", sequence: 1, summary: "없음", status: null, createdAt: at(1) }],
      notes: [{ id: "n1", kind: "note", parentId: null, title: "메모", body: "본문", createdAt: 1, updatedAt: 2 }],
      calculations: [{ id: "c1", expression: "1+1", result: "2", createdAt: 5 }],
    };
    const first = (await t.post("/api/v1/import", body).expect(200)).body;
    expect(first).toEqual({ schemaVersion: 1, sessions: { added: 2, updated: 0, kept: 0 }, updates: { added: 2, kept: 1 }, notes: { added: 1, updated: 0, kept: 0 }, calculations: { added: 1, kept: 0 } });
    const b = (await t.post("/api/v1/sessions/lookup", { providerSessionId: "p-ses_b", history: true }).expect(200)).body;
    expect(b.parentSession.id).toBe("ses_a"); expect(b.session.status).toBe("handoff"); expect(b.session.git.branch).toBe("main");
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "p-ses_a", history: true }).expect(200)).body.updatesPage.total).toBe(2);
    const again = (await t.post("/api/v1/import", body).expect(200)).body;
    expect(again.sessions).toEqual({ added: 0, updated: 0, kept: 2 }); expect(again.updates).toEqual({ added: 0, kept: 3 });
    expect(again.notes.kept).toBe(1); expect(again.calculations.kept).toBe(1);
    // 더 최근 갱신이 오면 바꾼다
    const newer = (await t.post("/api/v1/import", { sessions: [session("ses_a", { summary: "새 요약", updatedAt: at(9) })] }).expect(200)).body;
    expect(newer.sessions.updated).toBe(1);
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "p-ses_a" }).expect(200)).body.session.summary).toBe("새 요약");
    // 같은 Agent Session ID가 다른 내부 id로 이미 있으면 기존 것을 둔다
    expect((await t.post("/api/v1/import", { sessions: [session("ses_other", { providerSessionId: "p-ses_a" })] }).expect(200)).body.sessions.kept).toBe(1);
    // 이전 뒤에도 기록은 이어진다
    await t.post("/api/v1/sessions/update", { providerSessionId: "p-ses_a", summary: "이어서" }).expect(200);
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "p-ses_a", history: true }).expect(200)).body.updates[0].sequence).toBe(3);
    expect((await t.post("/api/v1/import", { sessions: [{ id: "bad" }] })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/import", { nope: [] })).body.error.code).toBe("INVALID_ARGUMENT");
    // 기록된 세션과 섞여도 문제없다
    await t.post("/api/v1/sessions", recordInput("live")).expect(200);
    expect((await t.get("/api/v1/sessions").expect(200)).body.page.total).toBe(3);
  });
});
