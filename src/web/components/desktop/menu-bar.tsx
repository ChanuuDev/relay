import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { Moon, Sun } from "lucide-react";
import { APPS, APP_IDS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";
import { popScale, spinIn } from "../../lib/motion";
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
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const relayRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLButtonElement>(null);
  const themeRef = useRef<HTMLButtonElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const was = useRef({ dark, connection });
  const now = useClock();
  const openKind = leaving ? null : menu?.kind;

  // F3 해·달 아이콘 회전 교체.
  useGSAP(() => {
    const previous = was.current.dark;
    was.current.dark = dark;
    if (previous !== dark) spinIn(themeRef.current?.querySelector("svg"));
  }, { dependencies: [dark] });
  // F4 연결 상태 점 펄스.
  useGSAP(() => {
    const previous = was.current.connection;
    was.current.connection = connection;
    if (previous !== connection) popScale(dotRef.current);
  }, { dependencies: [connection] });

  function toggle(kind: MenuKind, trigger: HTMLButtonElement | null) {
    if (openKind === kind || !trigger) { close(true); return; }
    const rect = trigger.getBoundingClientRect();
    leavingRef.current = false;
    setLeaving(false);
    setMenu({ kind, left: rect.left, top: rect.bottom + 6 });
  }
  /** 초점은 즉시 돌려주고(§4-1), 메뉴는 종료 트윈 뒤에 언마운트한다. */
  function close(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    const trigger = menu.kind === "relay" ? relayRef.current : windowRef.current;
    leavingRef.current = true;
    setLeaving(true);
    if (returnFocus) trigger?.focus();
  }
  function exited() {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    setMenu(null);
    setLeaving(false);
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
      <button ref={relayRef} type="button" className="menubar-mark" aria-label="Relay 메뉴" aria-haspopup="menu" aria-expanded={openKind === "relay"}
        data-open={openKind === "relay" ? "" : undefined} onClick={(event) => toggle("relay", event.currentTarget)}><RelayMark /></button>
      <button ref={windowRef} type="button" className="menubar-app" aria-haspopup="menu" aria-expanded={openKind === "window"}
        data-open={openKind === "window" ? "" : undefined} onClick={(event) => toggle("window", event.currentTarget)}>{target ? APPS[target].title : "Relay"}</button>
      {menu && <DesktopMenu items={menu.kind === "relay" ? relayItems : windowItems} position={menu} leaving={leaving} onClose={close} onExited={exited} />}
    </div>
    <div className="menubar-right">
      <div id="connection-state" role="status"><span ref={dotRef} className="connection-dot" data-state={connection} /><span className="connection-text">{CONNECTION_TEXT[connection]}</span></div>
      <span className="local-label">로컬 · 읽기 전용</span>
      <button ref={themeRef} type="button" className="menubar-icon" aria-label={dark ? "라이트 모드로 전환" : "다크 모드로 전환"} onClick={() => setTheme(dark ? "light" : "dark")}>
        {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </button>
      <button type="button" className="menubar-clock" aria-label={fullFormat.format(now)}>{clockFormat.format(now)}</button>
    </div>
  </header>;
}
