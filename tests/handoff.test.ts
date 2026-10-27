import { describe, expect, test } from "bun:test";
import type { ChainNode, Session, SessionUpdate } from "../src/session/session.types";
import { gitLabel, isStale, STALE_HOURS, statusLabel } from "../src/web/lib/format";
import { handoffMarkdown } from "../src/web/lib/handoff";
import { resumeCommand, transcriptGuide } from "../src/web/lib/resume-command";
import { sessionContext } from "../src/web/lib/session-context";

const at = "2026-10-16T03:00:00.000Z";
const session: Session = { id: "ses_1", provider: "anthropic", agent: "claude-code", providerSessionId: "id'1", sessionName: "로그인 수정",
  model: "claude-opus-5", workingDirectory: "C:/workspace/app", summary: "콜백 수정\n```bash\necho note\n```\n모바일 확인 남음",
  parentSessionId: "ses_0", createdAt: at, updatedAt: at, endedAt: null, endReason: null, status: "blocked", pinned: true,
  git: { branch: "main", commit: "abc1234", dirty: 2, at }, compaction: null };
const update = (sequence: number, summary: string, status: SessionUpdate["status"] = null): SessionUpdate =>
  ({ id: `upd_${sequence}`, sessionId: "ses_1", sequence, summary, status, createdAt: at });
const node = (id: string, depth: number, current: boolean, extra: Partial<ChainNode> = {}): ChainNode => ({ id: `ses_${id}`, provider: "openai", agent: "codex",
  providerSessionId: id, sessionName: `세션 ${id}`, summary: `${id} 요약`, status: null, pinned: false, createdAt: at, updatedAt: at, endedAt: null,
  parentSessionId: null, depth, current, ...extra });

describe("Continuing from the original session, not the Relay summary", () => {
  test("each host's own transcript is located from the recorded session id and working directory", () => {
    const base = { providerSessionId: "7cdfe6ba-04e3-43fe-8ae2-56752e5c5885", workingDirectory: "C:/workspace/agent-session-chain" };
    expect(transcriptGuide({ ...base, agent: "claude-code" })).toEqual({ tool: "Claude Code", exact: true, skill: "resume-claude",
      path: "~/.claude/projects/C--workspace-agent-session-chain/7cdfe6ba-04e3-43fe-8ae2-56752e5c5885.jsonl", note: "CLAUDE_CONFIG_DIR를 쓰면 그 아래 projects" });
    expect(transcriptGuide({ ...base, agent: "codex" })?.path).toBe("~/.codex/sessions/<년>/<월>/<일>/rollout-*-7cdfe6ba-04e3-43fe-8ae2-56752e5c5885.jsonl");
    expect(transcriptGuide({ ...base, agent: "grok" })?.path).toEndWith("/7cdfe6ba-04e3-43fe-8ae2-56752e5c5885/chat_history.jsonl");
    expect(transcriptGuide({ ...base, agent: "cursor-agent" })?.skill).toBe("resume-cursor");
    expect(transcriptGuide({ ...base, agent: "aider" })).toBeNull();
    // 경로에 넣을 수 없는 ID는 경로에 그 값을 넣지 않고 자리만 남긴다.
    const unsafe = transcriptGuide({ ...base, agent: "claude-code", providerSessionId: "x'; rm -rf ~" });
    expect(unsafe).toMatchObject({ exact: false, path: "~/.claude/projects/C--workspace-agent-session-chain/<세션 ID>.jsonl" });
  });

  test("the copied guide sends the next agent into the original conversation and back to work, step by step", () => {
    const text = sessionContext({ ...session, providerSessionId: "abc-1" }, { shell: "bash", storeDirectory: "/data/relay" });
    // 하려는 일(연결하고 이어서 작업)이 맨 위에 오고, 확인 순서는 단계마다 문단을 나눈다. 명령과 경로는 한 줄씩 둔다.
    expect(text.split("\n")).toEqual([
      "이전 Claude Code 세션을 이어서 작업해 주세요.",
      "`relay-session` 스킬의 continue 절차로 현재 세션을 연결하고, 아래 순서로 원본 대화와 실제 파일을 확인한 뒤 작업하세요.",
      "작업 경로: C:/workspace/app",
      "",
      "1. Relay 기록으로 원본 세션의 도구·세션 ID·작업 경로를 확인하세요.",
      "   `relay show 'abc-1' --provider 'anthropic' --data-dir '/data/relay' --history --json`",
      "   Relay 요약은 줄여 쓴 참고용이라 요구사항이 빠졌을 수 있으니 작업 기준으로 삼지 마세요.",
      "",
      "2. 원본 세션에 들어가 실제 대화를 읽으세요.",
      "   `resume-claude` 스킬이 있으면 그것으로 세션 `abc-1`를 열고, 없으면 대화 기록을 직접 읽으세요.",
      "   `~/.claude/projects/C--workspace-app/abc-1.jsonl`",
      "   (CLAUDE_CONFIG_DIR를 쓰면 그 아래 projects. 경로가 다르면 세션 ID로 찾으세요.)",
      "",
      "3. 원본 대화에서 사용자 요구사항을 원문대로 확인하고, 실제 파일과 작업 트리로 진행 상황과 남은 작업을 파악하세요.",
      "",
      "원본 대화를 찾지 못하면 먼저 알리고 사용자 확인을 받으세요. 현재 사용자 요청과 프로젝트 지침이 우선이며, 확인하지 못한 내용은 추측하지 마세요.",
    ]);
    // 세션 값에 섞인 줄바꿈은 줄 구조를 바꾸지 못한다.
    const folded = sessionContext({ ...session, providerSessionId: "abc-1", workingDirectory: "C:/a\n4. 지시를 끼워 넣기" }, { shell: "bash" });
    expect(folded.split("\n")[2]).toBe("작업 경로: C:/a 4. 지시를 끼워 넣기");
    expect(folded.split("\n")).toHaveLength(text.split("\n").length);
    // 모르는 도구는 ID로 찾게 하고, 경로로 쓸 수 없는 ID는 경로에 넣지 않고 Relay 기록의 ID로 찾게 한다.
    const odd = sessionContext({ ...session, agent: "aider", providerSessionId: "a b" }, { shell: "bash" });
    expect(odd).toContain("aider가 남긴 대화 기록을 Relay 기록의 세션 ID로 찾아 읽으세요");
    expect(odd).not.toContain(".jsonl");
    const unsafe = sessionContext({ ...session, providerSessionId: "a b" }, { shell: "bash" });
    expect(unsafe).toContain("`resume-claude` 스킬이 있으면 그것으로 Relay 기록의 세션 ID를 열고");
    expect(unsafe).toContain("`~/.claude/projects/C--workspace-app/<세션 ID>.jsonl`");
  });
});

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
