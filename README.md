# Relay

AI Agent의 최소 세션 정보와 다음 대화에 필요한 맥락을 로컬 SQLite에 기록하고, CLI와 브라우저에서 조회하는 도구입니다. 세션 실행 상태 관리, 전체 대화 복원이나 원본 Agent 로그 자동 수집은 하지 않습니다.

## 설치와 실행 · Windows

### 준비물

Windows 10/11 x64면 충분합니다. 필요한 것은 모두 `dist\relay.exe` 파일 하나에 들어 있어서, 이 파일만 있으면 Node.js나 Bun 없이 실행되고 관리자 권한도 필요 없습니다.

프로젝트를 새로 받아서 `dist\relay.exe`가 없다면 먼저 한 번만 빌드하세요. 이때만 Node.js 22.12 이상이 필요합니다.

```powershell
npm ci
npm run build
```

### 1단계 · 설치하기

PowerShell을 열고 프로젝트 폴더에서 한 번만 실행하세요.

```powershell
cd C:\workspace\agent-session-chain
.\scripts\install-cli.ps1
```

`Installed: ...\relay.exe`와 `Ready: relay --codex`가 보이면 설치가 끝난 것입니다. 이 스크립트가 하는 일은 두 가지뿐입니다.

1. `dist\relay.exe`를 내 계정 폴더인 `C:\Users\<사용자>\.local\bin\relay.exe`로 복사합니다.
2. 그 폴더가 PATH에 없으면 등록합니다. 그래야 어느 폴더에서나 `relay`라고만 입력해도 실행됩니다.

### 2단계 · 확인하기

**새 PowerShell 창**을 열고 아래를 실행합니다. 설치 전부터 열어 둔 창은 PATH가 바뀐 것을 모르기 때문에 창을 새로 열어야 합니다.

```powershell
relay --version
relay --help
```

### 3단계 · 기록하고 조회하기

Agent 세션 하나를 기록해 보는 예시입니다. `demo-session-a`는 예시 값이므로 실제로는 Agent의 진짜 Session ID를 넣으세요.

```powershell
# 세션의 첫 맥락을 기록
relay record --provider openai --agent codex --session-id "demo-session-a" --session-name "세션 연속성 구현" --summary "CLI와 웹 연결 확인. 다음 대화에서 브라우저 연결을 검증할 예정"

# 다음 대화에 필요한 맥락을 덧붙이기
relay update --session-id "demo-session-a" --summary "브라우저 테이블과 상세 확인 완료"

# 다른 Agent가 이어받은 세션을 연결
relay continue "demo-session-a" --provider anthropic --agent claude-code --session-id "demo-session-b" --summary "프로젝트 현재 상태를 확인하고 검증 재개"

# 가장 최근 기록 꺼내 보기
relay --codex
```

`--cwd`를 생략하면 현재 폴더가 기록됩니다. 기록이 하나도 없으면 `SESSION_NOT_FOUND`가 나오는데, 오류가 아니라 "아직 저장한 세션이 없다"는 뜻입니다. `record`는 같은 Provider와 Session ID의 동일한 첫 입력을 다시 받아도 이력을 중복으로 만들지 않습니다.

### 4단계 · 브라우저로 보기

```powershell
relay web
```

터미널에 주소가 표시되면 브라우저에서 `http://127.0.0.1:7474`로 접속하세요. `relay web --open`을 쓰면 브라우저까지 자동으로 열립니다. 종료는 서버를 띄운 터미널에서 Ctrl+C입니다.

이 서버는 실행 중일 때만 화면을 보여 줄 뿐이고, 기록과 조회는 서버 없이도 됩니다. 서버를 켜 둔 채 다른 터미널에서 기록하면 열어 둔 탭이 3초마다 자동으로 새 내용을 가져옵니다.

### 설치하지 않고 써 보기

설치가 부담스러우면 프로젝트 폴더에서 실행 파일을 직접 호출해도 똑같이 동작합니다.

```powershell
.\dist\relay.exe --help
.\dist\relay.exe --codex
```

