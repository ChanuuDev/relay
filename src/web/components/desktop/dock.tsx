import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import { APPS, APP_IDS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";
import { bounceIcon, captureMove, enter, fadeDot, playMove, type FlipSnapshot } from "../../lib/motion";
import { AppIcon } from "./app-icons";

type Tip = { id: AppId; left: number; bottom: number };

export function Dock() {
  const windows = useDesktop((state) => state.windows);
  const closing = useDesktop((state) => state.closing);
  const focused = useDesktop((state) => state.focused);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const [tip, setTip] = useState<Tip | null>(null);
  const barRef = useRef<HTMLUListElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipState = useRef<FlipSnapshot | null>(null);
  const openFlags = APP_IDS.map((id) => (windows[id].open && !closing[id] ? "1" : "0")).join("");
  const wasOpen = useRef(openFlags);

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

  // D2 툴팁: 처음엔 떠오르고, 아이콘 사이를 옮길 때는 Flip으로 미끄러진다.
  useGSAP(() => {
    const element = tipRef.current;
    const state = tipState.current;
    tipState.current = null;
    if (!element) return;
    if (state) playMove(state, "micro");
    else enter(element, { y: 4, duration: "micro" });
  }, { dependencies: [tip?.id] });

  // Dock 자체가 backdrop 루트라 툴팁은 body로 포털해 화면 전체를 흐리게 만든다.
  const show = (id: AppId, target: HTMLElement) => {
    if (mobile) return;
    tipState.current = captureMove(tipRef.current);
    const rect = target.getBoundingClientRect();
    setTip({ id, left: rect.left + rect.width / 2, bottom: window.innerHeight - rect.top + 10 });
  };
  const hide = () => { tipState.current = null; setTip(null); };
  const launch = (id: AppId, target: HTMLElement) => {
    // E1 닫힌 창을 열 때만 바운스. 앞으로 가져오기는 조용히.
    if (!windows[id].open || closing[id]) bounceIcon(target.querySelector(".app-icon"));
    focus(id);
  };

  return <nav className="dock" aria-label="Dock">
    <ul className="dock-bar material-dock" ref={barRef}>
      {APP_IDS.map((id) => <li key={id}>
        <button type="button" className="dock-item" aria-label={APPS[id].title} data-dock-item={id}
          data-open={windows[id].open && !closing[id] ? "" : undefined} data-active={focused === id ? "" : undefined}
          onClick={(event) => launch(id, event.currentTarget)}
          onPointerEnter={(event) => show(id, event.currentTarget)} onPointerLeave={hide}
          onFocus={(event) => show(id, event.currentTarget)} onBlur={hide}>
          <AppIcon app={id} size={mobile ? 32 : 48} />
          {mobile ? <span className="dock-label">{APPS[id].title}</span> : <span className="dock-dot" />}
        </button>
      </li>)}
    </ul>
    {tip && !mobile && createPortal(
      <div ref={tipRef} className="dock-tip material-menu" role="tooltip" style={{ left: tip.left, bottom: tip.bottom }}>{APPS[tip.id].title}</div>,
      document.body)}
  </nav>;
}
