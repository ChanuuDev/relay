# Relay 웹 화면 재설계 — macOS 데스크톱 셸

작성: 2026-09-22 · 설계/조율/감사: Fable 5.1 · 구현/테스트: Opus 5 서브에이전트
상태: 설계 확정 → 구현 대기

## 0. 목표와 범위

- **참고 디자인**: 21st.dev "macOS Desktop Portfolio" (작성자 alanagoyal, MIT).
  라이브 `https://www.alanagoyal.com`, 소스 `github.com/alanagoyal/alanagoyal` (커밋 `2189232`).
  사용자 요청: "되도록이면 비슷하게. 다만 기능이 많지 않으므로 하단 Dock에는 지금 있는 기능 위주로 나열."
- **결과물**: Relay 브라우저 화면(`relay web`)을 macOS 데스크톱 메타포로 재구성한다.
  배경화면 + 상단 메뉴바 + 드래그/리사이즈/최소화/최대화되는 창 + 하단 Dock.
- **테마**: 다크가 기본. 라이트 지원. 시스템 설정 따르기 옵션.
- **유지**: 조회 전용 기능 범위, `/api/v1/*` API, React Query 폴링(3초), zustand 상태, URL 라우팅(`/`, `/sessions/:id`, `back`),
  접근성 규칙(단축키 `/`, 초점 복귀, 복사 폴백), Playwright 테스트 계약(§9).
- **제외**: Apple 저작 자산(배경화면 JPG, 앱 아이콘 PNG, SF Pro 폰트) 사용 금지. 외부 CDN·원격 폰트 금지(단일 실행 파일 원칙).
  참고 사이트의 부팅/잠금/재시작 오버레이, 알림 센터, 컨텍스트 메뉴, 마법 확대(magnification)는 범위 밖(선택 항목만 §6.5에 표기).
- **이미지 자산**: 사용자 지시(2026-09-22)에 따라 이미지가 필요한 부분은 로컬 Grok Build의 Imagine(`image_gen`/`image_edit`)으로 생성한다.
  생성 자산은 `src/web/public/`에 두고 실행 파일에 포함한다. 배경화면 2종(§6.1)과 Dock 아이콘 4종(§6.6)이 여기에 해당한다. 파비콘·메뉴바 마크는 SVG(`currentColor`)를 유지한다.
  생성 명령 예: `grok -p "Use the image_gen tool once with aspect_ratio 16:9 and this exact prompt: '…'" --tools image_gen --always-approve --permission-mode bypassPermissions`.
  결과는 `~/.grok/sessions/<cwd>/<session>/images/1.jpg`(1280×720 또는 1024×1024)에 저장된다.

## 1. 참고 디자인 관찰 기록 (증거)

라이브 사이트 DOM/CSS와 소스에서 확인한 값. 우리 구현의 기준값이며, Apple 자산이 필요한 부분은 §5·§6에서 대체한다.

| 영역 | 관찰값 |
|---|---|
| 메뉴바 | `fixed top-0 h-7(28px) px-4 z-[70]`, 배경 `bg-white/55 dark:bg-black/55 backdrop-blur-md border-b border-white/10`. 좌: Apple 로고 버튼 `w-6 h-5 rounded`, 앱명 `text-sm font-semibold px-2 py-0.5 rounded`, 메뉴 항목 `text-sm px-2 py-0.5`. 열린 메뉴는 `bg-blue-500 text-white`. 우: 상태 아이콘 버튼 `w-7 h-5 rounded` hover `bg-white/10`, 열림 `bg-white/30 dark:bg-white/20`, 시계 `text-sm px-2`. |
| Dock | `fixed bottom-3 left-1/2 -translate-x-1/2 z-[60]`. 컨테이너 `flex items-end bg-white/30 dark:bg-black/30 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-lg`, padding `6px 12px`, gap 4. 아이콘 48px, 드롭섀도 `drop-shadow(0 2px 4px rgba(0,0,0,.35))`, 열림 표시점 4px `bg-black/60 dark:bg-white/60` (mt 4). 구분선 1×48 `bg-black/20 dark:bg-white/10`. 툴팁은 아이콘 위 46px, 말풍선 꼬리. 클릭 `active:scale-95`. 확대 배율 1.4, 반경 0.88·아이콘. 진입 애니메이션 dockEnter(bounce 0.7s). |
| 창 | `fixed` + `transform: translate(x,y)`, 내부 `absolute inset-0 overflow-hidden shadow-2xl rounded-xl bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10`. 비포커스 `opacity-95`. 최대화 시 `inset-0 rounded-none`. 리사이즈 핸들 모서리 12px, 변 6px. 타이틀바 더블클릭 = 확대 토글. 최소 크기 앱별(Notes 600×400). |
| 창 상단바 | `px-4 py-2 flex items-center sticky top-0 select-none bg-muted`, 스크롤 시 `border-b shadow-[0_2px_4px_-1px_rgba(0,0,0,.15)]`. 신호등 `w-3 h-3 rounded-full gap-1.5`, 색 red-500/yellow-500/green-500, hover 시 내부 아이콘 표시(`text-black/50`). 닫기 전용 창은 노랑·초록 자리에 `bg-zinc-300 dark:bg-zinc-600` 원. |
| Notes 앱 | 좌 사이드바(검색 `rounded bg-muted`, 섹션 헤더 13px muted, 항목 `h-[70px]` 제목 `text-sm font-bold` + 날짜/미리보기 `text-xs`), 선택 행 `bg-[#FFE390] dark:bg-[#9D7D28] rounded-md`, 항목 구분선 `border-muted-foreground/20 mx-2`. 우측 콘텐츠 `p-3`. |
| 드롭다운 메뉴 | `rounded-lg border border-black/10 bg-white/95 py-1 text-xs shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/95`, 항목 `px-3 py-1.5` hover `bg-blue-500 text-white`. |
| 토큰(globals.css) | light: bg `0 0% 100%`, fg `0 0% 20%`, muted `96.1%`, muted-fg `45.1%`, border `89.8%`; dark: bg `10%`, fg `98%`, muted `14.9%`, muted-fg `63.9%`, border `14.9%`; radius `.5rem`. |
| 서체 | `-apple-system, "SF Pro", "SF Pro Display", "SF Pro Text", ui-sans-serif, system-ui` (시스템 서체). 기본 16px, UI 13–14px. |
| Z 순서 | 창 1–50(동적), Dock 60, 메뉴바 70, 전체화면 80, 밝기 오버레이 90, 시스템 오버레이 100. |
| 상수 | `MENU_BAR_HEIGHT 28`, `DOCK_HEIGHT 80`, `CORNER_SIZE 12`, `EDGE_SIZE 6`. |
| 배경화면 | macOS Sierra JPG 기본(Apple 자산 → 사용 불가). 다크/라이트 모두 같은 사진. |
| 모바일 | 별도 `MobileShell`(iOS 풍) 사용. 데스크톱 창 관리는 데스크톱에서만. |

스크린샷(로컬 참고용, 커밋하지 않음): `.playwright-mcp/macos-live-default.png`, `macos-live-dark.png`, `macos-live-dark-notes.png`.

## 2. 정보 구조 — 기능을 앱(창)으로, 앱을 Dock으로

현재 Relay 웹의 기능: 세션 목록·검색·필터·페이지, 세션 상세(요약/기록 이력/세션 연결), 세션 컨텍스트·조회 명령 복사(셸 선택),
맥락 전달 안내, 저장소 경로·버전·연결 상태 표시, 자동 갱신. 여기에 테마 전환이 추가된다.

| Dock 순서 | 앱 id | 표시명 | 아이콘(§6.6) | 기본 상태 | 내용 (기존 컴포넌트 매핑) |
|---|---|---|---|---|---|
| 1 | `sessions` | 세션 | 파란 타일 + 레이어 글리프 | 열림·포커스 | 툴바(검색·Provider·상세 필터·검색), 필터 칩, 목록 패널(`SessionList`), 상세 패널(`SessionDetail`) 또는 빈 상태, 상태바(총 건수·`#database-path`·버전·마지막 조회 시각) |
| 2 | `guide` | 가이드 | 노란 메모 타일 | 뷰포트 너비 ≥ 1280이고 저장된 배치가 없으면 열림(세션 창 뒤, 우측) | `ContextGuide` 내용. "이전 기록 찾기" 버튼 → 세션 창을 열고 앞으로 가져온 뒤 검색 입력에 초점 |
| 3 | `command` | 명령 | 검은 터미널 타일 `>_` | 닫힘 | 터미널 룩. 선택된 세션의 `relay show …` 조회 명령과 컨텍스트 한 줄, 셸 선택, 복사 버튼. 선택 없으면 `relay --version` 출력과 안내 |
| 4 | `settings` | 설정 | 회색 톱니 타일 | 닫힘 | 모양(테마 다크/라이트/시스템), 명령(셸 종류), 창(배치 초기화), 저장소(경로·버전·연결 상태·읽기 전용) |

