import type { AppId } from "./app-config";

/** 바탕화면 밖 별도 창으로 띄울 수 있는 앱. 주소 `/?window=<앱>`으로 열면 그 앱 하나만 창 전체에 그린다.
 *  별도 창은 운영체제 창이라 다른 모니터로 옮길 수 있고, 내용은 같은 Relay 저장소를 읽고 쓴다. */
export const POPOUT_APPS = ["notes"] as const satisfies readonly AppId[];
export type PopoutApp = (typeof POPOUT_APPS)[number];

const PARAM = "window";
/** 열어 둔 창의 자리와 크기를 기억한다(다음에 같은 모니터·같은 자리에 연다). */
const BOUNDS_KEY = (app: PopoutApp) => `relay-popout-${app}-v1`;
const DEFAULT_SIZE = { width: 1000, height: 720 };
const MIN_SIZE = { width: 420, height: 320 };

export function popoutOf(search: string): PopoutApp | null {
  const params = new URLSearchParams(search);
  const value = params.getAll(PARAM);
  return value.length === 1 ? POPOUT_APPS.find((app) => app === value[0]) ?? null : null;
}
/** 이 화면이 별도 창이면 그 앱, 바탕화면이면 null. 불러올 때 한 번 정하고 바뀌지 않는다. */
export const popoutApp: PopoutApp | null = popoutOf(location.search);
export const popoutPath = (app: PopoutApp) => `/?${PARAM}=${app}`;
/** 별도 창의 이름. 같은 이름의 창이 떠 있으면 브라우저가 그 창을 다시 쓴다. */
const popoutName = (app: PopoutApp) => `relay-${app}`;

type Bounds = { left: number; top: number; width: number; height: number };

function readBounds(app: PopoutApp): Bounds | null {
  try {
    const value = JSON.parse(localStorage.getItem(BOUNDS_KEY(app)) ?? "null") as Partial<Record<keyof Bounds, unknown>> | null;
    if (!value) return null;
    const [left, top, width, height] = [value.left, value.top, value.width, value.height];
    if (![left, top, width, height].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
    return { left: left as number, top: top as number, width: Math.max(MIN_SIZE.width, width as number), height: Math.max(MIN_SIZE.height, height as number) };
  } catch { return null; }
}

/** 별도 창 안에서 부른다. 창을 닫거나 가리거나 크기를 바꿀 때 자리와 크기를 남긴다(브라우저는 창을 옮기는 사건을 따로 알리지 않는다). */
export function rememberBounds(app: PopoutApp) {
  const save = () => {
    if (window.innerWidth < MIN_SIZE.width / 2 || window.innerHeight < MIN_SIZE.height / 2) return;
    const bounds: Bounds = { left: window.screenX, top: window.screenY, width: window.innerWidth, height: window.innerHeight };
    try { localStorage.setItem(BOUNDS_KEY(app), JSON.stringify(bounds)); } catch { /* 기억하지 못하면 다음에는 기본 자리에 연다. */ }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(save, 300); });
  window.addEventListener("blur", save);
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
}

/** 이 화면에서 연 별도 창. 다시 누르면 새로 열지 않고 앞으로 가져온다. */
const opened = new Map<PopoutApp, Window>();

/** 열기 결과. blocked는 브라우저가 팝업을 막은 경우다. */
export type PopoutResult = "opened" | "focused" | "blocked";

/** app을 별도 창으로 연다. 처음에는 바탕화면 창 가까이, 그 뒤로는 마지막에 둔 자리(다른 모니터 포함)에 연다.
 *  Windows 앱에서는 앱이 창을 맡는다. 이미 떠 있으면 앱이 최소화를 풀고 앞으로 가져온 뒤 null을 돌려주므로 막힘으로 보지 않는다.
 *  그래서 앱에서는 매번 새 창 요청(_blank)으로 보낸다(이름 붙인 창은 브라우저가 그 창을 다시 불러온다). */
export function openPopout(app: PopoutApp): PopoutResult {
  const desktop = desktopApp();
  const current = opened.get(app);
  if (!desktop && current && !current.closed) { current.focus(); return "focused"; }
  const saved = readBounds(app);
  const width = saved?.width ?? Math.min(DEFAULT_SIZE.width, Math.max(MIN_SIZE.width, screen.availWidth - 80));
  const height = saved?.height ?? Math.min(DEFAULT_SIZE.height, Math.max(MIN_SIZE.height, screen.availHeight - 80));
  const left = saved?.left ?? Math.round(window.screenX + Math.max(24, (window.outerWidth - width) / 2 + 48));
  const top = saved?.top ?? Math.round(window.screenY + Math.max(24, (window.outerHeight - height) / 2 + 36));
  const child = window.open(popoutPath(app), desktop ? "_blank" : popoutName(app), `popup,width=${Math.round(width)},height=${Math.round(height)},left=${left},top=${top}`);
  if (!child) return desktop ? "focused" : "blocked";
  opened.set(app, child);
  child.focus();
  return "opened";
}

/** Relay Windows 앱(Electron) 안에서 열린 화면인가. 앱은 별도 창을 직접 만들고 다시 쓴다. */
const desktopApp = () => /\bElectron\//.test(navigator.userAgent);