지금 열린 터미널에서만 `relay`라는 짧은 이름을 쓰고 싶다면 PATH를 임시로 추가합니다. 창을 닫으면 원래대로 돌아갑니다.

```powershell
$env:Path = "$((Resolve-Path .\dist).Path);$env:Path"
relay list
```

### 최신 버전으로 갱신하기

소스를 고쳤거나 새 버전을 받았다면 다시 빌드한 뒤 `-Force`로 덮어씁니다.

```powershell
npm run build
.\scripts\install-cli.ps1 -Force
```

`-Force` 없이 실행하면 이미 있는 다른 실행 파일을 덮어쓰지 않고 멈춥니다. 같은 파일을 다시 설치하는 경우에는 그대로 둡니다. 설치 위치를 바꾸려면 `-InstallDirectory <절대경로>`, PATH 등록을 건너뛰려면 `-NoPath`를 붙이세요.

### 삭제하기

실행 파일만 지우면 됩니다. 기록한 세션을 함께 지우려면 데이터 폴더도 삭제하세요. **되돌릴 수 없습니다.**

```powershell
Remove-Item "$env:USERPROFILE\.local\bin\relay.exe"
Remove-Item "$env:USERPROFILE\.relay" -Recurse   # 기록까지 모두 삭제
```

PATH에 추가된 `.local\bin`은 다른 프로그램도 쓸 수 있는 폴더라 그대로 두어도 문제없습니다.

### 잘 안 될 때