Dock에 구분선과 휴지통은 두지 않는다(해당 기능 없음). 앱은 모두 단일 창이다.

메뉴바 좌측 Relay 마크 메뉴(Apple 메뉴 자리): `Relay 정보…`(설정 창의 저장소 절로 이동), `설정…`, 구분선, 테마 라디오 3개, 구분선, `창 배치 초기화`.
앱명 옆 `창` 메뉴: `최소화`, `최대화`/`복원`, `닫기`, 구분선, 열린 창 목록(체크 표시, 선택 시 포커스). 키보드만으로 창 조작이 가능하도록 하는 대체 수단이다.

## 3. 화면 구성

### 3.1 데스크톱 루트

```
div.desktop (fixed inset-0, overflow hidden, data-shell="desktop", data-mobile?)
├─ a.skip-link → #workspace
├─ Wallpaper (svg, aria-hidden, z 0)
├─ header.menubar (role=banner, z 70)
├─ main#desktop (창 레이어, z 1–50)  ── Window × n
├─ nav.dock (aria-label="Dock", z 60)
└─ 토스트 #copy-status · 복사 폴백 #copy-fallback (fixed, z 100)
```

### 3.2 상수와 기본 배치

| 상수 | 값 |
|---|---|
| `MENU_BAR_HEIGHT` | 28 |
| `DOCK_RESERVED` | 88 (Dock 12 + 컨테이너 ≈ 68 + 여백) — 창 최대화·클램프 하한 |
| `CORNER_SIZE` / `EDGE_SIZE` | 12 / 6 |
| Z | 창 1–50(정규화), Dock 60, 메뉴바 70, 드롭다운 90, 토스트·복사 폴백 100 |

기본 창 배치(뷰포트 W×H, 데스크톱 모드). 항상 `[0, W]×[28, H-88]` 안으로 클램프한다.

| 앱 | x | y | w | h | 최소 |
|---|---|---|---|---|---|
| sessions | 40 | 44 | min(1000, W-80) | min(720, H-28-88-24) | 640×440 |
| guide | W-40-380 | 92 | 380 | min(520, H-28-88-100) | 320×360 |
| command | 120 | 160 | 720 | 360 | 480×240 |
| settings | 200 | 120 | 560 | 520 | 480×400 |

세션 창은 시작 시 항상 열리고 포커스된다(URL이 `/sessions/:id`여도 동일). 가이드 창은 위 조건에서만 기본으로 열리며 세션 창 뒤에 놓인다.
W=1440에서 세션 창 우측 끝은 1040, 가이드 창 좌측은 1020이므로 20px만 겹치고 가이드 본문의 버튼은 가려지지 않는다.

### 3.3 반응형 정책

- **데스크톱 (뷰포트 > 760px)**: 자유 배치. 창은 드래그/리사이즈/최소화/최대화.
- **모바일 (≤ 760px)**: `data-mobile` 부여. 창은 항상 최대화(메뉴바~Dock 사이), 포커스된 창 하나만 표시, 드래그·리사이즈 없음.
  신호등은 닫기만 동작(노랑·초록은 회색 원). Dock은 전체 너비 탭바(§6.5). 저장된 창 좌표는 무시한다.
- **창 내부**는 뷰포트가 아니라 **컨테이너 쿼리**로 반응한다(창이 리사이즈되므로). 세션 창: `container: sessions / inline-size`,
  `@container sessions (min-width: 900px)`에서 목록|상세 2단, 그 미만은 단일 패널(선택 시 상세가 목록을 대체).

## 4. 테마 시스템

- **저장 키** `localStorage["relay-theme"]` ∈ `"dark" | "light" | "system"`. 없으면 `dark`.
- **적용 방식**: `<html class="dark">` 또는 `class="light"` + `style.colorScheme`. Tailwind v4: `@custom-variant dark (&:where(.dark, .dark *));`
- **선적용(깜빡임 방지)**: CSP가 `script-src 'self'`이므로 인라인 스크립트 불가. `src/web/public/theme.js`(클래식 스크립트, 10줄 내외)를
  `index.html`의 `<head>`에서 스타일시트 링크 **앞에** 동기 로드한다. `assets.ts`에 `/theme.js`를 등록한다(`text/javascript`).

  ```js
  (function () {
    var root = document.documentElement, dark = true;
    try {
      var t = localStorage.getItem("relay-theme");
      dark = t === "light" ? false : t === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
    } catch (e) {}
    root.classList.toggle("dark", dark); root.classList.toggle("light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";
  })();
  ```
- **런타임**: `useUI`에 `theme`, `setTheme` 추가. `setTheme`는 저장·클래스·`color-scheme`·`<meta name="theme-color">`를 갱신한다.
  `system`이면 `matchMedia` 변경을 구독한다. 테마 전환 순간 `transition`을 잠시 끈다(`html[data-theme-switching] * { transition: none !important }` 1프레임).
- **메뉴바 토글 버튼**: 현재가 다크면 `aria-label="라이트 모드로 전환"`(Sun 아이콘), 아니면 `"다크 모드로 전환"`(Moon). 클릭은 명시 테마로 저장(system 해제).
- `index.html`: `<meta name="color-scheme" content="dark light">`, `theme-color`는 JS로 갱신(다크 `#0b1024`, 라이트 `#a8d3ff`).

## 5. 시각 토큰

원본은 `styles.css`의 `:root`(라이트)와 `.dark`. shadcn 의미 토큰과 Relay 전용 토큰을 함께 정의하고 `@theme inline`으로 노출한다.
기본(primary) 색은 macOS 푸시 버튼처럼 **시스템 블루**다.

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--background` | `#ffffff` | `#1e1e20` | 창 콘텐츠 배경 |
| `--foreground` | `#1d1d1f` | `#f5f5f7` | 본문 |
| `--card` / `--popover` | `#ffffff` / `rgba(255,255,255,.95)` | `#242426` / `rgba(40,40,42,.95)` | 카드 / 드롭다운(블러 위) |
| `--primary` / `--primary-foreground` | `#0a7cff` / `#ffffff` | `#0a84ff` / `#ffffff` | 주요 버튼, 선택 강조 |
| `--secondary` / `--secondary-foreground` | `#f2f2f7` / `#1d1d1f` | `#2c2c2e` / `#f5f5f7` | 보조 버튼, 배지 |
| `--muted` / `--muted-foreground` | `#f5f5f7` / `#6e6e73` | `#2a2a2d` / `#9a9aa0` | 툴바·요약 표면 / 보조 텍스트 (대비 5.0:1 / 6.0:1) |
| `--accent` | `#e8e8ed` | `#353538` | hover 표면 |
| `--border` / `--input` | `rgba(0,0,0,.10)` / `rgba(0,0,0,.14)` | `rgba(255,255,255,.10)` / `rgba(255,255,255,.14)` | 선 / 입력 테두리 |
| `--ring` | `#0a7cff` | `#0a84ff` | 초점 링 |
| `--destructive` | `#d70015` | `#ff453a` | 오류 |
| `--link` | `#0a7cff` | `#409cff` | 텍스트 링크 |
| `--selected` / `--selected-inactive` | `rgba(10,124,255,.14)` / `rgba(0,0,0,.07)` | `rgba(10,132,255,.24)` / `rgba(255,255,255,.08)` | 선택 행(창 포커스 / 비포커스) |
| `--system-green/yellow/red` | `#28c840` / `#febc2e` / `#ff5f57` | 동일 | 신호등, 연결 상태 |
| `--window` / `--window-border` | `#ffffff` / `rgba(0,0,0,.10)` | `#1e1e20` / `rgba(255,255,255,.12)` | 창 배경/테두리 |
| `--window-shadow` | `0 25px 60px -12px rgba(0,0,0,.35), 0 0 0 .5px rgba(0,0,0,.05)` | `0 30px 70px -12px rgba(0,0,0,.7), 0 0 0 .5px rgba(255,255,255,.06)` | 창 그림자 |
| `--titlebar` / `--sidebar` | `#f5f5f7` / `#f7f7f9` | `#2a2a2d` / `#232325` | 창 상단바 / 목록 패널 |
| `--menubar-bg` / `--menubar-border` | `rgba(255,255,255,.55)` / `rgba(255,255,255,.10)` | `rgba(0,0,0,.55)` / `rgba(255,255,255,.10)` | 메뉴바 |
| `--dock-bg` / `--dock-border` / `--dock-indicator` | `rgba(255,255,255,.30)` / `rgba(255,255,255,.35)` / `rgba(0,0,0,.6)` | `rgba(0,0,0,.30)` / `rgba(255,255,255,.10)` / `rgba(255,255,255,.6)` | Dock |
| `--terminal-bg` / `--terminal-fg` / `--terminal-prompt` | `#1c1c1e` / `#e5e5ea` / `#30d158` | 동일 | 명령 창(항상 어두움) |
| `--wp-sky-1` / `--wp-sky-2` / `--wp-glow` | `#a8d3ff` / `#e6f0ff` / `#ffd2a8` | `#0b1024` / `#2a1b45` / `#ff7a45` | 배경화면 |
| `--wp-ridge-1/2/3` | `#b7c4d8` / `#8fa0b8` / `#6b7a92` | `#2b2335` / `#1a1626` / `#0e0c17` | 배경 능선 |
| `--provider-anthropic` / `-bg` | `#b4532a` / `#fbe9df` | `#e5915f` / `#3a2a22` | Agent 아바타 |
| `--radius` | `.5rem` | 동일 | 카드·패널 |

