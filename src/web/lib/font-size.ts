/** 창 안의 글자 크기(px). 13px이 기본이고, styles.css의 --fs-*·--lh-* 토큰이 고른 크기 ÷ 13(--font-scale)을 곱해 함께 커진다. */
export const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const DEFAULT_FONT_SIZE: FontSize = 13;
export const FONT_SIZE_KEY = "relay-font-size";

export function readFontSize(): FontSize {
  try {
    const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
    const size = FONT_SIZES.find((value) => value === stored);
    if (size) return size;
  } catch { /* 저장소를 못 읽으면 기본값을 쓴다. */ }
  return DEFAULT_FONT_SIZE;
}

export function applyFontSize(size: FontSize, persist = true) {
  document.documentElement.style.setProperty("--font-scale", String(size / DEFAULT_FONT_SIZE));
  if (persist) try { localStorage.setItem(FONT_SIZE_KEY, String(size)); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
}
