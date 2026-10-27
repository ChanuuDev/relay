# Relay 데스크톱 셸 디자인 시스템

Relay 웹 화면은 여러 창과 Dock을 사용하는 데스크톱 메타포를 따릅니다. 창 상단바는 왼쪽 앱 아이콘·제목과 오른쪽 사각 조작 버튼으로 구성합니다. 초기 참고 디자인은 21st.dev "macOS Desktop Portfolio"(작성자 alanagoyal, MIT)의 공개 화면이며,
관찰값과 Relay의 적용 결정은 `.tasks/desktop-design.md`에 정리돼 있습니다. Apple 저작 자산(배경화면·앱 아이콘·SF Pro)은 쓰지 않고, 외부 CDN·원격 폰트도 없습니다.

## 1. 구조

```
div.desktop (fixed inset-0)
├─ div.wallpaper (토큰 그라디언트 또는 색상 프리셋 + 기본 사진 2장 + 고른 사진, aria-hidden)
├─ header.menubar (28px · 설치한 앱이 제목 표시줄을 숨기면 창 조작 버튼 높이, z 70)
├─ main#desktop (창 레이어, z 1–50)
│   └─ section.window[data-window] × 6  — 세션 / 가이드 / 명령 / 메모 / 설정 / YouTube
└─ nav.dock (z 60) + 토스트·복사 폴백 (z 100)
```

창은 드래그·리사이즈·최소화·최대화·닫기가 가능하며 배치는 `localStorage["relay-desktop-v1"]`에 저장합니다.
배경화면 선택은 `localStorage["relay-wallpaper"]`에, 내 사진은 IndexedDB `relay-desktop/wallpaper`에 사진마다 한 레코드(`{ blob, name, addedAt }`)로 둡니다.
뷰포트 760px 이하는 모바일 모드로, 창은 항상 최대화되고 한 번에 하나만 보이며 Dock은 탭바가 됩니다.
창 내부 배치는 뷰포트가 아니라 **컨테이너 쿼리**(`container-name: sessions`)로 바뀝니다 — 창을 리사이즈해도 목록·상세 2단이 올바르게 접힙니다.

## 2. 재질(Material)

유리는 네 겹입니다: 반투명 채움 → `backdrop-filter: blur()/saturate()` → 1px 밝은 테두리 → 상단 안쪽 하이라이트와 바깥 그림자.
콘텐츠(상세 패널, 요약, 터미널)는 가독성을 위해 불투명하게 둡니다.

| 클래스 | 블러 | 사용처 |
| --- | --- | --- |
| `.material-bar` | 20px | 메뉴바 |
| `.material-dock` | 30px | Dock 캡슐, 모바일 탭바 |
| `.material-chrome` | 40px | 창 상단바, 세션 목록 패널·상태바·필터 행, 설정 창 바깥 |
| `.material-menu` | 30px | 드롭다운 메뉴, 선택 목록(shadcn Select), Radix 툴팁, 복사 폴백 |
| `.material-toast` | 24px | 복사 토스트 |
| `.material-control` | 없음 | 검색·Provider 입력, 세그먼트 컨트롤, 아이콘 버튼 |

`prefers-reduced-transparency`에서는 모두 불투명 `--background`로 바뀌고, 모바일은 블러 반경을 줄입니다.

## 3. 토큰

`styles.css`의 `:root`(라이트)와 `.dark`에 정의하고 `@theme inline`으로 Tailwind에 노출합니다. 다크가 기본입니다.

| 역할 | 라이트 | 다크 |
| --- | --- | --- |
| `--background` / `--foreground` | `#ffffff` / `#1d1d1f` | `#1e1e20` / `#f5f5f7` |
| `--primary` (시스템 블루) | `#0a7cff` | `#0a84ff` |
| `--muted` / `--muted-foreground` | `#f5f5f7` / `#6e6e73` | `#2a2a2d` / `#9a9aa0` |
| `--selected` (선택 행) | `rgba(10,124,255,.16)` | `rgba(10,132,255,.28)` |
| `--system-red/yellow/green` | `#ff5f57` / `#febc2e` / `#28c840` | 동일 |
| `--terminal-bg` / `--terminal-prompt` | `#1c1c1e` / `#30d158` | 동일 |
| `--glass-*` | §2 재질 채움·테두리·그림자 | 동일 키, 값만 다름 |

모서리: 창 12px(최대화 10px), 카드·세그먼트 8px, 버튼·입력 6px, Dock 18px. 창 조작은 중립색 아이콘 버튼을 사용하고, 닫기 버튼의 hover에는 빨간색을 씁니다. 상태점은 연결 상태에 따라 색을 표시합니다.

## 4. 서체와 정렬