- **서체 (2026-09-22 변경: Pretendard Variable 적용)**: 사용자 지시로 UI 전체에 **Pretendard Variable**(SIL OFL, orioncactus/pretendard v1.3.9)을 쓴다.
  파일은 `src/web/public/fonts/PretendardVariable.woff2`(약 2.3MB)와 라이선스 `OFL.txt`를 함께 두고, `/fonts/PretendardVariable.woff2`(`font/woff2`, `Cache-Control: public, max-age=31536000, immutable`)로 실행 파일에서 제공한다(§6.1과 같은 바이너리 자산 방식). CSP는 `default-src 'self'`라 같은 출처 폰트가 허용된다.
  ```css
  @font-face { font-family: "Pretendard Variable"; font-weight: 45 920; font-style: normal; font-display: swap;
    src: local("Pretendard Variable"), url("/fonts/PretendardVariable.woff2") format("woff2-variations"); }
  ```
  `--font-sans: "Pretendard Variable", Pretendard, -apple-system, "SF Pro Text", "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`.
  `--font-mono: "SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace`. 원격 폰트·CDN 없음.
  Pretendard 전용 설정: 본문 `letter-spacing: -0.01em`, 제목(22px) `-0.02em`, `font-feature-settings: "ss05"`는 쓰지 않음(기본), 숫자는 `font-variant-numeric: tabular-nums`(시각·건수·페이지). 한글 줄바꿈 `word-break: keep-all; overflow-wrap: anywhere`(경로·ID처럼 긴 토큰만 `anywhere`가 작동).
  굵기: 400 본문, 500 버튼·강조, 600 제목·목록 제목, 700은 쓰지 않는다(variable이라 중간값 사용 가능하나 이 셋만 쓴다).
- **크기**: 메뉴바 13px(앱명 600), 창 제목 13px 600, UI 본문 13px, 목록 제목 13px 600, 미리보기 12px, 메타 11px, 상세 제목 22px 600 -0.4px,
  요약 본문 14px/1.8, 터미널 12.5px mono, 캡션 11px. `-webkit-font-smoothing: antialiased`.
- **모서리**: 창 12px(최대화 10px), 상단바 없음, 버튼·입력 6px, 세그먼트 컨트롤 8px, Dock 16px, 드롭다운 8px, 선택 행 6px, 앱 아이콘 22%.
- **블러**: 메뉴바 `blur(12px)`, Dock `blur(40px)`, 드롭다운 `blur(24px)`. `prefers-reduced-transparency`에서는 불투명 배경으로 대체.
- **모션**: 창 열기 `scale(.96)→1, opacity 0→1` 160ms ease-out; 최소화 `scale(.9), opacity 0` 180ms ease-in; Dock hover `translateY(-4px) scale(1.12)` 120ms;
  메뉴 열림 80ms. `prefers-reduced-motion: reduce`에서 전부 제거.

### 5.1 재질(Material) — Apple식 글래스모피즘 (2026-09-22 추가)

사용자 요구: "애플스러운 글래스모피즘 효과. 요지는 오류 없는 코드가 아니라 객관적으로 봤을 때의 아름다움." 따라서 메뉴바·Dock·창 크롬·메뉴·토스트는 모두 **배경화면이 비쳐 보이는 반투명 유리 재질**로 만든다.
유리는 네 겹으로 구성한다: ① 반투명 채움(fill) ② `backdrop-filter: blur() saturate()` ③ 1px 바깥 테두리(밝은 선) ④ 상단 안쪽 하이라이트(`inset 0 1px 0`)와 부드러운 바깥 그림자. 콘텐츠 영역(상세 패널, 요약 본문, 터미널)은 가독성을 위해 불투명을 유지한다(macOS도 사이드바만 비친다).

| 재질 | 라이트 채움 / 다크 채움 | 블러 | 테두리 (라이트 / 다크) | 하이라이트·그림자 | 사용처 |
|---|---|---|---|---|---|
| `glass-bar` | `rgba(255,255,255,.55)` / `rgba(28,28,30,.45)` | `blur(20px) saturate(180%)` | 하단 `rgba(255,255,255,.35)` / `rgba(255,255,255,.12)` | 없음 | 메뉴바(§6.2) |
| `glass-dock` | 그라디언트 `rgba(255,255,255,.30)→.14` / `rgba(255,255,255,.12)→.05` | `blur(30px) saturate(180%)` | `rgba(255,255,255,.45)` / `rgba(255,255,255,.22)` | `inset 0 1px 0 rgba(255,255,255,.45|.25)`, `0 12px 40px rgba(0,0,0,.28|.45)` | Dock 컨테이너(§6.5), 모바일 탭바 |
| `glass-chrome` | `rgba(255,255,255,.62)` / `rgba(40,40,44,.55)` | `blur(40px) saturate(170%)` | 없음(창 테두리가 담당) | 상단바 하단 `1px --border` | 창 상단바(§6.4), 세션 창 목록 패널·상태바, 설정 창 그룹 바깥 영역 |
| `glass-menu` | `rgba(255,255,255,.72)` / `rgba(36,36,40,.62)` | `blur(30px) saturate(180%)` | `rgba(255,255,255,.55)` / `rgba(255,255,255,.18)` | `inset 0 1px 0 rgba(255,255,255,.6|.12)`, `0 20px 50px rgba(0,0,0,.30|.55)` | 드롭다운 메뉴(§6.11), Dock 툴팁, Radix 툴팁, 복사 폴백 |
| `glass-toast` | `rgba(255,255,255,.70)` / `rgba(44,44,48,.62)` | `blur(24px) saturate(180%)` | `rgba(255,255,255,.5)` / `rgba(255,255,255,.16)` | 위와 동일 | `#copy-status`(§6.12) |
| `glass-control` | `rgba(0,0,0,.05)` / `rgba(255,255,255,.08)` | 없음 | `rgba(0,0,0,.06)` / `rgba(255,255,255,.10)` | hover 시 채움 +.04 | 툴바 검색 필드·Provider 입력·세그먼트 컨트롤 바탕·상단바 아이콘 버튼 |

- 토큰: 위 값을 `--glass-bar-fill`, `--glass-dock-fill`, `--glass-chrome-fill`, `--glass-menu-fill`, `--glass-toast-fill`, `--glass-control-fill`, `--glass-border`, `--glass-highlight`, `--glass-shadow` 로 `:root`/`.dark`에 정의하고, `.material-bar`, `.material-dock`, `.material-chrome`, `.material-menu`, `.material-toast`, `.material-control` 유틸 클래스로 적용한다(중복 CSS 금지).
- **창 프레임**: `div.window-frame`의 배경은 투명으로 두고, 상단바·목록 패널·상태바만 `glass-chrome`, 상세 패널·본문은 불투명 `--background`. 프레임 테두리는 `1px solid rgba(255,255,255,.28)`(다크 `.14`) 바깥에 `0 0 0 .5px rgba(0,0,0,.35)` 링을 더해 유리 모서리처럼 보이게 한다. 상단 안쪽 하이라이트 `inset 0 1px 0 rgba(255,255,255,.45|.10)`. 비포커스 창은 채움 불투명도를 +.12 올리고 그림자를 절반으로 줄인다(뒤로 물러난 느낌).
- **명령 창**은 유리를 쓰지 않는다(불투명 터미널). **설정 창**은 그룹 박스가 `--background` 82% + 얇은 테두리, 바깥은 `glass-chrome`.
- **가독성**: 유리 위 텍스트는 13px 기준 대비 4.5:1 이상이어야 한다. 밝은 배경화면 영역 위 다크 유리는 채움을 `.55`까지, 라이트 유리는 `.70`까지 올려 맞춘다(스크린샷으로 확인). 유리 위 보조 텍스트는 `--muted-foreground` 대신 `color-mix(in srgb, var(--foreground) 70%, transparent)`.
- **모바일**: 블러 반경을 절반으로(성능). `prefers-reduced-transparency`: 모든 재질을 불투명 `--background`/`--popover`로 대체(블러 없음).
- **성능**: 블러는 창 개수만큼 겹치므로 `will-change`를 남발하지 않고, 드래그 중인 창은 `backdrop-filter`를 유지하되 그림자 전환을 끈다. 60fps 드래그가 감사 기준.

