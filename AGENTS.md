# Relay

## 세션 기록 지침

이 프로젝트의 Agent 세션은 Relay에 기록한다. `relay`가 없거나 기록이 실패하면 한 줄로 알리고 원래 작업을 계속한다. 기록 때문에 사용자의 작업을 멈추지 않는다.

- **세션 ID**: 현재 Agent의 실제 세션 ID를 셸 변수로 그대로 전달한다. Claude Code는 `$CLAUDE_CODE_SESSION_ID`, Codex는 `$CODEX_THREAD_ID`이다. 값을 임의로 만들지 않는다.
- **시작**: 첫 작업 전에 `relay show <ID> --json`으로 확인한다. 기록이 없을 때만 아래를 실행한다.

  ```text
  relay start --provider <anthropic|openai> --agent <claude-code|codex> --session-id <ID> --session-name <작업 주제> --summary <첫 요청 요약>
  ```

  이미 기록이 있으면 `start`를 다시 부르지 않는다. Claude Code는 `SessionStart` 훅이 먼저 기록해 두므로 보통 이 경우에 해당한다. 같은 ID에 다른 요약으로 `start`를 부르면 `SESSION_EXISTS`로 실패한다.
- **진행**: 의미 있는 작업 단위가 끝날 때마다 `relay update --session-id <ID> --summary <진행 요약>`.
- **종료**: 사용자가 작업을 마쳤다고 알리면 `relay finish --session-id <ID> --status completed|interrupted --summary <결과>`. 스스로 세션 종료를 선언하지 않는다.
- 요약은 짧은 사실 문장으로 쓴다. 전체 채팅, reasoning, 키·로그인 정보, 파일 전문은 넣지 않는다.

이전 세션을 이어받을 때는 `relay-session` 스킬을 사용한다.