- **Pretendard Variable**(SIL OFL)을 실행 파일에 포함해 `/fonts/PretendardVariable.woff2`로 제공합니다. 굵기는 400·500·600만 씁니다.
- 본문 `letter-spacing: -0.01em`, 22px 제목 `-0.02em`, 한글 `word-break: keep-all`, 긴 경로·ID는 `overflow-wrap: anywhere`.
- 크기(글자 크기 13px 기준): 메뉴바·창 제목·UI 본문 13px, 목록 제목 13px/600, 미리보기 12px, 메타·캡션 11px, 상세 제목 22px/600, 요약 14px/1.8, 터미널 12.5px mono.
- **글자 크기 설정**: 설정 창 `모양`의 `글자 크기`(shadcn `Select`)에서 12–18px을 고릅니다(기본 13px, `localStorage["relay-font-size"]`). 목록은 드롭다운 메뉴와 같은 유리 재질·26px 항목·시스템 블루 강조이고,
  macOS 팝업 버튼처럼 체크를 왼쪽 열에 두며 열면 고른 항목이 버튼 글자 위에 겹칩니다(item-aligned). `lib/font-size.ts`가 고른 크기 ÷ 13을 `--font-scale`에 넣으면
  창 안의 글자 크기·줄 높이는 `--fs-*`·`--lh-*` 토큰으로, shadcn의 `text-*` 유틸리티는 `@theme` 재정의로 함께 커집니다. 한 줄짜리 글자 상자(버튼·입력·배지·막대)는 높이를 `calc(1em + 위아래 여백)`으로 잡아 여백을 지키고,
  라벨 열 폭은 비율로 늘립니다. 툴바·명령 줄의 줄바꿈 컨테이너 쿼리는 컨테이너 글자 크기 기준 `em`(13px에서 719·519·559px)이라 글자가 커지면 더 일찍 줄을 바꾸고, 목록·상세 2단 기준(640·900px)은 px 그대로입니다.
  메뉴바·드롭다운 메뉴·Dock·툴팁·토스트는 운영체제 화면처럼 px로 고정합니다.
- 박스 안의 텍스트는 좌우 패딩을 같게, 세로는 flex 중앙으로 맞춥니다. 배지·캡슐은 높이를 명시하고 `line-height: 1`,
  목록 행은 제목 20px·요약 32px(2줄 고정)·메타 16px로 높이를 통일하며, 시각·건수는 `tabular-nums`, 라벨-값 쌍은 120px 라벨 열을 씁니다.
- 여백은 4px 배수만 씁니다(행 안쪽 12px, 섹션 안쪽 16px, 섹션 사이 24px).

## 5. 모션

창·목록·상세의 상태 전환은 GSAP으로 잇습니다. 값과 헬퍼는 **`lib/motion.ts` 한 곳**에 있고(`MOTION`·`EASE`·`dur()`),
해당 컴포넌트는 `useGSAP`으로 그 헬퍼를 부릅니다. 애니메이션 대상은 transform·opacity이며(상세 필터 행의 `height: auto`는 예외),
설계 근거는 `.tasks/motion-design.md`입니다.

Dock의 확대와 라벨은 사용자가 제공한 21st.dev 컴포넌트를 `components/ui/dock.tsx`에 적용한 Framer Motion 스프링으로 처리합니다. 포인터로부터 150px 이내의 아이콘은 기본 48px에서 최대 80px로 확대됩니다. 아이콘 PNG·앱 실행·열림 표시점은 유지하고, 라벨은 Dock의 backdrop 경계 밖 포털에 표시합니다. 라벨은 Dock 전체에 **하나**만 두어 포인터에서 가장 가까운 아이콘(키보드 초점이 있으면 그 아이콘)을 따라 미끄러지며 글자만 바꿉니다. 아이콘마다 라벨을 따로 띄우면 아이콘 사이 틈을 지날 때마다 사라졌다 나타나고 사라지는 라벨이 겹쳐 깜빡였습니다. 라벨 위치는 상태 대신 MotionValue로 매 프레임 아이콘 위 34px에 맞추고, 바탕은 거의 불투명한 알약(`--dock-tip-fill`, 블러 없음)이라 아래 창 글자가 비치지 않습니다. 눌러서 생긴 초점은 라벨을 붙잡지 않습니다. 창은 화면 아래 104px(`DOCK_RESERVED` = Dock 아래 여백 12 + 막대 안쪽 여백 7 + 가장 커진 아이콘 80 + 5)를 비워 두어, 커진 아이콘이 최대화한 창을 덮지 않습니다. 실제 `button`을 사용해 Enter·Space 실행을 지원하고 키보드 초점도 확대합니다. 모바일과 동작 줄이기 설정에서는 고정 크기로 표시합니다.

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `micro` | 120ms | 툴팁, 칩, 강조선, 상태점 |
| `fast` | 160ms | 종료(닫기·페이드아웃), 탭 콘텐츠·thumb |
| `base` | 220ms | 진입, 메뉴, 토스트, 상세 교체, 목록 재정렬 |
| `window` | 260ms | 창 열기·최소화·복원·최대화 |
| `stagger` | 30ms (총 300ms 상한) | 목록 행 · `tight` 20ms는 상세 머리글 |
| `pulse` | 600ms | 갱신된 행·요약의 배경 하이라이트 |

이징은 진입 `power3.out`, 종료 `power2.in`, 이동·크기 `power3.inOut`, 토스트 `back.out(1.4)`, Dock 바운스 `power1.inOut`입니다.

