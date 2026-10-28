/** 데스크톱 셸 치수. CSS(shell.css)와 같은 값을 쓴다. */
export const MENU_BAR_HEIGHT = 28;
/** 창이 비워 두는 화면 아래 높이. Dock 아래 여백 12 + 막대 안쪽 여백 7 + 가장 커진 아이콘 80 = 99에 5px를 더해, 커진 아이콘이 창을 덮지 않는다. */
export const DOCK_RESERVED = 104;
export const MOBILE_DOCK_HEIGHT = 64;
/** 이 너비 이하면 모바일 모드: 창은 늘 최대화·하나만, Dock은 탭바. */
export const MOBILE_MAX_WIDTH = 760;
export const MAX_Z = 50;

export type Box = { x: number; y: number; w: number; h: number };

/** 메뉴바 높이. 설치형 앱이 제목 표시줄 자리를 쓰면 CSS 변수가 바뀌므로 그 값을 읽는다. */
export function menuBarHeight() {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--menubar-height"));
  return Number.isFinite(value) && value > 0 ? value : MENU_BAR_HEIGHT;
}

export const isMobileWidth = (width: number) => width <= MOBILE_MAX_WIDTH;
export const reservedBottom = (mobile: boolean) => (mobile ? MOBILE_DOCK_HEIGHT : DOCK_RESERVED);
