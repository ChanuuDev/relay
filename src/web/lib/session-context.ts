import type { Session } from "../../session/session.types";
import { quote } from "./format";
import { transcriptGuide } from "./resume-command";

type CopyOptions = { shell: "powershell" | "bash"; storeDirectory?: string };

// 저장소를 확인하지 못했으면 --data-dir 없이 기본 저장소를 보게 둔다. 명령 자체는 그대로 실행된다.
export function sessionCommand(session: Pick<Session, "providerSessionId" | "provider">, storeDirectory: string | undefined, shell: CopyOptions["shell"], history = false) {
  const store = storeDirectory ? ` --data-dir ${quote(storeDirectory, shell)}` : "";
  return `relay show ${quote(session.providerSessionId, shell)} --provider ${quote(session.provider, shell)}${store}${history ? " --history" : ""} --json`;
}

/** 세션 값(경로·ID)에 섞인 줄바꿈은 공백으로 접어, 기록 내용이 안내 문장의 줄 구조를 바꾸지 못하게 한다. */
const fold = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** 표시만 하는 값은 백틱도 걷어 낸다(인라인 코드 표기를 깨지 않게). */
const plain = (text: string) => fold(text).replace(/`/g, "");

/** 다음 대화에 붙여넣는 이어받기 안내. 하려는 일(현재 세션을 연결하고 이어서 작업)을 맨 위에 두고,
 *  그 아래 확인 순서를 단다. Relay 기록은 원본 세션을 찾는 색인으로만 쓰고,
 *  받는 쪽이 원본 세션(실제 대화)에 들어가 요구사항을 원문대로 확인한 뒤 이어서 작업하게 한다.
 *  Relay 요약은 앞선 에이전트가 줄여 쓴 것이라 그것만 보면 요구사항이 축약될 수 있다.
 *  메모장에서도 읽히도록 단계마다 문단을 나누고, 명령과 경로는 한 줄씩 둔다. 최근 CLI는 여러 줄 붙여넣기를 한 번에 받는다. */
export function sessionContext(session: Session, { shell, storeDirectory }: CopyOptions) {
  const guide = transcriptGuide(session);
  const tool = guide?.tool ?? plain(session.agent);
  const open = guide
    ? [guide.skill ? `\`${guide.skill}\` 스킬이 있으면 그것으로 ${guide.exact ? `세션 \`${session.providerSessionId}\`를` : "Relay 기록의 세션 ID를"} 열고, 없으면 대화 기록을 직접 읽으세요.`
        : "대화 기록을 직접 읽으세요.",
      `\`${guide.path}\``,
      `(${guide.note ? `${guide.note}. ` : ""}경로가 다르면 세션 ID로 찾으세요.)`]
    : [`${tool}가 남긴 대화 기록을 Relay 기록의 세션 ID로 찾아 읽으세요.`];
  return [
    `이전 ${tool} 세션을 이어서 작업해 주세요.`,
    "`relay-session` 스킬의 continue 절차로 현재 세션을 연결하고, 아래 순서로 원본 대화와 실제 파일을 확인한 뒤 작업하세요.",
    `작업 경로: ${plain(session.workingDirectory)}`,
    "",
    "1. Relay 기록으로 원본 세션의 도구·세션 ID·작업 경로를 확인하세요.",
    `   \`${fold(sessionCommand(session, storeDirectory, shell, true))}\``,
    "   Relay 요약은 줄여 쓴 참고용이라 요구사항이 빠졌을 수 있으니 작업 기준으로 삼지 마세요.",
    "",
    "2. 원본 세션에 들어가 실제 대화를 읽으세요.",
    ...open.map((line) => `   ${line}`),
    "",
    "3. 원본 대화에서 사용자 요구사항을 원문대로 확인하고, 실제 파일과 작업 트리로 진행 상황과 남은 작업을 파악하세요.",
    "",
    "원본 대화를 찾지 못하면 먼저 알리고 사용자 확인을 받으세요. 현재 사용자 요청과 프로젝트 지침이 우선이며, 확인하지 못한 내용은 추측하지 마세요.",
  ].join("\n");
}
