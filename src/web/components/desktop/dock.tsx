import { useState } from "react";
import { createPortal } from "react-dom";
import { APPS, APP_IDS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";
import { AppIcon } from "./app-icons";

type Tip = { id: AppId; left: number; bottom: number };

export function Dock() {
  const windows = useDesktop((state) => state.windows);
  const focused = useDesktop((state) => state.focused);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const [tip, setTip] = useState<Tip | null>(null);
  // Dock 자체가 backdrop 루트라 툴팁은 body로 포털해 화면 전체를 흐리게 만든다.
  const show = (id: AppId, target: HTMLElement) => {
    if (mobile) return;
    const rect = target.getBoundingClientRect();
    setTip({ id, left: rect.left + rect.width / 2, bottom: window.innerHeight - rect.top + 10 });
  };
  return <nav className="dock" aria-label="Dock">
    <ul className="dock-bar material-dock">
      {APP_IDS.map((id) => <li key={id}>
        <button type="button" className="dock-item" aria-label={APPS[id].title}
          data-open={windows[id].open ? "" : undefined} data-active={focused === id ? "" : undefined}
          onClick={() => focus(id)}
          onPointerEnter={(event) => show(id, event.currentTarget)} onPointerLeave={() => setTip(null)}
          onFocus={(event) => show(id, event.currentTarget)} onBlur={() => setTip(null)}>
          <AppIcon app={id} size={mobile ? 32 : 48} />
          {mobile ? <span className="dock-label">{APPS[id].title}</span> : <span className="dock-dot" />}
        </button>
      </li>)}
    </ul>
    {tip && !mobile && createPortal(
      <div className="dock-tip material-menu" role="tooltip" style={{ left: tip.left, bottom: tip.bottom }}>{APPS[tip.id].title}</div>,
      document.body)}
  </nav>;
}
