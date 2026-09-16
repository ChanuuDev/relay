import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { age, fixture, input } from "./helpers";

describe("Session Service", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => f.close());

  test("atomic lifecycle and descending history", () => {
    const start = f.service.start(input("a")).session;
    expect(start.status).toBe("ACTIVE"); expect(start.model).toBeNull();
    f.service.update("a", "중간\n요약");
    const ended = f.service.finish("a", "완료", "completed").session;
    const result = f.service.show("a", undefined, true);
    expect(ended.endedAt).toBe(ended.updatedAt);
    expect(result.updates?.map(u => [u.sequence, u.type])).toEqual([[3, "END"], [2, "PROGRESS"], [1, "START"]]);
    expect(result.updates?.[0].summary).toBe(result.session.summary);
    expect(result.updates?.[0].createdAt).toBe(result.session.updatedAt);
  });

  test("start and finish retries retain current values without duplicate history", () => {
    f.service.start(input("a")); f.service.update("a", "변경"); f.service.finish("a", "완료", "completed");
    const before = f.service.show("a", undefined, true);
    expect(f.service.start(input("a")).session).toEqual(before.session);
    expect(f.service.finish("a", "완료", "COMPLETED").session).toEqual(before.session);
    expect(f.service.show("a", undefined, true)).toEqual(before);
    expect(() => f.service.start(input("a", { summary: "다른 시작" }))).toThrow("생성 정보");
    expect(() => f.service.update("a", "불가")).toThrow("종료된");
    expect(() => f.service.finish("a", "완료", "interrupted")).toThrow("종료된");
  });

  test("continuation inherits name/path, keeps parent, permits branches and retries", () => {
    const parentInput = input("parent", { provider: "anthropic", agent: "claude-code", sessionName: "부모 이름", model: "parent-model" });
    f.service.start(parentInput);
    expect(() => f.service.start(input("child"), "parent")).toThrow("ACTIVE 부모");
    f.service.finish("parent", "중단", "interrupted");
    const before = f.service.show("parent", undefined, true);
    const childInput = { provider: "openai", agent: "codex", sessionId: "child", summary: "재개" };
    const child = f.service.start(childInput, "parent", "anthropic");
    expect(child.session.parentSessionId).toBe(before.session.id);
    expect(child.session.sessionName).toBe("부모 이름"); expect(child.session.model).toBeNull();
    expect(child.session.workingDirectory).toBe(before.session.workingDirectory);
    f.service.start(input("branch"), "parent");
    f.service.update("child", "진행");
    expect(f.service.start(childInput, "parent").session.summary).toBe("진행");
    const after = f.service.show("parent", undefined, true);
    expect(after.session).toEqual(before.session); expect(after.updates).toEqual(before.updates);
    expect(after.childrenPage.total).toBe(2);
  });

  test("ambiguous provider IDs fail closed; parent provider is independent", () => {
    f.service.start(input("same"));
    f.service.start(input("same", { provider: "anthropic", agent: "claude-code" }));
    expect(() => f.service.show("same")).toThrow("여러 제공자");
    expect(() => f.service.update("same", "요약")).toThrow("여러 제공자");
    expect(f.service.show("same", "openai").session.provider).toBe("openai");
    f.service.finish("same", "중단", "interrupted", "anthropic");
    const child = f.service.start(input("child"), "same", "anthropic");
    expect(child.parentSession?.provider).toBe("anthropic"); expect(child.session.provider).toBe("openai");
  });

  test("latest filters BOTH provider and agent, all projects/statuses, reads never mutate", () => {
    f.service.start(input("codex"));
    f.service.start(input("claude1", { provider: "anthropic", agent: "claude-code" }));
    const selected = f.service.start(input("claude2", { provider: "anthropic", agent: "claude-code" })).session;
    f.service.start(input("other", { provider: "anthropic", agent: "other" }));
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
    const a = f.service.start(input("a")).session;
    const b = f.service.start(input("b", { cwd: f.dir })).session;
    f.db.query("UPDATE sessions SET updated_at='2026-01-01T00:00:00.000Z'").run();
    expect(f.service.latest("codex").session.id).toBe([a.id, b.id].sort().at(-1)!);
    expect(f.service.latest("codex", f.dir).session.id).toBe(b.id);
  });

  test("literal wildcard search, AND filters and paging above 100", () => {
    for (let n = 0; n < 105; n++) f.service.start(input(`item-${n}`, { summary: n === 0 ? "100%_\\테스트" : "일반 요약" }));
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
    const s = f.service.start(input("history")).session;
    for (let i = 0; i < 105; i++) f.service.update("history", "같은 요약");
    expect(f.service.updates(s.id).items[0].sequence).toBe(106);
    expect(f.service.updates(s.id, { limit: 100, offset: 100 }).items.map(u => u.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test("history failure rolls back insert/update/finish with no partial snapshot", () => {
    f.service.start(input("a"));
    const before = f.service.show("a", undefined, true);
    f.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON session_updates BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    expect(() => f.service.update("a", "실패")).toThrow();
    expect(() => f.service.finish("a", "실패", "completed")).toThrow();
    expect(() => f.service.start(input("b"))).toThrow();
    expect(f.service.show("a", undefined, true)).toEqual(before);
    expect(f.service.list().page.total).toBe(1);
  });

  test("retention deletes expired records on write, keeping live chains and the current session", () => {
    const r = fixture(30);
    try {
      r.service.start(input("alone"));
      r.service.start(input("old-root")); r.service.finish("old-root", "중단", "interrupted");
      r.service.start(input("old-leaf"), "old-root");
      r.service.start(input("kept-root")); r.service.finish("kept-root", "중단", "interrupted");
      r.service.start(input("kept-leaf"), "kept-root");
      for (const id of ["alone", "old-root", "old-leaf", "kept-root"]) age(r.db, id, 31);
      // Any write applies retention; the untouched chain disappears whole while the used one survives.
      r.service.update("kept-leaf", "진행");
      expect(r.service.list().items.map(s => s.providerSessionId).sort()).toEqual(["kept-leaf", "kept-root"]);
      expect(r.service.show("kept-leaf").parentSession?.providerSessionId).toBe("kept-root");
      // START/END of kept-root plus START/PROGRESS of kept-leaf; deleted sessions take their history with them.
      expect(r.db.query("SELECT count(*) AS n FROM session_updates").get()).toEqual({ n: 4 });
      // A retry that only reads back an expired session must not delete what it just returned.
      age(r.db, "kept-leaf", 31); age(r.db, "kept-root", 31);
      expect(r.service.start(input("kept-leaf"), "kept-root").session.providerSessionId).toBe("kept-leaf");
      expect(r.service.list().page.total).toBe(2);
    } finally { r.close(); }
  });

  test("retention of 0 keeps every record regardless of age", () => {
    f.service.start(input("ancient")); f.service.start(input("recent"));
    age(f.db, "ancient", 4000);
    f.service.update("recent", "진행");
    expect(f.service.list().page.total).toBe(2);
    expect(f.service.show("ancient").session.status).toBe("ACTIVE");
  });

  test("text and directory validation; old paths stay readable; continuation override", () => {
    expect(() => f.service.start(input(" "))).toThrow();
    expect(() => f.service.start(input("a", { summary: "\n " }))).toThrow();
    expect(() => f.service.start(input("a", { summary: "x".repeat(4001) }))).toThrow();
    expect(() => f.service.start(input("a", { sessionName: "x".repeat(201) }))).toThrow();
    expect(() => f.service.start(input("a", { cwd: "relative" }))).toThrow();
    const old = path.join(f.dir, "old"); mkdirSync(old);
    f.service.start(input("a", { cwd: old, provider: "OPENAI", agent: "CODEX" }));
    f.service.finish("a", "중단", "interrupted"); rmdirSync(old);
    expect(f.service.list({ cwd: old }).page.total).toBe(1);
    expect(f.service.latest("codex", old).session.provider).toBe("openai");
    expect(() => f.service.start({ ...input("b"), cwd: undefined }, "a")).toThrow();
    expect(f.service.start(input("b"), "a").session.status).toBe("ACTIVE");
  });
});
