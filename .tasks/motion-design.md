# Relay 데스크톱 셸 — GSAP 모션 설계

작성: 2026-09-22 · 설계/조율/감사: Fable 5.1 · 구현/테스트: Opus 5 워커
전제: `.tasks/desktop-design.md`의 데스크톱 셸이 구현·설치된 상태(커밋 `65953e7`). 이 문서는 그 위에 **전환 애니메이션**을 더한다.

## 0. 요구와 목표

사용자 피드백: "기능적으로는 아주 잘 동작하고 예뻐. 근데 세션 아이템을 교체하거나, 창을 닫거나, 데이터가 갱신될 때 애니메이션이 없어서 밋밋하다. GSAP으로 각 전환에 부드러운 효과를 더해 달라."

- 모든 **상태 전환**(창 열기·닫기·최소화·최대화, 세션 선택 교체, 목록 갱신·재정렬, 탭 전환, 메뉴·툴팁·토스트, 필터 행 펼침)에 GSAP 애니메이션을 준다.
- macOS 감각: **짧고 절제**(120–280ms), 물리적 연속성(요소가 어디서 와서 어디로 가는지 보임), 방향성(선택은 오른쪽으로 흘러가고, 닫힘은 안으로 사라짐), 튀지 않음.
- `prefers-reduced-motion: reduce`에서는 위치 이동·확대 없이 **즉시 적용(또는 80ms 이하 페이드)**.
- 기존 기능·테스트 계약·접근성(초점 규칙)을 깨지 않는다. 애니메이션은 **초점을 옮기지 않고**, 언마운트를 300ms 이상 늦추지 않는다.

## 1. 라이브러리와 아키텍처

- 의존성 추가: `gsap`(3.13+, Flip 플러그인 포함·무료) 와 `@gsap/react`(`useGSAP` 훅). `npm install gsap @gsap/react` — `package.json`·`package-lock.json` 갱신. CDN 없음(Bun이 번들). GSAP 코어는 `eval`을 쓰지 않아 CSP `script-src 'self'`와 호환된다.
- **중앙 모듈 `src/web/lib/motion.ts`**
  ```ts
  gsap.registerPlugin(Flip);
  export const MOTION = { micro: .12, fast: .16, base: .22, window: .26, stagger: .03, staggerMax: .3 };  // 초
  export const EASE = { enter: "power3.out", exit: "power2.in", move: "power3.inOut", pop: "back.out(1.4)" };
  export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;   // 매 호출 시 평가
  export function dur(key: keyof typeof MOTION) { return reduced() ? 0 : MOTION[key]; }
  export function enter(el, { y = 8, scale, x }?)          // fromTo opacity 0→1 (+ y/x/scale), dur base, ease enter
  export function exit(el, { y, scale, x }?): Promise<void> // to opacity 0, dur fast, ease exit; reduced면 즉시 resolve
  export function pulse(el)                                  // 배경 하이라이트 한 번(§3-B4)
  export function staggerIn(els)                             // enter + stagger(amount ≤ staggerMax)
  ```
  `gsap.defaults({ ease: EASE.enter, duration: MOTION.base, overwrite: "auto" })`. 모든 컴포넌트는 이 모듈만 통해 GSAP을 쓴다(값 하드코딩 금지).
- **React 통합**: 마운트 시 진입 애니메이션은 `useGSAP(() => enter(ref.current), { scope, dependencies })`. 언마운트 전 **종료 애니메이션**은 아래 두 패턴만 쓴다.
  1. **스토어 과도 상태**: 창처럼 상태가 스토어에 있으면 `closing`/`minimizing` 같은 과도 플래그를 두고, 컴포넌트가 종료 트윈을 재생한 뒤 `finalize*(id)`로 실제 상태를 바꾼다(§3-A).
  2. **클론 오버레이**: 상세 패널처럼 `key` 교체로 리마운트되는 콘텐츠는, 교체 직전 이전 DOM을 `cloneNode(true)`로 떠서 같은 자리에 절대 배치한 오버레이로 두고 페이드아웃 후 제거한다(§3-C1). React 상태를 건드리지 않아 안전하다. 클론에는 `aria-hidden`·`inert`를 준다.
