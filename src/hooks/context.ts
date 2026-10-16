export const SESSION_START_PROMPT = `세션의 첫 작업 전에 relay-session 스킬을 읽고, 그 절차에 따라 현재 세션 정보를 Relay에 기록한다.

명령을 추측하지 않는다. 스킬을 찾지 못하면 relay --help로 확인한다.

호스트가 제공한 실제 세션 ID만 사용하고, 기존 기록을 먼저 확인해 없을 때만 생성한다. 시작 훅이 먼저 기록했으면 record를 반복하지 않고 update로 맥락을 갱신한다.

이전 작업을 이어받으면 continue로 출처를 연결하고, 작업 단위가 끝나면 짧은 진행 단서를 갱신한다.

중간 작업 내용 또한 Relay 도구로 기록해 맥락을 파악할 수 있도록 한다. 목표·현재 상태·변경 파일·검증 결과·남은 위험이나 다음 작업을 짧게 요약한다. update에 --session-name으로 작업 주제를, --status working|blocked|handoff|done으로 마지막 작업 상태를 함께 남긴다. 막히면 blocked, 남은 일을 다음 세션에 넘기면 handoff, 끝났으면 done이다.

훅 자동 기록만 남은 세션은 종료 시 삭제되므로 첫 작업 단위가 끝나면 반드시 update로 갱신한다.

relay가 없거나 기록에 실패하면 한 줄로 알리고 원래 작업을 계속한다.`;

export const GROK_RULE_MARKER = "<!-- Relay managed session-start instructions -->";
export const GROK_SESSION_RULE = `${GROK_RULE_MARKER}
# Relay 세션 기록

이 지침은 현재 호스트가 Grok일 때 적용한다.

${SESSION_START_PROMPT}

Grok의 provider는 xai, agent는 grok이다. 현재 호스트가 제공한 GROK_SESSION_ID 환경변수를 그대로 사용한다. 실제 ID를 확인할 수 없으면 임의로 만들지 말고 한 줄로 알린 뒤 원래 작업을 계속한다.
`;
