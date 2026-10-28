# Relay Web 디자인 시스템 — 전체 추출본

> 다른 프로젝트에서 그대로 가져다 쓰기 위해 Relay 웹 화면(`src/web`)의 디자인 시스템을 토큰부터 컴포넌트 치수, 모션, 함정까지 한 문서로 정리했습니다.
>
> - 추출일: 2026-10-28 · 기준 커밋: `7b5fc84`
> - 정본 우선순위: `src/web/styles.css` → `src/web/lib/motion.ts` → `src/web/components/**` → `src/web/DESIGN.md`·`DESIGN-IMPLEMENTATION.md` → `.tasks/desktop-design.md`·`.tasks/motion-design.md`(초기 설계 문서라 일부 값이 지금과 다릅니다. 이 문서는 현재 코드 값을 따릅니다.)
> - 이 파일은 스타터 키트에 넣어 둔 사본입니다. 키트 사용법은 [`../README.md`](../README.md), 키트 코드 경로(`src/styles/*` 등)는 Relay 원본 경로(`src/web/*`)와 다릅니다.
> - 모든 치수는 **글자 크기 13px(기본)** 기준입니다. `--fs-*`·`--lh-*`·`calc(1em + Npx)`로 잡은 값은 글자 크기 설정을 따라 함께 커집니다.

---

## 목차