패턴은 넷입니다. **① 스토어 과도 상태** — 창 닫기·최소화는 `closing`/`minimizing`을 켜고 종료 트윈이 끝나면
`finalizeClose`/`finalizeMinimize`가 실제 상태를 바꿉니다(`data-closing`·`data-minimizing`). **② 클론 오버레이** —
`key` 교체로 리마운트되는 상세 패널·목록 콘텐츠는 교체 직전 DOM을 떠서 `.detail-clone`(`aria-hidden`+`inert`+`pointer-events:none`)으로
같은 자리에 덮고 페이드아웃하며, 300ms 타임아웃 가드로 반드시 제거합니다. **③ FLIP** — 목록·타임라인 재정렬과 창 최대화,
세그먼트 컨트롤 thumb 이동은 `Flip`이 맡습니다(`FlipList`는 커밋 직전 훅이 필요해 유일하게 클래스 컴포넌트입니다).
**④ 펄스** — 폴링으로 내용이 바뀐 행·요약만 `--pulse-tint`에서 제 배경색으로 돌아옵니다(`data-pulsing`).
React Query의 structural sharing 덕에 내용이 같은 폴링에서는 아무것도 움직이지 않습니다.

`prefers-reduced-motion: reduce`에서는 `dur()`이 0을 돌려주고 Flip·펄스·클론을 모두 건너뛰어 즉시 반영됩니다.
애니메이션은 초점·스크롤·URL을 바꾸지 않고, 언마운트를 300ms 이상 늦추지 않으며, 진행 중 트윈은 `overwrite: "auto"`로 정리해
연타(세션 연타, 닫는 중 다시 열기)에도 상태가 어긋나지 않습니다. 드래그·리사이즈 중에는 트윈을 만들지 않습니다.

## 6. 접근성

초점 링은 2px 시스템 블루, 스크롤바는 얇은 오버레이입니다.
랜드마크는 `header`(메뉴바) · `main#desktop` · `nav[aria-label=Dock]` · 창마다 `section[role=region]`이며,
드래그·리사이즈는 포인터 전용이라 `창` 메뉴·Dock·설정의 `창 배치 초기화`가 키보드 대체 수단입니다.

## 7. 바탕화면

`div.wallpaper`는 세 겹입니다: 토큰 그라디언트(색상 프리셋을 고르면 `data-color`의 그라디언트) → 테마별 기본 사진 2장(불투명도로 전환) → 고른 사진.
선택지는 `lib/wallpaper.ts`의 `WallpaperChoice`로 기본 · 사진 4종(`/wallpapers/*.jpg`, 1280×720) · 색상 5종 · 내 사진이며, 선택은 `localStorage["relay-wallpaper"]`에 둡니다.

- **전환**: `.wallpaper-image`는 `opacity .3s ease-out`. 고른 사진은 로드가 끝난 뒤에만 켜고, 가려진 이전 사진은 360ms 뒤 제거합니다(`loading → shown → leaving`). 색상을 고르면 사진이 걷히고 바닥 그라디언트만 남습니다.
- **설정 피커**: `repeat(auto-fill, minmax(88px, 1fr))` 격자, 16:9 견본, 모서리 8px, 선택은 시스템 블루 2px 링(`outline-offset: 2px`), 호버는 `scale(1.04)`.
  기본 견본은 낮·밤 사진을 대각선(`clip-path`)으로 나눠 보여 주고, 내 사진 추가 타일은 점선 테두리에 `+`입니다. 견본은 `role=radio`, 격자는 `role=radiogroup`입니다.
  내 사진 견본에는 모서리에 20px 유리 `×` 버튼(`aria-label="<이름> 지우기"`)이 있어 호버·초점에서 나타나고, 호버가 없는 기기에서는 24px로 늘 보입니다.
- **색상**: 그래파이트 · 미드나이트 · 라벤더 · 선셋 · 민트. 각각 방향 그라디언트 위에 radial 하이라이트 한 겹을 얹어 평면적으로 보이지 않게 합니다. 값은 `styles.css`의 `[data-color]` 규칙 한 곳에 두고 바닥과 견본이 공유합니다.
- **내 사진**: 여러 장(최대 20장)을 넣은 순서대로 보여 주고 견본 아래에는 확장자를 뗀 파일 이름을 씁니다. 25MB 이하의 이미지만 받고 긴 변이 2560px을 넘으면 캔버스로 줄여 JPEG로 저장합니다.
  IndexedDB의 Blob을 `blob:` URL로 그리므로 CSP에 `img-src 'self' blob:`이 있습니다. 보고 있던 사진을 지우면 기본으로 돌아갑니다. 첫 버전이 `custom` 키에 두던 한 장은 그대로 한 장으로 읽습니다. 서버로는 보내지 않습니다.

## 8. 설치형 앱(PWA)

Chrome·Edge에서 앱으로 설치하면 브라우저 탭 없이 별도 창으로 열립니다. `127.0.0.1`과 `localhost`는 보안 출처로 취급되므로 HTTPS 없이 설치되며, 앱은 설치한 주소(포트까지)마다 따로 등록됩니다.

