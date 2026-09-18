import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { HOOK_SUMMARY } from "../src/session/session.service";
import { age, fixture, input } from "./helpers";

describe("Session Service", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => f.close());

  test("atomic records and descending history without lifecycle fields", () => {
    const recorded = f.service.record(input("a")).session;
    expect(recorded.createdAt).toBe(recorded.updatedAt); expect(recorded.model).toBeNull();
    for (const field of ["status", "startedAt"]) expect(recorded).not.toHaveProperty(field);
    expect(recorded.endedAt).toBeNull(); expect(recorded.endReason).toBeNull();
    f.service.update("a", "중간\n요약");
    const updated = f.service.update("a", "완료").session;
    const result = f.service.show("a", undefined, true);
    expect(updated.createdAt).toBe(recorded.createdAt);
    expect(result.updates?.map(u => u.sequence)).toEqual([3, 2, 1]);
    for (const update of result.updates!) expect(update).not.toHaveProperty("type");
    expect(result.updates?.[0].summary).toBe(result.session.summary);
    expect(result.updates?.[0].createdAt).toBe(result.session.updatedAt);
  });

  test("record retries retain current values without duplicate history; later updates remain allowed", () => {
    f.service.record(input("a")); f.service.update("a", "변경"); f.service.update("a", "완료");
    const before = f.service.show("a", undefined, true);
    expect(f.service.record(input("a")).session).toEqual(before.session);
    expect(f.service.show("a", undefined, true)).toEqual(before);
    expect(() => f.service.record(input("a", { summary: "다른 시작" }))).toThrow("생성 정보");
    expect(f.service.update("a", "추가 맥락").session.summary).toBe("추가 맥락");
    expect(f.service.show("a", undefined, true).updatesPage?.total).toBe(4);
  });

  test("continuation inherits name/path, keeps parent, permits branches and retries", () => {
    const parentInput = input("parent", { provider: "anthropic", agent: "claude-code", sessionName: "부모 이름", model: "parent-model" });
    f.service.record(parentInput);
    const before = f.service.show("parent", undefined, true);
    const childInput = { provider: "openai", agent: "codex", sessionId: "child", summary: "재개" };
    const child = f.service.record(childInput, "parent", "anthropic");
    expect(child.session.parentSessionId).toBe(before.session.id);
    expect(child.session.sessionName).toBe("부모 이름"); expect(child.session.model).toBeNull();
    expect(child.session.workingDirectory).toBe(before.session.workingDirectory);
    f.service.record(input("branch"), "parent");
    f.service.update("child", "진행");
    expect(f.service.record(childInput, "parent").session.summary).toBe("진행");
    const after = f.service.show("parent", undefined, true);
    expect(after.session).toEqual(before.session); expect(after.updates).toEqual(before.updates);
    expect(after.childrenPage.total).toBe(2);
    expect(f.service.update("parent", "후속 맥락").session.summary).toBe("후속 맥락");
  });

  test("continuation links a session an automatic first record already created", () => {
    f.service.record(input("parent", { provider: "anthropic", agent: "claude-code", sessionName: "부모 이름", model: "parent-model" }));
    const parent = f.service.show("parent").session;
    // A session hook records the child first, with only the folder name and a placeholder note.
    f.service.record(input("child", { sessionName: "agent-session-chain", summary: "세션 첫 기록 (훅 자동 기록)" }));
    const hooked = f.service.show("child", undefined, true).session;
    expect(hooked.parentSessionId).toBeNull();

    const takeover = { provider: "openai", agent: "codex", sessionId: "child", summary: "이어받아 진행",
      sessionName: "이어받은 주제", model: "claude-opus-5" };
    const linked = f.service.record(takeover, "parent", "anthropic");
    expect(linked.session.id).toBe(hooked.id);
    expect(linked.session.createdAt).toBe(hooked.createdAt);
    expect(linked.session.workingDirectory).toBe(hooked.workingDirectory);
    expect(linked.session.parentSessionId).toBe(parent.id);
    expect(linked.session.sessionName).toBe("이어받은 주제");
    expect(linked.session.model).toBe("claude-opus-5");
    expect(linked.parentSession?.providerSessionId).toBe("parent");
    // The placeholder note stays in the history and the takeover is appended after it.
    const history = f.service.show("child", undefined, true);
    expect(history.updatesPage?.total).toBe(2);
    expect(history.updates?.map(u => u.summary)).toEqual(["이어받아 진행", "세션 첫 기록 (훅 자동 기록)"]);
    expect(f.service.show("parent").childrenPage.total).toBe(1);

    // A retry changes nothing; a second origin and a cycle are refused.
    const after = f.service.show("child", undefined, true);
    expect(f.service.record(takeover, "parent", "anthropic").session).toEqual(linked.session);
    expect(f.service.show("child", undefined, true)).toEqual(after);
    f.service.record(input("other", { provider: "anthropic", agent: "claude-code" }));
    expect(() => f.service.record(takeover, "other", "anthropic")).toThrow("이미 다른 세션에 연결");
    expect(() => f.service.record({ ...takeover, agent: "other-tool" }, "parent", "anthropic")).toThrow("다른 도구");
    expect(() => f.service.record({ provider: "anthropic", agent: "claude-code", sessionId: "parent", summary: "역방향" }, "child", "openai"))
      .toThrow("자기 자손");
    expect(f.service.show("child").session.parentSessionId).toBe(parent.id);
  });

  test("linking keeps labels the agent did not supply and refuses a self link", () => {
    f.service.record(input("root", { provider: "anthropic", agent: "claude-code", sessionName: "부모 이름" }));
    f.service.record(input("kid", { sessionName: "폴더 이름" }));
    const linked = f.service.record({ provider: "openai", agent: "codex", sessionId: "kid", summary: "이어받음" }, "root", "anthropic");
    // Without --session-name/--model the hook's label stays; the parent's name does not overwrite it.
    expect(linked.session.sessionName).toBe("폴더 이름");
    expect(linked.session.model).toBeNull();
    expect(linked.session.summary).toBe("이어받음");
    f.service.record(input("solo"));
    expect(() => f.service.record({ provider: "openai", agent: "codex", sessionId: "solo", summary: "자기 연결" }, "solo", "openai"))
      .toThrow("자기 자신");
    expect(f.service.show("solo").session.parentSessionId).toBeNull();
  });

  test("ambiguous provider IDs fail closed; parent provider is independent", () => {
    f.service.record(input("same"));
    f.service.record(input("same", { provider: "anthropic", agent: "claude-code" }));
    expect(() => f.service.show("same")).toThrow("여러 제공자");
    expect(() => f.service.update("same", "요약")).toThrow("여러 제공자");
    expect(f.service.show("same", "openai").session.provider).toBe("openai");
    const child = f.service.record(input("child"), "same", "anthropic");
    expect(child.parentSession?.provider).toBe("anthropic"); expect(child.session.provider).toBe("openai");
  });

  test("latest filters BOTH provider and agent across all projects; reads never mutate", () => {
    f.service.record(input("codex"));
    f.service.record(input("claude1", { provider: "anthropic", agent: "claude-code" }));
    const selected = f.service.record(input("claude2", { provider: "anthropic", agent: "claude-code" })).session;
    f.service.record(input("other", { provider: "anthropic", agent: "other" }));
    f.db.query("UPDATE sessions SET updated_at='2026-01-01T00:00:00.000Z'").run();
    f.db.query("UPDATE sessions SET updated_at='2026-01-02T00:00:00.000Z' WHERE id=?").run(selected.id);
    f.db.query("UPDATE sessions SET updated_at='2026-01-03T00:00:00.000Z' WHERE provider_session_id IN ('codex','other')").run();
    const before = f.service.show("claude2", undefined, true);
    expect(f.service.latest("claude").session.id).toBe(selected.id);
    expect(f.service.latest("claude").session.id).toBe(selected.id);
    expect(f.service.show("claude2", undefined, true)).toEqual(before);
    expect(() => f.service.latest("grok")).toThrow("다른 제공자로 대체하지");
    expect(() => f.service.latest("openai")).toThrow("사용법");
    expect(() => f.service.latest("toString")).toThrow("사용법");
  });

  test("latest deterministic tie break and explicit cwd", () => {
    const a = f.service.record(input("a")).session;
    const b = f.service.record(input("b", { cwd: f.dir })).session;
    f.db.query("UPDATE sessions SET updated_at='2026-01-01T00:00:00.000Z'").run();
    expect(f.service.latest("codex").session.id).toBe([a.id, b.id].sort().at(-1)!);
    expect(f.service.latest("codex", f.dir).session.id).toBe(b.id);
  });

  test("literal wildcard search, AND filters and paging above 100", () => {
    for (let n = 0; n < 105; n++) f.service.record(input(`item-${n}`, { summary: n === 0 ? "100%_\\테스트" : "일반 요약" }));
    expect(f.service.list({ q: "%_\\" }).page.total).toBe(1);
    expect(f.service.list({ q: "' OR 1=1 --" }).page.total).toBe(0);
    expect(f.service.list({ provider: "openai", agent: "other" }).page.total).toBe(0);
    const first = f.service.list({ limit: 100 }); const second = f.service.list({ offset: 100, limit: 100 });
    expect(first.page.total).toBe(105); expect(second.items.length).toBe(5);
    expect(new Set([...first.items, ...second.items].map(s => s.id)).size).toBe(105);
    expect(() => f.service.list({ limit: 101 })).toThrow("범위");
    expect(() => f.service.list({ offset: "1e2" })).toThrow("정수");
  });

  test("progress always appends; history paging is sequential", () => {
    const s = f.service.record(input("history")).session;
    for (let i = 0; i < 105; i++) f.service.update("history", "같은 요약");
    expect(f.service.updates(s.id).items[0].sequence).toBe(106);
    expect(f.service.updates(s.id, { limit: 100, offset: 100 }).items.map(u => u.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test("history failure rolls back record/update/continue with no partial snapshot", () => {
    f.service.record(input("a"));
    const before = f.service.show("a", undefined, true);
    f.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON session_updates BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    expect(() => f.service.update("a", "실패")).toThrow();
    expect(() => f.service.record(input("b"))).toThrow();
    expect(() => f.service.record(input("child"), "a")).toThrow();
    expect(f.service.show("a", undefined, true)).toEqual(before);
    expect(f.service.list().page.total).toBe(1);
  });

  test("retention deletes expired records on write, keeping live chains and the current session", () => {
    const r = fixture(30);
    try {
      r.service.record(input("alone"));
      r.service.record(input("old-root"));
      r.service.record(input("old-leaf"), "old-root");
      r.service.record(input("kept-root"));
      r.service.record(input("kept-leaf"), "kept-root");
      for (const id of ["alone", "old-root", "old-leaf", "kept-root"]) age(r.db, id, 31);
      // Any write applies retention; the untouched chain disappears whole while the used one survives.
      r.service.update("kept-leaf", "진행");
      expect(r.service.list().items.map(s => s.providerSessionId).sort()).toEqual(["kept-leaf", "kept-root"]);
      expect(r.service.show("kept-leaf").parentSession?.providerSessionId).toBe("kept-root");
      // The root's record and the leaf's record/update remain; deleted sessions take their history with them.
      expect(r.db.query("SELECT count(*) AS n FROM session_updates").get()).toEqual({ n: 3 });
      // A retry that only reads back an expired session must not delete what it just returned.
      age(r.db, "kept-leaf", 31); age(r.db, "kept-root", 31);
      expect(r.service.record(input("kept-leaf"), "kept-root").session.providerSessionId).toBe("kept-leaf");
      expect(r.service.list().page.total).toBe(2);
    } finally { r.close(); }
  });

  test("end keeps a session the agent wrote to, drops an untouched automatic record, and any new context reopens it", () => {
    // A hook recorded both sessions; only one ever received context from the agent.
    f.service.record(input("worked", { summary: HOOK_SUMMARY }));
    f.service.record(input("idle", { summary: HOOK_SUMMARY }));
    f.service.update("worked", "작업 맥락");
    const before = f.service.show("worked").session;

    const ended = f.service.end("worked", "openai", "prompt_input_exit");
    expect(ended.deleted).toBe(false);
    expect(ended.session.endedAt).not.toBeNull();
    expect(ended.session.endReason).toBe("prompt_input_exit");
    // The close is not context: the last-context time and the history stay as they were.
    expect(ended.session.updatedAt).toBe(before.updatedAt);
    expect(f.service.show("worked", undefined, true).updatesPage?.total).toBe(2);
    expect(f.service.show("worked").session.endedAt).toBe(ended.session.endedAt);

    const dropped = f.service.end("idle", "openai");
    expect(dropped.deleted).toBe(true);
    expect(() => f.service.show("idle")).toThrow("찾을 수 없습니다");
    expect(f.db.query("SELECT count(*) AS n FROM session_updates WHERE session_id = ?").get(dropped.session.id)).toEqual({ n: 0 });
    expect(f.service.list().page.total).toBe(1);

    // A session the agent recorded itself with a real note is context, even without a later update.
    f.service.record(input("manual", { summary: "직접 남긴 첫 요약" }));
    expect(f.service.end("manual", "openai").deleted).toBe(false);
    // An automatic record that became someone's origin stays: the child still points at it.
    f.service.record(input("origin", { summary: HOOK_SUMMARY }));
    f.service.record(input("next"), "origin", "openai");
    expect(f.service.end("origin", "openai").deleted).toBe(false);
    // An automatic record that was taken over through `continue` has the takeover note and stays.
    f.service.record(input("taken", { summary: HOOK_SUMMARY }));
    f.service.record({ provider: "openai", agent: "codex", sessionId: "taken", summary: "이어받음" }, "manual", "openai");
    expect(f.service.end("taken", "openai").deleted).toBe(false);

    // Resuming the same session, a progress update or a retried continuation all clear the end on record.
    expect(f.service.record(input("worked", { summary: HOOK_SUMMARY })).session.endedAt).toBeNull();
    expect(f.service.show("worked").session.endReason).toBeNull();
    f.service.end("worked", "openai", "logout");
    expect(f.service.update("worked", "다시 진행").session.endedAt).toBeNull();
    expect(f.service.show("worked").session.endedAt).toBeNull();
    f.service.end("taken", "openai", "other");
    const retried = f.service.record({ provider: "openai", agent: "codex", sessionId: "taken", summary: "이어받음" }, "manual", "openai");
    expect(retried.session.endedAt).toBeNull();
    expect(f.service.show("taken").session.endedAt).toBeNull();

    // The reason is optional text under the usual limits; an unknown session is an error like any lookup.
    expect(() => f.service.end("worked", "openai", "x".repeat(201))).toThrow("reason");
    expect(() => f.service.end("missing", "openai")).toThrow("찾을 수 없습니다");
    expect(f.service.end("worked", "openai").session.endReason).toBeNull();
  });

  test("retention of 0 keeps every record regardless of age", () => {
    f.service.record(input("ancient")); f.service.record(input("recent"));
    age(f.db, "ancient", 4000);
    f.service.update("recent", "진행");
    expect(f.service.list().page.total).toBe(2);
    expect(f.service.show("ancient").session.providerSessionId).toBe("ancient");
  });

  test("text and directory validation; old paths stay readable; continuation override", () => {
    expect(() => f.service.record(input(" "))).toThrow();
    expect(() => f.service.record(input("a", { summary: "\n " }))).toThrow();
    expect(() => f.service.record(input("a", { summary: "x".repeat(4001) }))).toThrow();
    expect(() => f.service.record(input("a", { sessionName: "x".repeat(201) }))).toThrow();
    expect(() => f.service.record(input("a", { cwd: "relative" }))).toThrow();
    const old = path.join(f.dir, "old"); mkdirSync(old);
    f.service.record(input("a", { cwd: old, provider: "OPENAI", agent: "CODEX" }));
    rmdirSync(old);
    expect(f.service.list({ cwd: old }).page.total).toBe(1);
    expect(f.service.latest("codex", old).session.provider).toBe("openai");
    expect(() => f.service.record({ ...input("b"), cwd: undefined }, "a")).toThrow();
    expect(f.service.record(input("b"), "a").session.parentSessionId).toBe(f.service.show("a").session.id);
  });
});
