# macOS 데스크톱 셸 재설계 — 작업 기록

설계 문서: `.tasks/desktop-design.md` · 역할: Fable 5.1(설계·조율·감사), Opus 5 서브에이전트(구현·테스트)

## 진행

| 시각 | 단계 | 담당 | 결과 |
|---|---|---|---|
| 2026-09-22 | 참고 디자인 수집(21st.dev macOS Desktop Portfolio, 라이브 DOM/CSS, 소스 클론) | Fable | 완료. 관찰값은 설계 문서 §1 |
| 2026-09-22 | 설계 문서 작성 | Fable | 완료 (`desktop-design.md`) |
| 2026-09-22 | 이미지 자산 생성(Grok Imagine): 배경화면 다크 `image_gen` → 라이트 `image_edit` 파생, Dock 아이콘 시트 `image_gen` → PIL 키잉으로 4개 PNG 분리 | Fable | 완료. `src/web/public/wallpaper-*.jpg`, `src/web/public/icons/*.png`. 설계 문서 §0·§6.1·§6.6 갱신, 구현 에이전트에 변경 전달 |
| 2026-09-22 | 사용자 추가 요구: Apple식 글래스모피즘, 합격 기준은 "객관적 아름다움" → 설계 문서 §5.1 재질 체계·§11-A 미적 합격 기준 추가, 구현 에이전트에 전달 | Fable | 완료 |
| 2026-09-22 | 사용자 추가 요구: 박스 안 텍스트 정렬(쏠림 없음), Pretendard Variable 폰트 → 설계 문서 §5 서체·§5.2 정렬 규칙 추가, `src/web/public/fonts/PretendardVariable.woff2`(v1.3.9, OFL) 배치, 구현 에이전트에 전달 | Fable | 완료 |
| 2026-09-22 | 구현 1~5단계 + 감사 반려 7건 재작업 | Opus 5 (implementer) | 완료 (검증 로그 1차·2차) |
| 2026-09-22 | 1차·2차 감사(스크린샷·실제 서버 조작·독립 테스트 재실행) | Fable | 합격. 커밋(푸시 없음) |

## 검증 로그

### 2026-09-22 · Opus 5 (implementer) · 구현 1~5단계 완료

네 명령을 순서대로 실행했고 모두 통과했다. 실행 순서는 typecheck → test → build → test:web.

```text
### typecheck
> tsc --noEmit
(출력 없음, 종료 코드 0)

### test  (bun unit)
bun test v1.4.2 (744846f84)
 80 pass
 0 fail
 1110 expect() calls
Ran 80 tests across 8 files. [30.78s]

### build
Built React web assets
Built dist/relay.exe

### test:web  (playwright, dist/relay.exe 대상)
Running 25 tests using 1 worker
  ok  1 desktop.spec.ts › 기본 테마는 다크, 토글과 시스템 모드가 저장된다 (1.4s)
  ok  2 desktop.spec.ts › 배경화면·Dock 아이콘·서체가 실행 파일에서 제공된다 (772ms)
  ok  3 desktop.spec.ts › 데스크톱 기본 배치: Dock 네 앱, 세션·가이드 창이 열린다 (663ms)
  ok  4 desktop.spec.ts › 창 열기·최소화·최대화·닫기가 Dock 표시와 함께 동작한다 (1.6s)
  ok  5 desktop.spec.ts › 상단바 드래그로 창을 옮기면 위치가 저장되고, 입력에서는 움직이지 않는다 (1.9s)
  ok  6 desktop.spec.ts › 가이드 창의 버튼과 / 단축키가 세션 창을 앞으로 가져온다 (1.2s)
  ok  7 desktop.spec.ts › 명령 창은 선택한 세션의 조회 명령을 보여 주고 셸 설정을 공유한다 (1.6s)
  ok  8 desktop.spec.ts › 메뉴바 메뉴로 테마·창·배치를 키보드로 다룰 수 있다 (1.8s)
  ok  9 desktop.spec.ts › 모바일에서는 창이 하나씩 최대화되고 Dock이 탭바가 된다 (680ms)
  ok 10 desktop.spec.ts › 감사용 스크린샷: 다크·라이트·상세·모바일 (2.8s)
  ok 11–25 web.spec.ts 기존 15개 전부 통과
  25 passed (1.4m)
```