### 5.2 텍스트 정렬 규칙 — "박스 안에서 쏠림 없이" (2026-09-22 추가)

사용자 요구: 박스(버튼·배지·행·카드·상단바·상태바) 안의 텍스트가 한쪽으로 쏠리지 않고 정돈돼 보여야 한다. 모든 컴포넌트에 아래를 적용하고 스크린샷으로 확인한다.

1. **대칭 패딩**: 좌우 패딩은 항상 같다(버튼 `0 14px`, 배지 `0 8px`, 칩 `0 10px`, 행 `0 16px`). 아이콘이 한쪽에 붙는 버튼은 아이콘 쪽 패딩을 2px 줄여 광학 균형을 맞춘다(`has-[>svg]:pl-3`).
2. **수직 중앙**: 높이가 고정된 요소는 `display:inline-flex; align-items:center`로 맞추고, 단일 행 텍스트는 `line-height: 1`이 아니라 요소 높이에 맞춘 `line-height`(예: 28px 버튼 → `line-height: 1` + flex 중앙)를 쓴다. `padding-top/bottom`으로 맞추지 않는다. 배지·캡슐은 `height`를 명시(20px/22px)하고 `line-height: 1`.
3. **아이콘-텍스트 정렬**: 아이콘은 16px(메타는 12px), `gap: 6px`, 아이콘 박스와 텍스트 x-height 중심이 같은 선에 놓이도록 `align-items:center`. 아이콘 색은 텍스트 색과 동일.
4. **행 내부**: 아바타(28px) 상단과 제목 첫 줄의 캡 높이를 맞춘다(`align-items:flex-start` + 제목 `line-height: 20px`, 아바타 `margin-top: 1px`). 요약 2줄 클램프는 `line-height: 16px`로 높이 32px 고정, 메타 줄 `line-height: 16px`. 행 전체 높이는 일정(예: 84px).
5. **숫자·시간**: `font-variant-numeric: tabular-nums`로 열이 흔들리지 않게. 우측 정렬 숫자 열은 `text-align: right` + 고정 폭.
6. **줄바꿈·자름**: 단일 행은 `white-space: nowrap; overflow:hidden; text-overflow: ellipsis`, 여러 줄은 `-webkit-line-clamp`. 한글은 `word-break: keep-all`. 제목은 `text-wrap: balance`, 문단은 `text-wrap: pretty`.
7. **정렬 방향 일관성**: 목록·폼 라벨은 좌측, 숫자 열·시간은 우측, 빈 상태·토스트·대화상자 본문은 중앙. 한 박스 안에서 정렬 방향을 섞지 않는다.
8. **라벨-값 쌍**: 설정 창·세션 정보의 라벨은 좌측 고정 폭(120px), 값은 그 오른쪽에서 시작해 세로로 정렬선이 생기게 한다.
9. **여백의 리듬**: 섹션 안쪽 여백 16px, 섹션 사이 24px, 항목 사이 8px, 캡션-본문 4px. 4px 배수만 쓴다.
10. **검증**: 각 컴포넌트를 2배 확대 스크린샷으로 보고 위·아래, 좌·우 여백이 1px 이내로 대칭인지 확인한다. 특히 Pretendard는 한글 글리프가 라틴보다 살짝 크므로 혼용 텍스트에서 세로 중심이 위로 쏠리지 않는지 본다(필요하면 `padding-top: 1px` 광학 보정).

## 6. 컴포넌트 명세

### 6.1 Wallpaper (`components/desktop/wallpaper.tsx`) — Grok 생성 이미지

(2026-09-22 변경: 인라인 SVG 능선 대신 Grok Imagine으로 생성한 라스터 배경화면을 쓴다.)

- 자산: `src/web/public/wallpaper-dark.jpg`(황혼의 설산, 1280×720, 271KB), `src/web/public/wallpaper-light.jpg`(같은 산의 아침, `image_edit`로 파생, 1280×720, 293KB).
  같은 산맥·구도이므로 테마 전환 시 장면이 유지되고 빛만 바뀐다. 제공 경로 `/wallpaper-dark.jpg`, `/wallpaper-light.jpg`(`image/jpeg`, `Cache-Control: public, max-age=86400`).
- `assets.ts`는 텍스트 자산 외에 **바이너리 자산**을 지원한다: `import wallpaperDark from "./public/wallpaper-dark.jpg" with { type: "file" }` → `Bun.build({ compile })`가 실행 파일에 포함하며,
  `new Response(Bun.file(path))`로 제공한다. 실행 파일을 다른 작업 디렉터리에서 실행해도 제공돼야 한다(기존 웹 테스트가 이를 검증).
- 구조: `div.wallpaper[aria-hidden]` — 바닥에 §5 `--wp-sky-*`/`--wp-glow` 그라디언트(로딩 중 빈 화면 방지), 위에 `<img>`(`object-fit: cover; position:absolute; inset:0; width/height:100%`,
  `draggable=false`, `decoding="async"`, `fetchpriority="high"`, `alt=""`). `src`는 테마에 따라 `.dark` → 다크, `.light` → 라이트. 전환 시 200ms 크로스페이드(reduced-motion에서는 즉시).
- `pointer-events:none`. 애니메이션 없음. Apple 사진은 쓰지 않는다.

### 6.2 MenuBar (`components/desktop/menu-bar.tsx`)

`header.menubar` — `fixed top-0 left-0 right-0 h-[28px] px-4 flex items-center justify-between select-none z-[70]`,
배경 `--menubar-bg` + `backdrop-filter: blur(12px)`, `border-bottom: 1px solid --menubar-border`. 글자색 `--foreground`.

좌측(`gap-4`):
- **Relay 마크 버튼** (`aria-label="Relay 메뉴"`, `aria-haspopup="menu"`, `aria-expanded`): 16px 인라인 SVG(`/icon.svg`의 R 글리프, `currentColor`), 히트영역 `w-6 h-5 rounded`, 열림 `bg-primary text-white`.
- **앱명**: 포커스 창의 표시명(없으면 "Relay"), `text-[13px] font-semibold px-2 py-0.5 rounded`. 클릭 시 `창` 메뉴 토글(`aria-haspopup="menu"`).
- 드롭다운(§6.11)은 해당 버튼 아래 `top: 28px`.

우측(`gap-1`):
- **연결 상태** `#connection-state`(`role="status"`): `span.connection-dot[data-state=online|pending|offline]`(6px 원, online `--system-green`, pending `--muted-foreground`, offline `--destructive`) + 텍스트 `연결됨 · 3초마다 자동 조회` / `연결 확인 중…` / `연결 끊김 또는 조회 오류 · 재시도 중`. 모바일에서는 텍스트를 `sr-only`로 숨기고 점만 보인다(텍스트는 DOM에 남긴다).
- **로컬 배지**: `로컬 · 읽기 전용` 11px muted (모바일 숨김).
- **테마 토글 버튼** `w-7 h-5 rounded`(§4).
- **시계** `button`(장식, `aria-label`에 전체 날짜): `Intl.DateTimeFormat("ko-KR", { month:"short", day:"numeric", weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false })` → `9월 22일 (화) 13:32`. 다음 분 경계에 맞춰 갱신.

### 6.3 Window (`components/desktop/window.tsx`)

```
section.window[data-window=<appId>][data-focused][data-maximized][data-minimized] (role="region", aria-label="<앱명> 창", tabIndex=-1)
  style: transform: translate(x,y); width; height; z-index
  ├─ div.window-frame (absolute inset-0 overflow-hidden rounded-[12px] bg --window border 1px --window-border shadow --window-shadow flex-col)
  │   ├─ WindowTitleBar (§6.4)
  │   └─ div.window-body (flex-1 min-h-0 overflow: auto|hidden — 앱별)
  └─ 리사이즈 핸들 8개 (data-window-resize-handle, 모서리 12px, 변 6px, 커서 nw/ne/sw/se/n/s/e/w)
```

