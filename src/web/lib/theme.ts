export type Theme = "dark" | "light" | "system";

export const THEME_KEY = "relay-theme";
const THEME_COLOR = { dark: "#0b1024", light: "#a8d3ff" };
const QUERY = "(prefers-color-scheme: dark)";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch { /* 저장소를 못 읽으면 기본값을 쓴다. */ }
  return "dark";
}

export function isDark(theme: Theme) {
  return theme === "system" ? window.matchMedia(QUERY).matches : theme === "dark";
}

/** 클래스·color-scheme·theme-color를 한 번에 맞춘다. 전환 순간의 트랜지션은 한 프레임 끈다. */
export function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement;
  const dark = isDark(theme);
  root.dataset.themeSwitching = "";
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  if (persist) try { localStorage.setItem(THEME_KEY, theme); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
  requestAnimationFrame(() => { delete root.dataset.themeSwitching; });
}

export function watchSystemTheme(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