- **목록 재정렬 — FLIP**: `FlipList` **클래스 컴포넌트**(`getSnapshotBeforeUpdate`에서 `Flip.getState(".session-row")` 캡처 → `componentDidUpdate`에서 `Flip.from(state, …)`)로 감싼다. 함수 컴포넌트에는 커밋 직전 훅이 없으므로 이 경우만 클래스를 허용한다. 각 행은 `data-flip-id={session.id}`.
- **불필요한 재생 방지**: React Query는 구조가 같으면 같은 참조를 돌려주므로(structural sharing) `list.data.items` 참조가 바뀔 때만 Flip을 돌린다. 3초 폴링에서 내용이 같으면 아무 애니메이션도 없어야 한다(테스트 §5-6).
- **성능**: transform·opacity만 애니메이션(`height`는 필터 행 하나만). `force3D: true`. 드래그·리사이즈 중에는 트윈을 만들지 않는다. 진행 중 트윈은 `overwrite: "auto"`로 정리. 컨텍스트는 `useGSAP`의 자동 revert에 맡긴다.

## 2. 타이밍 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `micro` | 120ms | 툴팁, 체크 표시, 칩 |
| `fast` | 160ms | 종료(닫기·페이드아웃), 탭 콘텐츠 |
| `base` | 220ms | 진입, 메뉴, 토스트, 상세 교체 |
| `window` | 260ms | 창 열기·최대화·복원·최소화 |
| `stagger` | 30ms (총 300ms 상한) | 목록 행, 타임라인 항목 |
| 이징 | `power3.out` 진입 · `power2.in` 종료 · `power3.inOut` 이동/크기 · `back.out(1.4)` 토스트·Dock 바운스 | |

reduced-motion: 위 모든 값 0(즉시). 단 opacity 페이드는 80ms까지 허용(깜빡임 방지).

## 3. 전환 인벤토리

각 항목: 트리거 → 대상 → from → to · 시간 · 이징 · reduced-motion 대안. 구현자는 이 표를 체크리스트로 쓴다.

### A. 창 (`components/desktop/window.tsx`, `lib/desktop-store.ts`)

| # | 전환 | 명세 |
|---|---|---|
| A1 | 열기(Dock 클릭, 메뉴, URL 진입, 첫 로드) | `.window-frame`: opacity 0→1, scale .94→1, y +14→0, `transform-origin: 50% 100%`(Dock 방향에서 떠오르는 느낌). `window`·`power3.out`. 첫 로드 시 세션 창과 가이드 창은 60ms 간격으로 순차. 기존 CSS `@keyframes window-in`은 제거(중복 금지). |
| A2 | 닫기(신호등·창 메뉴) | 스토어 `close(id)` → `closing: true` 표시(`data-closing`). 프레임: opacity 1→0, scale 1→.96, y 0→+6, `fast`·`power2.in`. 완료 후 `finalizeClose(id)`(open=false, closing=false). 애니메이션 중 포인터 차단(`pointer-events: none`). |
| A3 | 최소화 | `minimizing: true`. 프레임을 **Dock의 해당 아이콘 중심**으로: `x/y` = 아이콘 중심 − 창 중심, scale .12, opacity → 0, `window`·`power2.in`. 완료 후 `finalizeMinimize(id)`(minimized=true, `display:none`). Dock 표시점은 즉시 켜짐. |
| A4 | 복원(Dock 클릭·창 메뉴) | A3의 역재생: Dock 아이콘 위치에서 원래 프레임으로, `window`·`power3.out`. 스토어는 먼저 `minimized=false`로 두고 컴포넌트가 `from`으로 시작한다. |
| A5 | 최대화/복원 | `Flip.getState(frame)` → 상태 변경 → `Flip.from(state, { duration: window, ease: move, absolute: true, scale: false })`. 모서리 반경 12→10px도 함께 트윈. 상단바 더블클릭·초록 버튼·창 메뉴 모두 동일 경로. |
| A6 | 포커스 변경 | 현행 CSS(그림자·채움 불투명도) 유지, transition 180ms. GSAP 불필요. |
| A7 | 드래그·리사이즈 | 애니메이션 없음(즉시). 드래그 종료 시 뷰포트 밖으로 나간 부분이 있으면 클램프 위치로 `fast`·`power3.out` 스냅. |
| A8 | 모바일 창 전환(탭바) | 나가는 창 opacity→0 (fast), 들어오는 창 opacity 0→1 + x 12→0 (base). 두 창이 겹치는 동안 `position: fixed`라 레이아웃 변화 없음. |

