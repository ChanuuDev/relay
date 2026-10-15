import { create } from "zustand";
import { MENU_BAR_HEIGHT } from "./app-config";

/** Chromium의 설치 제안 이벤트. 표준 DOM 타입에는 아직 없다. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** 설치한 앱이 제목 표시줄 자리를 쓰는 Window Controls Overlay. 표준 DOM 타입에는 아직 없다. */
interface TitlebarOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

const APP_MODES = ["(display-mode: standalone)", "(display-mode: window-controls-overlay)"];
const inAppWindow = () => APP_MODES.some((query) => window.matchMedia(query).matches);
const titlebarOverlay = () => (navigator as Navigator & { windowControlsOverlay?: TitlebarOverlay }).windowControlsOverlay;

interface InstallState {
  /** 브라우저가 지금 설치를 제안할 수 있으면 그 이벤트. 한 번 쓰면 비운다. */
  prompt: InstallPromptEvent | null;
  /** 이 화면이 설치된 앱 창 안에서 열려 있다. */
  standalone: boolean;
  /** 이 탭에서 방금 설치를 마쳤다. */
  installed: boolean;
  install: () => Promise<void>;
}

export const useInstall = create<InstallState>((set, get) => ({
  prompt: null, standalone: inAppWindow(), installed: false,
  install: async () => {
    const event = get().prompt;
    if (!event) return;
    set({ prompt: null });
    await event.prompt();
    if ((await event.userChoice).outcome === "accepted") set({ installed: true });
  },
}));

/** 메뉴바 높이. 설치한 앱이 제목 표시줄 자리를 쓰면 창 조작 버튼 높이에 맞춘다. */
export function menuBarHeight() {
  const overlay = titlebarOverlay();
  return overlay?.visible ? Math.max(MENU_BAR_HEIGHT, Math.round(overlay.getTitlebarAreaRect().height)) : MENU_BAR_HEIGHT;
}

/** 제목 표시줄 영역을 CSS 변수로 옮긴다. 메뉴바는 이 값으로 높이를 맞추고 창 조작 버튼 자리를 비운다. */
function applyTitlebar() {
  const root = document.documentElement;
  const overlay = titlebarOverlay();
  if (!overlay?.visible) {
    delete root.dataset.titlebar;
    for (const name of ["--menubar-height", "--titlebar-left", "--titlebar-right"]) root.style.removeProperty(name);
    return;
  }
  const area = overlay.getTitlebarAreaRect();
  root.dataset.titlebar = "overlay";
  root.style.setProperty("--menubar-height", `${menuBarHeight()}px`);
  root.style.setProperty("--titlebar-left", `${Math.max(0, Math.round(area.x))}px`);
  root.style.setProperty("--titlebar-right", `${Math.max(0, Math.round(window.innerWidth - area.x - area.width))}px`);
}

type Rgba = [number, number, number, number];
let scratch: CanvasRenderingContext2D | null = null;

/** CSS 색을 [r, g, b, a]로 읽는다. 캔버스가 hex·rgb() 표기를 한 가지로 맞춰 준다. */
function rgba(value: string): Rgba | null {
  scratch ??= document.createElement("canvas").getContext("2d");
  if (!scratch || !value.trim()) return null;
  scratch.fillStyle = value.trim();
  const style = String(scratch.fillStyle);
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(style);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const parts = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(style);
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4] === undefined ? 1 : Number(parts[4])] : null;
}

/** CSS saturate() 필터 행렬. */
function saturate([r, g, b]: Rgba, s: number) {
  return [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ].map((value) => Math.min(255, Math.max(0, value)));
}

