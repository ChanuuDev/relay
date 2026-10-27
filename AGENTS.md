# Relay

## 세션 기록 지침

이 프로젝트의 Agent 세션은 Relay에 기록한다. `relay`가 없거나 기록이 실패하면 한 줄로 알리고 원래 작업을 계속한다. 기록 때문에 사용자의 작업을 멈추지 않는다.

- **세션 ID**: 현재 Agent의 실제 세션 ID를 셸 변수로 그대로 전달한다. Claude Code는 `$CLAUDE_CODE_SESSION_ID`, Codex는 `$CODEX_THREAD_ID`, Grok은 `$GROK_SESSION_ID`이다. Cursor는 환경변수가 없으므로 시작 훅이 맥락에 넣어 준 `sessionId`를 쓴다. 값을 임의로 만들지 않는다.
- **압축 뒤**: 컨텍스트가 압축된 뒤 시작 안내가 기록을 다시 읽으라고 하면 `relay show <ID> --provider <회사 식별자> --history --json`으로 자신의 기록을 확인하고, 빠진 맥락을 `update`로 보완한다.
- **첫 기록**: 첫 작업 전에 `relay show <ID> --provider <회사 식별자> --json`으로 확인한다. 기록이 없을 때만 아래를 실행한다.

  ```text
  relay record --provider <anthropic|openai|xai|cursor> --agent <claude-code|codex|grok|cursor-agent> --session-id <ID> --session-name <작업 주제> --summary <다음 대화에 필요한 첫 요약>
  ```

  이미 기록이 있으면 `record`를 다시 부르지 말고 `relay update --session-id <ID> --summary <현재까지의 맥락>`으로 갱신한다. 훅이 먼저 기록해 둔 경우에도 같은 규칙을 따른다.
- **맥락 갱신**: 의미 있는 작업 단위가 끝날 때마다 `relay update --session-id <ID> --summary <다음 대화에 필요한 진행 요약>`. 훅 자동 기록만 남은 세션은 종료 시 삭제되므로 첫 작업 단위가 끝나면 반드시 갱신한다. 훅이 기록한 세션은 이름이 폴더명이므로 첫 갱신에 `--session-name <작업 주제>`를 붙이고, `--status working|blocked|handoff|done`으로 마지막 작업 상태를 남긴다. 막히면 `blocked`, 남은 일을 다음 세션에 넘기면 `handoff`, 끝났으면 `done`이다. 상태는 다음 `--status`까지 유지된다.
- **이어받기**: 이전 기록을 확인하고 작업을 이어받으라는 요청이면 현재 세션을 별도로 `record`하지 말고 `relay continue <이전 Provider Session ID> --parent-provider <이전 회사 식별자> --provider <현재 회사 식별자> --agent <현재 도구 식별자> --session-id <현재 실제 Session ID> --summary <확인한 사실과 이어갈 작업>`을 먼저 실행한다. 부모 기록의 종료 상태를 확인하거나 요구하지 않는다. 훅이 현재 세션을 이미 기록해 둔 경우에도 같은 명령을 그대로 쓴다. 부모가 없는 기존 기록이면 출처가 연결되고, 이미 다른 세션에 연결돼 있으면 `PARENT_CONFLICT`이니 임의로 다시 연결하지 말고 사용자에게 알린다.
- **스킬 부재**: `relay-session` 스킬이 목록에 없거나 링크 문제로 읽히지 않으면 이 지침의 절차를 그대로 따르고, `relay install-skills`로 다시 설치하라고 한 줄로 알린다. 스킬 폴더를 심볼릭 링크나 정션으로 만들지 않는다.
- 요약은 다음 대화에서 바로 쓸 사실을 중심으로 짧게 쓴다. 목표·현재 상태·변경 파일·검증 결과·남은 위험이나 다음 작업을 담고, 전체 채팅·reasoning·키·로그인 정보·파일 전문은 넣지 않는다.

이전 세션을 이어받을 때는 `relay-session` 스킬을 사용한다.

## 작업 마무리 지침

이 저장소에서 작업 단위를 끝내면 사용자에게 따로 묻지 않고 **검증 → 커밋 → 다시 설치 → 푸시**까지 무조건 수행한다. 문서만 바꾼 작업도 같다. 재설치나 푸시를 건너뛴 채 작업을 끝냈다고 보고하지 않는다.

1. **검증**: `npm run check`(typecheck → test → build → test:web)가 통과해야 한다. 실패하면 고친 뒤 다시 돌린다. 끝내 고치지 못하면 커밋·설치·푸시하지 않고 실패 내용을 그대로 알린다.
2. **커밋**: `main`에 바로 커밋한다. 브랜치나 PR은 사용자가 요청할 때만 만든다.
3. **다시 설치**: 현재 커밋으로 `npm run build`를 다시 돌린 뒤 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-cli.ps1 -Force`로 `~/.local/bin/relay.exe`와 훅·스킬을 바꾼다. 서버를 미리 닫지 않는다. 스크립트가 실행 중이라 잠긴 옛 파일을 옆으로 옮겨 교체하고, 옛 파일로 떠 있던 `relay web`을 같은 포트·저장소로 `relay web --reload` 해 출력에 `Web server restarted`를 남긴다. 그 줄이 없거나 `restart failed`면 `relay web --reload [--port <포트>]`를 직접 실행한다. 끝나면 `/api/v1/health`가 200이고 `build`가 새 값인지 확인한다(열린 화면은 그 값을 보고 스스로 새로 고친다).
4. **푸시**: `git push origin main`. 원격이 앞서 있으면 `git pull --rebase` 뒤 다시 검증하고 푸시한다. 강제 푸시는 하지 않는다.
5. **보고**: 커밋 해시, 설치와 서버 재시작 결과, 푸시 범위(`이전..이후`)를 짧게 알린다.