- 비포커스 `opacity: .95`, 신호등 회색. 포커스는 `onPointerDownCapture`에서 부여(첫 클릭도 자식에게 그대로 전달 — 참고 사이트의 "첫 클릭 소모"는 채택하지 않음).
- **드래그**: 상단바(`data-window-drag-handle`)에서 `pointerdown`(주 버튼) → `setPointerCapture` → `pointermove` 델타 적용. 대상이 `a, button, input, select, textarea, [role=button], [role=tab], summary, [contenteditable]` 안이면 시작하지 않는다. 이동 중 `will-change: transform`, `user-select:none`. 이동 범위: `y ≥ 28`, 상단바가 최소 80px은 화면 안에 남도록 x 클램프, 아래는 `H-88-40`까지.
- **리사이즈**: 핸들 `pointerdown` → 크기/위치 갱신, 앱별 최소 크기, 뷰포트 클램프.
- **최대화(줌)**: `top:28px; left:0; right:0; bottom:88px; width/height:auto`, 모서리 10px, 그림자 유지, 핸들 숨김. 상단바 더블클릭(인터랙티브 요소 제외)과 초록 버튼, `창` 메뉴로 토글. 복원 시 이전 좌표/크기.
- **최소화**: `data-minimized` → `display:none`(세션 창은 상태 유지를 위해 언마운트하지 않고 숨김, 다른 창도 동일하게 숨김 처리로 통일). Dock 표시점은 유지. 복원은 Dock 클릭 또는 `창` 메뉴.
- **닫기**: 창 언마운트. 세션 창을 닫아도 URL은 유지되며 Dock에서 다시 열면 같은 URL 상태로 돌아온다.
- **z-order**: 포커스 시 `nextZ++` 부여, 50을 넘으면 열린 순서대로 1부터 재배정.
- **열기 애니메이션**: `@keyframes window-in` (scale .96→1, opacity 0→1, 160ms). reduced-motion 시 없음.
- **뷰포트 리사이즈**: `resize` 이벤트에서 모든 창을 경계 안으로 클램프. 모바일 전환 시 최대화 강제.
- 창 안의 `[data-slot=tooltip-content]`·드롭다운은 Radix Portal이므로 z 90 이상으로 둔다.

### 6.4 WindowTitleBar / 신호등 (`components/desktop/window-title-bar.tsx`, `traffic-lights.tsx`)

- `div.titlebar[data-window-drag-handle]` — `h-[52px] px-4 flex items-center gap-3 bg --titlebar border-b 1px --border select-none`.
  구성: 신호등 | 제목(13px 600, `.window-title`) | (앱별 툴바 슬롯 flex-1) | (우측 슬롯).
  세션 창은 툴바 슬롯에 검색·필터 컨트롤을 넣어 Finder 툴바처럼 쓴다(§6.7). 모바일에서는 `h-[44px]`.
- **신호등** `div.traffic-lights.group flex gap-[6px]`: 버튼 3개 `w-3 h-3 rounded-full`, 색 `--system-red/yellow/green`, hover 시 12px 원 안에 ×/–/⤢ 글리프(`text-black/55`) 표시.
  `aria-label`: `"<앱명> 창 닫기"`, `"<앱명> 창 최소화"`, `"<앱명> 창 최대화"` / `"<앱명> 창 복원"`. 비포커스 창은 셋 다 `bg-zinc-300 dark:bg-zinc-600`.
  모바일: 노랑·초록은 `disabled` + 회색.

### 6.5 Dock (`components/desktop/dock.tsx`)

- 데스크톱: `nav.dock[aria-label="Dock"]` — `fixed bottom-3 left-1/2 -translate-x-1/2 z-[60]`. 내부 `ul.dock-bar` — `flex items-end gap-1 px-3 py-[6px] rounded-2xl`
  배경 `--dock-bg`, `backdrop-filter: blur(40px) saturate(150%)`, `border: 1px solid --dock-border`, `box-shadow: 0 10px 30px rgba(0,0,0,.25)`.
- 항목 `button.dock-item[aria-label=<앱명>][data-open][data-active]` — `w-12 flex flex-col items-center outline-none`; 아이콘 48px(§6.6) `filter: drop-shadow(0 2px 4px rgba(0,0,0,.35))`;
  아래 표시점 `w-1 h-1 rounded-full mt-1 bg --dock-indicator`(열림 또는 최소화 상태에서 표시, 아니면 `opacity-0`).
  hover/focus-visible: 아이콘 `translateY(-4px) scale(1.12)` 120ms; `active:scale-95`. 초점 링 `ring-2 ring-primary/70 rounded-xl`.
- **툴팁**: hover/focus 시 아이콘 위 `-44px`에 `div[role=tooltip]` — `rounded-md px-2.5 py-1 text-[12px] font-medium bg --popover border --border shadow backdrop-blur` + 아래 꼬리(clip-path 삼각형). 마우스 이탈·blur 시 제거.
- **클릭**: 닫힘 → 열기+포커스, 최소화 → 복원+포커스, 열림 → 포커스(앞으로). 키보드 Enter/Space 동일.
- **선택(구현 여유가 있을 때)**: 참고 사이트식 마우스 위치 기반 확대(배율 1.4, 반경 .88·아이콘). 기본 꺼짐. 설정 창 토글 없음(범위 밖).
- **모바일(`data-mobile`)**: `nav.dock` — `fixed bottom-0 inset-x-0 h-[64px] pb-[env(safe-area-inset-bottom)]`, 배경 `--dock-bg` 위에 `--background` 85% 합성, `border-top --border`, 항목 4개 균등 폭,
  아이콘 32px + 라벨 10px(`--muted-foreground`, 활성 창은 `--primary`), 툴팁·hover 확대 없음. 항목 탭 = 해당 창을 열고 앞으로.

### 6.6 앱 아이콘 — Grok 생성 PNG (`src/web/public/icons/*.png`)

(2026-09-22 변경: 인라인 SVG 타일 대신 Grok Imagine으로 생성한 macOS Big Sur 풍 아이콘 시트를 분리한 PNG를 쓴다.)

- 자산: `src/web/public/icons/sessions.png`(파란 스쿼클 + 흰 문서 묶음), `guide.png`(노란 스쿼클 + 크림 메모지), `command.png`(검은 터미널 창 + 초록 프롬프트), `settings.png`(회색 스쿼클 + 톱니).
  각 256×256 투명 PNG, 28–51KB. 초록 배경을 키잉해 분리했으며 드롭섀도는 CSS로 준다(`filter: drop-shadow(0 2px 4px rgba(0,0,0,.35))`).
- 제공 경로 `/icons/<id>.png`(`image/png`, 바이너리 자산, §6.1과 같은 방식으로 실행 파일에 포함).
- 사용: Dock 항목과 모바일 탭바에서 `<img src="/icons/<id>.png" alt="" width=48 height=48 draggable={false} decoding="async">`(접근 가능한 이름은 버튼 `aria-label`). 설정 창·가이드 창의 상단바 제목 옆 16px 아이콘으로도 재사용 가능.
- `components/desktop/app-icons.tsx`는 **Relay 마크 SVG**(메뉴바용 16px, `currentColor`)만 담는다. `icon.svg`(파비콘)는 세션 아이콘과 같은 파란 바탕(`#0a5ce0`)에 흰 R 글리프로 교체한다.

### 6.7 세션 창 (`components/apps/sessions/…`)

기존 `Filters`, `SessionList`, `SessionDetail`, `ContextGuide`(빈 상태용)를 재사용하되 스타일과 컨테이너 구조를 바꾼다. 창 본문 루트 `div#workspace.sessions-body[tabIndex=-1]`(skip link 대상)이며 `container-name: sessions`.

```
titlebar: ● ● ●  세션 기록 [N]   [🔍 세션 이름, 요약, ID로 검색   /]  [Provider ▾] [상세 필터] [검색]
(advanced-filters 행: Agent · 프로젝트 경로 · 표시 개수 · 초기화 — bg --muted, border-b)
(filter-chips 행)
sessions-body ── @container ≥900px: [목록 패널 340px | 1px 구분선 | 상세 패널 flex-1]  /  <900px: 목록 또는 상세 하나
statusbar: 총 N건 · 최근 갱신순 │ #database-path(가운데 생략, title=전체 경로) │ RELAY vX.Y.Z · 마지막 성공 조회 hh:mm:ss
```

- **툴바 컨트롤**: 검색 `InputGroup` — `h-7 rounded-md bg --muted` 테두리 없음, 좌 Search 아이콘, 우 `kbd /`(모바일 숨김). Provider `Input`(datalist) `w-[150px]`. `상세 필터` outline 버튼(활성 시 secondary, `filter-indicator` 점 유지), `검색` primary 버튼. 모든 컨트롤 `h-7`, 13px.
  컨테이너 < 900px이고 상세가 열려 있으면 툴바 컨트롤과 칩 행을 숨기고 제목을 `세션 상세`로 바꾼다(단일 패널에서 상세 집중).
