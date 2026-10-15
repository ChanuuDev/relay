# Relay 디자인 적용 기준

`DESIGN.md`의 데스크톱 디자인 시스템을 Relay의 로컬 세션 조회 화면에 적용한 결정을 적습니다. 초기 설계 근거와 관찰값은 `.tasks/desktop-design.md`입니다.

## 목적

이전 대화의 세션을 찾고, 작업 맥락을 확인하고, 다음 대화에 전달합니다. 세션의 실행 여부나 시작·종료·중단 상태는 관리하지 않습니다.
조회 전용이며 기록은 CLI로만 남깁니다. 목록은 최근 갱신순이고 검색과 Provider·Agent·프로젝트 경로 필터를 제공합니다.

## 기능을 앱(창)으로

| Dock | 앱 | 기본 상태 | 내용 |
| --- | --- | --- | --- |
| 1 | 세션 | 열림·포커스 | 상단바 툴바(검색·Provider·상세 필터·검색), 필터 칩, 목록 패널, 상세 패널, 상태바(총 건수·저장소 경로·버전·마지막 조회) |
| 2 | 가이드 | 뷰포트 ≥ 1280일 때 열림 | 맥락 전달 안내와 `이전 기록 찾기`(세션 창을 앞으로 가져와 검색에 초점) |
| 3 | 명령 | 닫힘 | 선택한 세션의 `relay show …` 명령과 다음 대화에 붙여넣을 한 줄, 셸 선택, 복사 |
| 4 | 설정 | 닫힘 | 테마(다크/라이트/시스템), 글자 크기(12–18px 드롭다운), 바탕화면(`#wallpaper-settings`: 기본·사진 4종·색상 5종·내 사진 여러 장), 셸 종류, 창 배치 초기화, 앱(`#app-settings`: 설치·앱 창 실행 상태), 저장소 정보(`#storage-info`) |

메뉴바 Relay 마크 메뉴에 `Relay 정보…`·`설정…`·`바탕화면 변경…`·`앱으로 설치…`(브라우저가 설치를 제안할 때만)·테마 라디오·`창 배치 초기화`, 앱명 옆 `창` 메뉴에 최소화·최대화·닫기·열린 창 목록을 둡니다(키보드 대체 수단).

## 파일

- `client.tsx`: 조회 구성(React Query 3초 폴링), URL 이동, 클립보드 피드백, `/` 단축키, 초점 복귀, 테마 구독, 뷰포트 클램프.
- `lib/store.ts`: 조회 UI 상태(현재 URL, 필터 초안, 상세 탭, 셸, 테마, 글자 크기, 바탕화면)와 `navigate`. 상세 탭은 세션이 바뀌어도 그대로 두고, 기록 이력·세션 연결의 페이지만 새 세션의 URL을 따릅니다.
- `lib/desktop-store.ts`: 창 상태(열림·최소화·최대화·좌표·z)와 `localStorage` 영속화. `lib/app-config.ts`: 앱 목록과 기본 배치·최소 크기.
- `lib/theme.ts` + `public/theme.js`: 테마 읽기·적용·시스템 구독. CSP가 인라인 스크립트를 막으므로 선적용 스크립트는 별도 자산으로 `<head>`에서 동기 로드합니다.
- `lib/font-size.ts`: 글자 크기 목록(12–18px)·저장·적용(`DESIGN.md` §4). 첫 렌더 전에는 빈 바탕만 보이므로 선적용 스크립트 없이 `client.tsx`가 렌더 전에 저장값을 적용합니다.
- `lib/wallpaper.ts`: 바탕화면 선택(기본·사진·색상·내 사진)의 저장과 내 사진 여러 장의 IndexedDB 보관·축소. 사진 교체는 `components/desktop/wallpaper.tsx`가 로드 뒤 크로스페이드합니다.
- `lib/pwa.ts` + `public/manifest.webmanifest`·`public/sw.js`: 설치형 앱(`DESIGN.md` §8). 서비스 워커 등록, 설치 제안·앱 창 상태(`useInstall`), 제목 표시줄 통합 변수와 메뉴바 높이(`menuBarHeight`), 메뉴바에 맞춘 `theme-color`(`syncTitlebarColor`).
- `components/desktop/*`: 배경화면, 메뉴바, 드롭다운, 창·상단바·조작 버튼, 드래그/리사이즈 훅, Dock, Relay 마크.
- `components/ui/dock.tsx`: 제공된 21st.dev Dock을 Framer Motion으로 적용한 `Dock`·`DockItem`·`DockIcon`·`DockLabel`. `components.json`의 `@/components/ui` 별칭은 이 `src/web/components/ui` 폴더를 가리킵니다. 별도 루트 폴더를 만들지 않습니다.
- `components/apps/*`: 세션·가이드·명령·설정 창 본문. 목록·상세·필터·안내는 기존 컴포넌트를 재사용합니다.
- `lib/session-context.ts`: 목록·상세·명령 창이 같은 맥락 텍스트와 조회 명령을 만듭니다.
- `components/ui/`: shadcn/Radix 프리미티브는 그대로 두고 `styles.css`의 `[data-slot=…]` 오버라이드로 치수를 맞춥니다.

