import type { BrowserWindowConstructorOptions, Rectangle } from "electron";

/** 화면이 바탕화면 밖 별도 창으로 여는 앱(src/web/lib/popout.ts와 같다). 주소는 같은 서버의 `/?window=<앱>`이다. */
export const POPOUT_APPS = ["notes"] as const;
export type PopoutApp = (typeof POPOUT_APPS)[number];
const TITLES: Record<PopoutApp, string> = { notes: "메모" };
/** 별도 창의 창 조작 버튼 높이. 화면의 창 상단바(52px, 맨 아래 1px은 경계선)에서 경계선만 빼 버튼이 막대 오른쪽 끝에 들어가고 선은 끝까지 이어진다. */
export const POPOUT_TITLEBAR_HEIGHT = 51;
const MIN_SIZE = { width: 420, height: 320 };

/** url이 base 서버의 별도 창 주소면 그 앱. 다른 서버·다른 경로·값이 여럿이면 null이다. */
export function popoutAppOf(url: string, base: string): PopoutApp | null {
  try {
    const target = new URL(url);
    if (target.origin !== new URL(base).origin || target.pathname !== "/") return null;
    const values = target.searchParams.getAll("window");
    return values.length === 1 ? POPOUT_APPS.find((app) => app === values[0]) ?? null : null;
  } catch { return null; }
}

export const popoutUrl = (app: PopoutApp, base: string) => `${base}/?window=${app}`;

/** 작업 표시줄에서 Relay 본 창과 따로 묶이도록 앱마다 다른 Windows 앱 ID를 쓴다(그래서 앱 아이콘과 이름으로 따로 보인다). */
export const popoutAppId = (app: PopoutApp) => `dev.relay.desktop.${app}`;

/** 별도 창 모양. 본 창처럼 제목 표시줄을 숨기고, 화면의 상단바가 제목 표시줄을 대신한다(색은 화면이 알려 준다). 크기와 자리는 화면이 window.open에 넘긴 값을 쓴다.
 *  icon은 그 앱의 아이콘(작업 표시줄·Alt+Tab에 보인다)이다. */
export function popoutOptions(app: PopoutApp, icon: string, preload: string): BrowserWindowConstructorOptions {
  return {
    title: TITLES[app], icon, minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, backgroundColor: "#111318", autoHideMenuBar: true, show: true,
    titleBarStyle: "hidden", titleBarOverlay: { color: "#1e1e20", symbolColor: "#f5f5f7", height: POPOUT_TITLEBAR_HEIGHT },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  };
}

/** 마지막에 둔 모니터가 빠졌으면 창이 화면 밖에 뜨므로, 어느 작업 영역과도 충분히 겹치지 않으면 fallback 영역 가운데로 옮긴다. 옮길 필요가 없으면 null. */
export function visibleBounds(bounds: Rectangle, areas: Rectangle[], fallback: Rectangle): Rectangle | null {
  const overlap = (area: Rectangle) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return width >= 120 && height >= 48;
  };
  // 제목 표시줄(위쪽)이 보여야 창을 잡아 옮길 수 있다.
  const titlebar = { ...bounds, height: Math.min(bounds.height, POPOUT_TITLEBAR_HEIGHT) };
  if (areas.some((area) => overlap(area) && titlebar.y >= area.y - 8 && titlebar.y < area.y + area.height - 24)) return null;
  const width = Math.min(Math.max(bounds.width, MIN_SIZE.width), fallback.width);
  const height = Math.min(Math.max(bounds.height, MIN_SIZE.height), fallback.height);
  return { x: Math.round(fallback.x + (fallback.width - width) / 2), y: Math.round(fallback.y + (fallback.height - height) / 2), width, height };
}