- **목록 패널** `section.list-panel[aria-label="세션 목록"]` — 배경 `--sidebar`, 자체 스크롤. 상단 `div.list-toolbar`(11px muted: `전체 기록` · `최근 갱신순`)는 유지하되 24px 높이.
  목록은 `ol#list-content.session-rows`(`aria-busy`) + `li.session-row[aria-current=true?]`. `<table>`은 쓰지 않는다(테스트 계약 §9 변경 항목).
  행 구조: `agent-avatar`(28px 타일, `data-provider`) | 본문(`.session-title-line`: `a.session-name` 13px 600 + `.ended-badge`; `.row-summary` 12px muted 2줄 클램프 `white-space: pre-line`; `.compact-meta` 11px: agent · 프로젝트 · 상대시간) | `.row-action` 복사 아이콘 버튼(`aria-label="세션 컨텍스트 복사"`, hover/focus 시에만 불투명).
  2단 모드에서는 compact 형태만. 단일 패널 넓은 모드(≥ 640px)에서는 우측에 `source-column`(agent/model/프로젝트)과 `time-column`(상대시간/날짜)을 추가 표시.
  선택 행: `background: --selected; border-radius: 6px; margin: 0 8px`(Notes 방식), 창 비포커스 시 `--selected-inactive`. hover: `--accent` 60%. 행 사이 구분선 `--border` (선택 행 인접은 숨김). 행 클릭은 링크·버튼 외 영역에서 이동(현행 유지).
  빈 상태·오류·로딩(`Loading`, `EmptyState`, `ErrorNotice#list-error`)과 `Pager`는 현행 유지(11px, 하단 고정).
- **상세 패널** `aside.detail-panel[aria-label="세션 상세"][tabIndex=-1]` — 배경 `--background`, 자체 스크롤.
  헤더 행: 좌 `a.close-detail`(`‹ 목록으로`, `aria-label="목록으로 돌아가기"`, **패널의 첫 번째 탭 초점 요소**) · 중앙 11px muted `최근 갱신 <시각>` · 우 `agent` 텍스트 + `.ended-badge`.
  `h2` 22px 600, `.detail-project` 12px muted(Folder 아이콘). 액션 행: primary `세션 컨텍스트 복사`, secondary `조회 명령 복사`(현행 레이블 유지). `.context-copy-hint` 11px. `.shell-select`(`label for=command-shell` "조회 명령 셸") 우측 정렬.
  탭: `Tabs variant="default"`(세그먼트 컨트롤: `bg --muted rounded-lg p-[3px]`, 활성 `bg --window shadow-sm`) — `개요`, `기록 이력 N`, `세션 연결 N`. 탭 이름·`#updates-content`·`#children-content`·`[data-testid=history-entry]`·`.summary`·`.timeline`·`.relation`·`.current-session`·`details.technical-details`(`세션 식별자`, `dd`)·`[data-testid=session-end]`는 현행 유지.
  `.summary`는 `bg --muted rounded-lg p-4 text-[14px] leading-[1.8] white-space: pre-wrap`.
- **빈 상태(선택 없음, 2단 모드)**: 상세 자리에 `ContextGuide`의 축약판(아이콘 3개 일러스트 + `지난 대화에서 다음 시작점으로.` + 한 문단). **버튼은 두지 않는다**(`이전 기록 찾기` 버튼은 가이드 창에만 존재해야 이름이 유일하다). 단일 패널 모드에서는 표시하지 않음.
- **상태바** `footer.statusbar` — `h-6 px-3 flex items-center gap-3 text-[11px] text-muted-foreground bg --titlebar border-t --border`. `#database-path`(`title` 전체 경로, `direction: rtl` 생략 대신 `text-overflow: ellipsis` 중앙 생략은 선택), `.version`, 마지막 성공 조회 시각.
- **초점 규칙(현행 유지)**: 세션을 열면 `.detail-panel` 포커스, 목록으로 돌아오면 원래 `a.session-name` 포커스, `/`는 검색 입력 포커스(입력 중·IME 조합 중 제외). 창이 최소화되어 있으면 `/`가 세션 창을 복원한 뒤 포커스한다.

### 6.8 가이드 창 (`components/apps/guide-window.tsx`)

상단바 제목 `가이드`. 본문 `max-w-[380px] p-6` 세로 스크롤. 기존 `ContextGuide` 마크업 전체(일러스트, eyebrow `CONTEXT, CONTINUED`, `h3` 24px, 문단, `Separator`, `welcome-step` 3개, `button.welcome-action` **`이전 기록 찾기`**).
버튼 동작: 세션 창 열기/복원 → 포커스(앞으로) → `#search` 포커스(다음 프레임). 링크 색 `--link`, 아이콘 `--primary`.

### 6.9 명령 창 (`components/apps/command-window.tsx`)

iTerm 룩. 이 창의 프레임 배경은 테마와 무관하게 `--terminal-bg`, 상단바 `#2b2b2f`, 글자 `--terminal-fg`, 프롬프트 `--terminal-prompt`, mono 12.5px/1.7.
상단바 우측 슬롯: `label "셸 종류"` + `NativeSelect`(PowerShell/Bash, `useUI.shell`과 동기화 — 상세의 `조회 명령 셸`과 같은 값).

본문(`pre`가 아니라 행 단위 `div`로, 줄바꿈 `overflow-wrap:anywhere`):

```
relay@local ~ % relay --version
0.8.0                                      ← health.appVersion (없으면 "—")
relay@local ~ % relay show '<providerSessionId>' --provider '<provider>' --data-dir '<dir>' --json     [이 명령 복사]
# 다음 대화에 붙여넣을 한 줄
이전 세션 맥락은 `relay show …` 명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요.        [컨텍스트 줄 복사]
```

선택 세션은 현재 URL `/sessions/:id`의 상세 데이터. 선택이 없으면 두 번째 블록 대신 `# 세션 창에서 세션을 선택하면 조회 명령이 여기에 표시됩니다.`와 `relay record --help` 안내 행.
복사 버튼 레이블은 반드시 `이 명령 복사`, `컨텍스트 줄 복사`(상세·목록의 `세션 컨텍스트 복사`, `조회 명령 복사`와 이름이 겹치지 않게). 복사는 앱 공용 `copy()`(토스트·폴백 공유). 깜빡이는 커서 블록(reduced-motion 시 정지).

### 6.10 설정 창 (`components/apps/settings-window.tsx`)

macOS 시스템 설정의 그룹 폼. 본문 `p-5` 세로 스크롤, 그룹 박스 `rounded-lg border --border bg --muted/40`, 행 `min-h-9 px-3 flex justify-between items-center border-b --border(마지막 제외)`, 라벨 13px, 설명 11px muted.

| 그룹 | 행 |
|---|---|
| 모양 | `테마` — `fieldset` 라디오 3개 `다크`(기본) / `라이트` / `시스템`(`name=theme`, 라벨 텍스트 정확히 이 3개) |
| 명령 | `셸 종류` — select(PowerShell/Bash), `useUI.shell` |
| 창 | `창 배치 초기화` 버튼(outline) — 저장 배치 삭제 후 기본 배치 재적용 |
| 저장소 (`id="storage-info"`) | `데이터베이스` — `code`(전체 경로, 줄바꿈) / `버전` — `RELAY vX` / `연결` — 점 + 상태 텍스트 / `모드` — `읽기 전용` 배지. 로컬 조회 서버 설명 한 줄 |

`Relay 정보…` 메뉴는 설정 창을 열고 `#storage-info`로 스크롤한다. 라벨에 `표시 개수`, `Provider`, `Agent`, `검색`, `조회 명령 셸`을 쓰지 않는다(테스트의 `getByLabel` 부분 일치 충돌 방지).

### 6.11 드롭다운 메뉴 (`components/desktop/menu.tsx`)

`div[role=menu]` — `absolute top-[28px] min-w-[200px] rounded-lg border --border bg --popover backdrop-blur-[24px] shadow-2xl py-1 z-[90]`.
항목 `button[role=menuitem|menuitemradio][aria-checked]` — `w-full px-3 py-1.5 text-[13px] flex items-center gap-2 text-left`, hover/focus `bg --primary text-white`, 구분선 `my-1 border-t --border`, 체크 열 `w-3`.
키보드: 열림 시 첫 항목 포커스, ↑/↓ 순환, Home/End, Enter/Space 실행, Esc·바깥 클릭·다른 메뉴 열기 시 닫고 트리거로 초점 복귀. 열려 있는 동안 창 드래그 시작 금지.

### 6.12 토스트 · 복사 폴백 (현행 유지)

`#copy-status`(`role=status`, 하단 중앙 캡슐, `bg --popover`, 블러, `Check` 아이콘) 3초. `#copy-fallback`(`section aria-labelledby=copy-label`, 우하단, `Textarea#copy-text` 자동 선택, Esc 닫기·초점 복귀). 둘 다 z 100, 모바일 Dock 위(`bottom: 76px`).