| 증상 | 해결 |
|---|---|
| `relay` 명령을 찾을 수 없음 | PowerShell 창을 새로 열어 보세요. 그래도 안 되면 `.\scripts\install-cli.ps1`을 다시 실행하세요. |
| 갱신할 때 "다른 프로세스에서 사용 중" | `relay web` 서버가 실행 중입니다. 해당 터미널에서 Ctrl+C로 끄고 다시 설치하세요. |
| 포트가 이미 사용 중 | `relay web --port 7475`처럼 다른 포트를 지정하세요. |
| 스크립트 실행이 정책으로 차단됨 | 조직 정책을 우회하지 말고 설치 없이 `.\dist\relay.exe`로 사용하거나 관리자에게 문의하세요. |
| 기록이 안 보임 | 기록할 때와 조회할 때 같은 저장소를 쓰는지 확인하세요. `--data-dir`을 쓴다면 양쪽에 똑같이 넣어야 합니다. |
| 오래된 기록이 사라짐 | 기본값이 30일 보관입니다. [오래된 세션 자동 삭제](#오래된-세션-자동-삭제)에서 `retentionDays`를 0으로 바꾸면 지우지 않습니다. |

## 데이터 위치와 설정

데이터 위치는 `--data-dir` > `RELAY_DATA_DIR` > 사용자 홈의 `.relay`입니다. DB는 선택된 폴더의 `relay.db`, 설정은 선택적 `config.json`입니다. 새 저장소는 처음 데이터 명령 또는 웹 서버를 실행할 때 생성합니다. 테스트는 기본 저장소를 사용하지 않습니다.

```powershell
relay web --data-dir "C:\relay-data" --port 7475
relay list --data-dir "C:\relay-data" --json
```

선택적 `config.json`:

```json
{
  "schemaVersion": 1,
  "webHost": "127.0.0.1",
  "webPort": 7474,
  "retentionDays": 30
}
```

포트 우선순위는 `--port` > `config.json` > `7474`입니다. 잘못된 설정은 오류로 처리합니다. 네트워크 드라이브·클라우드 동기화 폴더의 DB 공유는 지원하지 않습니다. DB가 실행 중일 때 `relay.db`만 복사하는 방식은 WAL의 최신 변경을 빠뜨릴 수 있으므로 백업으로 사용하지 마세요. Windows 파일 접근은 해당 디렉터리의 OS 권한을 따릅니다.

## 오래된 세션 자동 삭제

`retentionDays`일보다 오래 갱신되지 않은 기록은 자동으로 삭제합니다. 기본값은 **30**일이고 **0이면 삭제하지 않습니다**. 허용 범위는 0~3650 정수입니다.

```json
{ "retentionDays": 0 }
```

- 기준은 마지막 맥락 갱신 시각(`updatedAt`)입니다. 기록을 갱신하면 기준 시각도 갱신됩니다.
- 삭제는 `record`, `continue`, `update`처럼 **기록을 남기는 명령과 같은 트랜잭션**에서 실행합니다. 조회 명령과 웹 서버는 읽기 전용이라 아무것도 지우지 않습니다.
- 이어받기 연결은 끊지 않습니다. 기한이 지난 기록이라도 남아 있는 자식 기록이 참조하면 함께 보존합니다. 연결 전체가 기한을 넘긴 경우에만 통째로 삭제합니다.
- 기록을 지우면 해당 기록의 맥락 이력도 함께 사라집니다. 삭제는 되돌릴 수 없으므로 장기 보관이 필요하면 `retentionDays`를 0이나 충분히 큰 값으로 두세요.

## 조회 명령

```powershell
relay --codex
relay --claude --json
relay --grok --data-dir "C:\relay-data"
relay list --provider openai --agent codex --query "검증" --limit 50 --offset 0
relay latest codex --json
relay latest claude --json
relay latest grok --json
relay latest claude --cwd "C:\workspace\my-project" --json
relay show "실제-session-id" --provider anthropic --history --limit 100 --json
```

`--codex`, `--claude`, `--grok`는 각각 `latest codex`, `latest claude`, `latest grok`와 같은 조회입니다. 한 번에 하나만 사용하며 다른 하위 명령과 함께 쓰지 않습니다. `--json`과 `--data-dir`을 함께 사용할 수 있고, 프로젝트별 필터가 필요하면 `latest <별칭> --cwd <절대경로>`를 사용하세요. 지정한 값은 조회할 **출처**이지 현재 실행 Agent를 선택하는 옵션이 아닙니다.

| 별칭 | 조회 조건 |
|---|---|
| `codex` | `provider=openai`, `agent=codex` |
| `claude` | `provider=anthropic`, `agent=claude-code` |
| `grok` | `provider=xai`, `agent=grok` |

기본적으로 모든 프로젝트 중 Relay에 가장 최근 갱신된 기록 1건을 반환합니다. 기록이 없거나 잘못된 별칭이면 오류이며 다른 제공자로 대체하지 않습니다. 원본 도구에서 생성되었지만 Relay에 기록하지 않은 세션은 조회되지 않습니다.

동일 Provider Session ID가 여러 제공자에 있으면 `--provider`를 지정해야 합니다. `continue`의 `--parent-provider`는 이전 제공자, `--provider`는 새 세션 제공자입니다. 이전 기록의 실행 상태를 확인하거나 바꿀 필요 없이 바로 연결할 수 있습니다.

`record/continue`의 같은 입력 재시도는 중복 이력을 만들지 않습니다. `update`는 호출마다 맥락을 기록하므로 응답을 잃었을 때 자동 재전송하지 말고 `show --history`로 확인하세요. `--summary`에는 비밀정보·전체 채팅·reasoning을 넣지 마세요.

### 이미 기록된 세션을 연결할 때

`continue`는 새 세션을 만드는 명령이면서, **이미 저장된 세션에 출처를 붙이는 명령**이기도 합니다. 아래 훅을 켜 두면 Agent가 작업을 시작하는 순간 세션이 먼저 기록되는데, 이때도 같은 `continue` 한 번으로 이어받기가 성립합니다.

- 아직 부모가 없는 세션이면 부모를 연결하고, 준 요약을 이력에 덧붙입니다. `--session-name`과 `--model`을 주면 훅이 알 수 없었던 값을 채웁니다. 주지 않으면 기존 값을 그대로 둡니다.
- 만든 시각, 도구(`agent`), 프로젝트 경로는 바뀌지 않습니다. 연결할 때 `--cwd`는 무시됩니다.
- 이미 같은 부모에 연결돼 있으면 재시도로 보고 아무것도 바꾸지 않습니다. 이후 맥락은 `update`로 남기세요.
- 다른 부모에 이미 연결돼 있으면 `PARENT_CONFLICT`입니다. 세션의 출처는 하나입니다. 자기 자신이나 자기 자손에 연결하는 것도 같은 오류로 막습니다.
- 같은 Provider Session ID가 다른 도구로 저장돼 있으면 `SESSION_EXISTS`입니다.

이전 기록을 이어받을 때는 현재 세션을 먼저 `record`하지 말고 `continue`를 먼저 호출하세요.

### 화면에 보이는 모양

`--json` 없이 실행하면 터미널 폭에 맞춘 표로 보여 줍니다.

```text
이름                          Provider/Agent         Session ID                            생성              갱신              요약
--------------------------------------------------------------------------------------------------------------------------
Relay 이어받기·보존 기간...   anthropic/claude-code  f47ac10b-58cc-4372-a567-0e02b2c3d479  2026-09-16 12:40  2026-09-16 13:02  README의 설치...
Relay Windows MVP 구현·검증   openai/codex           9b2d4c7e-1f60-4a83-b5d1-7c8e0a2f6b34  2026-09-16 12:20  2026-09-16 13:01  빠른 조회 옵션...
총 2건 · offset 0
```

- 한글은 두 칸으로 계산해 정렬합니다. 창이 좁으면 요약 → 갱신 → 생성 → Provider/Agent 순으로 열을 숨기고, 이름·Session ID는 항상 남깁니다. 창을 넓히면 다시 나옵니다.
- 헤더·작업명은 청록색, Session ID는 파란색, 시각은 회색으로 구분합니다. 제공자는 OpenAI 초록·Anthropic 노랑·xAI 자홍색을 사용하며 요약은 기본 글자색을 유지합니다. 상세 조회와 기록 이력에도 같은 색상 기준을 적용합니다.
- 파일로 넘기거나(`relay list > out.txt`) 다른 명령으로 연결하면 기본적으로 색 코드를 넣지 않습니다. 색을 끄고 싶으면 `NO_COLOR=1` 또는 `FORCE_COLOR=0`을 설정하세요. `FORCE_COLOR=1`은 리디렉션에도 색상을 강제하며, `NO_COLOR`가 우선합니다. JSON 출력에는 색상을 넣지 않습니다.
- 시각은 읽기 쉽게 로컬 시각으로 보여 주고, `show`의 상세 화면에는 `+09:00` 같은 오프셋도 함께 표시합니다. 최초 기록은 `createdAt`, 최근 맥락 갱신은 `updatedAt`으로 `--json`에 ISO 8601 UTC 그대로 담깁니다.
- 스크립트나 Agent에서 쓸 때는 이 모양에 의존하지 말고 `--json`을 사용하세요.

### 터미널에서 골라 복사하기

터미널에서 바로 실행하면 표가 그대로 남지 않고 화면을 잠시 넘겨받아 행을 고를 수 있습니다. 마우스를 올린 행이 반전되고, 그 행을 클릭하면 **다음 대화에 붙여넣을 세션 컨텍스트**가 클립보드에 들어갑니다. 브라우저 화면의 `세션 컨텍스트 복사` 버튼과 같은 텍스트입니다.

| 조작 | 동작 |
|---|---|
| 마우스 이동 | 커서 아래 행을 선택 |
| 클릭 · `Enter` · `Space` | 선택한 세션의 컨텍스트를 복사하고 화면을 닫음 |
| `↑` `↓` · `k` `j` · `PgUp` `PgDn` · `g` `G` | 행 이동 |
| 휠 | 화면 스크롤 |
| `q` · `Esc` · `Ctrl+C` | 복사하지 않고 화면을 닫음 |

고르는 것이 이 화면의 목적이므로 복사하면 바로 닫힙니다. 닫으면 원래 화면으로 돌아오면서 조회한 표를 그대로 다시 출력하므로 스크롤백에 기록이 남고, 무엇을 복사했는지는 표 아래에 한 줄로 알려 줍니다. 이 안내는 stderr로 나가므로 `relay list > out.txt`의 내용에는 섞이지 않습니다. `show`와 `relay --codex` 같은 단일 세션 화면에서도 같은 방식으로 복사합니다.

클립보드 기록은 화면을 닫은 **뒤에** 실행하므로, 클립보드 도구가 느려도 화면이 붙잡히지 않습니다. Windows는 `clip.exe`를 먼저 쓰고 실패하면 `Set-Clipboard`로 넘어갑니다. `clip.exe`는 약 15ms, PowerShell은 기동에만 약 1초가 들기 때문입니다. macOS는 `pbcopy`, Linux는 `wl-copy`/`xclip`/`xsel` 순이며, 모두 없으면 터미널 자체에 OSC 52로 요청합니다. 원격 접속처럼 터미널이 이를 무시할 수 있는 경우에는 요청만 보냈다고 알려 줍니다.

붙여넣은 한글이 깨지는 환경이라면 `RELAY_CLIPBOARD=powershell`로 도구를 고정하세요. `clip`, `powershell`, `pbcopy`, `wl-copy`, `xclip`, `xsel`을 지정할 수 있습니다. 복사하는 내용은 로컬 저장소의 세션 기록뿐이며 디스크에 임시 파일을 만들거나 네트워크로 보내지 않습니다.

파일이나 다른 명령으로 넘길 때, 터미널이 아닐 때는 이 화면을 쓰지 않고 예전처럼 표만 출력하고 끝납니다. 터미널에서도 끄고 싶으면 `RELAY_NO_TUI=1`을 설정하세요.

## Agent 스킬 설치와 호출

배포 원본은 [skills/relay-session](skills/relay-session/SKILL.md)입니다. 프로젝트 단위 설치 스크립트는 기존 파일이 다르면 덮어쓰지 않고 중단합니다.

```powershell
.\scripts\install-skill.ps1 -Agent codex -ProjectDirectory "C:\workspace\agent-session-chain"
.\scripts\install-skill.ps1 -Agent claude -ProjectDirectory "C:\workspace\agent-session-chain"
```

실행 정책으로 차단되면 조직 정책을 우회하지 말고, 원본 스킬 폴더를 아래 프로젝트 경로에 수동으로 배치하세요. 전역 설치는 수행하지 않았습니다. 다른 프로젝트에서 쓰려면 해당 프로젝트에 설치하고 `relay`를 PATH에 등록하세요.

| 현재 Agent 환경 | 설치 위치 | 명시적 호출 |
|---|---|---|
| Codex | `.agents/skills/relay-session` | `$relay-session claude` 또는 `/skills`에서 선택 |
| Claude Code | `.claude/skills/relay-session` | `/relay-session codex`, 또는 프로젝트 지침에 따라 모델이 직접 호출 |
| Grok 1.0.24 (로컬 확인) | 기존 `.agents/skills/relay-session`을 인식 | `/relay-session codex` 등록 확인, 모델 실행은 미검증 |
| 그 밖의 호스트 | 호스트별 등록 방식 확인 필요 | `relay latest <별칭> --json` 결과를 현재 Agent에 전달 |

Claude Code에 설치하는 스킬은 모델 호출을 막지 않습니다. 사용자가 `/relay-session`으로 직접 부를 수도 있고, 프로젝트 지침이 세션 기록을 요구할 때 Agent가 스스로 스킬을 열 수도 있습니다. 이미 설치된 스킬이 있다면 설치 스크립트가 덮어쓰지 않으므로, `disable-model-invocation: true` 줄이 남아 있으면 직접 지우고 Agent 세션을 다시 여세요.

Codex의 공식 호출 방식은 `$` 또는 `/skills`이며 모든 호스트에서 `/relay-session`이 직접 등록된다고 보증하지 않습니다. 설치 경로·호출 방식은 [OpenAI 공식 스킬 문서](https://learn.chatgpt.com/docs/build-skills), [Claude Code 공식 스킬 문서](https://code.claude.com/docs/en/skills)를 따릅니다. 설치 후 목록에 보이지 않으면 Agent 세션을 다시 열어 확인하세요.

사용 예: Codex에 `$relay-session claude`를 요청하면 현재 Codex가 Claude의 최근 Relay 기록을 참고합니다. 조회만으로 새 세션 생성·파일 수정·작업 재개를 하지 않습니다. `이 기록을 확인하고 작업을 이어서 해줘`까지 요청한 경우에만 실제 프로젝트를 조사하고 현재 Agent의 실제 Session ID로 부모 연결을 기록합니다.

실제 Session ID는 호스트가 제공한 값이나 사용자가 도구에서 확인한 값을 사용합니다. 현재 Codex 환경의 `CODEX_THREAD_ID` 제공과 실제 ID의 Relay 부모 연결을 임시 저장소에서 확인했지만 모든 설치·호스트에서 보장하지 않습니다. Codex 0.154.0의 `skills/list`, Claude Code 2.1.272의 SDK 초기화, Grok 1.0.24의 `inspect --json`으로 스킬 등록을 확인했습니다. 스킬 등록 확인과 모델이 실제로 스킬을 수행하는 검증은 구분합니다. Claude/Grok의 ID 자동 취득·원본 로그 import·기존 대화 재개·Agent 자동 전환은 구현하지 않았습니다. Relay CLI 설치만으로 모든 작업이 자동 기록되지도 않습니다. 수동 CLI 또는 명시적으로 적용한 기록 절차가 필요합니다.

## 세션 시작 자동 기록 (Claude Code 훅)

지침만으로는 모델이 기록을 건너뛸 수 있습니다. Claude Code의 `SessionStart` 훅에 등록하면 모델 판단과 무관하게 세션이 기록됩니다.

`~/.claude/settings.json`의 `hooks.SessionStart` 배열에 추가합니다. 기존 항목이 있으면 지우지 말고 이어서 넣으세요.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "\"C:/Users/<사용자>/.local/bin/relay.exe\" hook claude || echo {}", "timeout": 10 }] }
    ]
  }
}
```

`relay hook <codex|claude|grok>`은 훅 JSON을 stdin으로 받아 세션 시작을 기록합니다. 동작 규칙은 이렇습니다.

- **세션을 절대 막지 않습니다.** 먼저 `{}`를 출력하고 기록을 시도하며, 어떤 실패에도 종료 코드 0으로 끝납니다. 저장소 오류·잘못된 JSON·`relay` 부재 모두 조용히 넘어갑니다.
- 세션 ID는 페이로드의 `session_id`에서 읽고, 없으면 `CLAUDE_CODE_SESSION_ID`·`CODEX_THREAD_ID` 환경변수를 씁니다. **임의 ID를 만들지 않습니다.**
- 세션 이름은 작업 폴더 이름, 요약은 `세션 첫 기록 (훅 자동 기록)`으로 기록합니다. 실제 내용은 이후 Agent가 `relay update`로 채웁니다.
- 페이로드에 `agent_id`가 있으면 서브에이전트이므로 기록하지 않습니다.
- 같은 세션에서 다시 실행돼도(resume·compact) 같은 입력이라 이력이 늘지 않습니다.

기록을 원하지 않는 세션은 해당 항목을 `settings.json`에서 빼면 됩니다. 프로젝트별로만 쓰려면 전역 대신 프로젝트 `.claude/settings.json`에 넣으세요.

### 다른 프로젝트에 적용하기

훅은 세션의 **첫 기록**만 남깁니다. 작업 맥락을 계속 갱신하려면 해당 프로젝트의 지침 파일에 아래를 넣으세요. 이 저장소의 [AGENTS.md](AGENTS.md)가 같은 절차를 따릅니다.

```markdown
## 세션 기록 지침

