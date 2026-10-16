import { describe, expect, test } from "bun:test";
import type { ChainNode, Session, SessionUpdate } from "../src/session/session.types";
import { gitLabel, isStale, STALE_HOURS, statusLabel } from "../src/web/lib/format";
import { handoffMarkdown } from "../src/web/lib/handoff";
import { resumeCommand } from "../src/web/lib/resume-command";

const at = "2026-10-16T03:00:00.000Z";
const session: Session = { id: "ses_1", provider: "anthropic", agent: "claude-code", providerSessionId: "id'1", sessionName: "로그인 수정",
  model: "claude-opus-5", workingDirectory: "C:/workspace/app", summary: "콜백 수정\n```bash\necho note\n```\n모바일 확인 남음",
  parentSessionId: "ses_0", createdAt: at, updatedAt: at, endedAt: null, endReason: null, status: "blocked", pinned: true,
  git: { branch: "main", commit: "abc1234", dirty: 2, at } };
const update = (sequence: number, summary: string, status: SessionUpdate["status"] = null): SessionUpdate =>
  ({ id: `upd_${sequence}`, sessionId: "ses_1", sequence, summary, status, createdAt: at });
const node = (id: string, depth: number, current: boolean, extra: Partial<ChainNode> = {}): ChainNode => ({ id: `ses_${id}`, provider: "openai", agent: "codex",
  providerSessionId: id, sessionName: `세션 ${id}`, summary: `${id} 요약`, status: null, pinned: false, createdAt: at, updatedAt: at, endedAt: null,
  parentSessionId: null, depth, current, ...extra });

describe("Hand-over note and host commands", () => {
  test("each host reopens its own session; the id is quoted for the shell and unknown tools get no command", () => {
    expect(resumeCommand({ agent: "claude-code", providerSessionId: "a'b" }, "powershell")).toBe("claude --resume 'a''b'");
    expect(resumeCommand({ agent: "claude-code", providerSessionId: "a'b" }, "bash")).toBe("claude --resume 'a'\"'\"'b'");
    expect(resumeCommand({ agent: "codex", providerSessionId: "x" }, "bash")).toBe("codex resume 'x'");
    expect(resumeCommand({ agent: "grok", providerSessionId: "x" }, "bash")).toBe("grok --resume 'x'");
    expect(resumeCommand({ agent: "cursor", providerSessionId: "x" }, "bash")).toBeNull();
    expect(resumeCommand({ agent: "constructor", providerSessionId: "x" }, "bash")).toBeNull();
  });

  test("a session reads as stale only while it is neither closed nor finished and has gone quiet for hours", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    const quiet = new Date(now - (STALE_HOURS + 1) * 3_600_000).toISOString();
    const recent = new Date(now - (STALE_HOURS - 1) * 3_600_000).toISOString();
    expect(isStale({ endedAt: null, status: null, updatedAt: quiet }, now)).toBe(true);
    expect(isStale({ endedAt: null, status: "working", updatedAt: quiet }, now)).toBe(true);
    expect(isStale({ endedAt: null, status: "blocked", updatedAt: quiet }, now)).toBe(true);
    expect(isStale({ endedAt: null, status: "handoff", updatedAt: quiet }, now)).toBe(false);
    expect(isStale({ endedAt: null, status: "done", updatedAt: quiet }, now)).toBe(false);
    expect(isStale({ endedAt: at, status: null, updatedAt: quiet }, now)).toBe(false);
    expect(isStale({ endedAt: null, status: null, updatedAt: recent }, now)).toBe(false);
    expect(statusLabel(null)).toBe("미기록"); expect(statusLabel("handoff")).toBe("인계 대기");
    expect(gitLabel(null)).toBe("기록 없음");
    expect(gitLabel({ branch: null, commit: "abc", dirty: 0, at })).toBe("(브랜치 없음) @ abc · 깨끗함");
    expect(gitLabel({ branch: "main", commit: null, dirty: 3, at })).toBe("main · 수정 3건");
  });

  test("the note carries the session's words, its state, the clue, the links and the commands, and keeps fences quoted", () => {
    const markdown = handoffMarkdown({ session, parentSession: { id: "ses_0", provider: "openai", agent: "codex", providerSessionId: "p", sessionName: null, summary: "이전", status: "done" },
      children: [{ id: "ses_2", provider: "xai", agent: "grok", providerSessionId: "c", sessionName: "후속", summary: "후속", status: null }], childrenTotal: 3,
      updates: [update(2, "두 번째", "blocked")], updatesTotal: 5 }, { shell: "bash", storeDirectory: "C:/store" });
    expect(markdown).toStartWith("# 인계: 로그인 수정\n");
    for (const piece of ["- Agent: anthropic / claude-code (claude-opus-5)", "- Agent Session ID: `id'1`", "- 프로젝트: `C:/workspace/app`",
      "- 작업 상태: 막힘 · 고정", "- Git: main @ abc1234 · 수정 2건", "- 세션 종료: 기록 없음",
      "## 최근 작업 요약\n\n> 콜백 수정\n> ```bash\n> echo note\n> ```\n> 모바일 확인 남음",
      "## 기록 이력 (최신순 · 5건 중 1건)", "### #2 ·", "· 막힘\n\n> 두 번째",
      "## 세션 연결", "- 이전 세션: 이름 없는 세션 · openai / codex · `p`", "- 이어받은 세션: 후속 · xai / grok · `c`", "- 이어받은 세션 2건 더 있음",
      "- Relay 기록 조회: `relay show 'id'\"'\"'1' --provider 'anthropic' --data-dir 'C:/store' --json`",
      "- 원본 세션 재개: `claude --resume 'id'\"'\"'1'`", "실제 프로젝트 파일도 확인하세요."]) expect(markdown).toContain(piece);
    expect(markdown).not.toContain("세션 흐름");
    expect(markdown).toEndWith("\n");
    // With a chain the flow replaces the direct links, indented by depth and marking where this session stands.
    const flow = handoffMarkdown({ session, chain: [node("root", 0, false), node("here", 1, true, { status: "handoff" }), node("next", 2, false, { status: "working" })] },
      { shell: "powershell" });
    expect(flow).toContain("## 세션 흐름\n\n- 세션 root · openai / codex · `root`\n  - 세션 here · openai / codex · `here` · **현재**\n    - 세션 next · openai / codex · `next` · 작업 중");
    expect(flow).not.toContain("## 세션 연결"); expect(flow).not.toContain("## 기록 이력");
    expect(flow).toContain("`relay show 'id''1' --provider 'anthropic' --json`");
    // A tool Relay does not know leaves the resume line out instead of guessing.
    const unknown = handoffMarkdown({ session: { ...session, agent: "cursor", git: null, status: null, pinned: false, model: null } }, { shell: "bash" });
    expect(unknown).toContain("- Agent: anthropic / cursor\n"); expect(unknown).toContain("- 작업 상태: 미기록\n"); expect(unknown).toContain("- Git: 기록 없음");
    expect(unknown).not.toContain("원본 세션 재개");
  });
});