- 감사용 스크린샷: `test-results/desktop-감사용-스크린샷-다크·라이트·상세·모바일/`에
  `desktop-dark.png` · `desktop-light.png` · `desktop-detail-1440.png` · `mobile-dark.png` · `mobile-light.png`.
  기존 반응형 스크린샷은 `desktop-detail-{1920,1280,1024,760,390,320}.png`로 이름을 바꿨다.
- 테스트 계약 변경 2건 반영: `#list-content tbody tr` → `#list-content .session-row`, `.sidebar-footer .connection-dot` → `#connection-state .connection-dot`.
- 외부 자산 0건 확인(`grep -ri "apple.com|fonts.googleapis|https://" src/web` → 생성 CSS의 Tailwind 주석 한 줄뿐).
  배경화면·Dock 아이콘·Pretendard는 Bun `type: "file"` 임포트로 `relay.exe`에 포함되며, 다른 작업 디렉터리에서 실행한 바이너리가 200으로 제공하는 것을 Playwright로 확인했다.
- `pageerror` 0건(첫 web 테스트와 첫 desktop 테스트에서 검사). 콘솔 CSP 위반 없음.

### 2026-09-22 · Opus 5 (implementer) · 감사 지적 7건 반영 (2차)

```text
### typecheck
> tsc --noEmit
(출력 없음, 종료 코드 0)

### test
 80 pass / 0 fail / 1110 expect() calls · 8 files [31.39s]

### build
Built React web assets
Built dist/relay.exe

### test:web
Running 25 tests using 1 worker
  ok 1–10  desktop.spec.ts (테마 / 자산 / 기본 배치 / 창 조작 / 드래그 / 가이드 / 명령 창 / 메뉴 / 모바일 / 스크린샷)
  ok 11–25 web.spec.ts 기존 15개
  25 passed (1.4m)

### desktop.spec.ts 연속 2회(플레이크 확인)
run 1 → 10 passed (16.1s)
run 2 → 10 passed (16.2s)
```

반영 내용

1. (HIGH) 드롭다운 메뉴와 Dock 툴팁을 `createPortal(document.body)` + `position: fixed`로 옮겼다. 메뉴바·Dock이 backdrop 루트라
   내부에 두면 유리가 자기 자신만 샘플링해 뒤 창이 또렷하게 비쳤다. 트리거의 `getBoundingClientRect()`로 좌표를 잡고(메뉴 `top = bottom + 6`,
   툴팁은 아이콘 중앙 위 10px), z 90/95. Esc·↑↓·Home/End·초점 복귀는 그대로.
2. (MEDIUM) 세션 창 빈 상태를 `DetailPlaceholder`(40px `Inbox` + 한 줄 안내 + `/` 단축키 힌트)로 교체했다. 가이드 창과 내용이 겹치지 않는다.
3. (MEDIUM) 메뉴바 연결 표시를 `연결됨` / `연결 확인 중…` / `연결 끊김 · 재시도 중`으로 줄이고, 폴링 안내는 상태바
   `마지막 성공 조회 hh:mm:ss · 3초마다 자동 조회`로 옮겼다.
4. (LOW) 목록 행 복사 버튼은 `opacity: 0` → 행 hover/`:focus-within`에서만 보이고, `@media (hover: none)`에서는 항상 보인다.
5. (LOW) 설정 창 기본 높이 520 → 600. 더불어 `.window-body`가 flex 컬럼이라 자식이 눌려 스크롤이 생기지 않던 버그를 고치고
   (`flex-shrink: 0`), 여백을 줄여 1000px 높이에서 폼 전체(저장소 안내까지)가 스크롤 없이 들어간다(본문 546 = scrollHeight 546).
6. (LOW) 명령 창은 `container: command / inline-size`로 560px 미만에서 명령 줄과 복사 버튼을 세로로 쌓고 버튼을 오른쪽에 붙인다.
7. (LOW) 명령·설정 창 기본 위치를 가로 중앙으로(`x = round((W - w) / 2)`, 명령 y 180 / 설정 y 120).

