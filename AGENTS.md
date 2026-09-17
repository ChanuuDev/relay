# Relay

## 세션 기록 지침

이 프로젝트의 Agent 세션은 Relay에 기록한다. `relay`가 없거나 기록이 실패하면 한 줄로 알리고 원래 작업을 계속한다. 기록 때문에 사용자의 작업을 멈추지 않는다.

- **세션 ID**: 현재 Agent의 실제 세션 ID를 셸 변수로 그대로 전달한다. Claude Code는 `$CLAUDE_CODE_SESSION_ID`, Codex는 `$CODEX_THREAD_ID`, Grok은 `$GROK_SESSION_ID`이다. 값을 임의로 만들지 않는다.
- **첫 기록**: 첫 작업 전에 `relay show <ID> --provider <회사 식별자> --json`으로 확인한다. 기록이 없을 때만 아래를 실행한다.

  ```text
  relay record --provider <anthropic|openai> --agent <claude-code|codex> --session-id <ID> --session-name <작업 주제> --summary <다음 대화에 필요한 첫 요약>
  ```

  이미 기록이 있으면 `record`를 다시 부르지 말고 `relay update --session-id <ID> --summary <현재까지의 맥락>`으로 갱신한다. 훅이 먼저 기록해 둔 경우에도 같은 규칙을 따른다.
- **맥락 갱신**: 의미 있는 작업 단위가 끝날 때마다 `relay update --session-id <ID> --summary <다음 대화에 필요한 진행 요약>`.
- **이어받기**: 이전 기록을 확인하고 작업을 이어받으라는 요청이면 현재 세션을 별도로 `record`하지 말고 `relay continue <이전 Provider Session ID> --parent-provider <이전 회사 식별자> --provider <현재 회사 식별자> --agent <현재 도구 식별자> --session-id <현재 실제 Session ID> --summary <확인한 사실과 이어갈 작업>`을 먼저 실행한다. 부모 기록의 종료 상태를 확인하거나 요구하지 않는다. 훅이 현재 세션을 이미 기록해 둔 경우에도 같은 명령을 그대로 쓴다. 부모가 없는 기존 기록이면 출처가 연결되고, 이미 다른 세션에 연결돼 있으면 `PARENT_CONFLICT`이니 임의로 다시 연결하지 말고 사용자에게 알린다.
- 요약은 다음 대화에서 바로 쓸 사실을 중심으로 짧게 쓴다. 목표·현재 상태·변경 파일·검증 결과·남은 위험이나 다음 작업을 담고, 전체 채팅·reasoning·키·로그인 정보·파일 전문은 넣지 않는다.

이전 세션을 이어받을 때는 `relay-session` 스킬을 사용한다.
