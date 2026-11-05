import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { HOOK_SUMMARY } from "@relay/core";
import { recordInput, testApp, type TestApp } from "./helpers.js";

describe("원격 세션 API", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("health는 인증 없이, 나머지는 Bearer 토큰이 있어야 한다", async () => {
    const health = await t.raw.get("/api/v1/health").expect(200);
    expect(health.body).toMatchObject({ schemaVersion: 1, status: "ok", kind: "relay-remote", apiVersion: 1, build: "test", db: "ok", files: false });
    expect(health.headers["cache-control"]).toBe("no-store");
    expect((await t.raw.get("/api/v1/health?x=1")).status).toBe(400);
    const denied = await t.raw.get("/api/v1/sessions").expect(401);
    expect(denied.body.error.code).toBe("UNAUTHORIZED");
    expect((await t.raw.get("/api/v1/sessions").set("Authorization", "Bearer " + "x".repeat(40))).status).toBe(401);
    const who = await t.get("/api/v1/auth/whoami").expect(200);
    expect(who.body.user.name).toBe("tester"); expect(who.body.token.name).toBe("test-token");
    expect((await t.get("/api/v1/nope")).body.error.code).toBe("NOT_FOUND");
  });

  test("record → update → lookup(history) → continue → latest → list", async () => {
    const a = (await t.post("/api/v1/sessions", recordInput("provider-a", { git: { branch: "main", commit: "abc1234", dirty: 2, at: new Date().toISOString() } })).expect(200)).body;
    expect(a.session.id).toMatch(/^ses_/); expect(a.session.git.branch).toBe("main"); expect(a.session.status).toBeNull();
    // 같은 입력의 첫 기록은 다시 받아도 이력이 늘지 않는다.
    expect((await t.post("/api/v1/sessions", recordInput("provider-a")).expect(200)).body.session.id).toBe(a.session.id);
    // 다른 생성 정보면 SESSION_EXISTS
    expect((await t.post("/api/v1/sessions", recordInput("provider-a", { summary: "다른 요약" }))).body.error.code).toBe("SESSION_EXISTS");
    const updated = (await t.post("/api/v1/sessions/update", { providerSessionId: "provider-a", summary: "두 번째 맥락", status: "working", sessionName: "로그인 수정" }).expect(200)).body;
    expect(updated.session.status).toBe("working"); expect(updated.session.sessionName).toBe("로그인 수정");
    const shown = (await t.post("/api/v1/sessions/lookup", { providerSessionId: "provider-a", history: true }).expect(200)).body;
    expect(shown.updates.map((u: { sequence: number }) => u.sequence)).toEqual([2, 1]);
    expect(shown.updates[1].summary).toBe("첫 요약 provider-a"); expect(shown.updatesPage.total).toBe(2);
    const child = (await t.post("/api/v1/sessions/continue", { ...recordInput("provider-b", { provider: "anthropic", agent: "claude-code" }), parent: { providerSessionId: "provider-a" } }).expect(200)).body;
    expect(child.parentSession.id).toBe(a.session.id); expect(child.session.workingDirectory).toBe("C:/work/project");
    // 다른 부모에 다시 연결하면 PARENT_CONFLICT
    await t.post("/api/v1/sessions", recordInput("provider-c"));
    expect((await t.post("/api/v1/sessions/continue", { ...recordInput("provider-b", { provider: "anthropic", agent: "claude-code" }), parent: { providerSessionId: "provider-c" } })).body.error.code).toBe("PARENT_CONFLICT");
    const chain = (await t.post("/api/v1/sessions/lookup", { providerSessionId: "provider-b", chain: true }).expect(200)).body;
    expect(chain.items.map((n: { depth: number; current: boolean }) => [n.depth, n.current])).toEqual([[0, false], [1, true]]);
    const latest = (await t.get("/api/v1/sessions/latest?alias=claude").expect(200)).body;
    expect(latest.session.id).toBe(child.session.id); expect(latest.scope.cwd).toBeNull();
    expect((await t.get("/api/v1/sessions/latest?alias=grok")).body.error.code).toBe("SESSION_NOT_FOUND");
    expect((await t.get("/api/v1/sessions/latest?alias=claude&cwd=c:/WORK/project").expect(200)).body.session.id).toBe(child.session.id);
    const list = (await t.get("/api/v1/sessions?provider=anthropic").expect(200)).body;
    expect(list.items.length).toBe(1); expect(list.page.total).toBe(1);
    // 이어받은 자식은 부모의 세션 이름을 물려받으므로 둘 다 검색에 잡힌다
    expect((await t.get("/api/v1/sessions?q=로그인").expect(200)).body.page.total).toBe(2);
    expect((await t.get("/api/v1/sessions?status=working").expect(200)).body.page.total).toBe(1);
    for (const query of ["nope=1", "status=bad", "limit=0", "limit=101", "cwd=relative", "provider=x&provider=y"]) {
      expect((await t.get(`/api/v1/sessions?${query}`)).body.error.code).toBe("INVALID_ARGUMENT");
    }
    const detail = (await t.get(`/api/v1/sessions/${a.session.id}`).expect(200)).body;
    expect(detail.children[0].id).toBe(child.session.id); expect(detail.childrenPage.total).toBe(1);
    expect((await t.get(`/api/v1/sessions/${a.session.id}/updates?offset=1`).expect(200)).body.items[0].sequence).toBe(1);
    expect((await t.get(`/api/v1/sessions/${a.session.id}/chain`).expect(200)).body.items.length).toBe(2);
    expect((await t.get(`/api/v1/sessions/${a.session.id}/packet`).expect(200)).body.chain.length).toBe(2);
    expect((await t.get("/api/v1/sessions/provider-a")).status).toBe(404);
    // 내부 ID로 lookup하면 안내가 붙는다
    const wrong = await t.post("/api/v1/sessions/lookup", { providerSessionId: a.session.id });
    expect(wrong.body.error.details.providerSessionId).toBe("provider-a");
  });

  test("화면의 정리(actions)와 훅의 end·compact·models, pin·delete", async () => {
    const a = (await t.post("/api/v1/sessions", recordInput("provider-a")).expect(200)).body.session;
    const id = a.id;
    expect((await t.post(`/api/v1/sessions/${id}/actions`, { action: "status", status: "blocked" }).expect(200)).body.session.status).toBe("blocked");
    expect((await t.post(`/api/v1/sessions/${id}/actions`, { action: "pin", pinned: true }).expect(200)).body.session.pinned).toBe(true);
    const ended = (await t.post(`/api/v1/sessions/${id}/actions`, { action: "end" }).expect(200)).body.session;
    expect(ended.endReason).toBe("web"); expect(ended.updatedAt).toBe(a.updatedAt);
    expect((await t.post(`/api/v1/sessions/${id}/actions`, { action: "reopen" }).expect(200)).body.session.endedAt).toBeNull();
    expect((await t.post(`/api/v1/sessions/${id}/actions`, { action: "nope" })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post(`/api/v1/sessions/${id}/actions`, { action: "status", status: "working", extra: 1 })).body.error.code).toBe("INVALID_ARGUMENT");
    const compacted = (await t.post("/api/v1/sessions/compact", { providerSessionId: "provider-a", trigger: "auto" }).expect(200)).body.session;
    expect(compacted.compaction).toMatchObject({ count: 1, trigger: "auto" });
    const models = (await t.post("/api/v1/sessions/models", { providerSessionId: "provider-a", models: ["gpt-6", "gpt-6", "claude-fable-5-1"] }).expect(200)).body.session;
    expect(models.model).toBe("gpt-6, claude-fable-5-1");
    expect((await t.post("/api/v1/sessions/pin", { providerSessionId: "provider-a", pinned: false }).expect(200)).body.session.pinned).toBe(false);
    // 훅 종료: 이력이 있으니 남고 종료 시각이 붙는다
    const closed = (await t.post("/api/v1/sessions/end", { providerSessionId: "provider-a", reason: "prompt_input_exit" }).expect(200)).body;
    expect(closed.deleted).toBe(false); expect(closed.session.endReason).toBe("prompt_input_exit");
    // 훅 자동 기록만 남은 세션은 종료 때 지워진다
    await t.post("/api/v1/sessions", recordInput("hook-only", { summary: HOOK_SUMMARY })).expect(200);
    expect((await t.post("/api/v1/sessions/end", { providerSessionId: "hook-only" }).expect(200)).body.deleted).toBe(true);
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "hook-only" })).status).toBe(404);
    // 자식이 있는 세션은 --force 없이 지울 수 없다
    await t.post("/api/v1/sessions/continue", { ...recordInput("child", { provider: "xai", agent: "grok" }), parent: { providerSessionId: "provider-a" } }).expect(200);
    expect((await t.post("/api/v1/sessions/delete", { providerSessionId: "provider-a" })).body.error.code).toBe("SESSION_LINKED");
    const deleted = (await t.post("/api/v1/sessions/delete", { providerSessionId: "provider-a", force: true }).expect(200)).body;
    expect(deleted.deleted).toBe(true); expect(deleted.detached).toBe(1);
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "child" }).expect(200)).body.session.parentSessionId).toBeNull();
  });

  test("Idempotency-Key가 같으면 첫 응답을 그대로 돌려준다", async () => {
    const first = await t.post("/api/v1/sessions/update", { providerSessionId: "none", summary: "x" }).set("Idempotency-Key", "k".repeat(12));
    expect(first.status).toBe(404);
    await t.post("/api/v1/sessions", recordInput("provider-a")).expect(200);
    const key = "abcdefgh-12345678";
    await t.post("/api/v1/sessions/update", { providerSessionId: "provider-a", summary: "한 번" }).set("Idempotency-Key", key).expect(200);
    const two = await t.post("/api/v1/sessions/update", { providerSessionId: "provider-a", summary: "두 번" }).set("Idempotency-Key", key).expect(200);
    expect(two.headers["idempotent-replayed"]).toBe("true");
    expect(two.body.session.summary).toBe("한 번");
    expect((await t.post("/api/v1/sessions/lookup", { providerSessionId: "provider-a", history: true }).expect(200)).body.updatesPage.total).toBe(2);
    expect((await t.post("/api/v1/sessions/update", { providerSessionId: "provider-a", summary: "x" }).set("Idempotency-Key", "short")).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test("기기를 등록하면 기록에 기기 id가 붙고, 모르는 기기 헤더는 거부한다", async () => {
    const registered = (await t.post("/api/v1/devices/register", { name: "office-pc", platform: "win32" }).expect(200)).body;
    expect(registered.created).toBe(true); expect(registered.device.id).toMatch(/^dev_/);
    expect((await t.post("/api/v1/devices/register", { name: "office-pc" }).expect(200)).body.created).toBe(false);
    const recorded = (await t.post("/api/v1/sessions", recordInput("provider-a")).set("X-Relay-Device", registered.device.id).expect(200)).body;
    expect(recorded.session.deviceId).toBe(registered.device.id);
    expect((await t.get(`/api/v1/sessions?device=${registered.device.id}`).expect(200)).body.page.total).toBe(1);
    expect((await t.get("/api/v1/sessions").set("X-Relay-Device", "dev_unknown")).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.get("/api/v1/devices").expect(200)).body.items.length).toBe(1);
  });

  test("잘못된 본문·JSON은 400, 너무 큰 본문은 413", async () => {
    expect((await t.post("/api/v1/sessions").set("Content-Type", "application/json").send("{bad")).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/sessions", [1])).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/sessions", recordInput("x", { extra: true }))).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/sessions", recordInput("x", { cwd: "relative" }))).body.error.code).toBe("INVALID_ARGUMENT");
    const big = await t.post("/api/v1/sessions").set("Content-Type", "application/json").send(JSON.stringify({ summary: "x".repeat(9 * 1024 * 1024) }));
    expect(big.status).toBe(413);
  });
});
