import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { human } from "../src/output/human";
import { clip, localTime, wrap, width } from "../src/output/terminal";
import type { Session } from "../src/session/session.types";

const at = "2026-09-16T04:02:09.792Z";
function session(index: number, extra: Partial<Session> = {}): Session {
  return { id: `ses_00000000-0000-0000-0000-00000000000${index}`, provider: "anthropic", agent: "claude-code",
    providerSessionId: `f47ac10b-58cc-4372-a567-0e02b2c3d4000${index}`, sessionName: `세션 이름 ${index}`,
    model: "claude-opus-5", workingDirectory: "C:/workspace/agent-session-chain",
    summary: "요약 텍스트", parentSessionId: null, createdAt: at, updatedAt: at, ...extra };
}

describe("Terminal output", () => {
  test("width counts Korean as two columns and control characters as none", () => {
    expect(width("abc")).toBe(3);
    expect(width("세션")).toBe(4);
    expect(width("세션 a")).toBe(6);
    expect(width("\u001b")).toBe(0);
  });

  test("clip and wrap never exceed the requested column budget", () => {
    for (const max of [1, 2, 3, 4, 7, 12, 30]) {
      expect(width(clip("한글 이름이 아주 길어서 잘려야 합니다", max))).toBeLessThanOrEqual(max);
      expect(width(clip("plain ascii text that is also long", max))).toBeLessThanOrEqual(max);
      // A single Korean character needs two columns, so wrapping can only honour budgets of two or more.
      for (const line of wrap("한글 요약 문장과 ascii mixed content that must wrap cleanly", max)) {
        expect(width(line)).toBeLessThanOrEqual(Math.max(max, 2));
      }
    }
    expect(clip("한글 이름", 20)).toBe("한글 이름");
    expect(clip("한글 이름이 길다", 10)).toEndWith("...");
    expect(clip("여러  공백\n줄", 20)).toBe("여러 공백 줄");
    expect(wrap("한 줄", 20)).toEqual(["한 줄"]);
  });

  test("table columns align across Korean and ASCII rows and fit the terminal", () => {
    const items = [session(1), session(2, { sessionName: "ascii name" }),
      session(3, { sessionName: "아주 긴 한글 세션 이름이 들어가는 경우", summary: "긴 ".repeat(60) })];
    for (const space of [70, 100, 160]) {
      const lines = human({ items, page: { total: 3, offset: 0 } }, space).split("\n");
      const rows = lines.filter(line => line.includes("f47ac10b-"));
      expect(rows.length).toBe(3);
      const starts = rows.map(row => width(row.slice(0, row.indexOf("f47ac10b-"))));
      expect(new Set(starts).size).toBe(1);
      for (const line of lines) expect(width(line)).toBeLessThanOrEqual(space);
    }
  });

  test("detail keeps every field readable and history stays in sequence", () => {
    const view = human({ session: session(1, { summary: "요약 ".repeat(40) }),
      parentSession: { providerSessionId: "parent-id" }, children: [{ providerSessionId: "child-id" }],
      childrenPage: { total: 1 },
      updates: [{ id: "upd", sessionId: "ses", sequence: 2, summary: "진행 ".repeat(30), createdAt: at },
        { id: "upd", sessionId: "ses", sequence: 1, summary: "시작", createdAt: at }],
      updatesPage: { total: 2 } }, 80);
    const lines = view.split("\n");
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(80);
    expect(view).toContain("f47ac10b-58cc-4372-a567-0e02b2c3d40001");
    expect(view).toContain("parent-id"); expect(view).toContain("child-id");
    expect(view).toContain("기록 이력 (2건)");
    expect(lines.findIndex(l => l.includes("#2"))).toBeLessThan(lines.findIndex(l => l.includes("#1")));
    expect(view).toContain("최초 기록");
    for (const forbidden of ["상태", "종료", "START", "PROGRESS", "END"]) expect(view).not.toContain(forbidden);
  });

  test("redirected output carries no escape sequences and empty results say so", () => {
    const listed = human({ items: [session(1)], page: { total: 1, offset: 0 } }, 100);
    expect(listed).not.toContain("\u001b");
    expect(human({ items: [], page: { total: 0, offset: 0 } }, 100)).toContain("조회된 세션이 없습니다.");
    expect(human({ items: [{ sequence: 1 }] }, 100)).toContain("\"sequence\": 1");
  });

  test("TTY colors preserve plain text and alignment; environment overrides do not leak ANSI", () => {
    const items = [session(1), session(2, { provider: "openai", agent: "codex" }),
      session(3, { provider: "xai", agent: "grok" }), session(4, { provider: "custom", agent: "agent" })];
    const inputs = [70, 100, 160, 200].map(space => ({ value: { items, page: { total: 4, offset: 0 } }, space }));
    const detail = { session: items[0], updates: [{ id: "upd", sessionId: items[0]!.id, sequence: 1,
      summary: "여러 줄\n요약 그대로", createdAt: at }], updatesPage: { total: 1 } };
    const render = (tty: boolean, overrides: Record<string, string | undefined> = {}) => {
      const script = `Object.defineProperty(process.stdout, "isTTY", { value: ${tty} });
        const { human } = await import(${JSON.stringify(new URL("../src/output/human.ts", import.meta.url).href)});
        const inputs = ${JSON.stringify([...inputs, { value: detail, space: 80 }])};
        process.stdout.write(JSON.stringify(inputs.map(({ value, space }) => human(value, space))));`;
      const result = Bun.spawnSync([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe",
        env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, ...overrides } });
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout.toString()) as string[];
    };
    const plain = render(false);
    const colored = render(true);
    expect(colored).toEqual(render(false, { FORCE_COLOR: "1" }));
    expect(colored.map(stripVTControlCharacters)).toEqual(plain);
    for (const text of colored) expect(text).toMatch(/\x1b\[[\d;]+m/);
    for (const text of plain) expect(text).not.toContain("\x1b");
    expect(render(true, { NO_COLOR: "1", FORCE_COLOR: "1" })).toEqual(plain);
    expect(render(true, { FORCE_COLOR: "0" })).toEqual(plain);
    for (const [index, space] of [70, 100, 160, 200, 80].entries()) {
      for (const line of stripVTControlCharacters(colored[index]!).split("\n")) expect(width(line)).toBeLessThanOrEqual(space);
    }
    const providerCodes = ["openai/codex", "anthropic/claude-code", "xai/grok"]
      .map(label => colored[3]!.match(new RegExp(`\\x1b\\[([\\d;]+)m${label}\\x1b`))?.[1]);
    expect(providerCodes.every(Boolean)).toBe(true);
    expect(new Set(providerCodes).size).toBe(3);
  });

  test("timestamps render in local time and keep unparsable values", () => {
    const local = new Date(at);
    expect(localTime(at)).toBe(`${local.getFullYear()}-09-16 ${String(local.getHours()).padStart(2, "0")}:02`);
    expect(localTime(at, true)).toMatch(/:09 [+-]\d{2}:\d{2}$/);
    expect(localTime("nonsense")).toBe("nonsense");
  });
});
