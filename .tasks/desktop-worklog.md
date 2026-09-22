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
| 2026-09-22 | 1차·2차 감사(스크린샷·실제 서버 조작·독립 테스트 재실행) | Fable | 합격. 커밋 `65953e7`(푸시 없음), `scripts/install-cli.ps1 -Force`로 설치 |
| 2026-09-22 | 사용자 피드백: 전환 애니메이션 부재 → GSAP 모션 설계 `.tasks/motion-design.md` 작성(타이밍 토큰, 전환 인벤토리 A–F, 아키텍처, 테스트 계약) | Fable | 완료 |
| 2026-09-22 | GSAP 모션 구현(gsap 3.15.0, @gsap/react 2.1.2) + `tests/motion.spec.ts` | Opus 5 (worker) | 완료 (검증 로그 모션) |

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

### 2026-09-22 · Opus 5 (worker) · GSAP 모션 구현 (motion-design.md §3 A–F, §5)

네 명령을 순서대로 실행했고 모두 통과했다.

```text
### typecheck
> tsc --noEmit
(출력 없음, 종료 코드 0)

### test  (bun unit)
bun test v1.4.2 (744846f84)
 80 pass
 0 fail
 1110 expect() calls
Ran 80 tests across 8 files. [38.76s]

### build
Built React web assets
Built dist/relay.exe

### test:web  (playwright, dist/relay.exe 대상)
Running 35 tests using 1 worker
  ok  1–10 desktop.spec.ts (테마 / 자산 / 기본 배치 / 창 조작 / 드래그 / 가이드 / 명령 창 / 메뉴 / 모바일 / 스크린샷)
  ok 11 motion.spec.ts › 창 닫기는 종료 트윈을 재생한 뒤 DOM에서 사라진다 (1.0s)
  ok 12 motion.spec.ts › 최소화는 Dock으로 접히고 복원은 원래 자리로 되돌린다 (1.4s)
  ok 13 motion.spec.ts › 최대화는 Flip으로 프레임을 늘린다 (1.4s)
  ok 14 motion.spec.ts › 세션 교체는 클론 오버레이로 크로스페이드된다 (1.3s)
  ok 15 motion.spec.ts › 목록 갱신은 Flip으로 재정렬되고 바뀐 행만 밝아진다 (4.2s)
  ok 16 motion.spec.ts › 변화 없는 폴링에서는 아무것도 움직이지 않는다 (5.2s)
  ok 17 motion.spec.ts › 메뉴는 페이드인하고 Esc에 종료 트윈 뒤 사라진다 (1.2s)
  ok 18 motion.spec.ts › 복사 토스트는 떠오른 뒤 3.5초 안에 사라진다 (4.3s)
  ok 19 motion.spec.ts › reduced-motion에서는 열기·닫기·교체가 즉시 반영된다 (1.4s)
  ok 20 motion.spec.ts › 감사용 프레임 캡처: 창 열기와 세션 교체 (3.3s)
  ok 21–35 web.spec.ts 기존 15개 전부 통과
  35 passed (2.0m)

### motion.spec.ts 연속 실행(플레이크 확인)
run 1 → 10 passed (26.4s)
run 2 → 10 passed (26.0s)
```

- 의존성: `gsap@3.15.0`(Flip 포함) + `@gsap/react@2.1.2`만 추가(`--save-exact`). CDN 없음, `eval` 없음 → CSP `script-src 'self'` 유지.
  번들 `src/web/generated/app.js` 418,114 → 531,626바이트(minified, **+113,512** / 상한 120KB 이내).
- 구조: 값·헬퍼는 전부 `src/web/lib/motion.ts`(`MOTION`/`EASE`/`dur()`/`reduced()`)에만 있고 컴포넌트는 `useGSAP`으로 헬퍼만 부른다.
  커밋 직전 훅이 필요한 `FlipList`·`Crossfade`만 클래스 컴포넌트(`src/web/components/transitions.tsx`).
  스토어 과도 상태 `closing`/`minimizing` + `finalizeClose`/`finalizeMinimize`를 `lib/desktop-store.ts`에 추가했다.
- 중복 제거: CSS `@keyframes window-in`·`menu-in`과 해당 `animation` 선언을 지웠다(이제 GSAP만 재생).
- 감사용 프레임 캡처(0/80/160/260ms × 2건, 실제 촬영 시각은 명목값 이후):
  `test-results/motion-감사용-프레임-캡처-창-열기와-세션-교체/motion-window-open-{0,80,160,260}.png`,
  같은 폴더 `motion-session-swap-{0,80,160,260}.png`.
