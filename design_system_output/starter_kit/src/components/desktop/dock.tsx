import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { APPS, APP_IDS, type AppId } from "@/apps";
import { useDesktop } from "@/lib/desktop-store";
import { bounceIcon, fadeDot } from "@/lib/motion";
import { Dock as MagnifyingDock, DockIcon, DockItem, DockLabel } from "@/components/ui/dock";
import { AppIcon } from "./app-icon";

/** 화면 아래 가운데 유리 캡슐. 포인터 근처 아이콘이 48→80px로 스프링 확대되고, 라벨은 Dock 전체에 하나만 미끄러진다.
 *  닫힌 앱을 열 때만 실행 바운스, 열린 앱은 아래 4px 점. 모바일에서는 64px 탭바(아이콘 32 + 라벨)가 된다. */
export function Dock() {
  const windows = useDesktop((state) => state.windows);
  const closing = useDesktop((state) => state.closing);
  const focused = useDesktop((state) => state.focused);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const barRef = useRef<HTMLDivElement>(null);
  const openFlags = APP_IDS.map((id) => (windows[id].open && !closing[id] ? "1" : "0")).join("");
  const wasOpen = useRef(openFlags);

  // 새로 켜지는 표시점만 페이드인
  useGSAP(() => {
    const previous = wasOpen.current;
    wasOpen.current = openFlags;
    const bar = barRef.current;
    if (!bar || previous === openFlags) return;
    APP_IDS.forEach((id, index) => {
      if (openFlags[index] === "1" && previous[index] === "0") fadeDot(bar.querySelector(`[data-dock-item="${id}"] .dock-dot`));
    });
  }, { dependencies: [openFlags] });

  const launch = (id: AppId, target: HTMLElement) => {
    // 닫힌 창을 열 때만 바운스. 앞으로 가져오기는 조용히.
    if (!windows[id].open || closing[id]) bounceIcon(target.querySelector<HTMLElement>(".app-icon, .app-tile-box"));
    focus(id);
  };

  return <nav className="dock" aria-label="Dock">
    <MagnifyingDock className="material-dock" ref={barRef} disabled={mobile} baseSize={mobile ? 32 : 48}>
      {APP_IDS.map((id) =>
        <DockItem key={id} aria-label={APPS[id].title} data-dock-item={id}
          data-open={windows[id].open && !closing[id] ? "" : undefined} data-active={focused === id ? "" : undefined}
          onClick={(event) => launch(id, event.currentTarget)}>
          {!mobile && <DockLabel>{APPS[id].title}</DockLabel>}
          <DockIcon><AppIcon app={id} size={mobile ? 32 : 48} /></DockIcon>
          {mobile ? <span className="dock-label">{APPS[id].title}</span> : <span className="dock-dot" />}
        </DockItem>)}
    </MagnifyingDock>
  </nav>;
}
