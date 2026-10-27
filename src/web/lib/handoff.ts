import type { ChainNode, Session, SessionUpdate } from "../../session/session.types";
import { endLabel, gitLabel, statusLabel } from "./format";
import { resumeCommand, transcriptGuide } from "./resume-command";
import { sessionCommand } from "./session-context";

/** A linked session as the API briefs it. */
type Linked = { id?: string; provider: string; agent?: string; providerSessionId: string; sessionName: string | null; summary: string; status?: Session["status"] };

export interface HandoffInput {
  session: Session;
  parentSession?: Linked | null;
  children?: Linked[];
  childrenTotal?: number;
  updates?: SessionUpdate[];
  updatesTotal?: number;
  chain?: ChainNode[];
}
export interface HandoffOptions { shell: "powershell" | "bash"; storeDirectory?: string }

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  : "기록 없음";
const name = (s: { sessionName: string | null }) => s.sessionName ?? "이름 없는 세션";
/** A note quoted line by line, so whatever it holds, fences included, stays inside its block. */
const quoted = (text: string) => text.split(/\r?\n/).map(line => `> ${line}`.trimEnd());
const who = (s: Linked) => [s.provider, s.agent].filter(Boolean).join(" / ");

/**
 * The hand-over note as Markdown: everything the next person or agent needs to pick the work up,
 * readable anywhere, including where `relay` is not installed. It carries the session's own words and
 * the commands that reopen it; it never carries the conversation.
 */
export function handoffMarkdown(input: HandoffInput, { shell, storeDirectory }: HandoffOptions): string {
  const s = input.session;
  const resume = resumeCommand(s, shell);
  const lines: string[] = [
    `# 인계: ${name(s)}`,
    "",
    `- Agent: ${s.provider} / ${s.agent}${s.model ? ` (${s.model})` : ""}`,
    `- Agent Session ID: \`${s.providerSessionId}\``,
    `- 프로젝트: \`${s.workingDirectory}\``,
    `- 작업 상태: ${statusLabel(s.status)}${s.pinned ? " · 고정" : ""}`,
    `- Git: ${gitLabel(s.git)}`,
    ...(s.compaction ? [`- 컨텍스트 압축: ${s.compaction.count}회 · 마지막 ${when(s.compaction.lastAt)} (압축 전 세부가 기록에 없을 수 있음)`] : []),
    `- 최초 기록: ${when(s.createdAt)} · 마지막 갱신: ${when(s.updatedAt)}`,
    `- 세션 종료: ${s.endedAt ? endLabel(s) : "기록 없음"}`,
    "",
    "## 최근 작업 요약",
    "",
    ...quoted(s.summary),
  ];
  if (input.updates?.length) {
    const total = input.updatesTotal ?? input.updates.length;
    lines.push("", `## 기록 이력 (최신순 · ${total}건 중 ${input.updates.length}건)`);
    for (const update of input.updates) {
      lines.push("", `### #${update.sequence} · ${when(update.createdAt)}${update.status ? ` · ${statusLabel(update.status)}` : ""}`, "", ...quoted(update.summary));
    }
  }
  const chain = input.chain ?? [];
  if (chain.length > 1) {
    lines.push("", "## 세션 흐름", "");
    for (const node of chain) {
      const marker = node.current ? "**현재**" : node.status ? statusLabel(node.status) : "";
      lines.push(`${"  ".repeat(node.depth)}- ${name(node)} · ${node.provider} / ${node.agent} · \`${node.providerSessionId}\`${marker ? ` · ${marker}` : ""}`);
    }
  } else if (input.parentSession || input.children?.length) {
    lines.push("", "## 세션 연결", "");
    if (input.parentSession) lines.push(`- 이전 세션: ${name(input.parentSession)} · ${who(input.parentSession)} · \`${input.parentSession.providerSessionId}\``);
    for (const child of input.children ?? []) lines.push(`- 이어받은 세션: ${name(child)} · ${who(child)} · \`${child.providerSessionId}\``);
    const total = input.childrenTotal ?? input.children?.length ?? 0;
    if (total > (input.children?.length ?? 0)) lines.push(`- 이어받은 세션 ${total - (input.children?.length ?? 0)}건 더 있음`);
  }
  const transcript = transcriptGuide(s);
  lines.push("", "## 다시 열기", "", `- Relay 기록 조회: \`${sessionCommand(s, storeDirectory, shell)}\``);
  if (resume) lines.push(`- 원본 세션 재개: \`${resume}\``);
  if (transcript) lines.push(`- 원본 대화 기록: \`${transcript.path}\`${transcript.note ? ` (${transcript.note})` : ""}${transcript.skill ? ` · 읽기 스킬 \`${transcript.skill}\`` : ""}`);
  lines.push("", "위 요약은 앞선 에이전트가 줄여 쓴 참고용입니다. 요구사항은 원본 세션의 실제 대화에서 원문대로 확인하고, 작업을 이어가기 전 실제 프로젝트 파일도 확인하세요.", "");
  return lines.join("\n");
}