- **매니페스트**(`public/manifest.webmanifest`): `id`·`start_url`·`scope`는 `/`, `display: standalone`에 `display_override: ["window-controls-overlay"]`, `launch_handler`는 이미 열린 창을 앞으로 가져옵니다(`focus-existing`). 아이콘은 192·512px PNG입니다.
- **앱 아이콘**(`public/icons/app-*.png`): 메뉴바의 Relay 마크(R)를 코드로 그린 밑그림에 Grok Imagine `image_edit`로 재질과 입체감만 입히고, Dock 아이콘과 같은 squircle(n=5 superellipse, 캔버스의 89%)로 잘랐습니다. 파비콘과 메뉴바 마크는 그대로 인라인 SVG입니다.
- **서비스 워커**(`public/sw.js`): 항상 서버 응답을 먼저 쓰고(network-first) 응답이 없을 때만 보관본을 꺼냅니다. 설치할 때 화면 셸(HTML·JS·CSS·서체·기본 바탕화면·아이콘)을 담고, 그 뒤로는 받아 온 정적 자산을 갱신해 둡니다. 세션 데이터(`/api/`)는 담지 않으며 Static Routing API를 지원하는 브라우저에서는 서비스 워커를 거치지도 않습니다. 같은 포트에 다른 서버가 떠도 그 응답은 담지 않도록 `Relay-Pid` 헤더가 있는 200 응답만 보관합니다. 서버가 꺼진 채 앱을 열면 보관한 셸이 뜨고 메뉴바는 `연결 끊김 · 재시도 중`, 목록에는 서버를 켜는 명령이 나오며, 서버가 다시 뜨면 3초 폴링으로 저절로 연결됩니다.
- **제목 표시줄 통합**: 앱 창 오른쪽 위 `⌃` 단추로 제목 표시줄을 숨기면(Window Controls Overlay) 메뉴바가 그 자리에 올라갑니다. `lib/pwa.ts`가 `navigator.windowControlsOverlay`에서 영역을 읽어 `html[data-titlebar]`와 `--menubar-height`·`--titlebar-left`·`--titlebar-right`를 넣고, 메뉴바는 창 조작 버튼 자리를 비운 채 앱 창을 옮기는 손잡이(`app-region: drag`, 단추는 `no-drag`)가 됩니다. 메뉴바 높이는 창 조작 버튼 높이(Windows 33px)를 따르고, 창 배치 제한과 최대화한 창의 위쪽도 같은 값을 씁니다.
- **제목 표시줄 색**: `theme-color`를 메뉴바 유리의 겉보기 색에 맞춥니다. 유리 뒤 바탕화면 띠의 평균색(사진은 `object-fit: cover` 그대로 캔버스로 재고, 색상 바탕화면은 `[data-color]` 규칙의 `--wallpaper-top`·`--wallpaper-top-end`)에 메뉴바의 `saturate()`와 반투명 채움을 겹쳐 계산합니다. 그래서 표준 제목 표시줄은 메뉴바와 한 덩어리로 보이고, 제목 표시줄을 숨기면 창 조작 버튼 바탕이 메뉴바 오른쪽 끝과 이어집니다. 바탕화면·테마·창 크기·제목 표시줄 모드가 바뀔 때마다 다시 잽니다.
- **설치 안내**: 브라우저가 설치를 제안할 때(`beforeinstallprompt`)만 설정 창 `앱` 섹션의 `앱으로 설치` 단추와 Relay 메뉴의 `앱으로 설치…`가 나타납니다. 앱 창 안에서는 `앱 창에서 실행 중`을 보이고, 운영체제가 창 제목 앞에 앱 이름을 붙이므로 문서 제목에서 `· Relay`를 뺍니다.

- **새 빌드로 바꾸기**: 서버는 화면 파일(HTML·JS·CSS·서비스 워커)의 해시를 빌드 식별자로 HTML `<meta name="relay-build">`에 심고 `/api/v1/health`의 `build`로도 알립니다. 3초 폴링에서 둘이 달라지면(`relay web --reload`, 재설치로 서버가 새 빌드로 다시 뜸) 화면이 스스로 새로 고칩니다. 입력 칸·본문 편집기에 초점이 있으면 끊지 않고 메뉴바 아래 가운데에 유리 알약 안내(`#update-status`, `새로 고침` 단추)를 띄우고, 탭이 가려질 때 새로 고칩니다. 같은 빌드로는 `sessionStorage`에 남겨 한 번만 새로 고치므로 보관본과 서버가 엇갈려도 되풀이되지 않습니다. 메모는 `pagehide`에서 저장됩니다.

## 9. YouTube 창

크롬을 열듯 유튜브를 창 안에서 보는 앱입니다. 유튜브 본문 페이지는 `X-Frame-Options`로 다른 사이트 안에 들어가지 않으므로, 내장 플레이어(`https://www.youtube-nocookie.com/embed/…`)만 `iframe`으로 띄우고 나머지는 Relay가 브라우저처럼 감쌉니다.

