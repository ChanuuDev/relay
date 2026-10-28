# 디자인 지침 (Glass Desktop 디자인 시스템)

> 이 파일을 새 프로젝트 루트의 `AGENTS.md`(또는 `CLAUDE.md`)에 붙여 넣거나 그대로 두면, 화면을 만드는 Agent가 같은 계열의 디자인을 지킨다.
> 값의 정본은 `src/styles/tokens.css`이고, 세부 수치는 `reference/design_output.md`(Relay 디자인 시스템 전체 추출본)에 있다.

## 합격 기준

오류 없는 코드가 아니라 **스크린샷으로 본 아름다움**이 기준이다. 화면을 바꾸면 `tools/screenshot.mjs`로 다크·라이트·모바일을 찍어 아래를 확인하고 보고한다.

1. 유리가 보인다 — 크롬(메뉴바·상단바·사이드바·상태바·Dock) 뒤로 바탕화면이 은은하게 비친다. 회색 판처럼 보이면 실패.
2. 깊이 — 창·떠 있는 판은 큰 부드러운 그림자 + 얇은 밝은 테두리. 포커스된 창이 더 또렷하다.
3. 4px 리듬 — 상단바 요소 수직 중앙, 행 높이 일정, 좌우 여백 16, 섹션 사이 24.
4. 위계 — 창 제목 13/600 · 목록 제목 13/600 · 미리보기 12 · 메타 11 · 상세 제목 22/600(한 화면에 하나).
5. 색 절제 — 강조색은 시스템 블루 하나. 파란 채움 단추는 화면에 하나. 초록·노랑·빨강은 상태 표시에만.
6. 어색함 0 — 잘린 글자, 겹침, 굵은 스크롤바, 한쪽으로 쏠린 글자 없음.

## 반드시 지킬 것

- **유리는 크롬에만, 내용은 불투명.** 상단바·사이드바·상태바는 `material-chrome`, 메뉴·팝오버·툴팁은 `material-menu`, 토스트는 `material-toast`, Dock은 `material-dock`, 메뉴바는 `material-bar`. 읽는 영역은 `background: var(--background)`.
- **바탕화면을 지우지 않는다.** 유리는 뒤에 비칠 것이 있어야 보인다. 페이지형 화면도 `.wallpaper` 위에 판을 띄운다(`page.css`).
- **색 값을 컴포넌트에 쓰지 않는다.** 토큰(`var(--primary)`, `var(--glass-text-muted)` …)만 쓴다. 새 색이 필요하면 `tokens.css`에 라이트·다크 쌍으로 추가한다.
- 유리 위 보조 글자는 `--glass-text-muted`, 불투명 위 보조 글자는 `--muted-foreground`.
- **컨트롤은 알약형**(`--radius-control: 999px`): 입력·검색·선택·버튼·세그먼트·탭. 여러 줄 입력·메뉴·카드·행은 제외.
- 한 줄 상자의 높이는 `calc(1em + 위아래 여백)`(13px에서 버튼 32·28·24, 입력 28, 배지 20). 좌우 패딩은 대칭, 왼쪽 아이콘 쪽만 2px 줄인다.
- 글자 크기는 `--fs-*`·`--lh-*` 토큰으로(글자 크기 설정을 따른다). 메뉴바·메뉴·Dock·툴팁·토스트만 px 고정.
- 서체는 Pretendard Variable. 굵기는 400·500·600(제목 입력·본문 제목만 700). 본문 자간 `-0.01em`, 22px 이상 제목 `-0.02em`, 한글 `word-break: keep-all`, 긴 경로·ID `overflow-wrap: anywhere`, 숫자 `tabular-nums`.
- 아이콘은 lucide 1.5px 스트로크, 기본 16px(메타 12, 상단바 15, 메뉴바 14). 아이콘만 있는 단추는 `Tip` + `aria-label`.
- 상태: hover는 `--glass-control-hover`(+4%), 선택은 `--selected`(뒤 창은 `--selected-inactive`), 초점은 2px `--ring`, 비활성은 `.45`.
- **shadcn 프리미티브(`src/components/ui/*`)는 고치지 않는다.** 치수·모양은 `primitives.css`의 `[data-slot]` 규칙으로 덮는다. 예외는 `tooltip.tsx` 하나(화살표 없음, 트리거에서 6px).
- 창 안 배치는 뷰포트가 아니라 **창 컨테이너 쿼리**(`@container win`)로 바꾼다. 글자 크기와 엮인 줄바꿈 기준은 `em`.

## 모션

- 값은 `src/lib/motion.ts`의 `MOTION`·`EASE`와 헬퍼만 쓴다(하드코딩 금지): 120 micro · 160 fast · 220 base · 260 window, 진입 `power3.out`, 종료 `power2.in`, 이동 `power3.inOut`.
- transform·opacity만 움직인다(펼침 상자의 height 예외). 초점·스크롤·URL을 바꾸지 않고, 언마운트를 300ms 넘게 늦추지 않는다.
- 사라지는 요소는 과도 상태(닫는 중 → 트윈 → finalize) 또는 `Crossfade`(클론 오버레이)로. 재정렬은 `FlipList`, 갱신 알림은 `pulse`.
- `prefers-reduced-motion`이면 `dur()`이 0을 돌려준다. 새 애니메이션도 반드시 `dur()`·헬퍼를 거친다.

## 함정(겪은 문제)

- 부모에 `backdrop-filter`가 있으면 자식 유리가 뒤를 흐리지 못한다 → 메뉴·라벨은 `body`로 포털.
- 부모가 반투명(opacity < 1)이면 자식 유리가 깨진다 → 불투명도는 안쪽 요소에.
- shadcn `TooltipTrigger asChild`로 Button을 감싸면 `data-slot="button"`이 `tooltip-trigger`로 덮여 버튼 규칙이 빠진다 → 툴팁은 `components/patterns/tip.tsx`의 `Tip`만 쓴다.
- 이 키트의 CSS는 레이어 밖이라 Tailwind 유틸리티(`@layer utilities`)보다 강하다 → 패턴 클래스가 이미 정한 속성(여백·배경 등)은 유틸리티로 바꾸지 말고 감싸는 요소에 준다.
- 클램프(`-webkit-line-clamp`) 상자에 padding을 주면 잘린 줄이 비친다 → margin.
- 고정폭 글꼴에는 한글이 없다 → 폰트 스택에 Pretendard를 끼운다(`.source-editor`).
- 테마 전환 순간 번쩍임 → `applyTheme`가 한 프레임 동안 transition을 끈다. 첫 페인트 전 테마는 `public/theme.js`.

## 새 화면을 만들 때 순서

1. `src/demo/windows/gallery-window.tsx`(컴포넌트 견본)에서 쓸 부품을 고른다.
2. 데스크톱형이면 `src/apps.ts`에 창을 등록하고 `Window` + `WindowTitleBar`로 만든다. 페이지형이면 `page-demo.tsx` 구조(`.page-shell` > `.page-layout` > 유리 사이드바 + `.page-main`)를 따른다.
3. 목록-상세는 `SplitView`(collapse) + `.list-panel.material-chrome` + `.detail-panel`. 설정은 `SettingsGroup`/`SettingsRow`.
4. `npm run build`가 통과하면 `tools/screenshot.mjs`로 찍어 위 합격 기준으로 판정한다.
