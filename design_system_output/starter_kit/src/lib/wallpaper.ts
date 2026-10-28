/** 바탕화면 선택: 낮과 밤(테마를 따라 두 사진) · 사진 · 색상. 색상 그라디언트 값은 shell.css의 [data-color] 규칙 한 곳에 있다. */
export type PresetId = "aurora" | "dunes" | "waves" | "forest";
export type ColorId = "graphite" | "midnight" | "lavender" | "sunset" | "mint";
export type WallpaperChoice = { kind: "dynamic" } | { kind: "preset"; id: PresetId } | { kind: "color"; id: ColorId };

export const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: "aurora", label: "오로라" }, { id: "dunes", label: "모래 언덕" }, { id: "waves", label: "유리 물결" }, { id: "forest", label: "안개 숲" },
];
export const COLORS: readonly { id: ColorId; label: string }[] = [
  { id: "graphite", label: "그래파이트" }, { id: "midnight", label: "미드나이트" }, { id: "lavender", label: "라벤더" }, { id: "sunset", label: "선셋" }, { id: "mint", label: "민트" },
];

export const WALLPAPER_KEY = "app-wallpaper";
/** 기본은 그래파이트: 다크·라이트 어느 쪽 유리와도 대비가 무난하다. */
export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "color", id: "graphite" };
export const DAY_PHOTO = "/wallpapers/day.jpg";
export const NIGHT_PHOTO = "/wallpapers/night.jpg";
export const presetUrl = (id: PresetId) => `/wallpapers/${id}.jpg`;

export function sameChoice(a: WallpaperChoice, b: WallpaperChoice) {
  return a.kind === b.kind && (a.kind === "dynamic" || ("id" in b && a.id === b.id));
}

export function readWallpaper(): WallpaperChoice {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLPAPER_KEY) ?? "null") as { kind?: string; id?: string } | null;
    if (parsed?.kind === "dynamic") return { kind: "dynamic" };
    if (parsed?.kind === "preset" && PRESETS.some((preset) => preset.id === parsed.id)) return { kind: "preset", id: parsed.id as PresetId };
    if (parsed?.kind === "color" && COLORS.some((color) => color.id === parsed.id)) return { kind: "color", id: parsed.id as ColorId };
  } catch { /* 잘못 저장된 값은 기본값으로 */ }
  return DEFAULT_WALLPAPER;
}

export function writeWallpaper(choice: WallpaperChoice) {
  try { localStorage.setItem(WALLPAPER_KEY, JSON.stringify(choice)); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
}