- **상단바**: 제목 옆에 뒤로·앞으로·새로 고침·시작 페이지 단추와 알약 모양 주소창(`.address-field`)이 들어갑니다. 주소창은 유리 컨트롤이고 초점을 받으면 불투명 바탕으로 바뀝니다. 오른쪽 끝의 `YouTube에서 열기`는 보고 있는 주소를 브라우저 탭으로 엽니다. 좁은 창(`@container youtube (max-width: 44em)`)에서는 주소창 줄이 제목 아래로 내려갑니다.
- **주소 해석**(`lib/youtube.ts`): `watch?v=`, `youtu.be/`, `shorts/`, `live/`, `embed/`, `playlist?list=`와 11자리 영상 ID를 받고 `t=`·`start=` 시작 시각을 초로 바꿉니다. 알아볼 수 없는 입력은 창 안에서 열지 않고 상단 알림(`.browser-notice`)에서 `YouTube에서 검색`을 제안합니다.
- **탐색 이력**: 창 안의 뒤로·앞으로는 Relay가 가진 페이지 배열(`pages`/`index`)로 움직이고, 같은 주소를 다시 열면 이력을 늘리지 않고 새로 고칩니다. 플레이어 `iframe`은 `페이지 키:reloadKey`로 다시 마운트하며, 불러오는 동안 검은 바탕의 스피너를 보입니다. 창을 `×`로 닫으면(`windows.youtube.open`이 true→false) `reset()`으로 보던 영상·이력·최근 본 항목·`localStorage` 항목을 모두 지워 시크릿 창처럼 동작하고, 최소화는 재생을 그대로 둡니다.
- **시작 페이지**: 아이콘·안내와 `최근 본 항목` 격자(16:9 섬네일 `i.ytimg.com/vi/<id>/mqdefault.jpg`, 두 줄 제목). 제목은 `youtube.com/oembed`에서 읽어 두고, 목록은 `localStorage["relay-youtube-v1"]`에 최대 12개를 둡니다. 모서리의 `×`는 바탕화면 견본과 같은 유리 단추입니다.
- **플레이어 래퍼**: 유튜브는 플레이어를 넣은 페이지의 Referer가 없거나(오류 153) IP 주소(`http://127.0.0.1:포트`)이면 광고가 붙는 영상 재생을 거부하고 `http://localhost:포트`는 받아들입니다. 그래서 메인 화면은 플레이어를 직접 넣지 않고 `http://localhost:<포트>/youtube/player?v=…&list=…&start=…`(`youtube-player.ts`, 스크립트 없는 HTML)를 `iframe`으로 넣고, 그 페이지가 `referrerpolicy="strict-origin-when-cross-origin"`으로 nocookie 플레이어를 띄웁니다. 래퍼는 `frame-ancestors`로 이 서버의 두 루프백 출처만 허용하고, 127.0.0.1 화면이 넣으면 브라우저가 `Sec-Fetch-Site: cross-site`로 표시하므로 서버는 이 경로에서만 그 표시를 허용합니다. 바깥 `iframe`은 `sandbox`로 상위 창 이동을 막고 전체 화면·PiP·자동 재생을 허용합니다. 창을 끌거나 크기를 바꾸는 동안에는 `pointer-events: none`으로 플레이어가 포인터를 삼키지 않게 하고, 플레이어 안을 눌러 초점이 `iframe`으로 가면 `blur` 이벤트로 알아채 창을 앞으로 가져옵니다.
- **CSP**: 메인 화면은 `frame-src 'self' http://localhost:<포트>`, `img-src … https://i.ytimg.com`, `connect-src 'self' https://www.youtube.com`만 더하고, 래퍼 페이지는 `default-src 'none'; frame-src https://www.youtube-nocookie.com`입니다. 세션 데이터는 바깥으로 나가지 않습니다.

## 10. 메모 창

메모를 여러 개 쓰고 폴더 트리로 정리하는 앱입니다. 메모는 Relay 저장소(`relay.db`, 스키마 v5의 `notes`·`notes_meta`)에 둡니다. 서버는 세션을 읽기 전용 연결로 읽고, 메모만 따로 연 쓰기 연결로 `POST /api/v1/notes`(같은 출처·JSON만)를 받습니다. 화면(`lib/notes.ts`)은 처음에 `GET /api/v1/notes`로 트리를 받고, 고친 항목·지운 항목만 모아 400ms 뒤 한 묶음으로 보냅니다. 보내지 못한 변경은 `localStorage["relay-notes-pending-v1"]`에 남겨 창을 닫아도 다음에 보내고(64KB 이하면 닫을 때 `keepalive`로 바로 보냄), 3초마다 저장 번호(`ETag`)만 물어 바뀌었을 때만 목록을 다시 받습니다. 이때 아직 보내지 못한 이 창의 변경이 이깁니다. 고른 항목·펼친 폴더는 브라우저마다(`relay-notes-view-v1`) 둡니다. 예전 `localStorage["relay-notes-v1"]`의 메모는 처음 연결될 때 서버에 없는 것만 올리고 원본을 `relay-notes-v1-backup`으로 남깁니다. 사이드바 아래에는 저장 상태(초록 `Relay DB에 저장됨`, 회색 `저장 중…`, 노랑 `저장 대기 · 다시 시도 중`, 빨강 `저장 실패`)를 점과 함께 보이고, 연결이 끊기면 내용 위에 노란 알림을 띄웁니다. 창을 닫아도 지우지 않습니다.