/** 화면에 깔린 모양(object-fit: cover, 가운데 맞춤) 그대로 사진의 [x, x+w) × [0, h) 영역 평균색을 잰다. */
function photoTone(image: HTMLImageElement, x: number, w: number, h: number): Rgba | null {
  const W = window.innerWidth, H = window.innerHeight, iw = image.naturalWidth, ih = image.naturalHeight;
  if (!iw || !ih || w <= 0 || h <= 0) return null;
  const scale = Math.max(W / iw, H / ih);
  const left = (W - iw * scale) / 2, top = (H - ih * scale) / 2;
  const context = Object.assign(document.createElement("canvas"), { width: 32, height: 2 }).getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  try {
    context.drawImage(image, (x - left) / scale, -top / scale, w / scale, h / scale, 0, 0, 32, 2);
    const data = context.getImageData(0, 0, 32, 2).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) { sum[0]! += data[i]!; sum[1]! += data[i + 1]!; sum[2]! += data[i + 2]!; }
    const count = data.length / 4;
    return [sum[0]! / count, sum[1]! / count, sum[2]! / count, 1];
  } catch { return null; }
}

/** 설치한 앱의 제목 표시줄 색(theme-color)을 메뉴바 유리의 겉보기 색에 맞춘다. 유리 뒤 바탕화면의 평균색에 메뉴바의 채도 필터와
 *  반투명 채움을 겹쳐 계산한다. 제목 표시줄을 숨긴 앱에서는 창 조작 버튼이 놓이는 오른쪽 끝을, 아니면 메뉴바 전체 폭을 잰다. */
export function syncTitlebarColor() {
  const menubar = document.querySelector<HTMLElement>(".menubar");
  const wallpaper = document.querySelector<HTMLElement>(".wallpaper");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!menubar || !wallpaper || !meta) return;
  const style = getComputedStyle(menubar);
  const fill = rgba(style.backgroundColor);
  if (!fill) return;
  const W = window.innerWidth;
  const controls = document.documentElement.dataset.titlebar ? parseFloat(document.documentElement.style.getPropertyValue("--titlebar-right")) || 0 : 0;
  const photo = Array.from(wallpaper.querySelectorAll<HTMLImageElement>(".wallpaper-image[data-active]")).at(-1);
  const behind = (photo?.complete ? photoTone(photo, controls ? W - controls : 0, controls || W, menubar.offsetHeight) : null)
    ?? rgba(getComputedStyle(wallpaper).getPropertyValue(controls ? "--wallpaper-top-end" : "--wallpaper-top"));
  if (!behind) return;
  const amount = /saturate\(([\d.]+)(%?)\)/.exec(style.backdropFilter);
  const seen = saturate(behind, amount ? Number(amount[1]) / (amount[2] ? 100 : 1) : 1);
  const [r, g, b, a] = fill;
  meta.setAttribute("content", `rgb(${[r, g, b].map((value, i) => Math.round(value * a + seen[i]! * (1 - a))).join(", ")})`);
}

/** 서비스 워커를 등록하고, 설치 제안·설치 완료·앱 창 여부와 제목 표시줄 영역을 따라간다.
 *  onTitlebar는 제목 표시줄 영역이 바뀐 뒤 불린다. 창 크기 변경은 화면이 따로 처리한다. */
export function setupPwa(onTitlebar: () => void) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    useInstall.setState({ prompt: event as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => useInstall.setState({ prompt: null, installed: true }));
  for (const query of APP_MODES) window.matchMedia(query).addEventListener("change", () => useInstall.setState({ standalone: inAppWindow() }));

  applyTitlebar();
  titlebarOverlay()?.addEventListener("geometrychange", () => { applyTitlebar(); onTitlebar(); syncTitlebarColor(); });
  // 창 크기가 바뀌면 사진이 깔리는 범위도 바뀌므로, 크기 조절이 멈춘 뒤 제목 표시줄 색을 다시 잰다.
  let settle: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => { applyTitlebar(); clearTimeout(settle); settle = setTimeout(syncTitlebarColor, 150); });
  window.matchMedia("(prefers-reduced-transparency: reduce)").addEventListener("change", syncTitlebarColor);

  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => { /* 등록하지 못해도 화면은 그대로 동작한다. 서버가 꺼졌을 때 화면을 열지 못할 뿐이다. */ });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