## 7. 상태 관리

- `lib/desktop-store.ts` — `useDesktop` (zustand):
  ```ts
  type AppId = "sessions" | "guide" | "command" | "settings";
  type Win = { open: boolean; minimized: boolean; maximized: boolean; x: number; y: number; w: number; h: number; z: number };
  state: { windows: Record<AppId, Win>; focused: AppId | null; nextZ: number; mobile: boolean }
  actions: open(id) · close(id) · focus(id) · minimize(id) · toggleMaximize(id) · move(id, x, y) · resize(id, w, h, x?, y?) · resetLayout() · setMobile(bool) · clampAll(W, H)
  ```
  `open`·`focus`는 `minimized=false`, z 재부여. 영속화 `localStorage["relay-desktop-v1"]` = `{ version:1, windows: {id: {open, minimized, maximized, x, y, w, h}} }` (z 제외), 쓰기는 디바운스 200ms.
  로드 시 스키마 검증(숫자·불리언), 실패 시 기본값. 모바일에서는 좌표를 무시하고 항상 `sessions` 열림·포커스로 시작.
- `lib/app-config.ts` — 앱 목록(id, 표시명, 아이콘 컴포넌트, 기본 배치 함수, 최소 크기, 창 본문 컴포넌트).
- `useUI`(기존) — `theme`, `setTheme` 추가. `shell`은 상세와 명령 창, 설정 창이 공유.
- URL ↔ 창: `/sessions/:id`로 진입하면 세션 창을 연다(이미 정책). 세션 창이 닫혀 있는 상태에서 `popstate`로 `/sessions/:id`가 되면 세션 창을 다시 연다.
- 데이터 쿼리(`health`, `list`, `detail`, `updates`, `children`)와 `copy`/토스트/폴백 로직은 `client.tsx`의 `App`에 남기고, 창 본문 컴포넌트에 props로 내려준다(현행 구조 유지). 명령 창은 `detail` 쿼리 결과를 같이 받는다.

## 8. 접근성·키보드·모션

- 랜드마크: `header`(메뉴바) / `main#desktop`(창 레이어) / `nav[aria-label=Dock]` / 각 창 `section[role=region][aria-label="<앱명> 창"]` / 목록 `section[aria-label="세션 목록"]` / 상세 `aside[aria-label="세션 상세"]`.
- 탭 순서: skip link → 메뉴바(마크, 앱명, 상태, 토글, 시계) → 창들(z 순서와 무관하게 DOM 순서 = 앱 순서; 포커스 창은 `aria-current="true"`는 쓰지 않고 `data-focused`만) → Dock.
  창 내부 첫 탭 요소는 신호등(닫기). 상세 패널 안에서는 `a.close-detail`이 첫 요소여야 한다(테스트).
- 드래그·리사이즈는 포인터 전용. 키보드 대체: `창` 메뉴(최소화/최대화/닫기/포커스), Dock 버튼, 설정의 `창 배치 초기화`.
- 초점 링: `:focus-visible { outline: 2px solid --ring; outline-offset: 2px }` (버튼·링크·행·Dock 항목·신호등). 마우스 클릭엔 표시 안 함.
- 대비: 본문·muted 텍스트 4.5:1 이상(§5), 신호등 글리프는 장식(버튼 이름으로 대체). 선택 행은 색만이 아니라 `aria-current`로도 표현.
- `prefers-reduced-motion: reduce`: 창/Dock/메뉴/커서 애니메이션 전부 제거(전역 규칙 현행 유지). `prefers-reduced-transparency`: 메뉴바·Dock·드롭다운 배경을 불투명 `--background`/`--popover`로.
- IME: `/` 단축키는 `isComposing`이면 무시(현행). 검색 입력의 `Enter`는 폼 제출.
- 창이 하나도 없을 때도 Dock·메뉴바로 복구 가능해야 한다.

## 9. 테스트 계약 (Playwright)

기존 `tests/web.spec.ts`의 동작 테스트는 대부분 그대로 통과해야 한다. **유지해야 하는 훅**:

`#connection-state`(텍스트 `연결됨` / `연결 끊김`), `#database-path`(`relay.db` 포함), `#list-content`, `.session-row`, `.selected-row`, `.row-summary`, `a.session-name`(role link, 이름 = 세션명),
`.ended-badge`, `.pager`(`총 N건`), 버튼 `이전`/`다음`(각 Pager, 상세 탭 안의 Pager 포함 — 이름 `exact`), `getByLabel("검색")`, `getByLabel("Provider")`, 버튼 `검색`·`상세 필터`·`전체 초기화`·`agent 필터 해제`,
`getByLabel("Agent")`, `getByLabel("프로젝트 경로")`, `getByLabel("표시 개수")`, `.summary`, 탭 `개요`/`기록 이력`/`세션 연결`, `#updates-content [data-testid=history-entry]`, `#children-content li`, `#updates-error`, `#children-error`, `#detail-error`, `#list-error`,
`aside[aria-label="세션 상세"]`(role complementary), `section[aria-label="세션 목록"]`(role region), 링크 `목록으로 돌아가기`(상세 패널의 첫 탭 요소), 버튼 `세션 컨텍스트 복사`(목록 행 + 상세, 다른 곳에 같은 이름 금지), 버튼 `조회 명령 복사`, `getByLabel("조회 명령 셸")`, 버튼 `Agent Session ID만 복사`, 텍스트 `세션 식별자`(summary), `dd`, `[data-testid=session-end]`,
`#copy-text`, 버튼 `이전 기록 찾기`(가이드 창에만, 기본 열림 조건 §2), `.detail-panel`, `#workspace`, `#search`, `.stats-grid, .status-badge` 없음, 빈 상태 문구 3종, `document.documentElement.scrollWidth <= innerWidth`(모든 너비).

**변경이 허용된 항목**(테스트를 함께 고친다):

| 기존 | 변경 |
|---|---|
| `#list-content tbody tr` | `#list-content .session-row` |
| `.sidebar-footer .connection-dot` | `#connection-state .connection-dot` |
| 스크린샷 파일명 `cursor-detail-*.png` | `desktop-detail-*.png` (선택) |

**추가할 테스트** — 새 파일 `tests/desktop.spec.ts`(`playwright.config.ts`의 `testMatch`를 `/.*\.spec\.ts$/`로 넓힘). 기존 헬퍼(`launch/stop/record/cli/ready`)는 `tests/web-helpers.ts`로 추출해 공유한다.

1. 기본 테마: 저장값 없이 접속 → `html.dark`, `document.documentElement.style.colorScheme === "dark"`, 메뉴바 계산 배경이 어두움. 메뉴바 토글 클릭 → `html.light`, `localStorage.relay-theme === "light"`, 새로고침 후 유지. 설정 창 `시스템` 선택 + `emulateMedia({ colorScheme: "light" | "dark" })` 전환에 따라 클래스가 바뀜.
2. 데스크톱 기본 상태(1440×1000): Dock 항목 4개 이름 `세션`/`가이드`/`명령`/`설정`; `세션` 창과 `가이드` 창 열림, 세션 창 `data-focused`; 메뉴바 앱명 `세션`; Dock `세션`·`가이드`에 표시점.
3. 창 조작: Dock `설정` 클릭 → 설정 창 열림·포커스·앱명 `설정`. `설정 창 최소화` → 창 숨김, Dock 표시점 유지, Dock 클릭으로 복원. `설정 창 최대화` → 창 박스가 `top 28, left 0, right W, bottom H-88`과 ±1px 일치, `복원`으로 되돌림. `설정 창 닫기` → DOM에서 제거, 표시점 없음.
4. 드래그: 세션 창 상단바 빈 곳을 `page.mouse`로 (+120, +80) 드래그 → `getBoundingClientRect` 델타 일치. 새로고침 후 위치 유지. 상단바의 검색 입력에서 드래그해도 창이 움직이지 않음. 상단바 더블클릭 → 최대화 토글.
5. 가이드: `이전 기록 찾기` 클릭 → 세션 창이 최상위(`data-focused`) + `#search` 포커스. 세션 창을 최소화한 뒤 `/` 입력 → 세션 창 복원 + 검색 포커스.
6. 명령 창: 세션 상세를 연 상태에서 Dock `명령` 클릭 → 본문에 `relay show '<id>'`와 `--provider` 포함, `이 명령 복사` 클릭 → 클립보드가 상세의 `조회 명령 복사` 결과와 동일, `셸 종류`를 Bash로 바꾸면 상세의 `조회 명령 셸`도 Bash.
7. 메뉴: Relay 마크 클릭 → `role=menu` 표시, 항목 `Relay 정보…`/`설정…`/`다크`/`라이트`/`시스템`/`창 배치 초기화`; `Esc` → 닫히고 마크에 초점; `라이트` 선택 → 테마 변경. `창` 메뉴 `닫기` → 포커스 창 닫힘. `창 배치 초기화` → 세션 창이 기본 좌표로.
8. 모바일(390×844): `data-mobile`, 창은 최대화(폭 = 390, 상단 28, 하단 64), 한 번에 하나만 보임, Dock 탭 4개 라벨 표시, `설정` 탭 → 설정 창만 보임, `세션` 탭 → 복귀. 가로 넘침 없음. `#connection-state`는 텍스트 `연결됨` 포함(시각적으로는 점만).
9. 스크린샷(감사용, `test.info().outputPath`): `desktop-dark.png`(기본), `desktop-light.png`, `desktop-detail-1440.png`, `mobile-dark.png`, `mobile-light.png`.
10. 회귀: 기존 `web.spec.ts` 전부 통과. `pageerror` 0건(첫 테스트의 `errors` 검사 유지).