- **자료 구조**(`lib/notes.ts`): 폴더 `{ name }`와 메모 `{ title, body, updatedAt }`가 `parentId`로 트리를 이룹니다(`null`은 최상위). 폴더가 먼저, 같은 종류끼리는 이름 순(`Intl.Collator("ko-KR", { numeric: true })`)이고, 메모 이름은 제목이 없으면 본문 첫 줄, 그것도 없으면 `새 메모`입니다. 저장본을 읽을 때 모양이 틀린 항목은 버리고, 부모가 없거나 순환하는 항목은 최상위로 올립니다. 비어 있는 메모는 다른 항목으로 옮겨 가면 남기지 않습니다.
- **상단바**: 제목 오른쪽에 `새 폴더`·`새 메모`·`삭제` 아이콘 단추. 새 항목은 고른 폴더(메모를 골랐으면 그 메모의 폴더) 안에 생기고, 새 폴더는 곧바로 이름 입력이 열리며 새 메모는 제목에 초점이 갑니다.
- **사이드바**(`.notes-sidebar`, `material-chrome` 유리 256px): 검색 칸, `role="tree"` 트리, 아래 개수 줄. 행은 `aria-level`만큼 16px씩 들여 쓰고, 폴더는 갈매기 단추(펼치면 90° 회전)·청록 폴더 아이콘·하위 메모 수, 메모는 문서 아이콘입니다. 고른 행은 `--selected`, 창이 뒤에 있으면 `--selected-inactive`. 행에 올리면 개수 자리에 `…` 메뉴 단추가 나옵니다(터치 기기는 항상).
- **트리 조작**: 폴더를 누르면 고르면서 펼치고, 이미 고른 폴더를 다시 누르면 접습니다. 화살표 위·아래·Home·End로 옮기고, →는 펼치기/첫 하위 항목, ←는 접기/상위 폴더, Enter는 폴더 접기·펼치기 또는 메모 본문으로 이동, `F2`·더블클릭은 이름 바꾸기, `Delete`는 삭제, `Shift+F10`·메뉴 키·오른쪽 클릭은 메뉴입니다. 이름 입력은 Enter·바깥 클릭이면 저장, Esc면 취소이며 폴더 이름은 비울 수 없습니다.
- **옮기기**: HTML5 끌어 놓기로 폴더 행에 놓으면 그 폴더 안, 메모 행에 놓으면 그 메모의 폴더, 트리 빈 곳에 놓으면 최상위로 갑니다. 놓을 폴더 행은 파란 테두리, 최상위는 트리 전체 테두리로 표시하고, 닫힌 폴더 위에 650ms 머무르면 펼칩니다. 폴더를 제 안(하위 폴더 포함)으로는 옮길 수 없습니다. 끌기가 안 되는 환경을 위해 메뉴의 `다른 폴더로 이동…`이 같은 자리에 폴더 목록(`최상위` + 들여 쓴 폴더, 지금 폴더는 체크, 갈 수 없는 폴더는 비활성)을 엽니다.
- **삭제와 되살리기**: 폴더를 지우면 안의 폴더·메모도 함께 지워지고, 창 아래 가운데에 유리 안내(`.notes-undo`, `material-toast`)가 8초 동안 `실행 취소`를 제안합니다. 되살리면 지울 때 펼쳐 둔 폴더도 다시 펼칩니다.
- **내용**(불투명 `--background`): 위쪽 줄에 위치 경로(`모든 메모 › 폴더 …`, 누르면 그 폴더로)와 마지막 수정 시각. 메모는 그 아래 서식 도구 막대, 다시 그 아래 입력 창(최대 780px 가운데 단에 24px 굵은 제목 입력과 본문)이며 커서는 청록(`--notes-accent`)입니다.
- **본문 = Markdown**(`apps/note-editor.tsx`): 본문은 Markdown 원문으로 저장하고, 입력 창은 TipTap 3(ProseMirror) 서식 편집기로 서식을 그대로 보이며 고칩니다. `@tiptap/markdown`이 `marked`(`gfm`, `breaks: true` — 한 줄 바꿈도 줄바꿈이라 예전 평문 메모의 줄이 합쳐지지 않습니다)로 읽고 `getMarkdown()`으로 씁니다. 사용자가 고칠 때만 다시 쓰므로 열어 보기만 해서는 원문이 바뀌지 않고, 다른 탭·되살리기로 본문이 바뀌면 편집기에 다시 넣습니다. 확장: StarterKit(제목 1–3, 밑줄은 Markdown 표준 문법이 없어 제외, 링크는 누르면 이동하지 않고 붙여넣은 주소는 링크로), 체크리스트(중첩 가능), 표(GFM), 그림(외부 그림은 CSP가 막지만 원문 문법은 보존), 빈 본문 안내문. `injectCSS: false` — CSP `style-src 'self'`가 인라인 `<style>`을 막으므로 ProseMirror 기본 규칙은 `styles.css`에 옮겼습니다.
- **서식 도구 막대**(`.note-toolbar`, `role="toolbar"`, 44px, 위아래 머리카락 선): 실행 취소·다시 실행 | 본문 텍스트·제목 1·2·3(¶·H1–H3 아이콘 단추. Select 목록은 닫힐 때 초점을 늦게 돌려줘 바로 친 글자가 엇나가므로 쓰지 않습니다) | 굵게·기울임·취소선·인라인 코드 | 글머리·번호 목록·체크리스트 | 인용·코드 블록·구분선 | 링크(유리 팝오버에 주소 입력, 프로토콜이 없으면 `https://`, 지우기)·표(밖에서는 3×3 넣기, 안에서는 행·열 추가·삭제 목록) — 오른쪽 끝에 `서식 | Markdown` 세그먼트와 `.md` 내려받기. 30px 유령 단추이며 켜진 서식은 청록 틴트(`aria-pressed`), 툴팁에 단축키를 보입니다. 단추는 `mousedown`을 막아 편집기의 초점·선택을 빼앗지 않고, 팝오버가 닫히면 `view.focus()`로 곧바로 편집기에 초점을 돌려줍니다. 좁은 창에서는 가로로 스크롤합니다.
- **Markdown 보기**: `textarea` 원문 편집(Latin은 고정폭, 한글은 Pretendard로 받는 글꼴 순서, `field-sizing: content`). 이때 서식 단추는 비활성입니다. 보기 선택은 `localStorage["relay-notes-mode"]`에 남습니다.
- **본문 서식**(`.note-prose`): 14px·줄 높이 1.8, 제목 1.55/1.3/1.12배, 인라인 코드는 테두리 있는 알약, 코드 블록은 터미널 바탕(다크에서는 한 단계 밝힌 `#2b2b30`), 인용은 청록 왼쪽 막대, 체크리스트는 `accent-color` 청록 체크 상자와 완료 항목 취소선, 표는 머리 행 회색 바탕과 1px 칸 선. 트리 이름·카드 미리 보기는 Markdown 기호를 걷어 낸 글(`plainLine`)을 씁니다. 폴더(또는 `모든 메모`)를 고르면 이름·개수·`새 폴더`/`새 메모` 단추와 카드 격자(하위 폴더는 청록 틴트 카드, 메모는 제목·세 줄 미리 보기·날짜)를 보입니다. 아무것도 없으면 아이콘·안내·두 단추의 시작 화면입니다.
- **검색**: 제목·본문·폴더 이름을 대소문자 구분 없이 찾아 트리 대신 결과 목록(이름 + 폴더 경로)을 보입니다. Esc나 `×`로 지우면 트리로 돌아가고, 고른 항목까지 폴더가 펼쳐져 있습니다.
- **좁은 창**(`@container notes (max-width: 40em)`, 모바일 포함): 목록과 내용을 한 번에 하나만 보입니다. 메모를 열면 내용으로 넘어가고 위쪽 `목록` 단추로 돌아옵니다.
- **아이콘**(`public/icons/notes.png`): 민트·청록 squircle 위에 폴더(청록 사각)와 메모(주황 점)를 트리로 그린 종이와 연필. Grok Imagine 크레딧이 없어 PIL로 1024px에 그려 256px로 줄였고, 다른 Dock 아이콘과 같은 타일 영역(11–245px)과 얕은 그림자를 씁니다.

