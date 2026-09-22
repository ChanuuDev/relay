import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { APPS, APP_IDS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";
import { useUI } from "../../lib/store";
import type { Theme } from "../../lib/theme";
import { RelayMark } from "./app-icons";
import { DesktopMenu, type MenuEntry } from "./menu";

export type Connection = "pending" | "online" | "offline";
type MenuKind = "relay" | "window";

const CONNECTION_TEXT: Record<Connection, string> = {
  online: "연결됨",
  pending: "연결 확인 중…",
  offline: "연결 끊김 · 재시도 중",
};

const clockFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fullFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeStyle: "short" });

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); timer = setTimeout(tick, 60000 - (Date.now() % 60000)); };
    timer = setTimeout(tick, 60000 - (Date.now() % 60000));
    return () => clearTimeout(timer);
  }, []);
  return now;
}

export function MenuBar({ connection, dark }: { connection: Connection; dark: boolean }) {
  const focused = useDesktop((state) => state.focused);
  const windows = useDesktop((state) => state.windows);
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const [menu, setMenu] = useState<{ kind: MenuKind; left: number; top: number } | null>(null);
  const relayRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLButtonElement>(null);
  const now = useClock();

  function toggle(kind: MenuKind, trigger: HTMLButtonElement | null) {
    if (menu?.kind === kind || !trigger) { setMenu(null); return; }
    const rect = trigger.getBoundingClientRect();
    setMenu({ kind, left: rect.left, top: rect.bottom + 6 });
  }
  function close(returnFocus: boolean) {
    const trigger = menu?.kind === "relay" ? relayRef.current : windowRef.current;
    setMenu(null);
    if (returnFocus) trigger?.focus();
  }
  function openSettings(storage: boolean) {
    useDesktop.getState().open("settings");
    if (storage) requestAnimationFrame(() => document.getElementById("storage-info")?.scrollIntoView({ block: "start" }));
  }
  const themeItem = (id: Theme, label: string): MenuEntry => ({ kind: "radio", id, label, checked: theme === id, onSelect: () => setTheme(id) });
  const relayItems: MenuEntry[] = [
    { kind: "item", id: "about", label: "Relay 정보…", onSelect: () => openSettings(true) },
    { kind: "item", id: "settings", label: "설정…", onSelect: () => openSettings(false) },
    { kind: "separator", id: "sep-1" },
    themeItem("dark", "다크"), themeItem("light", "라이트"), themeItem("system", "시스템"),
    { kind: "separator", id: "sep-2" },
    { kind: "item", id: "reset", label: "창 배치 초기화", onSelect: () => useDesktop.getState().resetLayout() },
  ];
  const target = focused as AppId | null;
  const windowItems: MenuEntry[] = [
    { kind: "item", id: "min", label: "최소화", disabled: !target, onSelect: () => target && useDesktop.getState().minimize(target) },
    { kind: "item", id: "zoom", label: target && windows[target].maximized ? "복원" : "최대화", disabled: !target, onSelect: () => target && useDesktop.getState().toggleMaximize(target) },
    { kind: "item", id: "close", label: "닫기", disabled: !target, onSelect: () => target && useDesktop.getState().close(target) },
    { kind: "separator", id: "sep-w" },
    ...APP_IDS.filter((id) => windows[id].open).map((id): MenuEntry => ({
      kind: "radio", id: `win-${id}`, label: APPS[id].title, checked: focused === id, onSelect: () => useDesktop.getState().focus(id),
    })),
  ];

  return <header className="menubar material-bar" role="banner">
    <div className="menubar-left">
      <button ref={relayRef} type="button" className="menubar-mark" aria-label="Relay 메뉴" aria-haspopup="menu" aria-expanded={menu?.kind === "relay"}
        data-open={menu?.kind === "relay" ? "" : undefined} onClick={(event) => toggle("relay", event.currentTarget)}><RelayMark /></button>
      <button ref={windowRef} type="button" className="menubar-app" aria-haspopup="menu" aria-expanded={menu?.kind === "window"}
        data-open={menu?.kind === "window" ? "" : undefined} onClick={(event) => toggle("window", event.currentTarget)}>{target ? APPS[target].title : "Relay"}</button>
      {menu && <DesktopMenu items={menu.kind === "relay" ? relayItems : windowItems} position={menu} onClose={close} />}
    </div>
    <div className="menubar-right">
      <div id="connection-state" role="status"><span className="connection-dot" data-state={connection} /><span className="connection-text">{CONNECTION_TEXT[connection]}</span></div>
      <span className="local-label">로컬 · 읽기 전용</span>
      <button type="button" className="menubar-icon" aria-label={dark ? "라이트 모드로 전환" : "다크 모드로 전환"} onClick={() => setTheme(dark ? "light" : "dark")}>
        {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </button>
      <button type="button" className="menubar-clock" aria-label={fullFormat.format(now)}>{clockFormat.format(now)}</button>
    </div>
  </header>;
}
