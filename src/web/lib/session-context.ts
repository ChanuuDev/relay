import type { Session } from "../../session/session.types";
import { quote } from "./format";

type CopyOptions = { shell: "powershell" | "bash"; storeDirectory?: string };

// 저장소를 확인하지 못했으면 --data-dir 없이 기본 저장소를 보게 둔다. 명령 자체는 그대로 실행된다.
export function sessionCommand(session: Session, storeDirectory: string | undefined, shell: CopyOptions["shell"]) {
  const store = storeDirectory ? ` --data-dir ${quote(storeDirectory, shell)}` : "";
  return `relay show ${quote(session.providerSessionId, shell)} --provider ${quote(session.provider, shell)}${store} --json`;
}

/** 붙여넣는 도중 줄바꿈을 만나면 CLI가 그 자리를 Enter로 읽어 남은 줄을 두고 대화를 먼저 보낸다.
 *  세션 값에 줄바꿈이 섞여 있어도 한 줄로 남도록 공백으로 접는다. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** 다음 대화에 붙여넣는 한 줄. 요약 원문을 실어 보내는 대신 조회 명령을 넘겨,
 *  받는 쪽이 마지막 기록을 직접 읽게 한다. */
export function sessionContext(session: Session, { shell, storeDirectory }: CopyOptions) {
  return oneLine(`이전 세션 맥락은 \`${sessionCommand(session, storeDirectory, shell)}\` 명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요.`);
}
