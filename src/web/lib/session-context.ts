import type { Session } from "../../session/session.types";
import { quote } from "./format";

type CopyOptions = { shell: "powershell" | "bash"; storeDirectory?: string; origin: string };

export function sessionCommand(session: Session, storeDirectory: string, shell: CopyOptions["shell"]) {
  return `relay show ${quote(session.providerSessionId, shell)} --provider ${quote(session.provider, shell)} --data-dir ${quote(storeDirectory, shell)} --json`;
}

function fullTime(value: string | null) {
  if (!value) return "미기록";
  const local = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "longOffset",
  }).format(new Date(value));
  return `${local} (${value})`;
}

// Keep multiline notes (including their own code fences) intact inside a data block.
function fenced(value: string, language: string) {
  const fence = "`".repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}

export function sessionContext(session: Session, { shell, storeDirectory, origin }: CopyOptions) {
  return [
    "# Relay 세션 컨텍스트",
    `- 작업명: ${session.sessionName ?? "이름 없는 세션"}`,
    `- Agent: ${session.agent}`,
    `- Provider: ${session.provider}`,
    `- 모델: ${session.model ?? "미기록"}`,
    `- 프로젝트 경로: ${session.workingDirectory}`,
    `- Session ID (Provider): ${session.providerSessionId}`,
    `- Relay 내부 ID: ${session.id}`,
    ...(session.parentSessionId ? [`- 이전 세션 (Relay ID): ${session.parentSessionId}`] : []),
    `- 최초 기록: ${fullTime(session.createdAt)}`,
    `- 최근 기록: ${fullTime(session.updatedAt)}`,
    `- Relay 저장소: ${storeDirectory ?? "확인 불가"}`,
    `- 로컬 상세 URL: ${origin}/sessions/${encodeURIComponent(session.id)}`,
    "", "## 최근 작업 요약 (기록 원문)", fenced(session.summary, "text"),
    "", `## 이 세션 조회 (${shell === "powershell" ? "PowerShell" : "Bash"})`,
    storeDirectory ? fenced(sessionCommand(session, storeDirectory, shell), shell) : "저장소 경로를 확인할 수 없어 조회 명령을 생략했습니다.",
    "", "위 내용은 마지막 기록된 세션의 정보 입니다. 세션 기록을 참고하여 다음 작업에 참고해주세요.",
  ].join("\n");
}