### B. 세션 목록 (`components/session-list.tsx`)

| # | 전환 | 명세 |
|---|---|---|
| B1 | 첫 로드·페이지 이동·검색 결과 교체(항목 집합이 크게 바뀔 때) | 행 stagger-in: opacity 0→1, y 8→0, `base`, stagger 30ms(총 300ms 상한 = `stagger: { amount: .3 }`). 스켈레톤 → 목록은 크로스페이드(스켈레톤 exit fast). |
| B2 | 폴링 갱신으로 **일부** 행이 추가·삭제·재정렬 | `FlipList`: 이동하는 행은 Flip(`base`·`move`), 새 행은 `onEnter`로 opacity 0→1·y −8→0, 사라지는 행은 즉시 제거(React 커밋 후 DOM에 없으므로 종료 애니메이션 생략 — 문서화된 한계). |
| B3 | 선택 행 변경 | 선택 배경은 CSS transition 150ms 유지. 추가로 새 선택 행에 짧은 **좌측 강조선**(2px, `--primary`)이 위→아래로 그려짐(scaleY 0→1, `micro`). 선택 해제 행은 즉시. |
| B4 | 같은 행의 요약·시각이 갱신됨(폴링) | `pulse(row)`: 배경 `--selected`의 40% → 투명, 600ms `power2.out`. 텍스트는 즉시 교체. 창 비포커스여도 재생. |
| B5 | 빈 상태·오류 알림 등장 | enter(y 6, base). |

### C. 상세 패널 (`components/session-detail.tsx`, `components/apps/sessions-window.tsx`)

| # | 전환 | 명세 |
|---|---|---|
| C1 | 세션 교체(A→B) 및 목록→상세·상세→플레이스홀더 | **클론 오버레이 크로스페이드**: 이전 `.detail-panel`(또는 플레이스홀더)을 클론해 같은 위치에 덮고 opacity 1→0·x 0→−10 (`fast`·`power2.in`), 새 패널은 opacity 0→1·x 12→0 (`base`·`power3.out`). 새 패널의 헤더(제목·프로젝트·액션)는 20ms씩 stagger. 스크롤 위치는 새 패널 0. 초점 규칙(`.detail-panel` 포커스)은 애니메이션과 무관하게 즉시. |
| C2 | 탭 전환(개요/기록 이력/세션 연결) | 콘텐츠 opacity 0→1·y 6→0 (`fast`). 세그먼트 컨트롤의 활성 배경은 별도 `.tabs-thumb` 요소를 두고 Flip으로 좌우 이동(`fast`·`move`). Radix `TabsTrigger`의 `data-state=active` 배경은 투명으로 바꾸고 thumb이 대신한다. |
| C3 | 요약(`.summary`)이 폴링으로 바뀜 | `pulse(summary)` + 텍스트 즉시 교체. 기록 이력 탭이 열려 있으면 새 타임라인 항목이 맨 위에 삽입되며 y −8→0·opacity 진입, 나머지는 Flip으로 아래로 밀림. |
| C4 | 세션 식별자 `details` 펼침 | 내용 opacity·y 진입(`fast`). 닫힘은 즉시(브라우저 기본). |
| C5 | 로딩 스켈레톤 → 콘텐츠 | 크로스페이드(fast). |

### D. 메뉴·툴팁·토스트·복사 폴백