## 11. 파일 탐색기 창

이 PC의 디스크를 Finder·Windows 탐색기처럼 둘러보는 앱입니다. 서버(`src/files/files.service.ts`)는 디스크를 읽기만 하고, 파일을 여는 일은 운영체제의 기본 앱·탐색기(`explorer.exe`)에 넘깁니다. 만들기·지우기·옮기기는 하지 않습니다.

- **서버**: `GET /api/v1/files/places`(홈·Known Folder·드라이브), `GET /api/v1/files?path=`(폴더 내용, 한국어 이름 순 앞 5,000건), `GET /api/v1/files/content?path=`(미리 보기·내려받기, 한 구간 Range), `POST /api/v1/files/open`(`open`·`reveal`). 경로는 드라이브 문자로 시작하는 로컬 절대 경로만 받고 UNC·장치 경로·대체 스트림(`a:b`)은 400입니다. Windows의 숨김·시스템 속성(`GetFileAttributesW`), 드라이브 목록·종류·이름(`GetLogicalDrives`·`GetDriveTypeW`·`GetVolumeInformationW`), 사용자 폴더 위치(`SHGetKnownFolderPath`)는 Node가 알려 주지 않아 `bun:ffi`로 kernel32·shell32를 부르고, 못 부르면 이름으로 짐작합니다. 파일 조회는 `Sec-Fetch-Site`가 `same-origin`·`none`일 때만 받습니다(다른 포트의 로컬 앱이 그림으로 넣는 요청 차단). 내용 응답은 `default-src 'none'; … sandbox` CSP이고, 그림·영상·소리·`text/plain`만 그 형식으로, 나머지(HTML·SVG 외 스크립트 형식 포함)는 `application/octet-stream`으로 줍니다. 실행 형식(`.exe`·`.bat`·`.ps1`·`.lnk`·`.msi` 등)의 `open`은 `reveal`로 바꿉니다.
- **상단바**: 제목 옆에 뒤로·앞으로·위로·새로 고침(불러오는 동안 회전) 단추와 위치 경로 알약(`.files-path`). 경로는 `이 PC`(모니터 아이콘, 시작 화면에서만 글자) › `로컬 디스크 (C:)` › 폴더… 단추이고 지금 폴더는 굵게, 넘치면 앞쪽부터 `…` 하나로 접어(ResizeObserver로 다시 잼) `…`를 누르면 접힌 마지막 폴더로 갑니다. 다 접어도 넘칠 때만 마지막 이름이 말줄임으로 줄어듭니다. 알약의 빈 곳·`Ctrl+L`·`Alt+D`는 경로 입력 칸으로 바뀌고 Enter로 이동, Esc·바깥 클릭으로 취소합니다. 오른쪽에는 `이 폴더에서 찾기`(이름 거르기), `목록 | 아이콘` 세그먼트, 숨김 항목 눈 단추, 미리 보기 창 단추.
- **사이드바**(`.files-sidebar`, `material-chrome` 유리 216px): `즐겨찾기`(홈은 사용자 이름) · `이 PC`와 드라이브(`볼륨 이름 (C:)`). 아이콘은 시스템 블루, 지금 위치는 `--selected`.
- **이 PC**: 위에서 퍼지는 블루 그라디언트 바탕에 즐겨찾기 카드(폴더마다 다른 색 그라디언트 36px 타일 + 이름·경로)와 드라이브 카드(회색 금속 타일 + 이름 + 6px 사용량 막대, 90% 넘으면 빨강 + `전체 중 여유 사용 가능`). 카드는 메모 카드와 같은 hover 떠오름입니다.
- **목록 보기**: 열 머리(이름·수정한 날짜·종류·크기, 누르면 정렬·다시 누르면 반대로, 화살표 표시)와 27px 행, 짝수 행 3% 줄무늬. 폴더는 늘 먼저이고 이름은 `Intl.Collator("ko-KR", { numeric: true })`라 한글 뒤에 영문이 옵니다. 고른 행은 목록에 초점이 있으면 시스템 블루 채움에 흰 글자, 아니면 `--selected`. 종류 이름은 Windows 탐색기 말(`파일 폴더`·`텍스트 문서`·`PNG 이미지`…)이고 아이콘 색은 종류별 톤(그림 분홍·영상 보라·소리 주홍·압축 황토·표 초록·발표 주황·문서 파랑·코드 회청). 숨김 항목은 55% 불투명. 행은 `content-visibility: auto`로 수천 개도 가볍습니다.
- **아이콘 보기**: `auto-fill, minmax(104px, 1fr)` 격자에 48px 아이콘(폴더 56px, 채움 32%)이나 그림 섬네일(24MB 이하, `loading=lazy`, 얕은 그림자), 두 줄 이름. 고르면 그림 칸은 `--selected`, 이름은 파란 알약.
- **미리 보기**(272px, `--muted` 45% 바탕): 그림·영상(168px 칸)·소리 막대·글(앞 256KB, NUL이 있으면 이진, UTF-16LE BOM, UTF-8이 아니면 CP949로 읽는 고정폭 칸) 또는 큰 종류 아이콘, 이름·종류·크기, 수정한 날짜·위치, `기본 앱으로 열기`(폴더는 `열기`)·`탐색기에서 보기`·`내려받기`·`경로 복사`. 아무것도 고르지 않으면 지금 폴더의 하위 폴더·파일 수와 `탐색기에서 열기`.
- **조작**: 한 번 누르면 고르고 두 번 누르거나 Enter면 폴더는 들어가고 파일은 기본 앱으로 엽니다. 화살표(아이콘 보기는 좌우·한 줄 칸 수만큼 상하)·Home·End·PageUp/Down, Backspace·`Alt+↑` 위로(들어갔던 폴더가 골라진 채), `Alt+←/→`, `F5`, Space는 미리 보기 창 열기, 글자를 치면 그 이름으로 건너뜁니다(같은 글자를 거듭 치면 다음 항목). 오른쪽 클릭·`Shift+F10`·메뉴 키는 항목 메뉴(열기·탐색기에서 보기·내려받기·경로 복사)나 빈 곳 메뉴(새로 고침·탐색기에서 이 폴더 열기·보기·숨김 항목)를 엽니다. 열기·복사 결과는 상태 줄 위 가운데 유리 안내(`.files-toast`)로 3초 보입니다.
- **상태와 오류**: 아래 상태 줄에 `항목 N개 · 숨김 M개 · ‘거름’`과 고른 항목 이름·크기. 없는 경로·권한 없음은 내용 자리에 노란 경고 아이콘과 서버 문구, `상위 폴더`·`다시 시도` 단추. 5,000건을 넘으면 위쪽 노란 알림.
- **저장**: 보기·숨김·미리 보기 창·정렬·마지막 위치는 `localStorage["relay-files-v1"]`. 탐색 이력은 창 안에서만(최대 100) 둡니다.
- **좁은 창**(`@container files`): 58em(754px) 이하 미리 보기 창 숨김, 46em 이하 사이드바·종류 열 숨김과 경로 줄이 제목 아래로, 34em 이하 날짜 열과 찾기 칸 숨김.
- **아이콘**(`public/icons/files.png`): 하늘색에서 짙은 하늘빛으로 내려가는 squircle 위에 열린 파란 폴더와 흰 문서 두 장. 사용자 지시로 Codex 이미지 생성(1024px)을 받아 타일만 잘라 n=5 superellipse로 다시 깎고, 다른 Dock 아이콘과 같은 타일 영역(11–245px)과 얕은 그림자로 256px에 맞췄습니다.