Agent 세션은 Relay에 기록한다. `relay`가 없거나 실패하면 알리고 작업을 계속한다.

- 세션 ID는 Claude Code `$CLAUDE_CODE_SESSION_ID`, Codex `$CODEX_THREAD_ID`를 그대로 전달한다. 임의로 만들지 않는다.
- 첫 작업 전 `relay show <ID> --provider <회사 식별자> --json`으로 확인하고, 기록이 없을 때만
  `relay record --provider <anthropic|openai> --agent <claude-code|codex> --session-id <ID> --session-name <작업 주제> --summary <첫 요청 요약>`
- 기록이 이미 있으면 `record`를 반복하지 말고 `update`로 현재 맥락을 갱신한다.
- 작업 단위가 끝날 때마다 `relay update --session-id <ID> --summary <진행 요약>`
- 이전 세션을 이어받으라는 요청이면 현재 세션을 별도로 `record`하지 말고
  `relay continue <이전 ID> --parent-provider <이전 회사 식별자> --provider <현재 회사 식별자> --agent <현재 도구 식별자> --session-id <현재 실제 ID> --summary <확인한 사실과 이어갈 작업>`을 먼저 실행한다.
- 부모 기록의 종료 상태를 확인하거나 요구하지 않는다. 이전 세션을 이어받을 때는 `relay-session` 스킬을 사용한다.
```

Codex와 Grok은 `AGENTS.md`, Claude Code는 `CLAUDE.md`를 읽습니다. 내용을 한 곳에만 두려면 `CLAUDE.md`에 `@AGENTS.md` 한 줄만 넣어 가져오면 됩니다.

지침은 강제가 아니라 모델이 건너뛸 수 있습니다. 시작 기록만큼은 확실히 남기려면 위 훅을 함께 쓰세요.

## 브라우저와 API

React·shadcn 기반 워크스페이스에서 요약 중심 목록과 선택한 세션의 상세를 함께 확인합니다. 검색 결과 건수는 목록 제목에 표시합니다. 검색·Provider·Agent·프로젝트 절대경로 필터와 페이지 이동을 지원합니다. 검색 조건과 선택한 세션은 URL에 남아 새로고침·뒤로 가기·직접 링크에서도 복원됩니다.

상세 패널은 **개요 / 기록 이력 / 세션 연결** 탭으로 나뉩니다. 전체 요약, 모델·경로·기록 시각·식별자, 순서에 따른 맥락 이력, 이전·후속 세션을 확인할 수 있습니다. 좁은 화면에서는 상세에 집중하고 목록으로 돌아올 때 필터를 유지합니다. **세션 컨텍스트 복사**는 목록과 상세에서 같은 형식으로 작업명, Agent·Provider·모델, 프로젝트 경로, Provider Session ID·Relay ID, 최초·최근 기록 시각(연도·시간대 포함), Relay 저장소, 로컬 상세 링크, 최근 요약 원문, PowerShell/Bash 조회 명령을 함께 복사합니다. 다른 AI에 붙여 넣어 세션을 찾는 데 사용할 수 있습니다. 전체 대화나 원본 로그 위치를 추측해서 추가하지 않습니다. 저장소를 확인할 수 없으면 명령을 생략하고 이유를 표시합니다. ID만 필요하면 개요의 **세션 식별자 → Session ID만 복사**를 사용하세요. 복사는 명령을 실행하지 않습니다.

Zustand는 필터 입력·선택 탭·셸 등 UI 상태를, TanStack Query는 조회 캐시와 3초 자동 갱신을 관리합니다. 숨겨진 탭은 주기 조회를 멈추고 다시 보이면 갱신합니다. 조회 실패 시 마지막 성공 데이터를 유지하며 오류를 표시합니다. 연결 표시는 로컬 조회 서버와의 통신 결과입니다.

| 조회 API | 용도 |
|---|---|
| `GET /api/v1/health` | 버전·준비 상태·저장소 경로 |
| `GET /api/v1/sessions` | 목록: `q/provider/agent/cwd/limit/offset` |
| `GET /api/v1/sessions/:id` | 상세·부모·자식 첫 페이지 |
| `GET /api/v1/sessions/:id/updates` | 이력: `limit/offset` |
| `GET /api/v1/sessions/:id/children` | 자식: `limit/offset` |

API의 `:id`는 Relay 내부 ID이고 CLI의 `session-id`는 Provider Session ID입니다. API·CLI 모두 `schemaVersion: 1`, camelCase DTO를 사용합니다. 페이지는 기본 50개, 최대 100개입니다. 목록은 `updatedAt DESC, id DESC`, 이력은 `sequence DESC`입니다. 정확한 DTO와 오류 계약은 `relay <명령> --json` 출력으로 확인하세요.

기존 DB 스키마 v1은 새 실행 파일로 처음 열 때 v2로 자동 전환됩니다. 세션 ID·요약·부모 연결·모델·맥락 이력을 보존하고 `started_at`을 `created_at`으로 옮깁니다. 상태·종료 시각과 이력 종류는 제거되며, 전환이 실패하면 기존 스키마와 기록을 유지합니다. 조회 명령과 웹 서버의 첫 실행도 필요한 DB 전환을 수행하고, 이후 조회 연결은 읽기 전용입니다. 교체 전에는 기존 Relay 프로세스를 종료하고 저장소를 백업하세요. v2 DB는 구버전 실행 파일로 열 수 없으므로 CLI·웹 실행 파일과 Agent 지침을 함께 갱신해야 합니다.

loopback 바인딩, Host/Origin 검사, CSP, SQL 파라미터 바인딩, 텍스트 렌더링을 적용합니다. HTTP 쓰기 API·임의 파일 다운로드·셸 실행 기능은 없습니다. 이는 같은 PC의 다른 프로세스를 격리하는 사용자 인증 수단은 아닙니다.

CLI 종료 코드: `0` 성공, `2` 입력/설정, `3` 기록 없음, `4` 충돌, `5` 저장소, `6` 서버 시작 실패. `--json` 성공은 stdout, 실패는 stderr의 JSON 하나입니다. 자동화에는 실행 파일을 직접 호출하세요. npm 기본 실행 로그는 JSON 출력에 섞일 수 있습니다.

## 개발과 검증

고정 버전: Bun 1.4.2, TypeScript 5.9.3, Commander 15.0.0, Playwright 1.63.0. 개발 도구는 프로젝트 내부에 설치합니다. npm 사용 시 Node.js 22.12 이상을 전제로 합니다.

```powershell
npm ci
npm run relay -- --help
npx playwright install chromium
npm run check
```

개별 검사: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:web`. `npm ci`의 prepare 단계와 `npm run build:web`는 React 및 Tailwind 자산을 `src/web/generated/`에 생성합니다. 웹 소스는 `src/web/client.tsx`, `components/`, `lib/`, `styles.css`에 있으며 생성 자산은 Git에 저장하지 않습니다. `npm run build`는 웹 자산을 먼저 빌드한 뒤 실행 파일에 포함하므로 배포 시 별도 Node 서버나 CDN이 필요 없습니다. `npm run relay`도 실행 전에 웹 자산을 갱신합니다.

`tests/interactive.test.ts`는 대화형 화면을 가짜 입출력으로 구동하므로 실제 터미널이나 클립보드를 건드리지 않습니다. 호버·클릭·키 입력과 화면 복원까지는 이 테스트가 확인하고, 실제 클립보드 기록은 `relay list`를 터미널에서 직접 실행해 확인하세요.

Playwright는 빌드된 실행 파일을 소스 밖 임시 폴더에서 실행하므로 코드 변경 후에는 먼저 빌드하세요. 각 테스트는 자체 임시 DB·포트를 사용하고 종료 시 정리합니다. 빌드 스크립트는 실행 중인 웹 서버를 자동으로 종료하지 않으므로 같은 `dist/relay.exe`를 사용 중이면 해당 서버를 먼저 종료하세요.

Linux/macOS 소스 실행·빌드 경로는 준비되어 있으나 해당 OS에서 검증하지 않았으므로 지원 확정 대상으로 표기하지 않습니다. 배포는 `dist/relay.exe`와 필요한 경우 스킬 원본을 전달하면 됩니다.

## 라이선스

MIT 라이선스입니다. 전문은 [LICENSE](LICENSE)를 참고하세요.
