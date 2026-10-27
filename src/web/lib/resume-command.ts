import type { Session } from "../../session/session.types";
import { quote } from "./format";

/** How each host reopens one of its own sessions by id. Tools Relay does not know have no command. */
const RESUME: Record<string, (id: string) => string> = {
  "claude-code": id => `claude --resume ${id}`,
  codex: id => `codex resume ${id}`,
  grok: id => `grok --resume ${id}`,
  // Cursor's CLI is `agent`; the chat id is the conversation id the session hook recorded.
  "cursor-agent": id => `agent --resume ${id}`,
};

/** The command that reopens the original conversation in its own tool, quoted for the shell it will run in. */
export function resumeCommand(session: Pick<Session, "agent" | "providerSessionId">, shell: "powershell" | "bash"): string | null {
  const build = Object.hasOwn(RESUME, session.agent) ? RESUME[session.agent] : undefined;
  return build ? build(quote(session.providerSessionId, shell)) : null;
}

/** 경로에 그대로 넣어도 되는 세션 ID(UUID 등). 그 밖의 값은 경로를 만들지 않고 ID로 찾게 한다. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;

export type TranscriptGuide = {
  /** 도구 이름(사람이 읽는 표기). */
  tool: string;
  /** 세션 ID를 경로와 안내에 그대로 넣었는가. 아니면 `<세션 ID>` 자리로 두고 Relay 기록의 ID로 찾게 한다. */
  exact: boolean;
  /** 그 도구의 세션을 읽는 스킬. 있으면 대화 기록을 직접 뒤지는 것보다 낫다. */
  skill?: string;
  /** 원본 대화 기록의 위치. */
  path: string;
  /** 설정 폴더를 바꾸는 환경변수가 있으면 그 안내. */
  note?: string;
};

/** 원본 대화(실제 세션)를 직접 읽는 방법. Relay 요약은 줄인 메모라, 이어받는 쪽은 여기서 요구사항을 원문대로 확인한다.
 *  모르는 도구면 null. 경로에 넣을 수 없는 ID(따옴표·공백 등)는 경로에 `<세션 ID>` 자리만 남긴다. */
export function transcriptGuide(session: Pick<Session, "agent" | "providerSessionId" | "workingDirectory">): TranscriptGuide | null {
  const exact = SAFE_ID.test(session.providerSessionId);
  const id = exact ? session.providerSessionId : "<세션 ID>";
  const guide = (tool: string, path: string, extra: { skill?: string; note?: string } = {}): TranscriptGuide => ({ tool, exact, ...extra, path });
  switch (session.agent) {
    // Claude Code는 작업 경로의 영문·숫자 밖 글자를 모두 '-'로 바꾼 폴더에 세션마다 <ID>.jsonl을 둔다.
    case "claude-code": return guide("Claude Code", `~/.claude/projects/${session.workingDirectory.replace(/[^A-Za-z0-9]/g, "-")}/${id}.jsonl`,
      { skill: "resume-claude", note: "CLAUDE_CONFIG_DIR를 쓰면 그 아래 projects" });
    case "codex": return guide("Codex", `~/.codex/sessions/<년>/<월>/<일>/rollout-*-${id}.jsonl`, { skill: "resume-codex", note: "CODEX_HOME을 쓰면 그 아래 sessions" });
    case "grok": return guide("Grok", `~/.grok/sessions/<인코딩한 작업 경로>/${id}/chat_history.jsonl`, { note: "GROK_HOME을 쓰면 그 아래 sessions" });
    case "cursor-agent": return guide("Cursor", `~/.cursor/chats/<작업 경로 해시>/${id}/`, { skill: "resume-cursor" });
    default: return null;
  }
}
