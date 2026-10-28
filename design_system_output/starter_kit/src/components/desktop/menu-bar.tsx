import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { Moon, Sun } from "lucide-react";
import { APPS, APP_IDS, type AppId } from "@/apps";
import { useDesktop } from "@/lib/desktop-store";
import { popScale, spinIn } from "@/lib/motion";
import { useUI } from "@/lib/ui-store";
import type { Theme } from "@/lib/theme";
import { BrandMark } from "./app-icon";
import { DesktopMenu, type MenuEntry } from "./menu";

export type StatusState = "online" | "pending" | "warning" | "offline";
type MenuKind = "brand" | "window";

const clockFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fullFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeStyle: "short" });

/** 분 경계에 맞춰 갱신하는 시계 */
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

/** 메뉴바(28px, 유리 bar).
 *  왼쪽: 브랜드 마크 메뉴(설정·바탕화면·테마·배치 초기화 + brandItems) · 포커스된 앱 이름 = 창 메뉴(최소화·최대화·닫기·열린 창 목록).
 *  오른쪽: 상태 점·글자 · 보조 라벨 · 테마 토글(해/달) · 시계. */
export function MenuBar({ dark, status, statusText, label, brandItems = [], onOpenSettings }: {
  dark: boolean; status: StatusState; statusText: string; label?: ReactNode; brandItems?: MenuEntry[]; onOpenSettings?: (anchor?: string) => void;
}) {
  const focused = useDesktop((state) => state.focused);
  const windows = useDesktop((state) => state.windows);
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const [menu, setMenu] = useState<{ kind: MenuKind; left: number; top: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const brandRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLButtonElement>(null);
  const themeRef = useRef<HTMLButtonElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const was = useRef({ dark, status });
  const now = useClock();
  const openKind = leaving ? null : menu?.kind;

  // 해·달 아이콘 회전 교체, 상태 점 펄스
  useGSAP(() => {
    const previous = was.current.dark;
    was.current.dark = dark;
    if (previous !== dark) spinIn(themeRef.current?.querySelector("svg"));
  }, { dependencies: [dark] });
  useGSAP(() => {
    const previous = was.current.status;
    was.current.status = status;
    if (previous !== status) popScale(dotRef.current);
  }, { dependencies: [status] });

  function toggle(kind: MenuKind, trigger: HTMLButtonElement | null) {
    if (openKind === kind || !trigger) { close(true); return; }
    const rect = trigger.getBoundingClientRect();
    leavingRef.current = false;
    setLeaving(false);
    setMenu({ kind, left: rect.left, top: rect.bottom + 6 });
  }
  /** 초점은 즉시 돌려주고, 메뉴는 종료 트윈 뒤에 언마운트한다. */
  function close(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    const trigger = menu.kind === "brand" ? brandRef.current : windowRef.current;
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
  const openSettings = onOpenSettings ?? ((anchor?: string) => {
    useDesktop.getState().open("settings");
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
  });
  const themeItem = (id: Theme, text: string): MenuEntry => ({ kind: "radio", id, label: text, checked: theme === id, onSelect: () => setTheme(id) });
  const brandMenu: MenuEntry[] = [
    { kind: "item", id: "settings", label: "설정…", onSelect: () => openSettings() },
    { kind: "item", id: "wallpaper", label: "바탕화면 변경…", onSelect: () => openSettings("wallpaper-settings") },
    ...brandItems,
    { kind: "separator", id: "sep-1" },
    themeItem("dark", "다크"), themeItem("light", "라이트"), themeItem("system", "시스템"),
    { kind: "separator", id: "sep-2" },
    { kind: "item", id: "reset", label: "창 배치 초기화", onSelect: () => useDesktop.getState().resetLayout() },
  ];
  const target = focused;
  const windowMenu: MenuEntry[] = [
    { kind: "item", id: "min", label: "최소화", disabled: !target, onSelect: () => target && useDesktop.getState().minimize(target) },
    { kind: "item", id: "zoom", label: target && windows[target].maximized ? "복원" : "최대화", disabled: !target, onSelect: () => target && useDesktop.getState().toggleMaximize(target) },
    { kind: "item", id: "close", label: "닫기", disabled: !target, onSelect: () => target && useDesktop.getState().close(target) },
    { kind: "separator", id: "sep-w" },
    ...APP_IDS.filter((id) => windows[id].open).map((id: AppId): MenuEntry => ({
      kind: "radio", id: `win-${id}`, label: APPS[id].title, checked: focused === id, onSelect: () => useDesktop.getState().focus(id),
    })),
  ];

  return <header className="menubar material-bar">
    <div className="menubar-left">
      <button ref={brandRef} type="button" className="menubar-mark" aria-label="앱 메뉴" aria-haspopup="menu" aria-expanded={openKind === "brand"}
        data-open={openKind === "brand" ? "" : undefined} onClick={(event) => toggle("brand", event.currentTarget)}><BrandMark /></button>
      <button ref={windowRef} type="button" className="menubar-app" aria-haspopup="menu" aria-expanded={openKind === "window"}
        data-open={openKind === "window" ? "" : undefined} onClick={(event) => toggle("window", event.currentTarget)}>{target ? APPS[target].title : "데스크톱"}</button>
      {menu && <DesktopMenu items={menu.kind === "brand" ? brandMenu : windowMenu} position={menu} leaving={leaving} onClose={close} onExited={exited} />}
    </div>
    <div className="menubar-right">
      <div className="menubar-status" role="status"><span ref={dotRef} className="status-dot" data-state={status} /><span className="status-text">{statusText}</span></div>
      {label ? <span className="menubar-status menubar-hide-mobile">{label}</span> : null}
      <button ref={themeRef} type="button" className="menubar-icon" aria-label={dark ? "라이트 모드로 전환" : "다크 모드로 전환"} onClick={() => setTheme(dark ? "light" : "dark")}>
        {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </button>
      <button type="button" className="menubar-clock" aria-label={fullFormat.format(now)}>{clockFormat.format(now)}</button>
    </div>
  </header>;
}
