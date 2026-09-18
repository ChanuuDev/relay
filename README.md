# Relay

**AI Agent 세션을 기록하고, 다음 Agent가 이전 작업을 찾아갈 수 있게 연결하는 Windows용 로컬 CLI입니다.**

Codex로 작업하다 Claude Code나 Grok으로 옮기거나 새 대화를 열면, 새 Agent는 이전 세션이 어디서 무엇을 했는지부터 찾아야 합니다. Relay는 각 세션의 실제 세션 ID, 도구, 프로젝트 경로, 짧은 작업 요약을 로컬 SQLite에 남기고, 그 기록을 다음 Agent에게 한 줄 명령으로 넘겨줍니다.

```mermaid
flowchart LR
    H["세션 훅<br/>시작·종료 자동 기록"] --> DB[("Relay 저장소")]
    A["Agent<br/>작업 단위마다 요약 갱신"] --> DB
    DB --> U["사용자<br/>목록에서 골라 복사"]
    U -->|"붙여넣기"| B["다음 Agent<br/>기록 확인 후 이어받기"]
```

Relay는 찾아갈 단서만 전달하고, 내용 파악은 Agent가 실제 프로젝트 파일을 보고 합니다. 전체 대화 보관, 원본 로그 수집, 실행 중인 Agent 전환, 대화 자동 재개는 제공하지 않습니다.

## 목차

