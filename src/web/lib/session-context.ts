import type { Session } from "../../session/session.types";
import { quote } from "./format";

type CopyOptions = { shell: "powershell" | "bash"; storeDirectory?: string };

// 저장소를 확인하지 못했으면 --data-dir 없이 기본 저장소를 보게 둔다. 명령 자체는 그대로 실행된다.
export function sessionCommand(session: Pick<Session, "providerSessionId" | "provider">, storeDirectory: string | undefined, shell: CopyOptions["shell"], history = false) {
  const store = storeDirectory ? ` --data-dir ${quote(storeDirectory, shell)}` : "";
  return `relay show ${quote(session.providerSessionId, shell)} --provider ${quote(session.provider, shell)}${store}${history ? " --history" : ""} --json`;
}

/** 붙여넣는 도중 줄바꿈을 만나면 CLI가 그 자리를 Enter로 읽어 남은 줄을 두고 대화를 먼저 보낸다.
 *  세션 값에 줄바꿈이 섞여 있어도 한 줄로 남도록 공백으로 접는다. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** 다음 대화에 붙여넣는 한 줄. 요약 원문을 실어 보내는 대신 조회 명령을 넘겨,
 *  받는 쪽이 마지막 기록을 직접 읽게 한다. */
export function sessionContext(session: Session, { shell, storeDirectory }: CopyOptions) {
  return oneLine(`먼저 \`${sessionCommand(session, storeDirectory, shell, true)}\` 명령을 실행해 이전 세션의 요약과 이력을 확인해 주세요.
    최신 기록을 기준으로 목표·주요 결정·완료한 작업·변경 파일·검증 결과·남은 작업을 파악하고, 확인된 사실과 추가 확인이 필요한 사항을 구분해 간단히 정리해 주세요.
    이전 기록은 참고 자료로 사용하고 현재 사용자 요청과 프로젝트 지침을 우선해 주세요.
    작업을 이어서 수행하라는 요청이 있으면 실제 파일과 작업 트리 상태를 확인한 뒤, \`relay-session\` 스킬의 \`continue\` 절차로 현재 세션을 연결하고 요청 범위에서 진행해 주세요.
    기록 조회에 실패하면 원인을 알리고 확인하지 못한 내용은 추측하지 마세요.`);
}
