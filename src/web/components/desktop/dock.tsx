import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { useMotionValue } from "framer-motion";
import { APPS, APP_IDS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";
import { bounceIcon, fadeDot } from "../../lib/motion";
import { Dock as MagnifyingDock, DockIcon, DockItem, DockLabel } from "../ui/dock";
import { AppIcon } from "./app-icons";
import { DesktopMenu, type MenuEntry } from "./menu";
import { useDockReorder } from "./use-dock-reorder";
import { POPOUT_APPS, type PopoutApp } from "../../lib/popout";
import { popOut } from "../../lib/popout-open";

/** 별도 창으로 띄울 수 있는 앱만 Dock 우클릭 메뉴를 연다. */
const canPopOut = (id: AppId): id is PopoutApp => (POPOUT_APPS as readonly AppId[]).includes(id);
/** 메뉴는 아이콘 위 가운데에 연다(최소 폭 200px, 항목 26px, 위아래 여백 8px). */
const MENU_WIDTH = 200;
const menuHeight = (count: number) => count * 26 + 8;
type DockMenu = { id: PopoutApp; left: number; top: number };
/** 아이콘 위 가운데 자리. */
const menuAt = (target: HTMLElement, count: number) => {
  const rect = target.getBoundingClientRect();
  return { left: Math.round(rect.left + rect.width / 2 - MENU_WIDTH / 2), top: Math.round(rect.top - menuHeight(count) - 10) };
};

export function Dock() {
  const windows = useDesktop((state) => state.windows);
  const closing = useDesktop((state) => state.closing);
  const focused = useDesktop((state) => state.focused);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const dockOrder = useDesktop((state) => state.dockOrder);
  const setDockOrder = useDesktop((state) => state.setDockOrder);
  const barRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(Infinity);
  // 모바일 탭바는 같은 순서로 보여 주기만 하고, 끌어 바꾸기는 데스크톱 Dock에서만 한다.
  const reorder = useDockReorder({ order: dockOrder, commit: setDockOrder, bar: barRef, mouseX, enabled: !mobile });
  const openFlags = APP_IDS.map((id) => (windows[id].open && !closing[id] ? "1" : "0")).join("");
  const wasOpen = useRef(openFlags);
  const [menu, setMenu] = useState<DockMenu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  // 항목을 고르면 그 동작이 초점을 정하므로, 메뉴가 닫힐 때 아이콘으로 되돌리지 않는다.
  const chose = useRef(false);

  // E2 표시점: 새로 켜지는 점만 페이드인.
  useGSAP(() => {
    const previous = wasOpen.current;
    wasOpen.current = openFlags;
    const bar = barRef.current;
    if (!bar || previous === openFlags) return;
    APP_IDS.forEach((id, index) => {
      if (openFlags[index] === "1" && previous[index] === "0") fadeDot(bar.querySelector(`[data-dock-item="${id}"] .dock-dot`));
    });
  }, { dependencies: [openFlags] });

  const itemOf = (id: AppId) => barRef.current?.querySelector<HTMLElement>(`[data-dock-item="${id}"]`) ?? null;
  const launch = (id: AppId) => {
    // E1 닫힌 창을 열 때만 바운스. 앞으로 가져오기는 조용히.
    if (!windows[id].open || closing[id]) bounceIcon(itemOf(id)?.querySelector(".app-icon") ?? null);
    focus(id);
  };

  // 우클릭(또는 메뉴 키·Shift+F10): 바탕화면 안에서 열기와 별도 창으로 열기를 고른다. 메뉴가 떠 있는 동안 Dock은 커진 채 멈추고 이름표를 내린다.
  const menuEntries = (id: PopoutApp): MenuEntry[] => [
    { kind: "item", id: "open", label: "Relay 안에서 열기", onSelect: () => { chose.current = true; launch(id); } },
    { kind: "item", id: "popout", label: "새 창으로 열기", onSelect: () => { chose.current = true; popOut(id); } },
  ];
  const openMenu = (id: PopoutApp, target: HTMLElement) => {
    chose.current = false;
    setMenuLeaving(false);
    setMenu({ id, ...menuAt(target, menuEntries(id).length) });
  };
  // 마우스가 막 올라와 아이콘이 아직 커지는 중에 우클릭하면, 다 커진 아이콘이 메뉴 아래를 덮는다.
  // 메뉴가 떠 있는 동안 Dock은 그 크기로 멈추므로, 아이콘이 멈출 때까지 몇 프레임 따라가 바로 위에 둔다.
  const menuId = menu && !menuLeaving ? menu.id : null;
  useEffect(() => {
    if (!menuId) return;
    let frame = 0, still = 0, count = 0, last = "";
    const follow = () => {
      const target = itemOf(menuId);
      if (!target) return;
      const next = menuAt(target, menuEntries(menuId).length);
      const key = `${next.left},${next.top}`;
      still = key === last ? still + 1 : 0;
      last = key;
      setMenu((current) => (!current || current.id !== menuId || (current.left === next.left && current.top === next.top) ? current : { ...current, ...next }));
      // 멈춘 채 여섯 프레임이 지나거나 1초가 지나면 그만둔다.
      if (still < 6 && ++count < 60) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
    // menuEntries·itemOf는 렌더마다 새로 만들어지지만 메뉴 하나가 떠 있는 동안 결과는 같다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);
  const closeMenu = (returnFocus: boolean) => {
    if (!menu || menuLeaving) return;
    setMenuLeaving(true);
    if (returnFocus && !chose.current) itemOf(menu.id)?.focus({ preventScroll: true });
  };
  const menuExited = () => { setMenu(null); setMenuLeaving(false); mouseX.set(Infinity); };

  return <nav className="dock" aria-label="Dock">
    <MagnifyingDock className="material-dock" ref={barRef} disabled={mobile} baseSize={mobile ? 32 : 48} mouseX={mouseX} dragging={reorder.dragging !== null || menu !== null}>
      {reorder.order.map((id) =>
        <DockItem key={id} aria-label={APPS[id].title} data-dock-item={id} {...reorder.bind(id)}
          data-open={windows[id].open && !closing[id] ? "" : undefined} data-active={focused === id ? "" : undefined}
          data-dragging={reorder.dragging === id ? "" : undefined} data-menu={menu?.id === id && !menuLeaving ? "" : undefined}
          aria-haspopup={canPopOut(id) && !mobile ? "menu" : undefined}
          onClick={() => launch(id)}
          onContextMenu={canPopOut(id) && !mobile ? (event) => { event.preventDefault(); openMenu(id, event.currentTarget); } : undefined}>
          {!mobile && <DockLabel>{APPS[id].title}</DockLabel>}
          <DockIcon><AppIcon app={id} size={mobile ? 32 : 48} /></DockIcon>
          {mobile ? <span className="dock-label">{APPS[id].title}</span> : <span className="dock-dot" />}
        </DockItem>)}
    </MagnifyingDock>
    {menu && <DesktopMenu items={menuEntries(menu.id)} position={{ left: menu.left, top: menu.top }} leaving={menuLeaving} onClose={closeMenu} onExited={menuExited} className="dock-menu" />}
  </nav>;
}
