export type PresetId = "aurora" | "dunes" | "waves" | "forest";
export type ColorId = "graphite" | "midnight" | "lavender" | "sunset" | "mint";
/** 기본은 테마에 따라 낮·밤 사진이 바뀐다. 사진·색상은 테마와 무관하고, 내 사진은 브라우저(IndexedDB)에만 있다. */
export type WallpaperChoice = { kind: "dynamic" } | { kind: "preset"; id: PresetId } | { kind: "color"; id: ColorId } | { kind: "custom" };

export const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: "aurora", label: "오로라" }, { id: "dunes", label: "모래 언덕" }, { id: "waves", label: "유리 물결" }, { id: "forest", label: "안개 숲" },
];
export const COLORS: readonly { id: ColorId; label: string }[] = [
  { id: "graphite", label: "그래파이트" }, { id: "midnight", label: "미드나이트" }, { id: "lavender", label: "라벤더" }, { id: "sunset", label: "선셋" }, { id: "mint", label: "민트" },
];
export const WALLPAPER_KEY = "relay-wallpaper";
export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "dynamic" };
export const presetUrl = (id: PresetId) => `/wallpapers/${id}.jpg`;

export function sameChoice(a: WallpaperChoice, b: WallpaperChoice) {
  return a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);
}

export function wallpaperLabel(choice: WallpaperChoice) {
  if (choice.kind === "preset") return PRESETS.find((preset) => preset.id === choice.id)?.label ?? "사진";
  if (choice.kind === "color") return COLORS.find((color) => color.id === choice.id)?.label ?? "색상";
  return choice.kind === "custom" ? "내 사진" : "기본";
}

export function readWallpaper(): WallpaperChoice {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLPAPER_KEY) ?? "null") as { kind?: unknown; id?: unknown } | null;
    if (parsed?.kind === "dynamic" || parsed?.kind === "custom") return { kind: parsed.kind };
    if (parsed?.kind === "preset" && PRESETS.some((preset) => preset.id === parsed.id)) return { kind: "preset", id: parsed.id as PresetId };
    if (parsed?.kind === "color" && COLORS.some((color) => color.id === parsed.id)) return { kind: "color", id: parsed.id as ColorId };
  } catch { /* 저장소를 못 읽으면 기본값을 쓴다. */ }
  return DEFAULT_WALLPAPER;
}

export function writeWallpaper(choice: WallpaperChoice) {
  try { localStorage.setItem(WALLPAPER_KEY, JSON.stringify(choice)); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
}

// ── 내 사진: localStorage는 작고 문자열만 받으므로 IndexedDB에 Blob으로 둔다. 서버로는 보내지 않는다. ──
const DB_NAME = "relay-desktop";
const STORE = "wallpaper";
const CUSTOM_KEY = "custom";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2560;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|avif|gif|bmp)$/;

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function loadCustomImage(): Promise<Blob | null> {
  try { const value = await inStore<unknown>("readonly", (store) => store.get(CUSTOM_KEY)); return value instanceof Blob ? value : null; }
  catch { return null; }
}

export async function storeCustomImage(blob: Blob) {
  await inStore("readwrite", (store) => store.put(blob, CUSTOM_KEY));
}

export async function deleteCustomImage() {
  try { await inStore("readwrite", (store) => store.delete(CUSTOM_KEY)); } catch { /* 없으면 그만이다. */ }
}

/** 고른 파일을 검사하고, 긴 변이 2560px을 넘으면 줄여 저장 용량을 아낀다. 그 안이면 원본을 그대로 둔다. */
export async function prepareImage(file: File): Promise<Blob> {
  if (!IMAGE_TYPES.test(file.type)) throw new Error("JPG, PNG, WebP 같은 이미지 파일만 쓸 수 있습니다.");
  if (file.size > MAX_BYTES) throw new Error("25MB 이하의 이미지를 골라 주세요.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("이미지를 읽을 수 없습니다."); }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 변환할 수 없습니다."))), "image/jpeg", 0.92));
  } finally { bitmap.close(); }
}