- 연타·중단 시나리오를 별도 스크립트로 확인한 뒤 스크립트는 지웠다(검증만 목적):
  닫는 중 다시 열기 → 프레임 opacity 1 복귀, 최소화 중 복원 → transform 항등 복귀,
  세션 40ms 간격 3연타 → 마지막 세션으로 수렴·클론 0·상세 패널 초점 유지, 탭 3연타 후 thumb 오차 ≤1.5px,
  상세 필터 4연타 후 언마운트·인라인 style 잔여 없음, `pageerror` 0건.

문서 반영 중 설계와 달라진 점(3건, 사유 포함)

1. §3-B4·C3 펄스를 "`--selected`의 40%"가 아니라 토큰 `--pulse-tint`(같은 색 40% 알파)에서 **대상의 현재 배경색으로** 되돌린다.
   투명으로 보내면 선택된 행에서 트윈 끝에 배경이 한 번 꺼졌다 켜지는 깜빡임이 생긴다.
2. §3-C1 클론 크로스페이드에 **불투명 바탕 한 장**(`.detail-clone-backdrop`, z 4 < 새 패널 5 < 클론 6)을 깐다.
   두 겹이 동시에 반투명해지면 창 프레임 너머 배경화면이 비쳐 보였다(0ms 프레임 캡처로 확인 후 수정).
   바탕은 클론과 같은 타임아웃 가드(300ms)로 반드시 걷힌다.
3. §3-D4 복사 폴백은 종료 트윈 **전에** 초점을 돌려준다. §4-1(초점 규칙은 애니메이션과 무관하게 즉시)을 우선했다.
   같은 이유로 메뉴 닫기도 초점을 즉시 돌려주고 트윈은 뒤에서 끝난다.

그 밖의 구현 메모

- §3-B2의 문서화된 한계(사라지는 행은 React 커밋 후 DOM에 없어 종료 애니메이션 생략)를 그대로 따랐다.
- 클론은 `aria-hidden`+`inert`+`pointer-events:none`이고, `id`·`data-testid`·`name`을 떼고 `.summary`는 계산된 스타일을
  인라인으로 옮긴 뒤 클래스를 지운다. 클론이 살아 있는 160ms 동안 Playwright의 strict 선택자가 두 개를 잡는 일을 막는다.
- A5 최대화 Flip은 스토어 `toggleMaximize`가 상태를 바꾸기 전에 `captureFrame(id)`로 프레임 상태를 떠 둔다(호출 지점 3곳을 한곳으로 모음).
- 3초 폴링에서 내용이 같으면(React Query structural sharing) `items` 참조가 그대로라 Flip·pulse·stagger 모두 돌지 않는다(테스트 §5-6).

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

### 2026-09-22 · 모션 감사 (motion-design.md §7)

- 독립 검증: `npm run typecheck` 통과, `npx playwright test` 35 passed (2.0m).
- 프레임 캡처 대조표(창 열기·세션 교체 0/80/160/260ms)에서 중간 프레임이 설계대로 나타남.
- 실제 서버에서 계산값 측정(`getComputedStyle` 샘플링):
  창 열기 opacity .09→1·scale .945→1·y 12.8→0, 300ms 안에 정착, Dock 아이콘 y −12 바운스 동반 /
  닫기 `data-closing` 즉시, 82ms에 opacity .91, 175ms에 DOM 제거 /
  최소화 `data-minimizing` → Dock 아이콘 방향으로 translate + scale .12·opacity 0, 400ms 안에 `data-minimized`·`display:none`, 복원은 역재생 후 identity /
  세션 교체 클론 opacity .98→.62→170ms 제거, 바탕은 300ms 가드에 제거, 새 패널 opacity .55→1·x 5→0, 초점 `.detail-panel` 유지 /
  메뉴 opacity 0→.91(100ms)→1, Esc 후 300ms 안에 제거·초점 복귀 /
  CLI `relay update`로 한 행 갱신 → 그 행만 Flip 이동 + `data-pulsing`, 다른 행은 정지 / 무변화 폴링 3.6초 동안 pulsing·entering·transform 0건 /
  상세 필터 행 height 25→73·opacity 0→1(220ms).
- 워커의 설계 이탈 3건(펄스가 현재 배경색으로 복귀, 클론 크로스페이드에 불투명 바탕, 폴백·메뉴는 종료 트윈 전에 초점 복귀)은 모두 타당해 수용.
- 특이사항: 감사 초반 두 차례, 병렬 도구 호출 직후 URL이 세션 상세로 바뀐 현상이 있었으나 pushState·클릭 감시기를 심은 뒤 같은 순서(Dock 클릭→닫기→메뉴→Esc, 새로 로드)를 반복해도 재현되지 않음(pushState 0건, 히스토리 불변). 앱 코드의 이동 경로는 행·링크 클릭·페이저·필터뿐이며 테스트 35건이 2회 통과하므로 도구 동시 호출의 간섭으로 판단.
- 판정: 합격. 커밋·재설치 진행.