| # | 전환 | 명세 |
|---|---|---|
| D1 | 드롭다운 메뉴 열기/닫기 | 열기: opacity 0→1, y −6→0, scale .98→1, `transform-origin: top left`, `base`. 닫기: opacity→0, y→−4, `micro`·`power2.in` 후 언마운트(오버레이는 즉시 제거해 클릭 차단이 늦지 않게). 항목 hover 배경은 CSS. 기존 `@keyframes menu-in` 제거. |
| D2 | Dock 툴팁 | opacity 0→1, y 4→0, `micro`. 아이콘 간 이동 시 툴팁은 **위치를 Flip으로 미끄러지듯 이동**(`micro`·`move`)하고 텍스트만 교체. |
| D3 | 복사 토스트 `#copy-status` | 진입: y 16→0, opacity 0→1, scale .96→1, `base`·`back.out(1.4)`. 3초 후 종료: opacity→0, y→8, `fast`. 종료 중에도 `role=status` 텍스트는 유지. |
| D4 | 복사 폴백 `#copy-fallback` | 진입 x 16→0·opacity(`base`), Esc 닫기 시 종료(`fast`) 후 초점 복귀. |
| D5 | Radix 툴팁 | 현행 유지(tw-animate). |

### E. Dock

| # | 전환 | 명세 |
|---|---|---|
| E1 | 앱 실행(닫힌 창을 Dock에서 열 때) | 아이콘 바운스: y 0→−12→0, 2회, 총 520ms, `power1.inOut`(macOS 실행 바운스). 창 A1과 동시에 시작. 이미 열린 창을 앞으로 가져올 때는 바운스 없음. |
| E2 | 표시점 | opacity 0→.6 `micro`. |
| E3 | hover 리프트 | 현행 CSS 유지. |

### F. 툴바·필터·기타

| # | 전환 | 명세 |
|---|---|---|
| F1 | 상세 필터 행 펼침/접힘 | height 0↔auto + opacity, `base`·`power3.inOut`(GSAP `height: "auto"`). 접힘 완료 후 언마운트(과도 상태 패턴 1). |
| F2 | 필터 칩 추가·제거 | 추가 scale .9→1·opacity (`micro`), 제거는 즉시. |
| F3 | 테마 전환 | 배경화면 크로스페이드는 CSS 200ms 유지. 추가로 메뉴바 해·달 아이콘 회전 교체(rotate −90→0, `micro`). |
| F4 | 연결 상태 점 변화 | scale 1→1.4→1 `micro` 펄스 1회. |
| F5 | 페이지 이동(이전/다음) | B1과 동일(stagger-in). |

## 4. 접근성·안정성 규칙

1. 애니메이션은 **초점·스크롤·URL을 바꾸지 않는다**. `focus()` 호출 시점은 현행 유지(상세 열림 즉시).
2. reduced-motion: 모든 트윈 duration 0(`dur()`), Flip 생략, 펄스 생략. 페이드만 ≤80ms 허용.
3. 언마운트 지연 상한 300ms. 과도 상태 중 같은 대상에 새 명령이 오면 진행 중 트윈을 `kill`하고 새 상태로 즉시 정리(예: 닫는 중 다시 열기).
4. `visibilitychange`로 숨겨진 탭에서는 GSAP 전역 타임라인이 자동으로 멈추므로 별도 처리 없음. 다만 복귀 직후 폴링으로 데이터가 크게 바뀌면 B1(stagger)이 아니라 B2(Flip)만 쓴다.
5. 클론 오버레이는 `aria-hidden="true"` + `inert`, `pointer-events: none`, 절대 배치, 최대 300ms 후 반드시 제거(타임아웃 가드).
6. GSAP 트윈 대상은 `ref`로만 잡고 전역 `document.querySelector`는 쓰지 않는다(창 여러 개·클론과 충돌 방지). 예외: Dock 아이콘 좌표 계산(A3/A4)은 `data-dock-item` 속성으로 조회.

## 5. 테스트 계약 (Playwright, `tests/motion.spec.ts` 신규 + 기존 유지)

기존 `web.spec.ts`·`desktop.spec.ts` 40건은 그대로 통과해야 한다(자동 대기가 300ms 이내 종료 애니메이션을 흡수한다). 새 스펙:

1. **창 닫기 과도 상태**: 신호등 닫기 클릭 직후 `.window[data-closing]`이 존재하고, 500ms 안에 DOM에서 사라진다. reduced-motion(`emulateMedia`)에서는 즉시(`data-closing` 관측 없이 사라져도 통과).
2. **최소화 → Dock 표시점 유지 → 복원**: 최소화 클릭 후 600ms 안에 `data-minimized`, Dock 클릭 후 창이 다시 보이고 `getBoundingClientRect`가 원래 위치(±1px).
3. **최대화 Flip**: 클릭 후 100ms 시점의 프레임 폭이 시작·끝 사이 값(애니메이션 중)이고, 500ms 후 최대화 크기와 일치.
4. **세션 교체 크로스페이드**: 행 A 클릭 → `.summary` 텍스트 A; 행 B 클릭 직후 클론 오버레이(`.detail-clone`)가 존재하고 500ms 안에 제거되며 `.summary`가 B. 초점은 `.detail-panel`.
5. **목록 갱신 Flip**: 3개 기록 후 `relay update`로 두 번째 세션을 갱신(맨 위로 이동) → 500ms 안에 첫 행이 그 세션이고 `pageerror` 0, 행 개수 불변. 갱신 직후 첫 행에 `pulse` 배경 트윈이 걸린다(`gsap.getTweensOf(row).length > 0`을 `page.evaluate`로 확인 — `window.__relayGsap`을 두지 말고 `gsap`을 `globalThis.gsap`으로 노출하지도 말 것; 대신 행에 `data-pulsing` 속성을 트윈 동안만 붙여 검사).
6. **무변화 폴링에는 애니메이션 없음**: 4초 동안 `.session-row`에 `data-pulsing`·`data-entering`이 한 번도 붙지 않는다(폴링 3회).
7. **메뉴 열기/닫기**: 열기 직후 `[role=menu]` opacity < 1, 300ms 후 1. Esc 후 300ms 안에 제거되고 초점 복귀.
8. **토스트**: 복사 클릭 후 `#copy-status`가 보이고, 3.5초 안에 사라진다.
9. **reduced-motion 전체 회귀**: `emulateMedia({ reducedMotion: "reduce" })`로 desktop.spec 핵심 흐름(열기·닫기·교체)을 한 번 더 돌려 즉시 반영을 확인.
10. **감사용 프레임 캡처**: 창 열기와 세션 교체에 대해 트리거 후 0/80/160/260ms 시점 스크린샷 4장씩 `test.info().outputPath("motion-<case>-<ms>.png")`로 저장(감사자가 중간 프레임을 눈으로 확인).

## 6. 구현 순서와 산출물

1. 의존성 추가(`gsap`, `@gsap/react`), `lib/motion.ts`, reduced-motion 헬퍼. 기존 CSS keyframes(`window-in`, `menu-in`)와 충돌하는 규칙 제거.
2. A(창)와 스토어 과도 상태(`closing`/`minimizing`, `finalizeClose`/`finalizeMinimize`), E(Dock 바운스·표시점).
3. B(목록: `FlipList`, stagger, pulse), C(상세: 클론 크로스페이드, 탭 thumb, 타임라인 삽입).
4. D(메뉴·툴팁·토스트·폴백), F(필터 행·칩·테마 아이콘·연결 점).
5. `tests/motion.spec.ts` 10항목, 기존 40건 회귀, `npm run check` 전체. 검증 로그를 `.tasks/desktop-worklog.md`에 "모션" 절로 추가.
6. 문서: `src/web/DESIGN.md` §5 모션 절을 이 문서 기준으로 갱신(토큰·패턴·reduced-motion). README는 변경 없음(사용자 노출 기능 아님).

## 7. 감사 기준 (Fable)

- [ ] 각 전환이 §3 표의 시간·이징·방향과 일치(프레임 캡처와 계산값으로 확인).
- [ ] 240–300ms 안에 끝나고, 연속 조작(빠른 세션 연타, 닫는 중 다시 열기)에서 깨지지 않음.
- [ ] 3초 폴링에서 변화가 없으면 아무것도 움직이지 않음. 변화가 있으면 해당 행만 움직임.
- [ ] 초점·스크롤·URL 불변. reduced-motion에서 즉시 적용.
- [ ] 60fps: 드래그 중 트윈 없음, transform/opacity만. 콘솔 오류·CSP 위반 0.
- [ ] 기존 40건 + 신규 10건 통과. 번들 크기 증가 ≤ 120KB(minified).
- [ ] "밋밋함" 해소: 세션 교체·창 닫기·데이터 갱신이 모두 눈에 띄게 부드럽다(감사자 판정).