자발적 변경 원인: 1번과 같은 원인이었다. 메뉴가 메뉴바 안에 있어 유리가 깨진 채 창 위에 겹쳐 있었고, 창을 누르려는 클릭이
`창` 메뉴의 `닫기`·`최대화`에 그대로 들어갔다(세션 창 닫힘 + `maximized: true` 저장 + 포커스/URL 변동과 정확히 일치).
포털과 함께 전면 오버레이(z 89)를 두어 메뉴 바깥 클릭은 **메뉴를 닫기만** 하고 뒤 창에 닿지 않는다(실제 마우스 클릭으로 확인:
URL·창 개수·`data-maximized` 모두 변화 없음). 추가로 `restore()`는 열려 있는 창에만 `maximized`를 복원한다.
창을 조작하는 코드 경로는 신호등 버튼·상단바 더블클릭·`창` 메뉴·Dock뿐이며 effect/폴링에서 호출하는 곳은 없다.

감사용 스크린샷 5종은 `npm run test:web` 실행으로 다시 만들었다(`test-results/desktop-감사용-스크린샷-다크·라이트·상세·모바일/`).

## 감사 메모 (Fable)

### 2026-09-22 · 1차 감사 (스크린샷 + 실제 서버 조작)

검증: 계산된 스타일이 설계값과 일치(Pretendard 로드, 메뉴바 blur 20px·Dock 30px·창 크롬 40px, 창 프레임 투명, 콘솔 오류 0). 다크/라이트/모바일/설정/명령 창/Dock 툴팁 모두 확인.
전체적으로 §11-A 기준을 충족하나 아래 항목은 반려·재작업.

| # | 심각도 | 발견 | 조치 |
|---|---|---|---|
| 1 | 높음 | Relay 메뉴·창 메뉴 드롭다운이 `.menubar`(backdrop-filter) 안에 렌더돼 자체 블러가 아래 창을 흐리지 못함 → 창 내용이 또렷이 비쳐 메뉴 글자가 겹침 | 메뉴·Dock 툴팁을 body 포털 + fixed 좌표로 이동 |
| 2 | 중간 | 세션 창 빈 상세 영역이 가이드 창과 같은 일러스트·제목·문단을 반복 | 가벼운 플레이스홀더로 교체 |
| 3 | 중간 | 메뉴바 우측 텍스트 과다(`연결됨 · 3초마다 자동 조회`) | 메뉴바는 상태만, 주기는 상태바로 |
| 4 | 낮음 | 목록 행 복사 아이콘이 항상 45% 노출 | hover/focus 시에만, 터치 기기는 항상 |
| 5 | 낮음 | 설정 창 기본 높이 520에서 마지막 행·안내문이 잘림 | 기본 높이 600 |
| 6 | 낮음 | 모바일 명령 창에서 복사 버튼이 명령과 같은 줄에 있어 줄바꿈이 어색 | 좁은 컨테이너에서 버튼을 아래 줄로 |
| 7 | 낮음 | 명령·설정 창 기본 위치가 세션 목록을 가림 | 뷰포트 가로 중앙 배치 |

특이사항: 감사 중 한 번, 조작 없이 URL·창 상태가 바뀐 현상(세션 창 닫힘·최대화 저장·가이드 이동)이 있었음. 저장 배치 초기화 후 재현되지 않았고 JS/포인터 클릭 모두 정상. 재검증 시 재현 여부 확인.

### 2026-09-22 · 2차 감사 (재작업 검증)

- 반려 7건 모두 반영 확인. 드롭다운 메뉴·Dock 툴팁이 `body` 포털(`position: fixed`, z 90/95)로 옮겨져 뒤 창이 제대로 흐려지고 항목이 또렷함(2배 확대 확인). 메뉴 바깥 클릭은 전면 오버레이가 흡수.
- "조작 없이 상태가 바뀐" 현상의 원인은 1번과 동일: 유리가 깨진 메뉴가 창 위에 투명하게 겹쳐 있어, 창을 겨냥한 클릭이 `창 → 닫기/최대화`에 들어간 것. 포털+오버레이로 해소됐고 desktop.spec 2회 연속 통과.
- 빈 상세 영역은 `Inbox` 아이콘 + 한 줄 안내 + `/` 힌트의 플레이스홀더로 바뀌어 가이드 창과 중복 없음. 메뉴바는 `연결됨`만, 상태바에 `· 3초마다 자동 조회`.
- Fable 독립 검증: `npm run typecheck` 통과, `npx playwright test` 25 passed (1.5m).
- 판정: §11-A 미적 기준 충족 → 합격. 커밋 진행(푸시 없음).
