import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { applyFontSize, readFontSize, type FontSize } from "./font-size";
import { applyTheme, isDark, readTheme, watchSystemTheme, type Theme } from "./theme";
import { readWallpaper, writeWallpaper, type WallpaperChoice } from "./wallpaper";

/** 모양 설정(테마·글자 크기·바탕화면). 바꾸면 곧바로 적용하고 저장한다. */
interface UIState {
  theme: Theme;
  fontSize: FontSize;
  wallpaper: WallpaperChoice;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setWallpaper: (choice: WallpaperChoice) => void;
}

export const useUI = create<UIState>((set) => ({
  theme: readTheme(),
  fontSize: readFontSize(),
  wallpaper: readWallpaper(),
  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  setFontSize: (fontSize) => { applyFontSize(fontSize); set({ fontSize }); },
  setWallpaper: (wallpaper) => { writeWallpaper(wallpaper); set({ wallpaper }); },
}));

/** 지금 다크로 보이는지. 테마가 system이면 운영체제 설정이 바뀔 때 함께 다시 그리고 클래스도 맞춘다. */
export function useIsDark() {
  const theme = useUI((state) => state.theme);
  const systemDark = useSyncExternalStore(
    (onChange) => watchSystemTheme(() => { if (useUI.getState().theme === "system") applyTheme("system", false); onChange(); }),
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return theme === "system" ? systemDark : isDark(theme);
}
