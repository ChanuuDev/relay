# macOS 데스크톱 셸 디자인 시스템

Relay 웹 화면은 macOS 데스크톱 메타포를 따릅니다. 참고 디자인은 21st.dev "macOS Desktop Portfolio"(작성자 alanagoyal, MIT)의 공개 화면이며,
관찰값과 Relay의 적용 결정은 `.tasks/desktop-design.md`에 정리돼 있습니다. Apple 저작 자산(배경화면·앱 아이콘·SF Pro)은 쓰지 않고, 외부 CDN·원격 폰트도 없습니다.

## 1. 구조

```
div.desktop (fixed inset-0)
├─ div.wallpaper (배경화면 이미지 2장 + 토큰 그라디언트, aria-hidden)
├─ header.menubar (28px, z 70)
├─ main#desktop (창 레이어, z 1–50)
│   └─ section.window[data-window] × 4  — 세션 / 가이드 / 명령 / 설정
└─ nav.dock (z 60) + 토스트·복사 폴백 (z 100)
```

창은 드래그·리사이즈·최소화·최대화·닫기가 가능하며 배치는 `localStorage["relay-desktop-v1"]`에 저장합니다.
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
| `.material-menu` | 30px | 드롭다운 메뉴, Dock 툴팁, Radix 툴팁, 복사 폴백 |
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

모서리: 창 12px(최대화 10px), 카드·세그먼트 8px, 버튼·입력 6px, Dock 18px. 강조색은 시스템 블루 하나이며 초록·노랑·빨강은 신호등과 상태점에만 씁니다.

## 4. 서체와 정렬

- **Pretendard Variable**(SIL OFL)을 실행 파일에 포함해 `/fonts/PretendardVariable.woff2`로 제공합니다. 굵기는 400·500·600만 씁니다.
- 본문 `letter-spacing: -0.01em`, 22px 제목 `-0.02em`, 한글 `word-break: keep-all`, 긴 경로·ID는 `overflow-wrap: anywhere`.
- 크기: 메뉴바·창 제목·UI 본문 13px, 목록 제목 13px/600, 미리보기 12px, 메타·캡션 11px, 상세 제목 22px/600, 요약 14px/1.8, 터미널 12.5px mono.
- 박스 안의 텍스트는 좌우 패딩을 같게, 세로는 flex 중앙으로 맞춥니다. 배지·캡슐은 높이를 명시하고 `line-height: 1`,
  목록 행은 제목 20px·요약 32px(2줄 고정)·메타 16px로 높이를 통일하며, 시각·건수는 `tabular-nums`, 라벨-값 쌍은 120px 라벨 열을 씁니다.
- 여백은 4px 배수만 씁니다(행 안쪽 12px, 섹션 안쪽 16px, 섹션 사이 24px).

## 5. 모션

모든 상태 전환은 GSAP으로 잇습니다. 값과 헬퍼는 **`lib/motion.ts` 한 곳**에만 있고(`MOTION`·`EASE`·`dur()`),
컴포넌트는 `useGSAP`으로 그 헬퍼만 부릅니다. 애니메이션 대상은 transform·opacity뿐이며(상세 필터 행의 `height: auto`만 예외),
설계 근거는 `.tasks/motion-design.md`입니다.

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
