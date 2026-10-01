export type PresetId = "aurora" | "dunes" | "waves" | "forest";
export type ColorId = "graphite" | "midnight" | "lavender" | "sunset" | "mint";
/** 기본은 테마에 따라 낮·밤 사진이 바뀐다. 사진·색상은 테마와 무관하고, 내 사진은 브라우저(IndexedDB)에만 여러 장 둔다. */
export type WallpaperChoice = { kind: "dynamic" } | { kind: "preset"; id: PresetId } | { kind: "color"; id: ColorId } | { kind: "custom"; id: string };

export const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: "aurora", label: "오로라" }, { id: "dunes", label: "모래 언덕" }, { id: "waves", label: "유리 물결" }, { id: "forest", label: "안개 숲" },
];
export const COLORS: readonly { id: ColorId; label: string }[] = [
  { id: "graphite", label: "그래파이트" }, { id: "midnight", label: "미드나이트" }, { id: "lavender", label: "라벤더" }, { id: "sunset", label: "선셋" }, { id: "mint", label: "민트" },
];
export const WALLPAPER_KEY = "relay-wallpaper";
export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "dynamic" };
export const MAX_CUSTOM_IMAGES = 20;
export const presetUrl = (id: PresetId) => `/wallpapers/${id}.jpg`;

export function sameChoice(a: WallpaperChoice, b: WallpaperChoice) {
  return a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);
}

export function wallpaperLabel(choice: WallpaperChoice) {
  if (choice.kind === "preset") return PRESETS.find((preset) => preset.id === choice.id)?.label ?? "사진";
  if (choice.kind === "color") return COLORS.find((color) => color.id === choice.id)?.label ?? "색상";
  return choice.kind === "custom" ? "내 사진" : "기본";
}

/** 첫 버전은 내 사진 한 장을 이 키에 Blob으로 두었다. 지금은 그 키를 사진 하나의 id로 그대로 읽는다. */
const LEGACY_ID = "custom";

export function readWallpaper(): WallpaperChoice {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLPAPER_KEY) ?? "null") as { kind?: unknown; id?: unknown } | null;
    if (parsed?.kind === "dynamic") return { kind: "dynamic" };
    if (parsed?.kind === "custom") return { kind: "custom", id: typeof parsed.id === "string" && parsed.id ? parsed.id : LEGACY_ID };
    if (parsed?.kind === "preset" && PRESETS.some((preset) => preset.id === parsed.id)) return { kind: "preset", id: parsed.id as PresetId };
    if (parsed?.kind === "color" && COLORS.some((color) => color.id === parsed.id)) return { kind: "color", id: parsed.id as ColorId };
  } catch { /* 저장소를 못 읽으면 기본값을 쓴다. */ }
  return DEFAULT_WALLPAPER;
}

export function writeWallpaper(choice: WallpaperChoice) {
  try { localStorage.setItem(WALLPAPER_KEY, JSON.stringify(choice)); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
}

// ── 내 사진: localStorage는 작고 문자열만 받으므로 IndexedDB에 사진마다 레코드로 둔다. 서버로는 보내지 않는다. ──
export type CustomImageRecord = { id: string; blob: Blob; name: string; addedAt: number };
type StoredImage = { blob: Blob; name: string; addedAt: number };

const DB_NAME = "relay-desktop";
const STORE = "wallpaper";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2560;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|avif|gif|bmp)$/;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openStore(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

async function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openStore();
  try { return await run(db.transaction(STORE, mode).objectStore(STORE)); }
  finally { db.close(); }
}

const isStored = (value: unknown): value is StoredImage =>
  typeof value === "object" && value !== null && (value as StoredImage).blob instanceof Blob && typeof (value as StoredImage).name === "string";

/** 저장한 사진을 넣은 순서대로 돌려준다. 첫 버전의 사진 한 장(Blob만 있는 `custom` 키)도 한 장으로 센다. */
export async function listCustomImages(): Promise<CustomImageRecord[]> {
  try {
    return await inStore("readonly", async (store) => {
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll() as IDBRequest<unknown[]>)]);
      const images: CustomImageRecord[] = [];
      keys.forEach((key, index) => {
        const value = values[index];
        if (typeof key !== "string") return;
        if (value instanceof Blob) images.push({ id: key, blob: value, name: "내 사진", addedAt: 0 });
        else if (isStored(value)) images.push({ id: key, blob: value.blob, name: value.name, addedAt: Number(value.addedAt) || 0 });
      });
      return images.sort((a, b) => a.addedAt - b.addedAt);
    });
  } catch { return []; }
}

const newId = () => `img-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;

export async function storeCustomImage(blob: Blob, name: string): Promise<CustomImageRecord> {
  const record: CustomImageRecord = { id: newId(), blob, name, addedAt: Date.now() };
  await inStore("readwrite", (store) => request(store.put({ blob, name, addedAt: record.addedAt } satisfies StoredImage, record.id)));
  return record;
}

export async function deleteCustomImage(id: string) {
  try { await inStore("readwrite", (store) => request(store.delete(id))); } catch { /* 없으면 그만이다. */ }
}

/** 견본 아래에 보일 이름. 확장자를 뗀 파일 이름이며, 비어 있으면 "내 사진". */
export const imageLabel = (file: File) => file.name.replace(/\.[^.]+$/, "").trim() || "내 사진";

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