0. [한눈에 보기](#0-한눈에-보기)
1. [기술 스택과 구성 방식](#1-기술-스택과-구성-방식)
2. [디자인 원칙과 미적 합격 기준](#2-디자인-원칙과-미적-합격-기준)
3. [색](#3-색)
4. [유리 재질(Material)](#4-유리-재질material)
5. [타이포그래피](#5-타이포그래피)
6. [간격과 정렬 규칙](#6-간격과-정렬-규칙)
7. [모서리 반경](#7-모서리-반경)
8. [그림자와 깊이](#8-그림자와-깊이)
9. [Z-index 레이어](#9-z-index-레이어)
10. [치수 — 높이 공식과 고정 크기](#10-치수--높이-공식과-고정-크기)
11. [아이콘과 자산](#11-아이콘과-자산)
12. [상호작용 상태](#12-상호작용-상태)
13. [컴포넌트 명세](#13-컴포넌트-명세)
14. [모션](#14-모션)
15. [레이아웃·창 관리·반응형](#15-레이아웃창-관리반응형)
16. [테마 시스템](#16-테마-시스템)
17. [바탕화면](#17-바탕화면)
18. [접근성](#18-접근성)
19. [설치형 앱(PWA) 셸 디자인](#19-설치형-앱pwa-셸-디자인)
20. [이식 가이드 — 스타터 코드와 체크리스트](#20-이식-가이드--스타터-코드와-체크리스트)
21. [함정 모음(실제로 겪은 문제와 해법)](#21-함정-모음실제로-겪은-문제와-해법)
22. [원본 파일 맵](#22-원본-파일-맵)

---

## 0. 한눈에 보기

| 항목 | 값 |
| --- | --- |
| 콘셉트 | macOS 데스크톱 메타포(메뉴바 · 떠 있는 창 · Dock) + Apple식 글래스모피즘. **크롬은 유리, 콘텐츠는 불투명** |
| 기본 테마 | **다크**(라이트·시스템 선택 가능) |
| 강조색 | 시스템 블루 하나 — 라이트 `#0a7cff` / 다크 `#0a84ff` |
| 서체 | Pretendard Variable(로컬 포함), 기본 13px, 자간 `-0.01em`, 한글 `word-break: keep-all` |
| 컨트롤 모양 | 모두 알약형 `--radius-control: 999px`, 높이 `1em + 15px`(28px) |
| 유리 | 반투명 채움 → `blur()+saturate()` → 1px 밝은 테두리 → 상단 안쪽 하이라이트 + 바깥 그림자 |
| 모션 | 120 / 160 / 220 / 260ms, 진입 `power3.out` · 종료 `power2.in` · 이동 `power3.inOut` |
| 레이아웃 반응 | 뷰포트가 아니라 **창 컨테이너 쿼리**로 반응, 뷰포트 ≤ 760px는 모바일 모드 |
| 아이콘 | lucide-react, 스트로크 **1.5px**, 텍스트와 같은 색 |

---

## 1. 기술 스택과 구성 방식

| 영역 | 라이브러리(버전) | 쓰임 |
| --- | --- | --- |
| UI | React 19.3, TypeScript 5.9 | |
| 스타일 | Tailwind CSS **v4.3**(`@tailwindcss/cli`), `tw-animate-css` 1.4 | `@theme inline`으로 토큰 노출, 컴포넌트 CSS는 대부분 일반 클래스 |
| 프리미티브 | shadcn/ui(`new-york`, `baseColor: neutral`, `cssVariables: true`), `radix-ui` 1.6 | Button·Input·InputGroup·Select·NativeSelect·Tabs·Tooltip·Badge·Alert·Empty·Field·Label·Separator·Skeleton·Resizable |
| 유틸 | `class-variance-authority`, `clsx`, `tailwind-merge` | `cn()` |
| 아이콘 | `lucide-react` | 스트로크 1.5px로 일괄 조정 |
| 모션 | `gsap` 3.15(+ `Flip`), `@gsap/react`(`useGSAP`) | 창·목록·상세 전환 |
| 모션(Dock) | `framer-motion` 14 | Dock 확대 스프링과 라벨 |
| 분할 패널 | `react-resizable-panels` 4(shadcn Resizable) | 왼쪽 패널 폭 조절 |
| 상태 | `zustand` 5, `@tanstack/react-query` 5 | |
| 편집기 | TipTap 3(`@tiptap/*`, ProseMirror) + `@tiptap/markdown` | 메모 본문 |

`components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": false, "tsx": true,
  "tailwind": { "config": "", "css": "src/web/styles.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" }
}
```

### 핵심 구성 원칙

1. **shadcn 프리미티브 파일은 손대지 않는다.** 치수·모양은 `styles.css`의 `[data-slot="…"]` 선택자로 덮어쓴다(`[data-slot="button"][data-size="sm"]` 등). 프리미티브를 다시 받아도 디자인이 유지됩니다.
2. **토큰은 CSS 변수 한 곳**(`:root` 라이트, `.dark` 다크)에 두고 `@theme inline`으로 Tailwind에 노출한다.
3. **재질은 유틸 클래스**(`.material-bar` 등)로만 적용하고 같은 CSS를 반복하지 않는다.
4. **모션 값은 `lib/motion.ts` 한 곳**에만 두고 컴포넌트에서 하드코딩하지 않는다.
5. 상태는 `data-*` 속성으로 표현한다(`data-focused`, `data-open`, `data-state`, `data-active`, `data-closing`, `aria-selected`, `aria-pressed`, `aria-checked`).
6. 외부 CDN·원격 폰트·Apple 저작 자산(SF Pro, macOS 배경화면, 앱 아이콘)은 쓰지 않는다. CSP `default-src 'self'` 환경을 전제로 한다.

`cn` 유틸:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

---

## 2. 디자인 원칙과 미적 합격 기준

합격 기준은 "오류 없는 코드"가 아니라 **스크린샷을 객관적으로 봤을 때의 아름다움**입니다. 다크·라이트·모바일 스크린샷으로 판정합니다.

1. **유리 재질이 보인다** — 메뉴바·Dock·창 상단바·목록 패널 뒤로 바탕화면의 색과 형태가 은은하게 비친다. 불투명 회색 판처럼 보이면 실패.
2. **깊이감** — 창은 크고 부드러운 그림자와 얇은 밝은 테두리로 떠 있고, 포커스 창이 비포커스 창보다 또렷하다. Dock은 화면에 살짝 뜬 캡슐.
3. **정렬과 리듬** — 4px 그리드, 상단바 요소 수직 중앙, 목록 행 높이 일정, 좌우 여백 16px, 섹션 간격 12/16/24px.
4. **타이포 위계** — 창 제목 13/600 · 목록 제목 13/600 · 미리보기 12 muted · 메타 11. 상세 제목 22/600은 한 화면에 하나. 한글 줄간격 1.5 이상, eyebrow 자간 `.06em`.
5. **색 절제** — 강조색은 시스템 블루 하나. 초록·노랑·빨강은 상태점·신호에만. 배지·칩은 회색 캡슐. 파란 채움 버튼은 화면에 하나(주요 액션).
6. **아이콘 품질** — 앱 아이콘은 48px에서 선명, 그림자 부드럽게. lucide는 1.5px 스트로크, 텍스트와 같은 색.
7. **상태 표현** — hover는 채움 +4%, 선택은 파란 틴트 + 둥근 모서리, 초점 링 2px 블루, disabled 45% 불투명. 전환 120–200ms ease-out.
8. **빈 공간의 아름다움** — 데이터·선택이 없을 때도 안내 일러스트·문구가 중앙 정렬로 정돈.
9. **어색함 0** — 잘린 텍스트, 겹친 요소, 굵은 스크롤바, 픽셀 어긋남, 계단 현상 없음.
10. **박스 안에서 쏠림 없이** — 좌우 패딩 대칭, 세로는 flex 중앙(§6).

---

## 3. 색

### 3.1 의미 토큰(shadcn 호환)

| 토큰 | 라이트 | 다크 | 용도 |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#1e1e20` | 창 콘텐츠 바탕(불투명) |
| `--foreground` | `#1d1d1f` | `#f5f5f7` | 본문 글자 |
| `--card` / `--card-foreground` | `#ffffff` / `#1d1d1f` | `#242426` / `#f5f5f7` | 카드 |
| `--popover` / `--popover-foreground` | `rgba(255,255,255,.95)` / `#1d1d1f` | `rgba(40,40,42,.95)` / `#f5f5f7` | 팝오버 |
| `--primary` / `--primary-foreground` | `#0a7cff` / `#ffffff` | `#0a84ff` / `#ffffff` | 시스템 블루, 주요 버튼·선택 강조 |
| `--secondary` / `--secondary-foreground` | `#f2f2f7` / `#1d1d1f` | `#2c2c2e` / `#f5f5f7` | 보조 버튼 |
| `--muted` / `--muted-foreground` | `#f5f5f7` / `#6e6e73` | `#2a2a2d` / `#9a9aa0` | 요약·카드 표면 / 보조 글자(대비 5.0:1 / 6.0:1) |
| `--accent` / `--accent-foreground` | `#e8e8ed` / `#1d1d1f` | `#353538` / `#f5f5f7` | hover 표면(shadcn 기본) |
| `--destructive` | `#d70015` | `#ff453a` | 오류·삭제·닫기 hover |
| `--border` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.10)` | 머리카락 선 |
| `--input` | `rgba(0,0,0,.14)` | `rgba(255,255,255,.14)` | 입력 테두리·비활성 점 |
| `--ring` | `#0a7cff` | `#0a84ff` | 초점 링 |
| `--link` | `#0a7cff` | `#409cff` | 텍스트 링크 |
| `--radius` | `.5rem` | 동일 | shadcn 기준 반경 |

### 3.2 선택·강조

| 토큰 | 라이트 | 다크 | 용도 |
| --- | --- | --- | --- |
| `--selected` | `rgba(10,124,255,.16)` | `rgba(10,132,255,.28)` | 포커스 창의 선택 행 |
| `--selected-inactive` | `rgba(0,0,0,.07)` | `rgba(255,255,255,.08)` | 뒤에 있는 창의 선택 행 |
| `--pulse-tint` | `rgba(10,124,255,.4)` | `rgba(10,132,255,.4)` | 갱신된 행 하이라이트 시작색 |
| `--glass-text-muted` | `color-mix(in srgb, var(--foreground) 62%, transparent)` | `… 68% …` | **유리 위** 보조 글자(`--muted-foreground` 대신) |

### 3.3 시스템 색·작업 상태 색

| 토큰 | 라이트 | 다크 | 용도 |
| --- | --- | --- | --- |
| `--system-green` | `#28c840` | 동일 | 연결됨·저장됨 점, 복사 성공 아이콘 |
| `--system-yellow` | `#febc2e` | 동일 | 경고 아이콘·알림 바탕 틴트 |
| `--system-red` | `#ff5f57` | 동일 | (신호등 계열 예약) |
| `--status-working` | `#0a7cff` | `#0a84ff` | 작업 중 |
| `--status-blocked` | `#d70015` | `#ff453a` | 막힘 |
| `--status-handoff` | `#b25e00` | `#ffb340` | 인계 대기 |
| `--status-done` | `#1a8a3c` | `#30d158` | 완료 |
| `--stale` | `#b25e00` | `#ffb340` | 응답 없음(점선 배지) |

### 3.4 표면·터미널

| 토큰 | 라이트 | 다크 | 비고 |
| --- | --- | --- | --- |
| `--titlebar` | `#f5f5f7` | `#2a2a2d` | 불투명 대체용(유리 미사용 시) |
| `--sidebar` | `#f7f7f9` | `#232325` | 불투명 대체용 |
| `--terminal-bg` | `#1c1c1e` | 동일 | 명령 창은 테마와 무관하게 항상 어둡다 |
| `--terminal-fg` | `#e5e5ea` | 동일 | |
| `--terminal-prompt` | `#30d158` | 동일 | `$` 프롬프트 |

명령 창 전용 하드코딩: 상단바 `#2b2b2f`, 출력 `#b8b8c0`, 주석 `#8a8a94`, 다크 테마의 코드 블록 `#2b2b30`.

### 3.5 바탕화면·브랜드

| 토큰 | 라이트 | 다크 |
| --- | --- | --- |
| `--wp-sky-1` | `#a8d3ff` | `#0b1024` |
| `--wp-sky-2` | `#e6f0ff` | `#2a1b45` |
| `--wp-glow` | `#ffd2a8` | `#ff7a45` |
| `--provider-anthropic` / `-bg` | `#b4532a` / `#fbe9df` | `#e5915f` / `#3a2a22` |

`theme-color` 기본값: 다크 `#0b1024`, 라이트 `#a8d3ff`(실제로는 §19의 계산값으로 덮어씀). 파비콘 바탕 `#0a5ce0`.

### 3.6 앱 범위(로컬) 토큰

창마다 `.window[data-window="…"]`에 지역 토큰을 둡니다. 다른 프로젝트에서는 "기능 영역별 보조 강조색" 패턴으로 쓰면 됩니다.

| 영역 | 토큰 | 라이트 | 다크 |
| --- | --- | --- | --- |
| 메모 | `--notes-accent`(청록, 커서·켜진 서식·폴더 아이콘·인용 막대) | `#0f9478` | `#3dd0aa` |
| 메모 | `--notes-drop` | `color-mix(in srgb, var(--primary) 18%, transparent)` | 동일 |
| 파일 | `--files-folder` | `#2f95ee` | `#5aaeff` |
| 파일 | `--tone-image` | `#d9468f` | `#f472b6` |
| 파일 | `--tone-video` | `#8b5cf6` | `#a78bfa` |
| 파일 | `--tone-audio` | `#ef5a3a` | `#fb7c5c` |
| 파일 | `--tone-archive` | `#b07d2b` | `#d6a24a` |
| 파일 | `--tone-sheet` | `#16a34a` | `#4ade80` |
| 파일 | `--tone-slide` | `#ea580c` | `#fb923c` |
| 파일 | `--tone-doc` | `#2563eb` | `#60a5fa` |
| 파일 | `--tone-code` | `#64748b` | `#94a3b8` |

### 3.7 하드코딩 그라디언트·장식 색

| 요소 | 값 |
| --- | --- |
| 즐겨찾기 타일 기본 | `linear-gradient(180deg, #5ab0ff, #0a6fe0)` |
| ↳ desktop | `#8a96ff → #4f46e5` |
| ↳ documents | `#5ee0d0 → #0d9488` |
| ↳ downloads | `#6ee79a → #16a34a` |
| ↳ pictures | `#ffc27a → #f0663a` |
| ↳ music | `#ff86ab → #e0245e` |
| ↳ videos | `#c3a1ff → #7c3aed` |
| ↳ folder(사용자 폴더 외) | `#ffd45e → #f0a500` |
| 드라이브 금속 타일 | 라이트 `linear-gradient(180deg, #f1f3f6, #cfd4dc)`·아이콘 `#4b5563` / 다크 `#4b4f58 → #2f3238`·아이콘 `#d1d5db` |
| 사용량 막대 | 바탕 `color-mix(foreground 10%)`, 채움 `linear-gradient(90deg, #4aa8ff, #0a6fe0)`, 90% 초과 `#ff7b6e → #e5372a` |
| 즐겨찾기 별 | `#f5a524`, 채움 30% |
| 재생목록 섬네일 | `linear-gradient(135deg, #2b2b2f, #141416)`, 아이콘 `#e5e5ea` |
| 시작 페이지 광원(YouTube) | `radial-gradient(60% 42% at 50% 0%, color-mix(#ff2d3f 16%), transparent 70%)` |
| 플레이어 바탕 | `#000` |

### 3.8 `color-mix` 틴트 공식(재사용 가능한 규칙)

| 목적 | 공식 |
| --- | --- |
| 켜 둔 툴바 단추(유리 알약) | 바탕 `primary 16%`, 테두리 `primary 32%`, 글자 `primary`, hover 바탕 `primary 24%` |
| 상단바 주 단추(중립) | 바탕 `foreground 12%`, hover `18%`, 글자 `foreground` 600 |
| 상태 배지 테두리 | 상태색 `45%`(응답 없음은 `55%` + 점선) |
| 켜진 서식 단추 | 바탕 `notes-accent 16%`, hover `24%`, 글자 `notes-accent` |
| 폴더 카드 | 바탕 `notes-accent 9%` in `muted`, 테두리 `notes-accent 22%` in `border` |
| 고정 핀 아이콘 채움 | `primary 35%` |
| 폴더 아이콘 채움 | `files-folder 24%`(아이콘 보기 32%, 미리 보기 30%) |
| 짝수 행 줄무늬 | `foreground 3%` |
| 미리 보기 미디어 칸 | `foreground 5%` |
| 설정 그룹 바탕 | `background 82%`(유리 위 반투명 카드) |
| 서식 막대 바탕 | `muted 55%` in `background` |
| 미리 보기 패널 바탕 | `muted 45%` in `background` |
| 경고 알림 바탕 | `system-yellow 14%` in `background` |
| 빈 상태 광원 | `radial-gradient(60% 45% at 50% 0%, color-mix(accent 16%), transparent 70%), var(--background)` |
| 이름 입력 초점 링 | `0 0 0 3px` + `ring 28%` |
| 드롭 대상(트리 최상위) | 바탕 `primary 7%`, `inset 0 0 0 2px primary 55%` |
| placeholder | `foreground 30%` |
| 서식 단추 기본 글자 | `foreground 72%` |

---

## 4. 유리 재질(Material)

유리는 **네 겹**입니다: ① 반투명 채움 → ② `backdrop-filter: blur() saturate()` → ③ 1px 밝은 테두리 → ④ 상단 안쪽 하이라이트(`inset 0 1px 0`)와 바깥 그림자. 상세 패널·본문·터미널 같은 **콘텐츠는 불투명**하게 둡니다(macOS도 사이드바만 비칩니다).

### 4.1 재질 토큰

| 토큰 | 라이트 | 다크 |
| --- | --- | --- |
| `--glass-bar-fill` | `rgba(255,255,255,.55)` | `rgba(22,22,24,.55)` |
| `--glass-dock-fill` | `linear-gradient(to bottom, rgba(255,255,255,.34), rgba(255,255,255,.18))` | `linear-gradient(to bottom, rgba(255,255,255,.14), rgba(255,255,255,.06))` |
| `--glass-chrome-fill` | `rgba(255,255,255,.64)` | `rgba(36,36,40,.62)` |
| `--glass-chrome-dim`(비포커스 창) | `rgba(255,255,255,.76)` | `rgba(36,36,40,.74)` |
| `--glass-menu-fill` | `rgba(255,255,255,.74)` | `rgba(36,36,40,.68)` |
| `--glass-toast-fill` | `rgba(255,255,255,.72)` | `rgba(44,44,48,.66)` |
| `--glass-control-fill` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.08)` |
| `--glass-control-hover` | `rgba(0,0,0,.09)` | `rgba(255,255,255,.13)` |
| `--glass-control-border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.10)` |
| `--glass-border` | `rgba(255,255,255,.45)` | `rgba(255,255,255,.22)` |
| `--glass-bar-border` | `rgba(255,255,255,.35)` | `rgba(255,255,255,.12)` |
| `--glass-highlight` | `inset 0 1px 0 rgba(255,255,255,.55)` | `inset 0 1px 0 rgba(255,255,255,.14)` |
| `--glass-shadow` | `0 12px 40px rgba(0,0,0,.28)` | `0 12px 40px rgba(0,0,0,.45)` |
| `--glass-menu-shadow` | `0 20px 50px rgba(0,0,0,.30)` | `0 20px 50px rgba(0,0,0,.55)` |
| `--dock-tip-fill` | `rgba(246,246,248,.97)` | `rgba(46,46,52,.97)` |
| `--dock-tip-border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.12)` |
| `--window-edge` | `rgba(255,255,255,.28)` | `rgba(255,255,255,.16)` |

### 4.2 재질 클래스

| 클래스 | 채움 | 블러·채도 | 테두리 | 그림자 | 사용처 |
| --- | --- | --- | --- | --- | --- |
| `.material-bar` | `--glass-bar-fill` | `blur(20px) saturate(180%)` | (메뉴바가 하단 `--glass-bar-border`) | 없음 | 메뉴바 |
| `.material-dock` | `--glass-dock-fill` | `blur(30px) saturate(180%)` | `1px --glass-border` | 하이라이트 + `--glass-shadow` | Dock 캡슐, 모바일 탭바 |
| `.material-chrome` | `--glass-chrome-fill` | `blur(40px) saturate(170%)` | 없음(창 테두리가 담당) | 없음 | 창 상단바, 목록 패널, 상태바, 필터 행·칩 행, 메모·파일 사이드바, 설정 창 바깥 |
| `.material-menu` | `--glass-menu-fill` | `blur(30px) saturate(180%)` | `1px --glass-border` | 하이라이트 + `--glass-menu-shadow` | 드롭다운 메뉴, Select 목록, Radix 툴팁, 복사 폴백, 서식 팝오버 |
| `.material-toast` | `--glass-toast-fill` | `blur(24px) saturate(180%)` | `1px --glass-border` | 하이라이트 + `--glass-menu-shadow` | 복사·갱신 토스트, 되살리기 안내, 파일 결과 안내 |
| `.material-control` | `--glass-control-fill` | 없음 | `1px --glass-control-border` | 없음 | 검색·Provider 입력, 세그먼트, 아이콘 버튼 바탕. hover `--glass-control-hover` |

`[data-slot="tooltip-content"]`, `[data-slot="select-content"]`는 클래스를 붙이지 않아도 `.material-menu`와 같은 규칙을 받습니다.

### 4.3 재질 운용 규칙

- **창 프레임 바탕은 투명**(`.window-frame { background: transparent }`). 상단바·사이드바·상태바만 `material-chrome`, 내용 패널은 `--background`.
- 창 테두리는 `1px solid var(--window-edge)` + 그림자 안의 `0 0 0 .5px` 어두운 링으로 유리 모서리를 만든다.
- **비포커스 창**: 크롬 채움을 `--glass-chrome-dim`(약 +.12 불투명)으로 올리고 그림자를 `--window-shadow-dim`으로 줄인다 → 뒤로 물러난 느낌.
- **Dock 라벨**은 거의 불투명한 알약(`.97`)이고 블러를 쓰지 않는다. 움직이는 동안 매 프레임 backdrop을 다시 흐리는 비용과, 아래 창 글자가 비치는 문제를 함께 피한다.
- **명령 창(터미널)은 유리를 쓰지 않는다.**
- **모바일**: 크롬·바 `blur(20px) saturate(170%)`, Dock `blur(15px) saturate(180%)`로 블러 반경을 줄인다(성능).
- **`prefers-reduced-transparency: reduce`**: 모든 재질과 `.window-frame`이 불투명 `--background`, `backdrop-filter: none`.
- 유리 위 텍스트는 13px 기준 대비 4.5:1 이상. 유리 위 보조 글자는 `--glass-text-muted`.

---

## 5. 타이포그래피

### 5.1 서체

```css
/* Pretendard Variable (SIL OFL). 실행 파일에 포함한 같은 출처 폰트만 쓴다. OFL.txt를 함께 둔다. */
@font-face {
  font-family: "Pretendard Variable";
  font-weight: 45 920;
  font-style: normal;
  font-display: swap;
  src: local("Pretendard Variable"), url("/fonts/PretendardVariable.woff2") format("woff2-variations");
}
```

| 스택 | 값 |
| --- | --- |
| `--font-sans` | `"Pretendard Variable", Pretendard, -apple-system, "SF Pro Text", "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif` |
| `--font-mono` | `"SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace` |
| Markdown 원문 편집(고정폭 + 한글) | `"SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Pretendard Variable", Pretendard, ui-monospace, monospace` — 고정폭 글꼴엔 한글이 없으므로 한글은 Pretendard로 받는다 |

폰트 응답 캐시: `Cache-Control: public, max-age=31536000, immutable`.

### 5.2 본문 기본값(`body`)

```css
body { font-family: var(--font-sans); font-size: var(--fs-13); font-weight: 400; line-height: 1.5;
  letter-spacing: -.01em; word-break: keep-all; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
code, kbd { font-family: var(--font-mono); letter-spacing: 0; }
button, a, summary { letter-spacing: inherit; }
```

### 5.3 크기 토큰과 글자 크기 설정

```css
:root {
  --font-scale: 1;                         /* lib/font-size.ts가 (고른 크기 ÷ 13)을 넣는다. 12–18px 선택, 기본 13 */
  --fs-10: calc(10px * var(--font-scale)); --fs-11: calc(11px * var(--font-scale)); --fs-12: calc(12px * var(--font-scale));
  --fs-13: calc(13px * var(--font-scale)); --fs-14: calc(14px * var(--font-scale)); --fs-22: calc(22px * var(--font-scale));
  --fs-24: calc(24px * var(--font-scale));
  --lh-14: calc(14px * var(--font-scale)); --lh-16: calc(16px * var(--font-scale)); --lh-20: calc(20px * var(--font-scale));
}
@theme inline {
  /* shadcn 프리미티브의 text-* 유틸리티도 설정을 따른다. 13px에서는 Tailwind 기본값과 같다. */
  --text-xs: calc(12px * var(--font-scale)); --text-sm: calc(14px * var(--font-scale));
  --text-base: calc(16px * var(--font-scale)); --text-lg: calc(18px * var(--font-scale));
}
```

- 선택지: `[12, 13, 14, 15, 16, 17, 18]`, 저장 키 `localStorage["relay-font-size"]`.
- **함께 커지는 것**: 창 안의 글자·줄 높이(`--fs-*`, `--lh-*`), 한 줄짜리 글자 상자 높이(`calc(1em + 여백)`), 라벨 열 폭(`calc(120px * var(--font-scale))`), 줄바꿈 컨테이너 쿼리(`em` 기준).
- **px로 고정하는 것**(운영체제 화면처럼): 메뉴바, 드롭다운 메뉴, Dock, Dock 라벨, Radix 툴팁, 토스트(13px).
- 목록·상세 2단 전환 기준(640·900px)은 px 그대로.

### 5.4 위계 표

| 역할 | 크기 | 굵기 | 줄 높이 | 자간 | 색·기타 |
| --- | --- | --- | --- | --- | --- |
| 본문 UI | 13 | 400 | 1.5 | -.01em | |
| 메뉴바 글자·시계 | 13px 고정 | 400 / 앱명 600 | | | |
| 메뉴바 상태 글자 | 11px 고정 | | | | `--glass-text-muted` |
| 창 제목 | 13 | 600 | 20 | | 앱 아이콘 20px, gap 6 |
| 목록 제목(세션 이름) | 13 | 600 | 20 | | hover 시 `--link` + 밑줄(offset 3px) |
| 목록 요약(2줄 고정) | 12 | 400 | 16 | | `--glass-text-muted`, 높이 32px, `-webkit-line-clamp: 2` |
| 메타·캡션 | 11 | 400 | 16 | | `--glass-text-muted` 또는 `--muted-foreground` |
| 상세 제목 h2 | 22 | 600 | 1.4 | -.02em | `text-wrap: balance` |
| 환영·시작 제목 h3 | 24 | 600 | 1.4(시작 페이지 1.3) | -.02em | balance |
| 메모 제목 입력 | 24 | **700** | 1.35 | -.025em | 커서 `--notes-accent` |
| 폴더 보기 제목 | 24 | **700** | 1.3 | -.025em | |
| 섹션 제목 h3 | 13 | 600 | | | 아이콘 14px, gap 6, 아래 12px |
| 요약 본문 | 14 | 400 | 1.8 | | `--muted` 바탕 카드, `pre-wrap`, pretty |
| 그룹 제목(설정·최근 본 항목) | 11 | 600 | | .06em | `--muted-foreground` |
| eyebrow | 10 | | | .06em | `--muted-foreground` |
| 힌트 문단 | 11 | | 1.6–1.7 | | `--muted-foreground`, pretty |
| 배지 | 11 | 500 | 1 | | |
| 상태 배지 | 10 | 600 | 1 | .01em | 상태색 |
| 버튼 | 14(default) / 13(sm) / 12(xs) | 500 | 1 | | 상단바 주 단추는 600 |
| 탭(세그먼트) | 12 | 500 | 1 | | 개수는 10px, `opacity .6` |
| 툴팁·Dock 라벨 | 12px 고정 | 400 / Dock 500 | | | |
| 터미널 | `calc(12.5px * var(--font-scale))` mono | | 1.7 | 0 | |
| 버전 표기 | 11 | | | .06em | tabular-nums |
| 서식 본문(prose) | 14 | 400 | 1.8 | -.005em | §13.25 |

### 5.5 굵기 규칙

- UI는 **400(본문) · 500(버튼·강조·탭·폴더 이름) · 600(제목·목록 제목·현재 경로)** 세 가지가 기본.
- 예외: 메모 제목·폴더 보기 제목·서식 본문 제목·`strong`은 700, 서식 본문 h3는 650(가변 폰트 중간값).

### 5.6 줄바꿈·숫자·정렬 텍스트 규칙

- 한글 `word-break: keep-all`, 긴 경로·ID는 `overflow-wrap: anywhere`.
- 제목 `text-wrap: balance`, 문단 `text-wrap: pretty`.
- 한 줄: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. 여러 줄: `display: -webkit-box; -webkit-line-clamp: N; -webkit-box-orient: vertical; overflow: hidden`.
- 시각·건수·페이지·크기·버전은 `font-variant-numeric: tabular-nums`(`time`, `.pager`, `.statusbar`, `.version`, `.time-column`, `.timeline-meta`, 파일 열 등).
- 경로 표시(상태바 DB 경로)는 mono + 가운데 정렬 + 말줄임.

---

## 6. 간격과 정렬 규칙

### 6.1 "박스 안에서 쏠림 없이" 10원칙

1. **대칭 패딩** — 좌우 패딩은 항상 같다(버튼 14px, 배지 8px, 칩 10px, 행 16px). 왼쪽에 아이콘이 있는 버튼만 그쪽을 2px 줄여 광학 균형(`:has(> svg:first-child)` → default 12px, sm 10px).
2. **수직 중앙** — 높이 고정 요소는 `inline-flex; align-items: center` + `line-height: 1`. `padding-top/bottom`으로 맞추지 않는다.
3. **아이콘-텍스트** — 기본 아이콘 16px(메타 12px), `gap: 6px`, 아이콘 색 = 글자 색.
4. **행 내부** — 아바타(28px) 상단과 제목 첫 줄을 맞춘다(`align-items: flex-start`, 제목 `line-height: 20px`, 아바타 `margin-top: 1px`). 요약 32px(2줄)·메타 16px 고정 → 행 높이 일정.
5. **숫자** — tabular-nums, 오른쪽 정렬 숫자 열은 고정 폭.
6. **자름** — 위 §5.6.
7. **정렬 방향** — 목록·폼 라벨은 왼쪽, 숫자·시간은 오른쪽, 빈 상태·토스트·대화상자는 가운데. 한 박스 안에서 섞지 않는다.
8. **라벨-값 쌍** — 라벨 열 `calc(120px * var(--font-scale))` 고정(시간 표는 102px), 값이 세로 정렬선을 만든다.
9. **리듬** — 섹션 안쪽 16px, 섹션 사이 24px, 항목 사이 8px, 캡션-본문 4px.
10. **검증** — 2배 확대 스크린샷에서 상하·좌우 여백이 1px 이내로 대칭인지 본다. Pretendard 한글은 라틴보다 살짝 커서 혼용 시 세로 중심이 위로 쏠리는지 확인(필요하면 `padding-top: 1px` 광학 보정).

### 6.2 자주 쓰는 간격 값

기본 리듬은 4px 배수이고, 유리 크롬·카드에는 광학 보정용 홀수 값(7·10·14·18·22px)이 일부 있습니다.

| 위치 | 값 |
| --- | --- |
| 메뉴바 | 좌우 16, 요소 gap 12(오른쪽 묶음 4) |
| 창 상단바 | `0 12px 0 16px`, gap 12, 툴바 gap 8, 오른쪽 묶음 gap 12 |
| 창 조작 묶음 | gap 2, 왼쪽 12 + 세로 구분선 |
| 목록 행 | 바깥 `0 8px`, 안쪽 12, gap 12, 행 사이 구분선은 좌우 12 안쪽 |
| 목록 툴바·상태바·페이저 | 좌우 16(좁은 창 12), 상태바 gap 16 |
| 상세 | 상단 줄 `0 20px`, 머리 `24px 24px 16px`, 섹션 24(좁은 창 16), 액션 gap 8 |
| 필터 행 | `12px 16px`, gap 12, 필드 라벨-입력 gap 4 |
| 칩 행 | `8px 16px`, gap 8 |
| 설정 | 바깥 14, 그룹 사이 12, 그룹 제목 `0 16px`, 행 `6px 16px` gap 12, 안내 `4px 16px 8px` |
| 메모 | 사이드바 검색 `10px 10px 6px`, 트리 `4px 8px 12px`, 본문 시트 `22px 24px 0`, 서식 막대 `0 12px` |
| 파일 | 목록 `4px 12px 12px`, 아이콘 보기 `12px 14px 16px` gap 4, 홈 `24px 28px 28px` gap 28, 미리 보기 `18px 16px 16px` |
| 카드 | 메모 카드 `14px 16px 12px` gap 6, 즐겨찾기 `10px 12px` gap 12, 드라이브 `14px 16px` gap 14 |
| 격자 | 메모 카드 `minmax(196px,1fr)` gap 14, 최근 본 항목 `minmax(150px,1fr)` gap `18px 14px`, 즐겨찾기 `minmax(196px,1fr)` gap 10, 드라이브 `minmax(268px,1fr)`, 파일 아이콘 `minmax(104px,1fr)`, 바탕화면 견본 `minmax(88px,1fr)` gap `12px 10px` |
| 최대 폭 | 폴더 보기 960, 최근 본 항목 840, 시작 페이지 히어로 470, 환영 패널 380, 빈 상태 문구 320–360 |

---

## 7. 모서리 반경

| 토큰 | 값 |
| --- | --- |
| `--radius` | `.5rem` |
| `--radius-sm / md / lg / xl` (`@theme`) | `4px / 6px / 8px / 12px` |
| **`--radius-control`** | **`999px`** — 유리 컨트롤 공통(알약, 정사각 아이콘 단추는 원) |

`--radius-control` 적용 대상: `input`, `input-group`, `native-select`, `select-trigger`, `button`, `input-group-button`, `tabs-list`, `tabs-trigger`, 탭 thumb, `.window-control`, 주소창, 파일 찾기 칸, 세그먼트(`.files-segment`, `.format-mode`)와 그 버튼, 상단바 아이콘 버튼(메모·파일·브라우저), 경로 단추(`.files-crumb`), 서식 단추. **제외**: 여러 줄 입력(textarea 6px), 메뉴, 카드, 목록 행.

| 요소 | 반경 |
| --- | --- |
| 창 / 최대화 / 모바일 | 12 / 10 / 0 (최대화 전환 시 반경도 트윈) |
| Dock 캡슐 / Dock 항목 | 18 / 12 |
| 드롭다운 메뉴·Select 목록·서식 팝오버 | 10 (항목 6) |
| Dock 라벨 | 8 |
| 복사·갱신 토스트 | 999(알약) |
| 되살리기·파일 안내, 복사 폴백 | 12 |
| 설정 그룹 | 10 |
| 메모 카드·즐겨찾기·드라이브 카드·폴더 빈 상태·미리 보기 그림 칸 | 12 |
| 최근 본 항목 카드·미리 보기 글 칸·파일 아이콘 타일·즐겨찾기 아이콘 타일·일러스트 노드·코드 블록 | 10 (드라이브 아이콘 11) |
| 세션 행·요약·관계 카드·현재 세션·바탕화면 견본·아바타·그림 | 8 |
| 트리 행·파일 행·Select 항목·메뉴 항목·경로 코드 블록·빈 명령 상자 | 6 |
| 메뉴바 항목·트리 `…` 단추·타일 이름 알약·인라인 코드 | 5 |
| kbd·단축키 표시·경로 단추(메모)·트리 갈매기·이름 입력 | 4 |
| 사용량 막대 | 3 |
| 배지·상태점·Dock 표시점·삭제 `×` 버튼 | 999 / 50% |

---

## 8. 그림자와 깊이

| 요소 | 라이트 | 다크 |
| --- | --- | --- |
| 창(포커스) `--window-shadow` | `0 28px 60px -12px rgba(0,0,0,.38), 0 0 0 .5px rgba(0,0,0,.35)` | `0 30px 70px -12px rgba(0,0,0,.7), 0 0 0 .5px rgba(0,0,0,.55)` |
| 창(비포커스) `--window-shadow-dim` | `0 14px 30px -12px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.3)` | `0 15px 35px -12px rgba(0,0,0,.55), 0 0 0 .5px rgba(0,0,0,.45)` |
| Dock `--glass-shadow` | `0 12px 40px rgba(0,0,0,.28)` | `… .45` |
| 메뉴·토스트 `--glass-menu-shadow` | `0 20px 50px rgba(0,0,0,.30)` | `… .55` |
| 유리 하이라이트 | `inset 0 1px 0 rgba(255,255,255,.55)` | `… .14` |
| Dock 라벨 | 하이라이트 + `0 6px 18px rgba(0,0,0,.28)` | 동일 |

| 요소 | 그림자 |
| --- | --- |
| 탭 thumb | `0 1px 3px rgba(0,0,0,.12)` |
| 세그먼트 켜진 단추 | `0 1px 2px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.06)` |
| 카드 쉼 | 메모 `0 1px 2px rgba(0,0,0,.06)`, 최근 본 항목 `.08`, 즐겨찾기·드라이브 `.05` |
| 카드 hover | `translateY(-2px)` + `0 10px 24px rgba(0,0,0,.16)`(메모) / `.2`(최근) / `.14`(파일) |
| 바탕화면 견본 | `inset 0 0 0 1px var(--glass-control-border), 0 1px 2px rgba(0,0,0,.12)`, hover `0 4px 10px rgba(0,0,0,.18)` + `scale(1.04)` |
| 삭제 `×` 유리 단추 | `0 2px 6px rgba(0,0,0,.25)` |
| 앱 아이콘(Dock) | `filter: drop-shadow(0 2px 4px rgba(0,0,0,.35))` |
| 시작 페이지 큰 아이콘(72px) | `drop-shadow(0 10px 22px rgba(0,0,0,.35))` |
| 일러스트 중앙 노드 | `0 6px 16px color-mix(primary 45%)` |
| 즐겨찾기 타일 | `inset 0 1px 0 rgba(255,255,255,.35), 0 2px 6px rgba(0,0,0,.16)` |
| 드라이브 타일 | 라이트 `inset 0 1px 0 rgba(255,255,255,.8), 0 2px 6px rgba(0,0,0,.14)` / 다크 `… .12, … .4` |
| 파일 섬네일 | `0 1px 2px rgba(0,0,0,.12), 0 3px 10px rgba(0,0,0,.14)` |
| 미리 보기 미디어 | `0 4px 16px rgba(0,0,0,.2)` |
| 코드 블록 | `inset 0 0 0 1px rgba(255,255,255,.06)`(다크 `.08`) |

---

## 9. Z-index 레이어

| 레이어 | z |
| --- | --- |
| 바탕화면 | 0 |
| 창 레이어(`#desktop`) | 1 |
| 창 | 1–50(포커스 순서로 정규화, `MAX_Z = 50`) |
| ↳ 창 안: 클론 바탕 4 · 상세 패널/빈 상태 5 · 클론 6 · 분할 경계 6 · 오른쪽 리사이즈 핸들 7 · 창 안 토스트 5 | |
| Dock | 60 |
| 메뉴바 | 70 |
| 메뉴 오버레이(바깥 클릭 차단) | 89 |
| 드롭다운 메뉴·Select 목록·서식 팝오버 | 90 |
| Radix 툴팁·Dock 라벨 | 95 |
| 토스트·복사 폴백 | 100 |
| 본문 건너뛰기 링크 | 110 |

---

## 10. 치수 — 높이 공식과 고정 크기

### 10.1 한 줄 글자 상자: `height = calc(1em + 위아래 여백)`

글자 크기가 바뀌어도 여백이 지켜지도록 높이를 이 공식으로 잡습니다. 아래는 13px 기준 결과입니다.

| 요소 | 글자 | 공식 | 13px 결과 |
| --- | --- | --- | --- |
| Button `default` | 14 | `1em + 18px` | 32 |
| Button `sm` | 13 | `1em + 15px` | **28** |
| Button `xs` | 12 | `1em + 12px` | 24 |
| Input · InputGroup · NativeSelect(sm) · SelectTrigger(sm) | 13 | `1em + 15px` | **28** |
| InputGroup 안 입력 · Select 항목 · 링크 입력 | 13 | `1em + 13px` | 26 |
| 트리 행 · 파일 열 머리 | 13 | `1em + 15px` | 28 |
| 파일 행 | 13 | `1em + 14px` | 27 |
| 트리 이름 입력 | 13 | `1em + 9px` | 22 |
| 배지 | 11 | `1em + 9px` | 20 |
| 필터 칩 | 11 | `1em + 11px` | 22 |
| 상태 배지 · 종료 배지 | 10 | `1em + 8px` | 18 |
| kbd · 검색 단축키 | 11 | `1em + 7px` | 18 |
| 목록 툴바 · 상태바 · 메모 아래 줄 | 11 | `1em + 17px` | 28 |
| 파일 상태 줄 · 설정 그룹 제목 · 트리 안내 | 11 | `1em + 13px` | 24 |
| 메모 내용 위 줄(최소) | 11 | `1em + 23px` | 34 |
| 서식 보기 전환 단추 | 12 | `1em + 11px` | 23 |
| 경로 단추(파일) | 12 | `1em + 7px` | 19 |
| 빈 상태 명령 상자 | 12 | `1em + 20px` | 32 |

### 10.2 고정 크기(px)

| 요소 | 크기 |
| --- | --- |
| 메뉴바 | 높이 28(`--menubar-height`, 설치형 앱 제목 표시줄 통합 시 창 조작 버튼 높이·Windows 33) |
| 메뉴바 항목 | 높이 20 · 마크 24×20 · 아이콘 단추 28×20(아이콘 14) · 앱명·시계 `0 8px` |
| 창 상단바 | 최소 52(모바일 44) |
| 창 조작 단추 | 30×28, 아이콘 14 |
| 상단바 아이콘 단추 | 28×28, 아이콘 15 |
| 서식 도구 단추 | 30×30, 아이콘 16, 구분선 1×18 `margin 0 6px` |
| 서식 도구 막대 | 최소 44 |
| 목록 행 액션·페이저 단추 | 28×28 · 24×24 |
| 상세 상단 줄 · 페이저 | 40 |
| 설정 행 | 최소 36 |
| 세그먼트 단추(파일) | 28×22, 아이콘 14, 바깥 패딩 2 |
| 탭 리스트 | 패딩 3, thumb top/bottom 3 |
| 드롭다운 메뉴 | 최소 폭 200, 패딩 4, 항목 26 `0 10px` gap 8, 체크 열 12 |
| Select 항목 | `0 10px 0 30px`, 체크는 왼쪽 10px·12px |
| 툴팁 · Dock 라벨 | 높이 24, `0 10px`, 최대 폭 320, 꼬리 10×6 |
| 토스트 | 높이 40, 복사 `0 20px`, 갱신 `0 6px 0 16px` |
| 복사 폴백 | 폭 460(최대 `100vw - 40px`), 패딩 16 |
| Dock | 아이콘 48 → 최대 80, 막대 `7px 12px` gap 12, 아래 12, 표시점 4(아이콘 아래 2) |
| 모바일 탭바 | 높이 64 + `env(safe-area-inset-bottom)`, 아이콘 32, 라벨 10px |
| 아바타 | 28×28 |
| 상태점 | 연결 6 · 저장 6 · 필터 표시 5 · 타임라인 7(바깥 4px 바탕색 outline) |
| 선택 강조선 | 폭 2, 위아래 10 안쪽, 왼쪽 2 |
| 트리 | 갈매기 16(아이콘 12, 스트로크 2), 아이콘 15, `…` 단추 22, 들여쓰기 `depth × 16px` |
| 파일 열 | `minmax(0,1fr) 152px 136px 76px` |
| 파일 아이콘 보기 | 타일 그림 칸 76×64, 아이콘 48(폴더 56), 섬네일 최대 68×56 |
| 미리 보기 패널 | 폭 272, 그림 칸 168, 글 칸 208, 아이콘 72(폴더 84) |
| 즐겨찾기 / 드라이브 타일 | 36 / 46 |
| 사용량 막대 | 높이 6 |
| 일러스트 노드 | 40(중앙 48), 연결선 16 점선 |
| 바탕화면 삭제 단추 | 20(터치 24), 모서리 바깥 -7(-8) |
| 빈 상태 아이콘 | 40, `opacity .55` |

---

## 11. 아이콘과 자산

### 11.1 lucide 아이콘

```css
svg { flex-shrink: 0; }
svg[class*="lucide"] { stroke-width: 1.5px; }
```

| 크기 | 쓰임 |
| --- | --- |
| 11 | 경로 구분 갈매기, 열 정렬 화살표, 링크 배지 |
| 12 | 메타 줄·칩 닫기·상세 정보 아이콘·메뉴 체크 |
| 13 | 입력 안 아이콘, 토스트 안 버튼, 폴더 액션 |
| 14 | 메뉴바·창 조작·섹션 제목·세그먼트·빈 상태 액션 |
| 15 | 상단바 아이콘 단추, 트리 아이콘 |
| 16 | 기본(shadcn `size-4`), 서식 도구, 파일 목록 아이콘, 복사 성공 |
| 18 | 일러스트·현재 세션·즐겨찾기 타일 |
| 20–24 | 로딩 스피너, 드라이브 타일, 큰 일러스트 |
| 40 | 빈 상태 |

스트로크 예외: 트리 갈매기·열 화살표 2px, 즐겨찾기 타일 1.8px, 파일 빈 상태 1.2px, 큰 파일 아이콘 1.1px, 미리 보기 아이콘 1px.

### 11.2 앱 아이콘(PNG)

- 256px PNG, **squircle(n = 5 superellipse, 캔버스의 89%)**, 타일 영역 약 11–245px, 얕은 그림자는 아래로만.
- Dock에서는 `drop-shadow(0 2px 4px rgba(0,0,0,.35))`, 누르면 `scale(.95)`.
- 이미지를 바꾸면 주소에 판 번호(`?v=N`)를 붙여 브라우저 캐시를 피한다.
- 반투명 가장자리는 **premultiplied로 축소**해 밝은 바탕에서 회색 외곽선이 생기지 않게 한다.
- 설치형 앱 아이콘 192·512px.

### 11.3 마크·파비콘(인라인 SVG)

```svg
<!-- 파비콘 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0a5ce0"/>
  <path d="M10 24V8h7a5 5 0 0 1 1 10l5 6h-5l-5-6v6zm3-10h4a1 1 0 0 0 0-2h-4z" fill="#ffffff"/>
</svg>
```

메뉴바 마크는 같은 path를 `fill="currentColor"` 16px로 씁니다.

---

## 12. 상호작용 상태

| 상태 | 표현 |
| --- | --- |
| hover(유리 컨트롤) | `--glass-control-fill` → `--glass-control-hover`(약 +4%) |
| hover(목록 행·트리 행·경로 단추) | 바탕 `--glass-control-fill` |
| hover(카드) | `translateY(-2px)` + 큰 그림자, `.15s ease-out` |
| hover(메뉴 항목·Select 항목) | `--primary` 채움 + 흰 글자 |
| 열린 메뉴 트리거(메뉴바) | `--primary` 채움 + 흰 글자 |
| 선택(포커스 창) | `--selected` + 왼쪽 2px 파란 강조선(세션 행) |
| 선택(뒤 창) | `--selected-inactive` |
| 선택(목록에 키보드 초점) | `--primary` 채움, 글자 `#fff`, 보조 글자 `rgba(255,255,255,.92)` |
| 초점 | `outline: 2px solid var(--ring); outline-offset: 2px`(Dock 항목 offset 4). 트리·목록은 `inset 0 0 0 2px var(--ring)` |
| 입력 초점 | 바탕이 유리에서 불투명 `--background`로(주소창은 테두리도 `--ring`) |
| disabled | 버튼·메뉴 `opacity .45`, 창 조작 `.4`, 아이콘 단추 `.3`, 찾기 칸 `.5` |
| 비포커스 창 | 크롬 채움 dim, 그림자 dim, 창 조작·상단바 아이콘 `--glass-text-muted`, 폴더 아이콘 색 제거 |
| 닫기 버튼 hover | `--destructive` 채움 + 흰 아이콘 |
| 위험 메뉴 항목 hover | `--destructive` 채움 |
| 끌어 놓기 대상 | `--notes-drop` 바탕 + `inset 0 0 0 1.5px var(--primary)` |
| 끄는 중 | `opacity .45` |
| 숨김 항목 | `opacity .55` |
| 저장 상태 점 | 저장됨 초록 · 저장 중/불러오는 중 회색 · 오프라인/오류 노랑 · 거부 빨강 |
| 연결 점 | 연결 초록 · 확인 중 `--muted-foreground` · 끊김 `--destructive` |
| 행 액션 | 평소 `opacity 0`, 행 hover·초점 시 1(`@media (hover: none)`에서는 늘 1) |
| 테마 전환 순간 | `html[data-theme-switching] * { transition: none !important; }` 한 프레임 |

---

## 13. 컴포넌트 명세

### 13.1 Button

shadcn `buttonVariants`(cva)를 그대로 두고 CSS로 덮습니다.

```css
[data-slot="button"] { font-weight: 500; line-height: 1; box-shadow: none; border-radius: var(--radius-control);
  transition: background-color .15s ease-out, color .15s ease-out, border-color .15s ease-out; }
[data-slot="button"][data-size="default"] { height: calc(1em + 18px); padding-inline: 14px; }
[data-slot="button"][data-size="default"]:has(> svg:first-child) { padding-left: 12px; }
[data-slot="button"][data-size="sm"] { height: calc(1em + 15px); font-size: var(--fs-13); padding-inline: 12px; }
[data-slot="button"][data-size="sm"]:has(> svg:first-child) { padding-left: 10px; }
[data-slot="button"][data-size="xs"] { height: calc(1em + 12px); font-size: var(--fs-12); padding-inline: 10px; }
[data-slot="button"][data-variant="outline"] { background: var(--glass-control-fill); border-color: var(--glass-control-border); }
[data-slot="button"][data-variant="outline"]:hover { background: var(--glass-control-hover); }
[data-slot="button"][data-variant="link"] { color: var(--link); }
[data-slot="button"]:disabled { opacity: .45; }
```

- 변형: `default`(파란 채움, 화면에 하나), `secondary`, `outline`(유리 알약), `ghost`(가장 많이 씀), `link`, `destructive`.
- 크기: `default · sm · xs · lg · icon · icon-sm(32) · icon-xs(24) · icon-lg`. 실사용 빈도: ghost 33 · sm 28 · icon-sm 19 · outline 15 · xs 12 · secondary 10 · icon-xs 8.
- **상단바 안 변형**:
  - 주 단추(`default`): 바탕 `foreground 12%`(hover 18%), 글자 `foreground`, 600, 테두리 `--glass-control-border`.
  - 켜 둔 단추(`secondary`): 바탕 `primary 16%`(hover 24%), 글자 `primary`, 테두리 `primary 32%`.
- 복사 아이콘 버튼 패턴: `ghost` + `icon-sm` + 툴팁 + `aria-label`.

### 13.2 Input · InputGroup(검색칸·주소창)

```css
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"], [data-slot="textarea"] {
  box-shadow: none; border-radius: 6px; background: var(--glass-control-fill); }
[data-slot="input"], [data-slot="input-group"] { height: calc(1em + 15px); min-height: calc(1em + 15px); font-size: var(--fs-13); }
[data-slot="input-group-control"] { height: calc(1em + 13px); min-height: calc(1em + 13px); font-size: var(--fs-13); }
:root { --radius-control: 999px; }
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"], [data-slot="button"],
[data-slot="input-group-button"], [data-slot="tabs-list"], [data-slot="tabs-trigger"] { border-radius: var(--radius-control); }
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"] { border-color: var(--glass-control-border); }
[data-slot="input"]:hover, [data-slot="input-group"]:hover, [data-slot="native-select"]:hover { background: var(--glass-control-hover); }
[data-slot="input"]:focus-visible, [data-slot="native-select"]:focus-visible,
[data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible) { background: var(--background); }
[data-slot="input"] { padding-inline: 12px; }
[data-slot="input-group-addon"]:first-child { padding-left: 11px; }
```

- 텍스트에어리어만 6px 모서리(알약 제외).
- 검색칸: 왼쪽 돋보기 아이콘(13px, `--glass-text-muted`), 오른쪽 `/` 단축키 상자(kbd 18px, 좁은 창에서 숨김), placeholder `--glass-text-muted`.
- **주소창(`.address-field`)**: 알약, 유리 채움, 초점 시 `--background` + 테두리 `--ring`, 글자 12px `letter-spacing: 0` + 말줄임, 잘못된 값은 `--destructive` 글자, 최소 폭 140.
- 파일 찾기 칸: 폭 164(좁은 창 132), 글자 12px.

### 13.3 Select(Radix) · NativeSelect

- `SelectContent`는 기본 `position="item-aligned"` — **macOS 팝업 버튼처럼 열면 고른 항목이 버튼 글자 위에 겹친다.**
- 목록은 유리 메뉴 재질, 모서리 10, z 90.
- 항목: 높이 `1em + 13px`, `0 10px 0 30px`, 모서리 6, 체크는 **왼쪽 열**(10px 위치, 12px). 하이라이트는 `--primary` + 흰 글자.
- 트리거: 글자 13, `padding-inline: 12px 13px`, hover·열림 시 `--glass-control-hover`.
- 값에 따라 너비가 흔들리지 않도록 가장 긴 항목에 맞춘 최소 폭(`min-width: 9.5em`).
- NativeSelect: `padding-inline: 12px 30px`, 화살표 16px `opacity .5`.
- 터미널 위 NativeSelect: 바탕 `rgba(255,255,255,.08)`, 테두리 `.16`, 글자 `--terminal-fg`.

### 13.4 세그먼트 컨트롤 · 탭

세 종류 모두 **바깥 알약 안에 알약 thumb**이 움직이는 모양입니다.

| 종류 | 바깥 | 켜진 항목 |
| --- | --- | --- |
| 상세 탭(`.detail-tabs` = Radix TabsList) | 유리 채움 + 머리카락 테두리, 패딩 3, 좌우 margin 24 | 별도 `.tabs-thumb`(`--background`, `0 1px 3px rgba(0,0,0,.12)`)가 Flip으로 미끄러짐. Radix 트리거의 active 배경은 투명으로 |
| 서식 / Markdown(`.format-mode`) | 패딩 2, 유리 채움 + 테두리 | `aria-pressed="true"` → `--background` + 이중 그림자, 글자 12/500 |
| 목록 / 아이콘(`.files-segment`) | 패딩 2 | `aria-checked="true"` → `--background` + 이중 그림자, 아이콘 단추 28×22 |

thumb 배치 로직: 활성 트리거의 `offsetLeft/offsetWidth`를 thumb에 넣고, 바뀔 때만 `captureMove → place → playMove("fast")`. `ResizeObserver`로 폭이 바뀌면 애니메이션 없이 다시 맞춘다. 처음 놓이기 전에는 `opacity: 0`, 놓이면 `data-ready`.

### 13.5 Badge · 상태 배지 · 칩 · kbd

- 배지 공통: `height: calc(1em + 9px); padding: 0 8px; line-height: 1; font-size: var(--fs-11); font-weight: 500;` 모서리 999.
- 상태 배지(`[data-status]`): 10px/600/`.01em`, 높이 `1em + 8px`, `0 6px`, 글자 = 상태색, 테두리 = 상태색 45%.
- 응답 없음 배지: `--stale`, **점선 테두리** 55%.
- 종료 배지: 10px, `--glass-text-muted`.
- 필터 칩: 높이 `1em + 11px`, `0 10px`, gap 6, 유리 채움, 글자 `--foreground`, 닫기 아이콘 12px. 추가 시 `scale .9 → 1` 팝.
- kbd·단축키: 높이 `1em + 7px`, `0 5px`, 테두리 `--glass-control-border`, 모서리 4, 11px.

### 13.6 툴팁

- Radix Tooltip, `delayDuration = 0`(앱은 `TooltipProvider`에서 250ms), **화살표 없음**, 트리거에서 `sideOffset = 6`(macOS 툴팁처럼).
- 유리 메뉴 재질, z 95, 높이 24, `0 10px`, 12px, 최대 폭 320, 글자 `--foreground`. shadcn 기본 화살표(회전한 `bg-foreground` 정사각형)는 반투명 유리 위에서 두 겹으로 보이고 글자를 덮으므로 뺀다(함정 23).
- 등장·퇴장은 `tw-animate-css`의 `fade-in-0 zoom-in-95` / `slide-in-from-*`.

### 13.7 드롭다운 메뉴(`.desktop-menu`)

- `body`로 **포털**(메뉴바가 backdrop 루트라 그 안에 두면 유리가 창을 제대로 흐리지 못함).
- 전면 투명 오버레이(z 89)가 바깥 클릭을 삼켜 뒤 창이 눌리지 않게 하고, 닫을 때 오버레이는 즉시 걷고 메뉴는 종료 트윈 뒤 언마운트.
- 위치: 트리거 아래 6px, 좌우는 `max(4, min(left, innerWidth - 220))`.
- 구성: 최소 폭 200, 패딩 4, 모서리 10, 항목 26px(`0 10px`, gap 8, 모서리 6, 13px), 왼쪽 12px 체크 열, 구분선 `margin: 4px 6px; border-top: 1px solid var(--border)`.
- 키보드: ↑↓ 순환, Home/End, Esc(닫고 트리거로 초점 복귀), Tab(닫기). 첫 항목에 자동 초점.
- 역할: `role="menu"`, 항목 `menuitem` / `menuitemradio` + `aria-checked`.

### 13.8 토스트·안내

| 종류 | 위치 | 모양 | 모션 |
| --- | --- | --- | --- |
| 복사 토스트 | 화면 아래 가운데 `bottom: 104px`(모바일 76) | 알약 40px, `0 20px`, 13px, 초록 체크 16px | 진입 `y 16 · scale .96 → 1`, `back.out(1.4)` 220ms, 3초 뒤 `y 8` 페이드 160ms |
| 갱신 안내 | 메뉴바 아래 10px 가운데 | 알약 40px, `0 6px 0 16px`, 파란 아이콘 15, 오른쪽 `새로 고침` 버튼 | `update-drop .22s cubic-bezier(.2,.8,.2,1)` (위 -6px에서) |
| 창 안 안내(되살리기·파일 결과) | 창 아래 가운데 16 / 40px | 모서리 12, 12px, `6px 6px 6px 14px` | `notes-rise .22s` (아래 8px에서) |
| 복사 폴백 | 오른쪽 아래 20px, `bottom: 104px` | 유리 메뉴, 460px, 모서리 12, 안의 textarea는 `--background` | 진입 x 16, Esc 닫기 후 초점 복귀 |

모두 `role="status"` 텍스트를 유지합니다.

### 13.9 알림(Alert)·경고 줄

- shadcn Alert를 `margin: 12px; width: auto; background: var(--background)`로 창 안에 띄움. 등장 `enter(y 6)`.
- 브라우저 경고 줄(`.browser-notice`): `7px 10px 7px 16px`, 12px, 아래 머리카락 선, 바탕 `system-yellow 14%` in background, 노란 경고 아이콘 14px.

### 13.10 빈 상태

- **상세 빈 자리**: 가운데 정렬, gap 8, 아이콘 40px(`opacity .55`), 문구 13px muted 최대 320, 단축키 힌트 11px + kbd.
- **환영 패널**: 최대 380, `20px 24px`. 일러스트(40px 둥근 사각 노드 – 16px 점선 – 48px 파란 중앙 노드 – …), 제목 24/600, 문단 12/1.8 muted, 단계 목록(번호 mono 10px 20px 열 + 제목 12/600 + 설명 11), 링크형 액션 13/500 `--link`.
- **앱 빈 화면(메모·파일·시작 페이지)**: 위에서 퍼지는 강조색 radial 광원 + 아이콘 + 안내 + 두 단추(gap 8).
- **폴더 빈 상태**: 점선 테두리 카드, 모서리 12, 패딩 28, 12px 가운데.

### 13.11 설정 그룹

```text
section.settings-group        border 1px --border · radius 10 · bg background 82% · overflow hidden
├─ h3                         높이 1em+13px · 0 16px · 11px/600 · 자간 .06em · muted
├─ .settings-row × N          min 36 · 6px 16px · gap 12 · 위 머리카락 선 · 13px
│   ├─ :first-child           라벨 열 calc(120px × scale), nowrap
│   └─ 값                     flex 1 (버튼·배지·셀렉트는 flex 0 0 auto)
└─ p.settings-note            4px 16px 8px · 11px/1.6 · muted · pretty
```

바깥 창 본문은 `material-chrome`(유리) + 패딩 14, 그룹 사이 12. 라디오는 `accent-color: var(--primary)`.

### 13.12 창(Window)

```text
section.window[data-window][data-focused][data-maximized][data-closing]…   position fixed, transform translate(x,y)
├─ div.window-frame        absolute inset 0 · flex column · overflow hidden · radius 12 · 투명 바탕
│                           border 1px --window-edge · --window-shadow (비포커스 dim)
│   ├─ .titlebar.material-chrome
│   └─ .window-body        flex 1 · column · overflow hidden
└─ .resize-handle × 8       n/s 높이 6(좌우 12 안쪽) · w 폭 6 · e 폭 12(바깥 -10px, z 7) · 모서리 12×12(오른쪽은 22×12, 바깥 -10px)
```

- 오른쪽 핸들을 바깥으로 넓혀 스크롤바를 덜 가린다.
- 최대화: `top: var(--menubar-height); left/right 0; bottom: 104px`(모바일 64), 모서리 10.
- 드래그 중 `body[data-window-dragging]`: `user-select: none`, 프레임 transition 끔, iframe `pointer-events: none`.
- 상단바 더블클릭 = 최대화 토글. 드래그 핸들은 상단바 전체(버튼·입력 등 상호작용 요소 제외).

### 13.13 창 상단바·툴바

- `.titlebar`: 최소 52, `0 12px 0 16px`, gap 12, 아래 `1px --border`, `user-select: none`.
- 왼쪽 `.window-title`(앱 아이콘 20 + 13/600), 가운데 `.window-toolbar`(flex 1, gap 8 — 검색·필터·경로·주소창), 오른쪽 `.titlebar-actions`(gap 12) = 추가 단추 + 창 조작.
- 좁은 창에서 툴바는 `order: 3; flex-basis: 100%`로 제목 아래 줄로 내려가고 상단바는 `8px 12px` gap 8로 줄어든다.

### 13.14 창 조작 버튼

- 신호등이 아니라 **중립색 사각(알약) 아이콘 버튼 세 개**: 최소화(`Minus`)·최대화(`Square`, 최대화 상태면 `Copy`)·닫기(`X`).
- 30×28, 모서리 999, 아이콘 14, 묶음 gap 2 + 왼쪽 12px 세로 구분선(`--glass-control-border`).
- hover `--glass-control-hover`, active `--glass-control-fill`, **닫기 hover/active는 `--destructive` + 흰 아이콘**. 전환 `.12s ease-out`.
- 비포커스 창 `--glass-text-muted`. 모바일에서는 닫기만 보인다.
- `aria-label="<앱> 창 최소화"` 등, 최대화는 `aria-pressed`.

### 13.15 메뉴바

```text
header.menubar.material-bar   fixed top · 높이 28 · 0 16px · z 70 · 아래 1px --glass-bar-border · 13px
├─ 왼쪽(gap 12): Relay 마크 버튼(24×20) · 포커스 앱 이름 버튼(600) → 각각 드롭다운
└─ 오른쪽(gap 4): 연결 상태(6px 점 + 11px 글자) · 모드 라벨 11px · 테마 토글(해/달 14px) · 시계(ko-KR "10월 28일 (수) 15:47")
```

- 버튼 hover `--glass-control-hover`, 열림 `--primary` + 흰 글자, 모서리 5.
- 시계는 분 경계에 맞춰 갱신, `aria-label`에 전체 날짜.
- 테마 전환 시 해/달 아이콘 `rotate -90 → 0` + 페이드(120ms). 연결 상태 바뀌면 점 `scale 1 → 1.4 → 1`.
- 모바일: 연결 글자는 sr-only, 모드 라벨 숨김, 시계 좌우 4.

### 13.16 Dock

```text
nav.dock[aria-label=Dock]   fixed bottom 12 · 가운데 · z 60 · max-width calc(100% - 16px) · pointer-events none
└─ .dock-row (높이 64) > .dock-bar.material-dock (role=toolbar)   flex-end · gap 12 · 7px 12px · radius 18 · pointer-events auto
    └─ button.dock-item × N   폭 48(스프링) · radius 12
        ├─ .dock-icon > img.app-icon   aspect 1 · drop-shadow
        └─ .dock-dot                   4px · 아이콘 아래 2px · 열린 앱만 opacity .6
```

- **확대**: Framer Motion. 포인터와 아이콘 중심 거리 `[-150, 0, 150] → [48, 80, 48]`, `useSpring({ mass: .1, stiffness: 150, damping: 12 })`. 키보드 초점(`:focus-visible`)을 받은 아이콘도 80으로.
- **라벨은 Dock 전체에 하나**: 포인터에서 가장 가까운 아이콘(키보드 초점이 있으면 그 아이콘)을 따라 미끄러지며 글자만 바꾼다. 위치는 state가 아니라 **MotionValue**로 매 프레임 아이콘 위 34px(라벨 24 + 꼬리 6 + 여백 4)에 맞춘다. `body`로 포털(Dock의 backdrop 경계 밖). 등장 `opacity 0 · y 4 → 1 · 0` 120ms.
- 눌러서 생긴 초점은 라벨을 붙잡지 않는다.
- 실행 바운스: 닫힌 앱을 열 때만 `y 0 → -12 → 0` 2회(각 130ms, `power1.inOut`, 총 520ms). 앞으로 가져오기는 조용히.
- 창이 화면 아래 **104px**(`DOCK_RESERVED` = 아래 여백 12 + 막대 안쪽 7 + 최대 아이콘 80 + 5)를 비워 커진 아이콘이 최대화 창을 덮지 않는다.
- 모바일·동작 줄이기: 고정 크기. 모바일은 화면 아래 붙은 64px 탭바(모서리 0, 위 테두리 `--glass-border`, 아이콘 32 + 라벨 10px, 활성 라벨 `--primary`, 표시점 숨김).

### 13.17 분할 경계(SplitView)

```css
/* 자리는 1px, 양옆 1px씩 겹치는 3px 요소. 왼쪽 1px은 --border 선, 오른쪽 2px은 불투명 바탕(투명 창 틈 메우기) */
.split-handle { position: relative; z-index: 6; width: 3px; flex: 0 0 3px; margin: 0 -1px; outline: none;
  background: linear-gradient(to right, var(--border) 0 1px, var(--background) 1px); }
.split-handle::after { content: ""; position: absolute; inset: 0 -4px; }            /* 양옆 4px까지 잡힘 */
.split-handle::before { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; border-radius: 2px;
  transform: translateX(-50%); background: var(--primary); opacity: 0; transition: opacity .15s ease-out .08s; pointer-events: none; }
.split-handle:is([data-separator="hover"], [data-separator="active"], [data-separator="focus"])::before { opacity: .85; }
.split-handle[data-separator="active"]::before { transition-delay: 0s; }
```

- 왼쪽 패널은 px로 정하고 `groupResizeBehavior="preserve-pixel-size"` → 창 크기를 바꿔도 왼쪽 폭은 그대로.
- 크기: 세션 340(260–640, 오른쪽 최소 360) · 메모 256(200–480, 320) · 파일 240(168–520, 320). 기본 오른쪽 최소 280.
- 사용자가 끈 폭만 `localStorage["relay-split-v1"]`에 창마다 저장. **두 번 누르면 기본 폭**(라이브러리 더블클릭은 끄고 직접 구현).
- `role="separator"`, Tab 초점 + ←/→ 이동, `aria-label="<이름> 너비 조절"`.

### 13.18 트리(메모·파일 탐색 창 공용)

- `role="tree"`, 항목 `aria-level`·`aria-expanded`·`aria-selected`.
- 행: 높이 `1em + 15px`, `padding: 0 6px 0 calc(4px + depth × 16px)`, 모서리 6, gap 6, 13px, `cursor: default`, `user-select: none`.
- 갈매기 16px(펼치면 `rotate(90deg)` `.16s`), 아이콘 15px(폴더는 강조색), 이름 말줄임(폴더 500), 오른쪽 개수(11px tabular) — hover 시 개수 대신 `…` 메뉴 단추(22px, 터치 기기는 늘).
- 키보드: ↑↓ Home End, → 펼치기/첫 하위, ← 접기/상위, Enter, F2 이름 바꾸기, Delete, Shift+F10·메뉴 키.
- 이름 바꾸기 입력: 22px, `--ring` 테두리 + 3px 28% 링, `--background`.
- 끌어 놓기: 대상 폴더는 파란 테두리, 최상위는 트리 전체 테두리, 닫힌 폴더 위 650ms 머물면 펼침.

### 13.19 세션 목록 행

```text
li.session-row[data-flip-id]   margin 0 8 · padding 12 · gap 12 · radius 8 · flex-start
├─ .row-accent                 선택 시 2px 파란 막대(위→아래로 그려짐)
├─ .agent-avatar (28)          provider PNG 또는 첫 글자(유리 채움, radius 8, 16px)
├─ .row-main
│   ├─ .session-title-line     이름(13/600/20) + 상태·고정·응답 없음·종료 배지(gap 6)
│   ├─ .row-summary            12/16, 2줄 고정(32px), 위 4
│   └─ .compact-meta           11/16, 한 줄, gap 6, 셋째 칸만 줄어듦
├─ .source-column (168) / .time-column (104×scale)   640–899px 컨테이너에서만
└─ .row-action                 hover 시 나타나는 복사 버튼(28×28)
```

- 행 사이 구분선은 `::before`로 좌우 12px 안쪽에 두고, 선택·hover 행의 위아래 선은 투명 처리.
- 목록 툴바(건수 600 + 정렬 안내) 28px, 페이저 40px, 상태바 28px(총 건수 · mono DB 경로 · 버전 `.06em` · 마지막 조회).

### 13.20 상세 패널 부품

| 부품 | 명세 |
| --- | --- |
| 상단 줄 | 40px, `0 20px`, 11px muted, `← 목록`(12px) · 출처 |
| 머리 | `24px 24px 16px`, h2 22/600, 프로젝트 경로 12/16 muted + 폴더 아이콘 |
| 액션 | gap 8 wrap, 아래 11px 안내 문단 |
| 요약 카드 `.summary` | 패딩 16, `--muted`, 모서리 8, 14/1.8, `pre-wrap` |
| 정보 표 `.identity-grid` | gap 8, 라벨 120×scale 11px muted(아이콘 12) · 값 12/600 |
| 경로 블록 | 라벨 11 + mono 코드 상자(패딩 12, `--muted`, 모서리 6, 11/1.7) |
| 시간 표 | 라벨 102×scale, 아이콘 12 |
| 기술 정보 `details` | 위 선 + `+`/`−` 표시, dt 10px muted, dd 11px mono |
| 타임라인 | 왼쪽 1px 선, 항목 `0 0 24px 20px`, 점 7px(첫 항목 파랑, 나머지 `--input`, 바깥 4px 바탕색 outline), 메타 10px, 본문 12/1.8 |
| 세션 흐름 `.chain` | `depth × 16px` 들여쓰기, 현재 노드는 `--muted` 바탕 + `0 8px 8px 0` 모서리 + 파란 점 + `현재` 표시 |
| 관계 카드 | 패딩 12, 테두리, 모서리 8, 본문 11/1.7 muted |
| 현재 세션 상자 | 패딩 16, `--muted`, 모서리 8, 파란 아이콘 18 |

### 13.21 파일 목록·아이콘 보기·미리 보기

- 열 머리: 28px, 11/500 muted, 열 사이 1×14px 세로 선(배경 그라디언트로 그림), 정렬 중인 열은 `--foreground` + 화살표(내림차순 `rotate(180deg)`).
- 행: 27px, 모서리 6, 짝수 줄무늬 `foreground 3%`, 이름 13px + 아이콘 16 gap 8, 나머지 칸 12px muted tabular, 크기는 오른쪽 정렬. `content-visibility: auto; contain-intrinsic-size: auto 27px`로 수천 행도 가볍게.
- 아이콘 보기: 타일 패딩 `6px 4px 8px`, 모서리 10, 그림 칸 76×64(모서리 8), 이름 2줄(12/16, 모서리 5 알약). 선택 시 그림 칸 `--selected`, 초점 있으면 이름이 파란 알약.
- 미리 보기(272px): 그림 칸 168, 이름 14/600 가운데, 종류 11, 정보 `dl`(auto 1fr, gap `6px 12px`, 위 선), 액션 버튼 세로 gap 6(왼쪽 정렬).
- 이 PC 홈: 위에서 퍼지는 `primary 12%` 광원, 카드 + 사용량 막대.
- 상태 줄 24px 11px muted tabular.

### 13.22 카드

| 카드 | 바탕·테두리 | 모서리 | 기타 |
| --- | --- | --- | --- |
| 메모 카드 | `--muted` + `--border` | 12 | 최소 132, 제목 13/600 말줄임, 미리 보기 12/20 **3줄**, 날짜 11 아래 붙음(`margin-top: auto`) |
| 폴더 카드 | 강조색 9% 틴트 | 12 | 강조색 폴더 아이콘 22 |
| 최근 본 항목 | `--muted` + `--border` | 10 | 16:9 섬네일, 2줄 캡션(11/16), 모서리 `×` 단추 |
| 즐겨찾기 / 드라이브 | `--muted` + `--border` | 12 | 색 그라디언트 타일 36 / 금속 타일 46 + 6px 막대 |

공통 hover: `translateY(-2px)` + 큰 그림자(`.15s ease-out`), 초점 `2px --primary` outline offset 2.
클램프 상자에는 padding을 두지 않고 margin으로 여백을 준다(잘린 줄이 비치지 않도록).

### 13.23 경로 알약(브레드크럼)

- 알약 28px(`1em + 15px`), `0 4px`, 머리카락 테두리, 빈 곳을 누르면 경로 입력으로 바뀜(`Ctrl+L`·`Alt+D`).
- 단추 19px, `0 7px`, 12px `--glass-text-muted`, hover 유리 채움 + `--foreground`, 현재 폴더 600, 구분 갈매기 11px.
- 넘치면 앞쪽부터 `…` 하나로 접고(ResizeObserver로 다시 잼), 다 접어도 넘칠 때만 마지막 이름이 말줄임.
- 메모 위치 줄은 더 가벼운 판: 단추 `2px 5px`, 모서리 4, 갈매기 11px `opacity .6`.

### 13.24 터미널(명령 창)

```css
.window[data-window="command"] .window-frame { background: var(--terminal-bg); border-color: rgba(255,255,255,.16); }
.window[data-window="command"] .titlebar { background: #2b2b2f; border-bottom-color: rgba(255,255,255,.10); color: var(--terminal-fg); backdrop-filter: none; }
.terminal-body { padding: 16px; gap: 8px; color: var(--terminal-fg); font-family: var(--font-mono);
  font-size: calc(12.5px * var(--font-scale)); line-height: 1.7; letter-spacing: 0; }
.term-prompt { color: var(--terminal-prompt); }   .term-output { color: #b8b8c0; }   .term-comment { color: #8a8a94; }
.terminal-body [data-slot="button"] { font-family: var(--font-sans); background: rgba(255,255,255,.12); color: var(--terminal-fg); border-color: rgba(255,255,255,.16); }
.term-cursor { width: .64em; height: 1.12em; background: var(--terminal-fg); animation: term-blink 1s steps(2, start) infinite; }
@keyframes term-blink { to { visibility: hidden; } }
```

줄은 `$ 명령 … [복사]` 가로 배치이고, 컨테이너 43em 이하에서 세로로 쌓이며 버튼은 오른쪽 끝.

### 13.25 서식 본문(TipTap prose)

| 요소 | 값 |
| --- | --- |
| 본문 | 14px, 줄 높이 1.8, 자간 -.005em, 커서 강조색, 블록 사이 `.55em` |
| h1 / h2 / h3 | `14 × 1.55 / 1.3 / 1.12`, 700(h3 650), -.02em, 줄 높이 1.4, 위 `1.25 / 1.15 / 1em` |
| 링크 | `--link`, 밑줄 색 `link 40%`, offset 3px, 누르면 이동하지 않음(`cursor: text`) |
| 인라인 코드 | `.1em .38em`, 모서리 5, 테두리 + 유리 채움, `.86em` |
| 코드 블록 | `12px 16px`, 모서리 10, 터미널 바탕(다크 `#2b2b30`), mono 12/1.7 |
| 인용 | 왼쪽 3px 강조색 막대, `2px 0 2px 14px`, muted |
| 목록 | 들여쓰기 1.45em, disc → circle → square, 마커 `--glass-text-muted`, 항목 사이 `.15em` |
| 체크리스트 | 15px 체크 상자 `accent-color: 강조색`, gap 9, 완료 항목 muted + 취소선(60%) |
| 구분선 | `1.3em 0`, 1px `--border`(선택 시 강조색) |
| 표 | 고정 레이아웃, 13/1.6, 칸 `6px 10px` 1px 선, 머리 행 `--muted` 600, 선택 칸 `--selected` 덮개 |
| 빈 본문 안내 | `attr(data-placeholder)`, `foreground 30%` |

서식 도구 막대: 44px, 위아래 머리카락 선, `muted 55%` 바탕, 30px 유령 단추 묶음(구분선 1×18), 켜진 서식은 강조색 틴트(`aria-pressed`), 오른쪽 끝에 `서식 | Markdown` 세그먼트. 단추는 `mousedown`을 막아 편집기 초점·선택을 빼앗지 않는다. 좁은 창에서는 가로 스크롤(스크롤바 숨김).

### 13.26 바탕화면 견본 고르기·모서리 삭제 단추

- 격자 `repeat(auto-fill, minmax(88px, 1fr))`, gap `12px 10px`, 견본 16:9 모서리 8, 이름 11px(말줄임) gap 7.
- 선택: `outline: 2px solid var(--primary); outline-offset: 2px` + 이름 `--foreground` 500. hover `scale(1.04)`.
- 낮·밤 견본은 두 사진을 대각선 `clip-path: polygon(0 0, 100% 0, 0 100%)`로 나눠 보임.
- 추가 타일: 점선 `1.5px var(--input)` + `+` 아이콘 18.
- `role="radiogroup"` / 견본 `role="radio"` + `aria-checked`.
- **모서리 삭제 단추**(바탕화면·최근 본 항목 공용): 20px 원, 바깥 -7px, 유리(`--glass-menu-fill` + `blur(12px)` + `--glass-border`), 그림자 `0 2px 6px .25`, 평소 숨김 → 타일 hover/초점 시 나타남, 단추 hover는 `--destructive` + 흰 아이콘 + `scale(1.08)`. 호버 없는 기기는 24px로 늘 보임.

### 13.27 로딩

- 스켈레톤: shadcn `animate-pulse rounded-md bg-accent`, 목록 로딩은 `padding 16, gap 24`.
- 스피너: `LoaderCircle`(20–22px) `animation: browser-spin 1s linear infinite`, 새로 고침 아이콘도 `[data-spinning]`으로 회전.
- 플레이어 로딩: 검은 바탕 + 회색(`#b8b8c0`) 스피너·문구.

---

## 14. 모션

### 14.1 타이밍 토큰(`lib/motion.ts`)

```ts
export const MOTION = {
  micro: 0.12, fast: 0.16, base: 0.22, window: 0.26,
  stagger: 0.03, staggerMax: 0.3, tight: 0.02, bounce: 0.13, pulse: 0.6,
} as const;
export const EASE = {
  enter: "power3.out", exit: "power2.in", move: "power3.inOut",
  pop: "back.out(1.4)", bounce: "power1.inOut", decay: "power2.out",
} as const;
gsap.defaults({ ease: EASE.enter, duration: MOTION.base, overwrite: "auto" });
gsap.config({ force3D: true });
export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; // 매 호출 평가
export const dur = (key: keyof typeof MOTION) => (reduced() ? 0 : MOTION[key]);
```

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `micro` | 120ms | 툴팁·칩·강조선·상태점·메뉴 닫기·아이콘 회전 |
| `fast` | 160ms | 종료(닫기·페이드아웃), 탭 콘텐츠·thumb, 드래그 스냅 |
| `base` | 220ms | 진입, 메뉴 열기, 토스트, 상세 교체, 목록 재정렬, 높이 펼침 |
| `window` | 260ms | 창 열기·최소화·복원·최대화 |
| `stagger` | 30ms(총 300ms 상한) | 목록 행 · `tight` 20ms는 상세 머리글 |
| `bounce` | 130ms × 4 | Dock 실행 바운스 |
| `pulse` | 600ms | 갱신된 행·요약 배경 하이라이트 |

설계 감각: **짧고 절제**(120–280ms), 물리적 연속성(어디서 와서 어디로 가는지), 방향성(선택은 오른쪽으로 흐르고 닫힘은 안으로 사라짐), 튀지 않음. **transform·opacity만** 애니메이션(펼침 상자의 `height: auto`만 예외).

### 14.2 헬퍼 API

| 함수 | 동작 |
| --- | --- |
| `enter(el, { x, y = 8, scale, origin, duration = "base", ease, delay })` | `opacity 0 → 1` + 이동·확대, 끝나면 `clearProps` |
| `exit(el, { x, y, scale, duration = "fast" }) → Promise` | `opacity → 0`. 감소 모드면 즉시 숨기고 바로 resolve(언마운트 지연 없음) |
| `staggerIn(els)` | 행 순차 진입, `stagger.amount = min(.3, n × .03)`, 진행 중 `data-entering` |
| `pulse(el)` | 배경 `--pulse-tint` → 현재 배경색, 600ms `power2.out`, 진행 중 `data-pulsing` |
| `enterWindow(frame, delay)` | `y 14 · scale .94 → 1`, `transform-origin: 50% 100%`(Dock 쪽에서 떠오름), 260ms |
| `exitWindow(frame)` | `y 6 · scale .96 · opacity 0`, 160ms `power2.in` |
| `minimizeToDock / restoreFromDock` | Dock 아이콘 중심으로 `scale .12 · opacity 0` 빨려 들어감 / 역재생, 260ms |
| `settleFrame` | 진행 중인 종료·축소를 끊고 원위치(닫는 중 다시 열기) |
| `flipFrame(state, frame, radius)` | 최대화·복원을 Flip(`absolute: true, scale: false`)으로, 모서리 12 ↔ 10도 트윈 |
| `snapTo(from, to, onStep)` | 드래그 종료 후 화면 밖이면 클램프 위치로 160ms 스냅 |
| `captureRows / flipRows` | `[data-flip-id]` 행 재정렬 Flip(220ms `power3.inOut`), 새 행은 `y -8` 진입 |
| `captureMove / playMove` | 위치만 바뀌는 단일 요소(탭 thumb) 미끄러뜨리기 |
| `captureClone / fadeClone / dropClones` | 교체 직전 DOM을 떠서 덮고 `x -10` 페이드아웃, 300ms 가드로 반드시 제거 |
| `popIn` | `scale .9 → 1`, 120ms(칩) |
| `enterToast / exitToast` | `y 16 · scale .96`, `back.out(1.4)` / `y 8` |
| `enterMenu / exitMenu` | `y -6 · scale .98`, origin `top left`, 220ms / `y -4`, 120ms |
| `bounceIcon` | `y -12` 왕복 2회, CSS transition을 잠시 끔 |
| `growAccent` | 선택 강조선 `scaleY 0 → 1`(위에서 아래로), 120ms |
| `fadeDot` | 표시점 `opacity 0 → .6`, 120ms |
| `popScale` | `scale 1 → 1.4 → 1`(60ms yoyo) |
| `spinIn` | `rotate -90 → 0` + 페이드, 120ms |
| `expandHeight / collapseHeight` | 바깥은 `height 0 ↔ auto`(220ms `power3.inOut`), 안쪽은 제 높이 그대로 `opacity · y -6`. 접히는 중 다시 펼치면 지금 높이에서 이어감 |
| `bootDelay()` | 첫 로드에서 창을 60ms 간격으로 순차 진입 |

### 14.3 네 가지 패턴

1. **스토어 과도 상태** — 닫기·최소화는 `closing`/`minimizing` 플래그를 켜고(`data-closing` → `pointer-events: none`), 종료 트윈이 끝나면 `finalizeClose`/`finalizeMinimize`가 실제 상태를 바꾼다.
2. **클론 오버레이 크로스페이드** — `key` 교체로 리마운트되는 영역은 교체 직전 DOM을 `cloneNode(true)`로 떠서 같은 자리에 절대 배치(`aria-hidden` + `inert` + `pointer-events: none`, id·testid·name 제거)하고 페이드아웃. 두 겹이 동시에 반투명해지면 뒤가 비치므로 **불투명 바탕 한 장**(`.detail-clone-backdrop`)을 깔고 그 위에서 교차한다. React 상태는 건드리지 않는다. 클래스 컴포넌트 `Crossfade`(`getSnapshotBeforeUpdate`).
3. **FLIP** — 목록·타임라인 재정렬, 창 최대화, 세그먼트 thumb. `FlipList`는 커밋 직전 훅이 필요해 유일한 클래스 컴포넌트. `items` 참조가 바뀔 때만 캡처한다(React Query structural sharing 덕에 같은 내용의 폴링에서는 아무것도 움직이지 않음).
4. **펄스** — 폴링으로 내용이 바뀐 행·요약만 `--pulse-tint`에서 제 배경색으로 돌아온다.

### 14.4 전환 인벤토리(요약)

| 대상 | 전환 |
| --- | --- |
| 창 | 열기 A1(떠오름) · 닫기 A2(줄며 사라짐) · 최소화 A3(Dock으로) · 복원 A4(역재생) · 최대화 A5(Flip + 반경) · 드래그 A7(없음, 끝나면 스냅) · 모바일 전환 A8(들어오는 창 `x 12`, 나가는 창 페이드) |
| 목록 | 첫 로드·페이지 이동 B1(stagger) · 부분 변경 B2(Flip, 새 행 위에서 진입, 사라지는 행은 즉시) · 선택 B3(강조선) · 갱신 B4(펄스) · 오류 알림 B5(`y 6`) |
| 상세 | 교체 C1(클론 `x -10` 아웃 / 새 패널 `x 12` 인, 머리글 20ms stagger) · 탭 C2(thumb Flip + 콘텐츠 `y 6`) · 요약 갱신 C3(펄스 + 타임라인 삽입) |
| 메뉴·토스트 | 메뉴 D1 · Dock 라벨 D2 · 복사 토스트 D3 · 복사 폴백 D4 · Radix 툴팁 D5(tw-animate) |
| Dock | 실행 바운스 E1 · 표시점 E2 |
| 기타 | 필터 행 펼침 F1(높이) · 칩 F2(팝) · 테마 아이콘 F3(회전) · 연결 점 F4(팝) |

### 14.5 CSS 전환·키프레임

| 대상 | 값 |
| --- | --- |
| 버튼·세그먼트·카드·견본·삭제 단추·열 화살표 | `.15s ease-out` |
| 창 조작·목록 행·트리 행·경로 단추·행 액션·타일 칸 | `.12s ease-out` |
| 트리 갈매기 회전 | `.16s ease-out` |
| 분할 경계 막대 | `opacity .15s ease-out .08s`(끄는 중엔 지연 0) |
| 바탕화면 사진 | `opacity .3s ease-out`, 가려진 사진은 360ms 뒤 제거 |
| `update-drop` | `.22s cubic-bezier(.2,.8,.2,1)`, `from { opacity: 0; transform: translateY(-6px) }` |
| `notes-rise` | `.22s cubic-bezier(.2,.8,.2,1)`, `from { opacity: 0; transform: translate(-50%, 8px) }` |
| `browser-spin` | `1s linear infinite`, `to { transform: rotate(360deg) }` |
| `term-blink` | `1s steps(2, start) infinite`, `to { visibility: hidden }` |

### 14.6 동작 줄이기·안정성 규칙

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
  .term-cursor { visibility: visible; }
}
```

1. 감소 모드에서는 `dur()`이 0, Flip·펄스·클론을 모두 건너뛰고 즉시 반영. Dock은 고정 크기.
2. 애니메이션은 **초점·스크롤·URL을 바꾸지 않는다.**
3. 언마운트 지연 상한 300ms(클론 가드도 300ms).
4. 진행 중 트윈은 `overwrite: "auto"`로 정리 → 연타·닫는 중 다시 열기에도 상태가 어긋나지 않음.
5. 드래그·리사이즈 중에는 트윈을 만들지 않는다(60fps).
6. 트윈 대상은 `ref`로만 잡는다(예외: Dock 아이콘 좌표는 `[data-dock-item]`).
7. 테스트용 관찰점은 전역 노출 대신 `data-pulsing`·`data-entering`·`data-closing` 속성으로.

---

## 15. 레이아웃·창 관리·반응형

### 15.1 데스크톱 구조

```text
div.desktop (fixed inset 0, overflow hidden)
├─ div.wallpaper (z 0, aria-hidden) — 토큰 그라디언트 / 색상 프리셋 + 기본 사진 2장 + 고른 사진
├─ header.menubar (28px, z 70)
├─ main#desktop (창 레이어, z 1, 창 z 1–50)
│   └─ section.window[data-window] × N (role=region, aria-label="<앱> 창")
└─ nav.dock (z 60) + 토스트·복사 폴백 (z 100)
```

### 15.2 상수

| 상수 | 값 |
| --- | --- |
| `MENU_BAR_HEIGHT` | 28 |
| `DOCK_RESERVED` | 104 |
| `MOBILE_DOCK_HEIGHT` | 64 |
| `MOBILE_MAX_WIDTH` | 760(이하면 모바일 모드) |
| `CORNER_SIZE` / `EDGE_SIZE` | 12 / 6 |
| `GUIDE_MIN_VIEWPORT` | 1280(보조 창은 이 폭 이상에서만 기본으로 열림) |
| `MAX_Z` | 50 |
| 드래그 한계 | 가로 `[80 - w, innerWidth - 80]`(최소 80px는 화면에 남김), 세로 메뉴바 아래 ~ Dock 예약 위 |

### 15.3 기본 배치와 최소 크기(W·H = 뷰포트, free = H − 28 − 104)

| 앱 | x | y | w | h | 최소 |
| --- | --- | --- | --- | --- | --- |
| 세션 | 40 | 44 | min(1000, W−80) | min(720, free−24) | 640×440 |
| 가이드 | W−420 | 92 | 380 | min(560, free−100) | 320×360 |
| 명령 | (W−720)/2 | 180 | 720 | 360 | 480×240 |
| 메모 | 가운데 | 72 | min(920, W−80) | min(620, free−32) | 480×360 |
| 파일 탐색기 | 가운데 | 64 | min(1040, W−80) | min(660, free−24) | 520×360 |
| 설정 | (W−560)/2 | 120 | 560 | min(600, free) | 480×400 |
| YouTube | 가운데 | 84 | min(960, W−80) | min(640, free−40) | 480×360 |

배치는 `localStorage["relay-desktop-v1"]`에 저장하고, 읽을 때와 뷰포트가 바뀔 때 `clampBox`로 화면 안에 맞춘다.

### 15.4 컨테이너 쿼리(창 안쪽 반응)

창 프레임에 `container: <이름> / inline-size`를 걸어 **창 크기**로 반응합니다. 글자 크기와 엮인 줄바꿈은 `em`, 2단 배치는 `px`.

| 컨테이너 | 조건 | 변화 |
| --- | --- | --- |
| `sessions` | ≤ 899px | 목록·상세 중 하나만(상세가 목록 대체), 경계 숨김 |
| `sessions` | 640–899px(목록 상태) | 목록에 출처·시각 열 표시, 압축 메타 숨김 |
| `sessions` | ≤ 55.31em(13px에서 719px) | 상단바 줄바꿈, 툴바가 아랫줄로, 필터 세로 쌓기, 상세 여백 16 |
| `sessions` | ≤ 39.95em(519px) | 검색칸 한 줄 전체, 단축키 숨김, 상태바 축소, 여백 12 |
| `command` | ≤ 43em(559px) | 명령 줄 세로 쌓기 |
| `youtube` | ≤ 44em(572px) | 주소창 줄이 제목 아래로 |
| `notes` | ≤ 40em(520px) | 트리·내용 중 하나만, `목록` 뒤로 단추 |
| `files` | ≤ 46em(598px) | 탐색 창 숨김, 경로 줄이 아래로 |
| `files` | ≤ 34em | 찾기 칸 숨김 |
| `files-content` | < 54em | 미리 보기 숨김 |
| `files-main` | < 40em / < 29em | 종류 열 / 날짜 열 숨김(열 템플릿도 교체) |

### 15.5 모바일 모드(뷰포트 ≤ 760px, `.desktop[data-mobile]`)

- 창은 항상 최대화, 포커스 창 하나만 보임(나가는 창은 `data-leaving` 동안만 남음).
- 프레임 모서리 0, 테두리·그림자 없음. 상단바 44px. 최소화·최대화 단추 숨김.
- 블러 반경 축소(§4.3). Dock은 화면 아래 탭바(§13.16). 토스트 `bottom: 76px`.

---

## 16. 테마 시스템

- 값: `"dark" | "light" | "system"`, 저장 키 `localStorage["relay-theme"]`, **없으면 dark**.
- 적용: `<html class="dark">` 또는 `class="light"` + `style.colorScheme`. Tailwind v4 변형: `@custom-variant dark (&:where(.dark, .dark *));`
- **첫 페인트 전 선적용**(깜빡임 방지): CSP가 인라인 스크립트를 막으므로 별도 파일을 `<head>`에서 스타일시트 **앞에** 동기 로드.

```js
/* public/theme.js */
(function () {
  var root = document.documentElement, dark = true;
  try {
    var t = localStorage.getItem("relay-theme");
    dark = t === "light" ? false : t === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
  } catch (e) {}
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
```

```html
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b1024">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/style.css">
```

- 런타임 `applyTheme`: `html[data-theme-switching]`를 켜서 **한 프레임 동안 모든 transition을 끄고** 클래스·`color-scheme`·`theme-color`를 바꾼 뒤 다음 프레임에 해제. `system`이면 `matchMedia` 변경 구독.
- 메뉴바 토글은 명시 테마로 저장(system 해제), `aria-label`은 "라이트 모드로 전환"/"다크 모드로 전환".

---

## 17. 바탕화면

### 17.1 기본(토큰) 그라디언트

```css
.wallpaper { background: linear-gradient(180deg, var(--wp-sky-1) 0%, var(--wp-sky-2) 55%, var(--wp-glow) 100%); }
```

### 17.2 색상 프리셋(방향 그라디언트 + radial 하이라이트 한 겹)

| 이름 | 값 | 상단 띠 평균색(`--wallpaper-top` / `-end`) |
| --- | --- | --- |
| 그래파이트(**기본값**) | `radial-gradient(90% 70% at 80% 0%, rgba(255,255,255,.16), transparent 60%), linear-gradient(160deg, #55555e 0%, #2c2c32 55%, #141417 100%)` | `#54545b` / `#54545a` |
| 미드나이트 | `radial-gradient(70% 55% at 80% 100%, rgba(120,90,220,.35), transparent 70%), radial-gradient(120% 90% at 18% 0%, #3d5ab8 0%, #1c2d74 36%, #0d153f 68%, #070a1e 100%)` | `#253882` / `#101a4a` |
| 라벤더 | `radial-gradient(80% 60% at 20% 10%, rgba(255,255,255,.55), transparent 60%), linear-gradient(135deg, #efe2ff 0%, #c9b1f6 50%, #8a72e4 100%)` | `#dccbfa` / `#c0a8f4` |
| 선셋 | `radial-gradient(70% 60% at 75% 20%, rgba(255,236,200,.6), transparent 60%), linear-gradient(165deg, #ffd7a3 0%, #ff8d79 48%, #6a3ea6 100%)` | `#ffc59c` / `#ffb997` |
| 민트 | `radial-gradient(80% 60% at 20% 0%, rgba(255,255,255,.5), transparent 60%), linear-gradient(135deg, #e2fbf0 0%, #9ce2c5 50%, #2b9b78 100%)` | `#bfedda` / `#8cd8ba` |

상단 띠 평균색은 위 그라디언트를 렌더링해 잰 상단 32px의 평균이며, 그라디언트를 바꾸면 다시 잽니다(§19 제목 표시줄 색 계산에 사용).

### 17.3 사진·전환

- 선택지: 낮과 밤(테마 따라 두 사진을 불투명도로 전환) · 사진 4종(오로라·모래 언덕·유리 물결·안개 숲, 1280×720) · 색상 5종 · 내 사진(최대 20장, 25MB 이하, 긴 변 2560px 넘으면 JPEG로 축소, IndexedDB).
- 겹 순서: 토큰 그라디언트 → 기본 사진 2장 → 고른 사진. 고른 사진은 **로드가 끝난 뒤에만** 켜고(`loading → shown → leaving`) 가려진 사진은 360ms 뒤 제거.
- 사진 `object-fit: cover`, 모든 이미지 `draggable={false}`.

---

## 18. 접근성

- 초점 링 2px 시스템 블루(`outline-offset: 2px`), 얇은 오버레이 스크롤바 `scrollbar-width: thin; scrollbar-color: rgba(127,127,127,.4) transparent`.
- 랜드마크: `header`(메뉴바) · `main#desktop` · `nav[aria-label=Dock]` · 창마다 `section[role=region]`. 본문 건너뛰기 링크(평소 화면 밖 `top: -80px`, 초점 시 메뉴바 아래 8px에 32px 높이·모서리 8의 파란 상자로 등장).
- 드래그·리사이즈는 포인터 전용이므로 **키보드 대체 수단**(메뉴바 `창` 메뉴의 최소화·최대화·닫기·창 목록, Dock, 설정의 `창 배치 초기화`)을 둔다.
- 메뉴·트리·목록·세그먼트·분할 경계 모두 키보드 조작(§13). Dock 항목은 실제 `button`(Enter·Space).
- 아이콘만 있는 버튼은 `aria-label` + 툴팁. 장식 아이콘은 `aria-hidden`.
- 호버가 없는 기기(`@media (hover: none)`)에서는 hover 전용 컨트롤(행 액션, `…` 단추, 삭제 `×`)을 늘 보인다.
- `prefers-reduced-motion`·`prefers-reduced-transparency` 모두 대응.
- `/` 키로 검색에 초점(입력 중·IME 조합 중 제외), 상세를 닫으면 원래 링크로 초점 복귀.
- 모바일에서 숨긴 텍스트는 sr-only 패턴(`position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path: inset(50%)`).

---

## 19. 설치형 앱(PWA) 셸 디자인

- 매니페스트: `display: standalone`, `display_override: ["window-controls-overlay"]`, `launch_handler.client_mode: ["focus-existing", "auto"]`, `background_color`·`theme_color` `#0b1024`, 아이콘 192·512.
- **제목 표시줄 통합**: Window Controls Overlay가 켜지면 `html[data-titlebar]`와 `--menubar-height`(창 조작 버튼 높이)·`--titlebar-left`·`--titlebar-right`를 넣고, 메뉴바가 창을 옮기는 손잡이(`app-region: drag`, 버튼과 메뉴 오버레이는 `no-drag`)가 된다. 창 배치 제한과 최대화 창 위쪽도 같은 변수를 따른다.
- **`theme-color`를 메뉴바 유리의 겉보기 색에 맞추는 계산**(제목 표시줄과 메뉴바가 한 덩어리로 보이게):
  1. 유리 뒤 바탕화면 띠의 평균색을 잰다 — 사진은 `object-fit: cover` 배치 그대로 32×2 캔버스에 그려 평균, 색상 바탕화면은 `--wallpaper-top`(제목 표시줄을 숨긴 경우 오른쪽 끝 `--wallpaper-top-end`).
  2. 메뉴바 `backdrop-filter`의 `saturate(s)`를 CSS 필터 행렬로 적용:
     `R' = (.213+.787s)R + (.715−.715s)G + (.072−.072s)B`, `G' = (.213−.213s)R + (.715+.285s)G + (.072−.072s)B`, `B' = (.213−.213s)R + (.715−.715s)G + (.072+.928s)B`
  3. 메뉴바 반투명 채움 `rgba(r,g,b,a)`와 알파 합성: `out = fill × a + seen × (1 − a)`.
  4. 바탕화면·테마·창 크기·제목 표시줄 모드가 바뀔 때마다 다시 잰다.

---

## 20. 이식 가이드 — 스타터 코드와 체크리스트

### 20.1 스타터 CSS(그대로 복사해 시작)

Relay 전용 토큰(provider·wallpaper 일부)을 덜어 낸 휴대용 판입니다. Tailwind v4 + shadcn 프로젝트의 전역 CSS에 넣으면 토큰·재질·컨트롤 모양이 그대로 재현됩니다.

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));

@font-face {
  font-family: "Pretendard Variable";
  font-weight: 45 920; font-style: normal; font-display: swap;
  src: local("Pretendard Variable"), url("/fonts/PretendardVariable.woff2") format("woff2-variations");
}

:root {
  --background: #ffffff; --foreground: #1d1d1f;
  --card: #ffffff; --card-foreground: #1d1d1f;
  --popover: rgba(255, 255, 255, .95); --popover-foreground: #1d1d1f;
  --primary: #0a7cff; --primary-foreground: #ffffff;
  --secondary: #f2f2f7; --secondary-foreground: #1d1d1f;
  --muted: #f5f5f7; --muted-foreground: #6e6e73;
  --accent: #e8e8ed; --accent-foreground: #1d1d1f;
  --destructive: #d70015;
  --border: rgba(0, 0, 0, .10); --input: rgba(0, 0, 0, .14); --ring: #0a7cff;
  --link: #0a7cff; --radius: .5rem;
  --selected: rgba(10, 124, 255, .16); --selected-inactive: rgba(0, 0, 0, .07);
  --pulse-tint: rgba(10, 124, 255, .4);
  --system-green: #28c840; --system-yellow: #febc2e; --system-red: #ff5f57;
  --status-working: #0a7cff; --status-blocked: #d70015; --status-handoff: #b25e00; --status-done: #1a8a3c; --stale: #b25e00;
  --terminal-bg: #1c1c1e; --terminal-fg: #e5e5ea; --terminal-prompt: #30d158;
  --wp-sky-1: #a8d3ff; --wp-sky-2: #e6f0ff; --wp-glow: #ffd2a8;
  --glass-bar-fill: rgba(255, 255, 255, .55);
  --glass-dock-fill: linear-gradient(to bottom, rgba(255, 255, 255, .34), rgba(255, 255, 255, .18));
  --glass-chrome-fill: rgba(255, 255, 255, .64);
  --glass-chrome-dim: rgba(255, 255, 255, .76);
  --glass-menu-fill: rgba(255, 255, 255, .74);
  --glass-toast-fill: rgba(255, 255, 255, .72);
  --glass-control-fill: rgba(0, 0, 0, .05);
  --glass-control-hover: rgba(0, 0, 0, .09);
  --glass-control-border: rgba(0, 0, 0, .08);
  --glass-border: rgba(255, 255, 255, .45);
  --glass-bar-border: rgba(255, 255, 255, .35);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, .55);
  --glass-shadow: 0 12px 40px rgba(0, 0, 0, .28);
  --glass-menu-shadow: 0 20px 50px rgba(0, 0, 0, .30);
  --dock-tip-fill: rgba(246, 246, 248, .97); --dock-tip-border: rgba(0, 0, 0, .08);
  --window-edge: rgba(255, 255, 255, .28);
  --window-shadow: 0 28px 60px -12px rgba(0, 0, 0, .38), 0 0 0 .5px rgba(0, 0, 0, .35);
  --window-shadow-dim: 0 14px 30px -12px rgba(0, 0, 0, .28), 0 0 0 .5px rgba(0, 0, 0, .3);
  --glass-text-muted: color-mix(in srgb, var(--foreground) 62%, transparent);
  --menubar-height: 28px;
  --radius-control: 999px;
  --font-scale: 1;
  --fs-10: calc(10px * var(--font-scale)); --fs-11: calc(11px * var(--font-scale)); --fs-12: calc(12px * var(--font-scale)); --fs-13: calc(13px * var(--font-scale));
  --fs-14: calc(14px * var(--font-scale)); --fs-22: calc(22px * var(--font-scale)); --fs-24: calc(24px * var(--font-scale));
  --lh-14: calc(14px * var(--font-scale)); --lh-16: calc(16px * var(--font-scale)); --lh-20: calc(20px * var(--font-scale));
}
.dark {
  --background: #1e1e20; --foreground: #f5f5f7;
  --card: #242426; --card-foreground: #f5f5f7;
  --popover: rgba(40, 40, 42, .95); --popover-foreground: #f5f5f7;
  --primary: #0a84ff; --primary-foreground: #ffffff;
  --secondary: #2c2c2e; --secondary-foreground: #f5f5f7;
  --muted: #2a2a2d; --muted-foreground: #9a9aa0;
  --accent: #353538; --accent-foreground: #f5f5f7;
  --destructive: #ff453a;
  --status-working: #0a84ff; --status-blocked: #ff453a; --status-handoff: #ffb340; --status-done: #30d158; --stale: #ffb340;
  --border: rgba(255, 255, 255, .10); --input: rgba(255, 255, 255, .14); --ring: #0a84ff;
  --link: #409cff;
  --selected: rgba(10, 132, 255, .28); --selected-inactive: rgba(255, 255, 255, .08);
  --pulse-tint: rgba(10, 132, 255, .4);
  --wp-sky-1: #0b1024; --wp-sky-2: #2a1b45; --wp-glow: #ff7a45;
  --glass-bar-fill: rgba(22, 22, 24, .55);
  --glass-dock-fill: linear-gradient(to bottom, rgba(255, 255, 255, .14), rgba(255, 255, 255, .06));
  --glass-chrome-fill: rgba(36, 36, 40, .62);
  --glass-chrome-dim: rgba(36, 36, 40, .74);
  --glass-menu-fill: rgba(36, 36, 40, .68);
  --glass-toast-fill: rgba(44, 44, 48, .66);
  --glass-control-fill: rgba(255, 255, 255, .08);
  --glass-control-hover: rgba(255, 255, 255, .13);
  --glass-control-border: rgba(255, 255, 255, .10);
  --glass-border: rgba(255, 255, 255, .22);
  --glass-bar-border: rgba(255, 255, 255, .12);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, .14);
  --glass-shadow: 0 12px 40px rgba(0, 0, 0, .45);
  --glass-menu-shadow: 0 20px 50px rgba(0, 0, 0, .55);
  --dock-tip-fill: rgba(46, 46, 52, .97); --dock-tip-border: rgba(255, 255, 255, .12);
  --window-edge: rgba(255, 255, 255, .16);
  --window-shadow: 0 30px 70px -12px rgba(0, 0, 0, .7), 0 0 0 .5px rgba(0, 0, 0, .55);
  --window-shadow-dim: 0 15px 35px -12px rgba(0, 0, 0, .55), 0 0 0 .5px rgba(0, 0, 0, .45);
  --glass-text-muted: color-mix(in srgb, var(--foreground) 68%, transparent);
}
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border); --color-input: var(--input);
  --color-ring: var(--ring); --color-link: var(--link);
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, "SF Pro Text", "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace;
  --text-xs: calc(12px * var(--font-scale)); --text-sm: calc(14px * var(--font-scale)); --text-base: calc(16px * var(--font-scale)); --text-lg: calc(18px * var(--font-scale));
}
@layer base {
  * { border-color: var(--border); }
  body { margin: 0; color: var(--foreground); background: var(--background); font-family: var(--font-sans); font-size: var(--fs-13); font-weight: 400;
    line-height: 1.5; letter-spacing: -.01em; word-break: keep-all; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  button:not(:disabled), [role="button"]:not(:disabled), summary { cursor: pointer; }
  a { color: inherit; text-decoration: none; }
  button, a, summary { -webkit-tap-highlight-color: transparent; letter-spacing: inherit; }
  button:focus-visible, a:focus-visible, summary:focus-visible, li:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  svg { flex-shrink: 0; }
  svg[class*="lucide"] { stroke-width: 1.5px; }
  code, kbd { font-family: var(--font-mono); letter-spacing: 0; }
  time { font-variant-numeric: tabular-nums; }
  html[data-theme-switching] * { transition: none !important; }
  * { scrollbar-width: thin; scrollbar-color: rgba(127, 127, 127, .4) transparent; }
}

/* 유리 재질 */
.material-bar { background: var(--glass-bar-fill); backdrop-filter: blur(20px) saturate(180%); }
.material-dock { background: var(--glass-dock-fill); backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid var(--glass-border); box-shadow: var(--glass-highlight), var(--glass-shadow); }
.material-chrome { background: var(--glass-chrome-fill); backdrop-filter: blur(40px) saturate(170%); }
.material-menu, [data-slot="tooltip-content"], [data-slot="select-content"] { background: var(--glass-menu-fill); backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid var(--glass-border); box-shadow: var(--glass-highlight), var(--glass-menu-shadow); }
.material-toast { background: var(--glass-toast-fill); backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--glass-border); box-shadow: var(--glass-highlight), var(--glass-menu-shadow); }
.material-control { background: var(--glass-control-fill); border: 1px solid var(--glass-control-border); box-shadow: none; }
.material-control:hover { background: var(--glass-control-hover); }

/* shadcn 프리미티브 치수·모양 */
[data-slot="button"] { font-weight: 500; line-height: 1; box-shadow: none; transition: background-color .15s ease-out, color .15s ease-out, border-color .15s ease-out; }
[data-slot="button"][data-size="default"] { height: calc(1em + 18px); padding-inline: 14px; }
[data-slot="button"][data-size="default"]:has(> svg:first-child) { padding-left: 12px; }
[data-slot="button"][data-size="sm"] { height: calc(1em + 15px); font-size: var(--fs-13); padding-inline: 12px; }
[data-slot="button"][data-size="sm"]:has(> svg:first-child) { padding-left: 10px; }
[data-slot="button"][data-size="xs"] { height: calc(1em + 12px); font-size: var(--fs-12); padding-inline: 10px; }
[data-slot="button"][data-variant="outline"] { background: var(--glass-control-fill); border-color: var(--glass-control-border); }
[data-slot="button"][data-variant="outline"]:hover { background: var(--glass-control-hover); }
[data-slot="button"][data-variant="link"] { color: var(--link); }
[data-slot="button"]:disabled { opacity: .45; }
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"], [data-slot="textarea"] { box-shadow: none; border-radius: 6px; background: var(--glass-control-fill); }
[data-slot="input"], [data-slot="input-group"] { height: calc(1em + 15px); min-height: calc(1em + 15px); font-size: var(--fs-13); }
[data-slot="input-group-control"] { height: calc(1em + 13px); min-height: calc(1em + 13px); font-size: var(--fs-13); }
[data-slot="native-select"] { font-size: var(--fs-13); padding-inline: 12px 30px; }
[data-slot="native-select"][data-size="sm"] { height: calc(1em + 15px); min-height: calc(1em + 15px); }
[data-slot="select-trigger"] { font-size: var(--fs-13); padding-inline: 12px 13px; }
[data-slot="select-trigger"]:hover, [data-slot="select-trigger"][data-state="open"] { background: var(--glass-control-hover); }
[data-slot="select-trigger"][data-size="sm"] { height: calc(1em + 15px); }
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"], [data-slot="button"], [data-slot="input-group-button"],
[data-slot="tabs-list"], [data-slot="tabs-trigger"] { border-radius: var(--radius-control); }
[data-slot="input"], [data-slot="input-group"], [data-slot="native-select"], [data-slot="select-trigger"] { border-color: var(--glass-control-border); }
[data-slot="input"]:hover, [data-slot="input-group"]:hover, [data-slot="native-select"]:hover { background: var(--glass-control-hover); }
[data-slot="input"]:focus-visible, [data-slot="native-select"]:focus-visible,
[data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible) { background: var(--background); }
[data-slot="input"] { padding-inline: 12px; }
[data-slot="input-group-addon"]:first-child { padding-left: 11px; }
[data-slot="select-content"] { z-index: 90; border-radius: 10px; color: var(--foreground); }
[data-slot="select-item"] { height: calc(1em + 13px); padding: 0 10px 0 30px; border-radius: 6px; font-size: var(--fs-13); }
[data-slot="select-item"][data-highlighted] { background: var(--primary); color: #fff; }
[data-slot="select-item-indicator"] { left: 10px; right: auto; width: 12px; height: 12px; }
[data-slot="select-item-indicator"] svg { width: 12px; height: 12px; color: currentColor; }
[data-slot="tooltip-content"] { max-width: 320px; z-index: 95; color: var(--foreground); height: 24px; padding: 0 10px; display: flex; align-items: center; font-size: 12px; }
[data-slot="badge"] { height: calc(1em + 9px); padding: 0 8px; line-height: 1; font-size: var(--fs-11); font-weight: 500; }

@media (prefers-reduced-transparency: reduce) {
  .material-bar, .material-chrome, .material-dock, .material-menu, .material-toast, [data-slot="tooltip-content"], [data-slot="select-content"] {
    background: var(--background); backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

> 스타터의 스크롤바 규칙은 편의상 `*`에 걸었습니다. Relay 원본은 스크롤 영역 클래스에만 겁니다.

### 20.2 글자 크기 설정 스타터

```ts
export const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18] as const;
export function applyFontSize(size: number) {
  document.documentElement.style.setProperty("--font-scale", String(size / 13));
}
```

### 20.3 이식 체크리스트

- [ ] Pretendard Variable woff2 + `OFL.txt`를 로컬 자산으로 둔다(원격 폰트 금지).
- [ ] `theme.js`를 `<head>`에서 스타일시트 앞에 동기 로드한다(다크 기본).
- [ ] 스타터 CSS를 넣고 shadcn 프리미티브는 손대지 않는다(`[data-slot]`로만 덮기).
- [ ] 크롬(상단바·사이드바·상태바)은 `material-chrome`, 내용 패널은 `--background`.
- [ ] 메뉴·팝오버·Dock 라벨은 `body`로 포털한다.
- [ ] 강조색은 하나, 파란 채움 버튼은 화면에 하나.
- [ ] 한 줄 상자 높이는 `calc(1em + N)`, 좌우 패딩 대칭, 아이콘 쪽 2px 광학 보정.
- [ ] 보조 글자: 유리 위 `--glass-text-muted`, 불투명 위 `--muted-foreground`.
- [ ] 숫자는 tabular-nums, 한글 keep-all, 긴 토큰 anywhere.
- [ ] `lib/motion.ts`(토큰 + 헬퍼)를 그대로 가져오고 값 하드코딩 금지, `dur()`로 감소 모드 대응.
- [ ] 창 안 반응은 컨테이너 쿼리, 글자 크기와 엮인 기준은 `em`.
- [ ] 다크·라이트·모바일 스크린샷으로 §2 기준을 판정한다.

---

## 21. 함정 모음(실제로 겪은 문제와 해법)

| # | 증상 | 원인 | 해법 |
| --- | --- | --- | --- |
| 1 | 드롭다운의 유리가 뒤 창을 흐리지 못함 | 부모(메뉴바)에 `backdrop-filter`가 있으면 자식의 backdrop 루트가 부모가 됨 | 메뉴·라벨을 `body`로 포털 |
| 2 | 펼침 애니메이션 중 안쪽 유리가 비치지 않음 | 부모가 `opacity < 1`이면 자식 `backdrop-filter`가 뒤를 못 봄 | 불투명도는 **안쪽(첫 자식)**에만 주고 바깥은 높이만 트윈 |
| 3 | 펼칠 때 입력칸 아랫부분만 잘려 보이고 패딩만큼 튐 | 안쪽 행 자체 높이를 줄임 | 감싼 상자(`.advanced-reveal`)만 `height 0 ↔ auto`, 행은 제 높이 유지 |
| 4 | 분할 경계 틈으로 뒤 창 글자·바탕화면이 비침 | 창 바탕이 투명 + 반투명 선 + 소수점 px 경계 | 3px 핸들(왼쪽 1px 선 + 오른쪽 2px 불투명 바탕)로 메움 |
| 5 | 크로스페이드 중 뒤 배경이 비침 | 두 겹이 동시에 반투명 | 불투명 바탕 한 장을 깔고 그 위에서 교차 |
| 6 | 줄 클램프 상자 아래 잘린 줄이 살짝 보임 | 클램프 상자에 padding | 여백은 margin으로 |
| 7 | 고정폭 칸의 한글이 넓고 어색함 | 고정폭 글꼴에 한글 글리프 없음 | 폰트 스택에 Pretendard를 끼움 |
| 8 | Dock 라벨이 아이콘 사이를 지날 때 깜빡임 | 아이콘마다 라벨을 띄우고 지움 | 라벨 하나를 가까운 아이콘으로 미끄러뜨림 |
| 9 | Dock 확대 중 라벨 위치가 뒤처지거나 리렌더 폭주 | 위치를 React state로 | MotionValue + rAF로 매 프레임 맞춤 |
| 10 | 서식 도구에서 Select를 쓰면 바로 친 글자가 엇나감 | Radix Select가 닫힐 때 초점을 늦게 돌려줌 | 아이콘 단추로 대체, `mousedown` 막기 + `view.focus()` |
| 11 | CSP에서 TipTap 기본 스타일이 사라짐 | `style-src 'self'`가 인라인 `<style>` 차단 | `injectCSS: false` + ProseMirror 규칙을 CSS 파일로 |
| 12 | 테마 전환 순간 모든 요소가 따로 전환되며 번쩍임 | transition이 색 변화에 반응 | `html[data-theme-switching]`로 한 프레임 transition 끔 |
| 13 | 첫 페인트에 흰 화면이 번쩍임(FOUC) | 테마 적용이 JS 번들 뒤 | 별도 `theme.js`를 `<head>`에서 동기 로드 |
| 14 | 값에 따라 선택 버튼 너비가 출렁임 | 내용 폭에 맞춰짐 | 가장 긴 값 기준 `min-width`(em) |
| 15 | 큰 목록 스크롤이 무거움 | 수천 행 레이아웃 | `content-visibility: auto; contain-intrinsic-size: auto 27px` |
| 16 | 아이콘을 바꿔도 예전 그림이 보임 | 하루 캐시 | 주소에 `?v=<판 번호>` |
| 17 | 생성 아이콘이 밝은 바탕에서 회색 외곽선 | 반투명 가장자리를 검정과 섞어 축소 | 바깥 색을 안쪽 이웃 색으로 번져 채운 뒤 premultiplied 축소 |
| 18 | 창을 끄는 동안 iframe이 포인터를 삼킴 | iframe이 이벤트를 가져감 | 드래그 중 `body[data-window-dragging] iframe { pointer-events: none }` |
| 19 | 같은 내용의 폴링에도 목록이 움직임 | 매번 새 배열 참조 | 구조적 공유(React Query) + 참조가 바뀔 때만 Flip |
| 20 | 닫는 중 다시 열면 창이 반쯤 투명하게 멈춤 | 진행 중 트윈과 새 상태 충돌 | `overwrite: "auto"` + `settleFrame`으로 원위치 |
| 21 | 툴팁을 단 버튼만 `[data-slot="button"]` 규칙(크기·알약·변형)이 빠짐 | shadcn `TooltipTrigger`(`asChild`)가 자기 `data-slot="tooltip-trigger"`를 자식에 합쳐 Button의 `data-slot="button"`을 덮어씀 | 툴팁 래퍼는 `data-slot`이 없는 Radix `Tooltip.Trigger`를 직접 쓴다(스타터 키트 `patterns/tip.tsx`). Relay에도 잠재해 있는 문제 |
| 22 | `mt-4` 같은 Tailwind 유틸리티가 패턴 클래스 위에서 안 먹음 | 컴포넌트 CSS가 cascade layer 밖이라 `@layer utilities`보다 강함 | 패턴 클래스가 정한 속성은 감싸는 요소로 조정하거나, 그 속성을 패턴에서 빼 둔다(예: 격자의 `margin: 0`) |
| 23 | 툴팁 화살표(마름모)가 툴팁 글자를 덮음 | shadcn 화살표는 회전한 정사각형(`bg-foreground`)이고 `span` 안에 있어 `> svg` 덮어쓰기가 닿지 않음. 반투명 유리와 겹친 자리는 두 겹으로 보임 | 화살표를 빼고 `sideOffset` 6px(macOS 툴팁처럼) |

---

## 22. 원본 파일 맵

| 파일 | 내용 |
| --- | --- |
| `src/web/styles.css` | 토큰·재질·프리미티브 덮어쓰기·모든 컴포넌트 CSS·컨테이너 쿼리(정본) |
| `src/web/lib/motion.ts` | 모션 토큰·이징·헬퍼 |
| `src/web/components/transitions.tsx` | `FlipList`, `Crossfade` 클래스 컴포넌트 |
| `src/web/components/ui/*` | shadcn 프리미티브(수정 없음) + `dock.tsx`(Framer Motion Dock) |
| `src/web/components/desktop/*` | 바탕화면·메뉴바·메뉴·창·상단바·창 조작·Dock·SplitView·앱 아이콘·드래그/리사이즈 훅 |
| `src/web/lib/app-config.ts` | 레이아웃 상수, 앱 목록·기본 배치·최소 크기 |
| `src/web/lib/desktop-store.ts` | 창 상태·클램프·영속화 |
| `src/web/lib/theme.ts`, `public/theme.js` | 테마 |
| `src/web/lib/font-size.ts` | 글자 크기 설정 |
| `src/web/lib/wallpaper.ts`, `components/desktop/wallpaper.tsx` | 바탕화면 선택·전환 |
| `src/web/lib/pwa.ts` | 제목 표시줄 통합·`theme-color` 계산 |
| `src/web/DESIGN.md`, `DESIGN-IMPLEMENTATION.md` | 디자인 시스템 요약과 적용 결정 |
| `.tasks/desktop-design.md`, `.tasks/motion-design.md` | 초기 설계 근거(관찰값·전환 인벤토리·감사 기준) |