## 자산

기본 배경화면 2종(낮·밤), 프리셋 배경화면 4종(`public/wallpapers/`), Dock 아이콘 4종은 로컬 Grok Imagine으로 생성해 `src/web/public/`에 두고, Bun의 `with { type: "file" }` 임포트로 `relay.exe`에 포함합니다.
목록의 프로바이더 아이콘 3종(OpenAI·Anthropic·xAI)은 내장 ImageGen으로 생성한 투명 PNG(`public/icons/providers/`)이며 같은 방식으로 실행 파일에 포함합니다. 28px로 표시하며 알 수 없는 프로바이더는 기존처럼 Agent의 첫 글자를 표시합니다. 생성 프롬프트는 해당 폴더의 `README.md`에 보관합니다.
Pretendard Variable도 같은 방식이며 라이선스(`OFL.txt`)를 함께 둡니다. 파비콘과 메뉴바 마크는 인라인 SVG입니다.
설치형 앱 아이콘(`public/icons/app-192.png`·`app-512.png`)은 Relay 마크를 코드로 그린 밑그림을 Grok Imagine `image_edit`로 다듬고 Dock 아이콘과 같은 squircle로 자른 것입니다.
이미지·폰트만 `Cache-Control: public, max-age=…`를 쓰고 나머지 응답은 `no-store`를 유지합니다. 외부 CDN·원격 폰트·Apple 자산은 없습니다.

## 반응형과 접근성

창 상단바는 왼쪽에 앱 아이콘·제목, 가운데 검색·필터, 오른쪽에 최소화·최대화/복원·닫기를 배치합니다. 조작 버튼은 30×28px의 중립색 사각 버튼이며 아이콘을 항상 표시하고 닫기에 마우스를 올리면 빨간색으로 강조합니다. 모바일에서는 동작하지 않는 최소화·최대화 버튼을 숨깁니다.

창 안쪽은 컨테이너 쿼리로 반응합니다. 세션 창 컨테이너가 900px 이상이면 목록·상세 2단, 미만이면 단일 패널(상세가 목록을 대체)이고
640–899px에서 목록에 Agent·프로젝트·시각 열을 더 보여 줍니다. 뷰포트 760px 이하는 모바일 모드입니다.
우측 크기 조절 핸들은 상세 패널보다 위에 두고 창 바깥으로 10px 확장합니다. 우측 변의 안쪽 겹침은 2px로 줄여 스크롤바를 덜 가리며, 우측 모서리도 같은 바깥 범위에서 대각선 조절을 받습니다. 좌측·위·아래 변의 영역은 기존 크기를 유지합니다.

Dock은 기존 네 앱과 PNG를 유지하고 포인터 주변 아이콘에 스프링 확대(48→80px)를 적용합니다. 기존 GSAP 실행 바운스는 이미지에, Framer Motion 확대는 버튼·아이콘 래퍼의 너비에 적용해 겹치지 않습니다. 모바일은 32px 이미지와 고정 탭바를 유지하고, `prefers-reduced-motion` 변경에도 즉시 고정 크기로 돌아갑니다. 라벨은 마우스·키보드 초점에서 표시하며 확대 중 위치를 따라갑니다.

`/`로 검색에 초점을 보냅니다(입력 중·IME 조합 중 제외, 세션 창이 최소화돼 있으면 먼저 복원). 세션을 열면 상세, 목록으로 돌아오면 원래 링크에 초점을 돌립니다.
상세의 개요·기록 이력·세션 연결 탭은 목록에서 다른 세션을 골라도, 연결 세션으로 이동해도, 목록으로 돌아갔다 다시 골라도 유지됩니다.
복사 권한이 없으면 원문을 선택할 수 있고 Escape로 닫아 복사 버튼으로 돌아갑니다. 드롭다운 메뉴는 ↑↓·Home/End·Esc를 지원합니다.

## 검증

`npm run typecheck`, `npm test`, `npm run build`, `npm run test:web`를 씁니다. Playwright는 `tests/web.spec.ts`(조회 기능 회귀: 필터·페이지·상세 탭 유지·복사·폴링·오류 복구)와
`tests/desktop.spec.ts`(테마·글자 크기·자산·바탕화면·기본 배치·창 조작·드래그·가이드·명령 창·메뉴·모바일·감사용 스크린샷), `tests/motion.spec.ts`(전환 애니메이션·reduced-motion), `tests/cli-web.spec.ts`(실행 파일의 `web --headless`/`--close`),
`tests/pwa.spec.ts`(설치 조건·서버가 꺼졌을 때의 셸과 재연결·설치 안내·제목 표시줄 통합과 색)를 실행하며 공용 헬퍼는 `tests/web-helpers.ts`입니다. 서비스 워커의 보관 규칙은 `tests/pwa.test.ts`가 가짜 실행 환경에서 따로 검사합니다.
