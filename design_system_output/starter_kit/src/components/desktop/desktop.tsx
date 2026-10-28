import { useEffect, type ReactNode } from "react";
import { useDesktop } from "@/lib/desktop-store";
import { isMobileWidth } from "@/lib/layout";
import { useIsDark } from "@/lib/ui-store";
import { Toaster } from "@/components/patterns/toaster";
import { Dock } from "./dock";
import { MenuBar, type StatusState } from "./menu-bar";
import type { MenuEntry } from "./menu";
import { Wallpaper } from "./wallpaper";

/** 데스크톱 셸 조립: 건너뛰기 링크 · 바탕화면 · 메뉴바 · 창 레이어(children) · Dock · 토스트.
 *  뷰포트가 바뀌면 모바일 모드(≤760px)를 고르고 창을 화면 안으로 맞춘다. */
export function Desktop({ children, status = "online", statusText = "연결됨", label, brandItems }: {
  children: ReactNode; status?: StatusState; statusText?: string; label?: ReactNode; brandItems?: MenuEntry[];
}) {
  const dark = useIsDark();
  const mobile = useDesktop((state) => state.mobile);

  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const desktop = useDesktop.getState();
        desktop.setMobile(isMobileWidth(window.innerWidth));
        desktop.clampAll(window.innerWidth, window.innerHeight);
      });
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(frame); };
  }, []);

  return <div className="desktop" data-mobile={mobile ? "" : undefined}>
    <a className="skip-link" href="#desktop">본문으로 건너뛰기</a>
    <Wallpaper dark={dark} />
    <MenuBar dark={dark} status={status} statusText={statusText} label={label} brandItems={brandItems} />
    <main id="desktop" tabIndex={-1}>{children}</main>
    <Dock />
    <Toaster />
  </div>;
}