- [주요 기능](#주요-기능)
- [용어](#용어)
- [설치](#설치)
- [사용 방법](#사용-방법)
- [Agent 연동](#agent-연동)
- [명령](#명령)
- [터미널과 브라우저 화면](#터미널과-브라우저-화면)
- [데이터와 설정](#데이터와-설정)
- [문제 해결](#문제-해결)
- [API](#api)

## 주요 기능

- **자동 첫 기록**: Claude Code, Codex, Grok의 SessionStart 훅이 세션 시작 시 식별 정보를 기록합니다.
- **종료 기록**: SessionEnd 훅이 종료 시각과 사유를 남깁니다. 훅 자동 기록만 남은 채 끝난 세션은 목록만 차지하므로 지웁니다.
- **조회**: 출처별 최근 세션, 프로젝트별 조회, 이름·ID·요약·경로 부분 검색을 지원합니다.
- **세션 연결**: `continue`로 이전 세션과 현재 세션의 부모·자식 관계를 남깁니다.
- **터미널 선택 화면**: 표에서 행을 고르면 상세를 확인하고, 다음 대화에 붙여넣을 조회 명령을 복사합니다.
- **브라우저 조회**: 필터, 상세, 요약 이력, 세션 연결을 `127.0.0.1`에서 확인합니다.
- **30일 보관**: 마지막 갱신 기준 30일이 지난 기록은 자동 정리됩니다.

## 용어

| 용어 | 설명 |
| --- | --- |
| **Agent Session ID** | Claude Code, Codex, Grok이 각자 발급하는 36자 UUID입니다. Relay는 이 값을 그대로 저장하고 CLI 조회에 씁니다. JSON 필드는 `providerSessionId`입니다. |
| **Relay 내부 ID** | `ses_`로 시작하는 Relay 저장소 식별자입니다. 웹 API와 부모·자식 연결에만 쓰며, CLI 조회에 넣으면 올바른 `relay show` 명령을 안내합니다. JSON 필드는 `id`입니다. |
| **provider / agent** | 회사 식별자와 도구 식별자입니다. `openai`/`codex`, `anthropic`/`claude-code`, `xai`/`grok`. |
| **출처 별칭** | `codex`, `claude`, `grok`. 조회할 **이전 작업의 출처**를 한 단어로 가리키며, 현재 Agent를 바꾸는 옵션이 아닙니다. |
| **훅 자동 기록** | 시작 훅이 만든 첫 기록입니다. 세션 이름은 작업 폴더명, 요약은 `세션 첫 기록 (훅 자동 기록)`이며 실제 단서는 Agent가 `update`로 채웁니다. |
| **세션 연결** | `continue`가 남기는 부모·자식 관계입니다. 이전 세션이 부모, 이어받은 세션이 자식입니다. |
| **종료 기록** | 종료 훅이 남기는 `endedAt`과 `endReason`입니다. 없으면 `진행 중`으로 표시되지만, 강제 종료된 세션도 훅이 돌지 않아 `진행 중`으로 남을 수 있습니다. |

## 설치

Windows 10/11 x64를 지원합니다. `relay.exe` 하나에 런타임과 웹 화면이 들어 있어 설치 후에는 Node.js, Bun, 관리자 권한이 필요 없습니다.

### 빌드하고 설치하기

소스에서 빌드하려면 Node.js 22.12 이상과 npm이 필요합니다. Bun은 npm 의존성으로 함께 설치됩니다.

```powershell
npm ci
npm run build
.\scripts\install-cli.ps1
```

설치 스크립트는 `dist\relay.exe`를 `%USERPROFILE%\.local\bin\relay.exe`에 복사하고, 그 폴더를 사용자 PATH에 추가한 뒤 `relay install-hooks`로 세 도구의 SessionStart·SessionEnd 훅을 등록합니다. 이미 빌드된 실행 파일이 있다면 설치 스크립트만 실행하면 됩니다.

```powershell
relay --version
relay --help
```

`relay`를 찾지 못하면 새 터미널을 여세요. **Codex는 등록된 훅을 `/hooks`에서 한 번 신뢰해야 실행됩니다.** Claude Code와 Grok은 추가 조작이 필요 없습니다.

### 업데이트와 제거

실행 중인 `relay web` 서버나 터미널 선택 화면이 있으면 먼저 종료한 뒤 다시 빌드하고 덮어씁니다.

```powershell
npm run build
.\scripts\install-cli.ps1 -Force
```

설치 위치는 `-InstallDirectory <절대경로>`, PATH 등록 생략은 `-NoPath`로 지정합니다. 제거하려면 설치된 `relay.exe`와 같은 폴더의 `relay-hook-*.cmd`를 삭제하고 각 도구의 훅 설정에서 Relay 항목을 지웁니다. 데이터까지 지우려면 [저장소 폴더](#데이터와-설정)를 삭제합니다.

## 사용 방법

사용자가 하는 일은 세 가지입니다. 훅이 세션을 자동 기록하게 두고, Agent가 요약을 남기게 하고, 목록에서 골라 다음 Agent에게 건넵니다.

### 자동 기록

설치하면 세션 훅이 등록됩니다. 세션을 열면 시작 훅이 세션 ID와 작업 폴더를 기록하고, 세션을 닫으면 종료 훅이 종료 시각과 사유를 남깁니다. 훅은 세션 ID만 알고 작업 내용은 모르므로 요약은 `세션 첫 기록 (훅 자동 기록)`으로 시작하며, 실제 단서는 Agent가 채웁니다.

### 기록 갱신

Agent가 의미 있는 작업 단위마다 요약을 갱신합니다. 프로젝트에 스킬과 지침을 넣어 두면 Agent가 스스로 수행하며, 방법은 [Agent 연동](#agent-연동)에 있습니다. Codex 환경의 PowerShell 예시입니다.

```powershell
relay show $env:CODEX_THREAD_ID --provider openai --json
relay record --provider openai --agent codex --session-id $env:CODEX_THREAD_ID --session-name "로그인 리다이렉트 수정" --summary "로그인 콜백의 리다이렉트 동작 확인 중"
relay update --session-id $env:CODEX_THREAD_ID --provider openai --summary "auth/callback.ts 수정, 테스트 통과. 모바일 확인 필요"
```

- `record`는 `show`로 확인해 기록이 없을 때만 씁니다. 훅이 먼저 기록해 두었으면 바로 `update`를 씁니다.
- `record`는 같은 첫 입력을 재시도해도 이력이 중복되지 않지만, `update`는 호출마다 이력을 추가합니다.
- 요약은 목표, 현재 상태, 변경 파일, 검증 결과, 다음 작업처럼 다음 Agent가 바로 쓸 사실만 짧게 씁니다. 전체 채팅, 파일 전문, 비밀정보는 넣지 않습니다.
- **`update`를 한 번도 남기지 않은 세션은 종료 시 삭제됩니다.** 남길 세션은 첫 작업 단위가 끝나면 반드시 갱신하세요.

### 건네주기

```powershell
relay list
relay --codex
```

`relay list`는 표에서 세션을 골라 상세를 보고, `Enter`로 조회 안내 한 줄을 복사합니다. `relay --codex`처럼 출처를 지정하면 그 출처의 최근 세션 상세가 바로 열립니다. 복사되는 문장은 다음과 같습니다.

```text
이전 세션 맥락은 `relay show '<Agent Session ID>' --provider '<provider>' --data-dir '<Relay 저장소>' --json` 명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요.
```

새 대화에 붙여넣으면 Agent가 `relay show`로 기록을 확인합니다. 받는 Agent는 같은 PC에서 `relay`와 해당 저장소에 접근할 수 있어야 합니다.

### 이어받기

이전 작업을 **파악하는 요청**과 **이어서 수행하는 요청**은 구분하세요. 붙여넣은 문장만으로는 조회만 하며, "이 기록을 확인하고 작업을 이어서 해 주세요"처럼 요청하면 Agent가 `continue`로 현재 세션을 이전 세션의 자식으로 연결한 뒤 프로젝트 파일을 확인하고 작업을 계속합니다. Grok 세션을 Codex가 이어받는 예시입니다.

```powershell
relay continue '<이전 Agent Session ID>' --parent-provider xai --provider openai --agent codex --session-id $env:CODEX_THREAD_ID --summary "이전 로그인 수정 세션을 확인함. 모바일 동작 검증 진행"
```

- `--parent-provider`는 이전 세션의 제공자, `--provider`는 현재 세션의 제공자입니다.
- 이어받을 때는 별도로 `record`하지 않고 `continue`를 먼저 호출합니다. 훅이 현재 세션을 이미 기록해 두었어도 부모가 없으면 그 기록에 연결됩니다.
- `continue`는 Relay 기록 사이의 연결만 남기며 원본 대화를 재개하지 않습니다. 새 기록은 부모의 세션 이름과 프로젝트 경로를 기본으로 쓰고, 다른 폴더면 `--cwd`를 지정합니다.
- 이미 다른 부모에 연결돼 있거나 자기 자신·자손을 부모로 지정하면 `PARENT_CONFLICT`입니다.

## Agent 연동

Agent가 스스로 기록하게 하려면 프로젝트마다 스킬과 지침을 설치합니다. 훅은 설치 시 사용자 단위로 한 번만 등록됩니다.

### 스킬 설치

[skills/relay-session](skills/relay-session/SKILL.md)은 Agent가 Relay를 기록·조회·이어받는 절차를 담은 스킬입니다. 프로젝트 단위로 설치하며, 기존 파일 내용이 다르면 덮어쓰지 않고 중단합니다.

```powershell
.\scripts\install-skill.ps1 -Agent codex -ProjectDirectory "C:\workspace\my-project"
.\scripts\install-skill.ps1 -Agent claude -ProjectDirectory "C:\workspace\my-project"
```

각각 `.agents/skills/relay-session`, `.claude/skills/relay-session`에 배치됩니다. 스킬을 인식한 Codex에서는 `$relay-session grok`, Claude Code에서는 `/relay-session grok`으로 Grok 기록을 조회할 수 있습니다.

### 프로젝트 지침

프로젝트의 `AGENTS.md` 또는 `CLAUDE.md`에 아래 지침을 추가하면 Agent가 첫 작업 전에 기록 절차를 수행합니다. 이 저장소의 [AGENTS.md](AGENTS.md)가 실제 예시입니다.

```text
세션의 첫 작업 전에 relay-session 스킬을 읽고, 그 절차에 따라 현재 세션 정보를 Relay에 기록한다.
명령을 추측하지 않는다. 스킬을 찾지 못하면 relay --help로 확인한다.
호스트가 제공한 실제 세션 ID만 사용하고, 기존 기록을 먼저 확인해 없을 때만 생성한다.
이전 작업을 이어받으면 continue로 출처를 연결하고, 작업 단위가 끝나면 짧은 진행 단서를 갱신한다.
update를 한 번도 남기지 않은 세션 기록은 종료 시 삭제되므로 첫 작업 단위가 끝나면 반드시 갱신한다.
relay가 없거나 기록에 실패하면 한 줄로 알리고 원래 작업을 계속한다.
```

세션 ID는 각 도구가 환경변수로 제공합니다. Agent는 이 값을 그대로 쓰고 임의로 만들지 않습니다.

| 도구 | 환경변수 | `--provider` / `--agent` |
| --- | --- | --- |
| Claude Code | `CLAUDE_CODE_SESSION_ID` | `anthropic` / `claude-code` |
| Codex | `CODEX_THREAD_ID` | `openai` / `codex` |
| Grok | `GROK_SESSION_ID` | `xai` / `grok` |

### 시작·종료 훅

`relay install-hooks`가 세 도구의 SessionStart·SessionEnd 훅을 등록하며, `relay.exe`를 실행할 때마다 빠진 훅을 다시 채웁니다. 기존의 다른 훅은 유지하고, Relay 항목이 이미 있으면 실행 파일 경로만 맞춥니다.

| 도구 | 훅 위치 | 시작 명령 | 종료 명령 |
| --- | --- | --- | --- |
| Claude Code | 사용자 설정 `hooks.SessionStart` · `hooks.SessionEnd` | `relay.exe hook claude` | `relay.exe hook claude --end` |
| Codex | `~/.codex/hooks.json` (`CODEX_HOME`이 설정돼 있으면 그 폴더에도) | `relay-hook-codex.cmd` | `relay-hook-codex-end.cmd` |
| Grok | `~/.grok/hooks/relay.json` | `relay-hook-grok.cmd` | `relay-hook-grok-end.cmd` |

Claude Code 설정 예시입니다. Codex와 Grok은 같은 구조에 래퍼 `.cmd` 경로를 넣습니다.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "\"C:/Users/<사용자>/.local/bin/relay.exe\" hook claude || echo {}", "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "\"C:/Users/<사용자>/.local/bin/relay.exe\" hook claude --end || echo {}", "timeout": 10 }] }
    ]
  }
}
```

- 훅은 `{}`를 먼저 출력하고 기록을 시도하므로 기록 오류가 도구의 세션을 막지 않습니다.
- 세션 ID는 페이로드의 `session_id`, `sessionId`, `thread_id`, 그다음 환경변수 순으로 찾습니다. 서브에이전트 페이로드(`agent_id`)는 기록하지 않습니다.
- 시작 훅은 작업 폴더 이름과 `세션 첫 기록 (훅 자동 기록)` 요약으로 등록합니다. 같은 세션이 다시 시작돼도 이력이 늘지 않습니다.
- 종료 훅은 종료 시각(`endedAt`)과 도구가 보낸 사유(`endReason`, 예: `prompt_input_exit`, `logout`)를 남깁니다. 마지막 갱신 시각과 요약 이력은 바뀌지 않습니다.
- 이력이 훅 자동 기록 한 건뿐이고 이어받은 세션도 없으면 종료 시 기록을 삭제합니다. 같은 세션이 다시 시작되거나 `update`·`continue`가 오면 종료 기록을 지웁니다.
- Codex는 등록된 시작·종료 항목을 `/hooks`에서 각각 신뢰해야 실행됩니다. Orca처럼 `CODEX_HOME`을 따로 두는 호스트에서 실행한 Codex는 그 폴더의 `hooks.json`을 읽으므로, 그 환경변수가 있는 셸에서 `relay install-hooks`를 한 번 실행하세요.
- 훅을 등록하고 싶지 않으면 `RELAY_SKIP_HOOK_INSTALL=1`을 설정한 뒤 각 도구 설정에서 Relay 항목을 지웁니다.

훅은 첫 기록을 자동화하는 편의 장치이지 기록의 전제 조건이 아닙니다. 훅이 없거나 실행되지 않았어도 Agent는 스킬 절차대로 `record`하고 `continue`합니다.

## 명령

| 명령 | 용도 |
| --- | --- |
| `relay --codex` / `--claude` / `--grok` | 해당 출처의 최근 세션 한 건을 상세로 열고 조회 명령 복사 |
| `relay latest <별칭> [--cwd <경로>]` | 출처의 최근 갱신 기록 한 건 |
| `relay list [--query <텍스트>] [--provider] [--agent] [--cwd]` | 세션 목록과 부분 검색 |
| `relay show <Agent Session ID> [--provider] [--history]` | 세션 상세와 요약 이력 |
| `relay record --provider --agent --session-id --summary [--session-name] [--model] [--cwd]` | 현재 세션 첫 기록 |
| `relay update --session-id <ID> --summary <요약> [--provider]` | 진행 요약 갱신 |
| `relay continue <이전 ID> --parent-provider <제공자> ...` | 이전 세션에 현재 세션 연결. 나머지 옵션은 `record`와 같음 |
| `relay install-hooks [--bin-dir <경로>]` | SessionStart·SessionEnd 훅 등록 |
| `relay web [--open] [--port <번호>]` | 브라우저 조회 서버 실행 |

전역 옵션은 `--data-dir <절대경로>`와 `--json`입니다. Agent나 스크립트에서는 `--json`을 붙이세요. 성공 결과는 stdout, 실패는 stderr에 JSON 하나로 출력됩니다. 종료 코드는 `0` 성공, `2` 입력·설정 오류, `3` 기록 없음(`SESSION_NOT_FOUND`), `4` 충돌(`PARENT_CONFLICT`, `SESSION_EXISTS`, `AMBIGUOUS_SESSION_ID`), `5` 저장소 오류, `6` 서버 시작 실패입니다.

### 조회 별칭

| 별칭 | provider | agent |
| --- | --- | --- |
| `codex` | `openai` | `codex` |
| `claude` | `anthropic` | `claude-code` |
| `grok` | `xai` | `grok` |

"최근"의 기준은 Relay의 마지막 갱신 시각 `updatedAt`입니다. `latest`와 단축 조회는 기본적으로 모든 프로젝트를 대상으로 하며, `--cwd`를 주면 정확히 일치하는 경로의 기록만 찾습니다. 범위에 기록이 없으면 `SESSION_NOT_FOUND`를 반환하고 다른 프로젝트나 제공자로 자동 전환하지 않습니다. 같은 Agent Session ID가 여러 제공자에 있으면 `--provider`를 지정합니다.

### 조회 결과 필드

`--json` 응답은 `schemaVersion: 1`과 camelCase 필드를 씁니다. `latest`와 `show`에서 Agent가 보는 단서입니다.

| 필드 | 의미 |
| --- | --- |
| `session.provider` / `session.agent` | 어떤 제공자와 도구의 세션인지 |
| `session.providerSessionId` | 원본 세션을 찾을 때 쓰는 실제 Agent Session ID |
| `session.workingDirectory` | 어느 프로젝트에서 한 작업인지 |
| `session.sessionName` / `session.summary` | 어떤 작업을 하던 세션인지, 마지막 요약 |
| `session.createdAt` / `session.updatedAt` | Relay에 처음 기록하고 마지막으로 갱신한 시각 |
| `session.endedAt` / `session.endReason` | 종료 훅이 남긴 종료 시각과 사유. 없으면 `null` |
| `parentSession` / `children` / `childrenPage` | 이어받은 이전 세션과 이 세션을 이어받은 세션들 |

## 터미널과 브라우저 화면

### 터미널

`relay list`와 단축 조회는 아래 열을 표시합니다. 이름과 Agent Session ID는 항상 남고, 터미널이 좁으면 요약, 생성, 갱신, 종료, Agent, 프로젝트 순으로 숨깁니다.

| 열 | 내용 |
| --- | --- |
| 이름 | 세션 이름. 훅이 기록한 세션은 프로젝트 폴더명 |
| 프로젝트 | 작업 경로의 폴더명 |
| Agent | 도구 이름. 제공자별로 색이 다름 |
| Agent Session ID | 원본 도구의 실제 세션 ID |
| 생성 · 갱신 | 로컬 시각을 `26.09.17 18:00` 형식으로 표시 |
| 종료 | 종료 훅이 남긴 종료 시각. 종료 기록이 없으면 `진행 중` |
| 요약 | 마지막 진행 요약 |

터미널에서 직접 실행하면 행을 골라 상세를 보고 복사하는 선택 화면이 열립니다. 상세는 브라우저 상세와 같은 내용(최근 작업 요약, 세션 정보, 기록 이력, 세션 연결)을 한 화면에 담습니다. 파일로 리디렉션하거나 Agent가 비대화형으로 호출하면 선택 화면 없이 표 또는 JSON만 출력합니다.

| 조작 | 동작 |
| --- | --- |
| 마우스 이동 · `↑` `↓` · `j` `k` · `PgUp` `PgDn` · `g` `G` | 목록에서 행 이동, 상세에서 스크롤 |
| 클릭 · `Enter` · `Space` | 목록에서 선택한 세션의 상세 열기, 상세에서 조회 안내 한 줄을 복사하고 닫기 |
| `Backspace` · 상세에서 `Esc` | 상세에서 목록으로 돌아가기 |
| `q` · `Ctrl+C` · 목록에서 `Esc` | 복사하지 않고 닫기 |

선택 화면은 `RELAY_NO_TUI=1`, 색상은 `NO_COLOR=1`로 끕니다. Windows 클립보드에서 한글이 깨지면 `RELAY_CLIPBOARD=powershell`을 지정하세요.

### 브라우저

```powershell
relay web --open
```

기본 주소는 `http://127.0.0.1:7474`이며 종료는 `Ctrl+C`입니다. 검색, 제공자·도구·프로젝트 경로 필터, 페이지 이동, 세션 상세를 제공하고, 상세의 **개요 / 기록 이력 / 세션 연결** 탭에서 작업 단서와 연결된 세션을 봅니다. CLI가 저장한 변경은 3초 안에 화면에 반영됩니다.

- **세션 컨텍스트 복사**: 다음 Agent에게 붙여넣을 조회 명령과 안내 문구 한 줄
- **조회 명령 복사**: `relay show ... --json` 명령만
- **Agent Session ID만 복사**: 원본 도구의 실제 세션 ID만

## 데이터와 설정

저장소 폴더는 `--data-dir` → `RELAY_DATA_DIR` 환경변수 → 사용자 홈의 `.relay` 순으로 정합니다. 그 폴더에 `relay.db`와 선택 파일 `config.json`을 둡니다. 저장소 폴더와 프로젝트 작업 디렉터리는 다른 경로이며, 기록과 조회에는 같은 저장소를 써야 합니다.

```powershell
relay latest grok --data-dir "C:\relay-data" --json
relay web --data-dir "C:\relay-data" --port 7475
```

`config.json`의 전체 항목입니다. 파일이 없으면 기본값을 씁니다.

```json
{
  "schemaVersion": 1,
  "webHost": "127.0.0.1",
  "webPort": 7474,
  "retentionDays": 30
}
```

DB는 로컬 디스크에 두세요. 네트워크 드라이브나 클라우드 동기화 폴더는 지원하지 않습니다.

### 보관 기간

기본 보관 기간은 **마지막 갱신으로부터 30일**입니다. 정리는 `record`, `continue`, `update`와 훅 같은 기록 명령에서만 수행하며, 자식이 참조하는 부모는 함께 보존합니다. `retentionDays`는 0~3650이고 `0`이면 자동 삭제를 끕니다. Relay 기록을 정리해도 프로젝트 소스나 원본 도구의 세션 파일은 삭제하지 않습니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `relay`를 찾지 못함 | 새 터미널을 열거나 실행 파일의 절대경로를 사용 |
| `SESSION_NOT_FOUND` | 출처, 조회 범위, 저장소 경로 확인. Relay에 없다는 뜻이지 원본 세션이 없다는 뜻은 아님 |
| 엉뚱한 프로젝트의 기록이 나옴 | 기본값은 전체 프로젝트. `latest <별칭> --cwd <절대경로>`로 제한 |
| 요약이 훅 기본 문구뿐임 | Agent가 작업 시작 후 `update`로 단서를 남겼는지, 스킬과 프로젝트 지침이 설치됐는지 확인 |
| 세션이 목록에서 사라짐 | 훅 자동 기록만 남은 채 종료되면 삭제됩니다. Agent가 `update`를 남겼는지 확인 |
| 끝난 세션이 `진행 중`으로 보임 | 터미널을 강제로 닫거나 프로세스가 죽으면 종료 훅이 실행되지 않음 |
| 오래된 기록이 사라짐 | 30일 보관 정책. 원본 도구의 기록과 프로젝트 파일은 별개 |
| 설치 시 파일이 사용 중 | 실행 중인 `relay web` 서버나 선택 화면을 종료하고 다시 설치 |
| 웹 포트가 사용 중 | `relay web --port 7475`처럼 다른 포트 지정 |
| Codex 훅이 실행되지 않음 | Codex에서 `/hooks`로 Relay 시작·종료 항목을 신뢰. `CODEX_HOME`을 쓰는 호스트면 그 셸에서 `relay install-hooks` 실행 |
| 복사한 한글이 깨짐 | `RELAY_CLIPBOARD=powershell` 지정 |

## API

`relay web`은 로컬 조회 전용 서버입니다. `127.0.0.1`에 바인딩하고 GET만 허용하며, Host/Origin 검사와 CSP를 적용합니다. 쓰기 API는 없으므로 기록은 항상 CLI로 합니다.

| 조회 API | 용도 |
| --- | --- |
| `GET /api/v1/health` | 버전, 준비 상태, 저장소 경로 |
| `GET /api/v1/sessions` | 목록: `q/provider/agent/cwd/limit/offset` |
| `GET /api/v1/sessions/:id` | 상세, 부모, 자식 첫 페이지 |
| `GET /api/v1/sessions/:id/updates` | 요약 이력 |
| `GET /api/v1/sessions/:id/children` | 자식 세션 |

`:id`는 Relay 내부 ID입니다. 응답은 CLI의 `--json`과 같은 형태이며, 페이지 크기는 기본 50, 최대 100입니다.

## 라이선스

[MIT](LICENSE)