## 10. 파일 구조와 구현 계획

### 10.1 파일

| 구분 | 경로 | 내용 |
|---|---|---|
| 신규 | `src/web/public/theme.js` | 테마 선적용 스크립트(§4) |
| 신규 | `src/web/lib/desktop-store.ts` | 창 상태·영속화(§7) |
| 신규 | `src/web/lib/app-config.ts` | 앱 정의·기본 배치(§3.2, §7) |
| 신규 | `src/web/lib/theme.ts` | 테마 읽기/적용/시스템 구독(§4) |
| 신규 | `src/web/components/desktop/wallpaper.tsx`, `menu-bar.tsx`, `menu.tsx`, `window.tsx`, `window-title-bar.tsx`, `traffic-lights.tsx`, `dock.tsx`, `app-icons.tsx`, `use-window-behavior.ts`(드래그/리사이즈 훅) | §6 |
| 신규 | `src/web/components/apps/sessions-window.tsx`, `guide-window.tsx`, `command-window.tsx`, `settings-window.tsx` | 창 본문 |
| 변경 | `src/web/client.tsx` | `App`이 데스크톱 셸을 렌더(데이터·복사 로직 유지) |
| 변경 | `src/web/components/session-list.tsx`, `session-detail.tsx`, `session-filters.tsx`, `session-common.tsx`, `context-guide.tsx` | 마크업/스타일 조정(§6.7, §6.8) |
| 삭제 | `src/web/components/workspace-sidebar.tsx` | 메뉴바·상태바·설정 창으로 흡수 |
| 변경 | `src/web/styles.css` | 토큰(§5), `@custom-variant dark`, 컴포넌트 CSS 전면 교체, 컨테이너 쿼리 |
| 변경 | `src/web/public/index.html` | `theme.js`, `color-scheme` 메타, 제목 `Relay` |
| 변경 | `src/web/assets.ts` | `/theme.js` 등록, `icon.svg` 교체 |
| 변경 | `src/web/DESIGN.md`, `src/web/DESIGN-IMPLEMENTATION.md` | 새 디자인 시스템 요약과 Relay 적용 결정으로 재작성(이 문서를 근거로, 간결하게) |
| 변경 | `README.md` "브라우저" 절 | 데스크톱 셸·다크 기본·테마 전환·Dock 4개 앱을 한 문단으로 |
| 변경 | `tests/web.spec.ts`, 신규 `tests/desktop.spec.ts`, `tests/web-helpers.ts`, `playwright.config.ts` | §9 |

`components/ui/*`(shadcn)는 그대로 두고 `styles.css`의 `[data-slot=…]` 오버라이드로 macOS 룩을 맞춘다(버튼 6px·h-7/h-8, 입력 6px, 탭 세그먼트, 배지 캡슐, 툴팁 다크 캡슐).

### 10.2 구현 순서 (Opus 5 서브에이전트)

1. 토큰·테마·`theme.js`·`@custom-variant dark`·배경화면·데스크톱 루트(빈 셸)까지. `npm run typecheck && npm run build` 통과.
2. 창 관리자(스토어, 훅, Window/TitleBar/TrafficLights), 메뉴바(마크·앱명·상태·토글·시계), Dock(데스크톱·모바일), 앱 아이콘, 드롭다운 메뉴.
3. 세션 창 이식(툴바·목록·상세·상태바·컨테이너 쿼리), 가이드·명령·설정 창.
4. 기존 테스트 계약 맞추기(§9 변경 2건) → `npm run test:web` 전부 통과. 새 `desktop.spec.ts` 작성·통과.
5. 문서(README 절, DESIGN 2종) 갱신. `npm run check` 최종.

검증 명령: `npm run typecheck` · `npm test` · `npm run build` · `npm run test:web` (`bun`은 devDependency라 `npm run` 경유로 실행된다). 결과는 `.tasks/desktop-worklog.md`에 기록한다.

## 11-A. 미적 합격 기준 (2026-09-22 추가)

코드가 동작하는 것은 전제이고, 합격 기준은 **스크린샷을 객관적으로 봤을 때 실제 macOS 데스크톱처럼 아름다운가**다. 감사자는 아래를 다크/라이트/모바일 스크린샷으로 판정하며, 하나라도 미달이면 반려한다.

1. **유리 재질이 보인다**: 메뉴바·Dock·창 상단바·목록 패널 뒤로 배경화면의 색과 형태가 은은하게 비친다. 불투명 회색 판처럼 보이면 실패.
2. **깊이감**: 창은 부드러운 큰 그림자와 얇은 밝은 테두리로 배경에서 떠 있고, 포커스 창이 비포커스 창보다 또렷하다. Dock은 화면에 살짝 떠 있는 캡슐이다.
3. **정렬과 리듬**: 4px 그리드. 상단바 요소가 수직 중앙 정렬, 목록 행 높이 일정, 좌우 여백 16px, 섹션 간격 12/16/24px 중 하나. 텍스트 베이스라인이 아이콘 중심과 맞는다.
4. **타이포그래피 위계**: 창 제목 13px 600 · 목록 제목 13px 600 · 미리보기 12px muted · 메타 11px. 상세 제목 22px 600은 한 화면에 하나. 한글 줄간격 1.5 이상, 영문 대문자 eyebrow는 자간 .06em.
5. **색 절제**: 강조색은 시스템 블루 하나. 초록·노랑·빨강은 신호등·상태점에만. 배지·칩은 회색 캡슐. 파란 채움 버튼은 화면에 하나(주요 액션).
6. **아이콘 품질**: Dock 아이콘은 48px에서 선명하고 그림자가 부드럽다. lucide 아이콘은 1.5px 스트로크, 16px 기준, 텍스트 색과 동일.
7. **상태 표현**: hover는 채움 +4%, 선택 행은 파란 틴트 + 둥근 모서리, 초점 링은 2px 블루, disabled는 45% 투명. 전환 120–200ms ease-out, 튀지 않는다.
8. **빈 공간의 아름다움**: 세션이 없거나 선택이 없을 때도 안내 일러스트·문구가 중앙 정렬로 정돈돼 있다.
9. **어색함 0**: 잘린 텍스트, 겹친 요소, 스크롤바 노출(얇은 오버레이 스크롤바 `scrollbar-width: thin; scrollbar-color: rgba(127,127,127,.4) transparent`), 픽셀 어긋남, 계단 현상 없음.
10. **참고 사이트와의 유사성**: 메뉴바 28px·Dock 캡슐·신호등·둥근 12px 창·Notes식 사이드바 선택 강조가 한눈에 macOS로 읽힌다.

## 11. 감사 체크리스트 (Fable 5.1)

- [ ] 다크 기본, 라이트 전환·영속·시스템 모드 동작. 첫 페인트 깜빡임 없음(`theme.js`가 CSS보다 먼저).
- [ ] Apple 자산·외부 리소스 0건(`grep -ri "apple.com\|fonts.googleapis\|\.jpg\|\.png" src/web` 검토, 아이콘·배경은 SVG).
- [ ] CSP 위반 0건(콘솔), `pageerror` 0건.
- [ ] 메뉴바·Dock·창 치수/색이 §1·§5·§6과 일치(스크린샷 대조: 다크/라이트/모바일).
- [ ] 창 드래그·리사이즈·최소화·최대화·닫기·z-order·영속화·뷰포트 클램프.
- [ ] 세션 기능 회귀 없음: 검색·필터·페이지·상세 탭·복사·폴백·자동 갱신·오류 복구·초점 규칙.
- [ ] 접근성: 랜드마크·이름·초점 링·키보드 메뉴·reduced-motion·대비.
- [ ] 테스트: 기존 통과 + 신규 10항목, 총 실행 시간 합리적. 스크린샷 산출.
- [ ] 문서 3종 갱신. `.tasks/desktop-worklog.md`에 검증 로그.
