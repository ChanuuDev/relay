import type { CSSProperties, ReactNode } from "react";
import { APPS, MENU_BAR_HEIGHT, type AppId } from "../../lib/app-config";
import { reservedBottom, useDesktop } from "../../lib/desktop-store";
import { cn } from "../../lib/utils";
import { WindowTitleBar } from "./window-title-bar";
import { RESIZE_DIRS, useResizeHandle } from "./use-window-behavior";

export function Window({ id, header, children, bodyClassName, detail }: {
  id: AppId; header?: ReactNode; children: ReactNode; bodyClassName?: string; detail?: boolean;
}) {
  const win = useDesktop((state) => state.windows[id]);
  const focused = useDesktop((state) => state.focused === id);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const onResize = useResizeHandle(id);
  if (!win.open) return null;
  const maximized = mobile || win.maximized;
  const style: CSSProperties = maximized
    ? { top: MENU_BAR_HEIGHT, left: 0, right: 0, bottom: reservedBottom(mobile), width: "auto", height: "auto", transform: "none", zIndex: win.z }
    : { top: 0, left: 0, transform: `translate(${win.x}px, ${win.y}px)`, width: win.w, height: win.h, zIndex: win.z };
  return <section className="window" role="region" aria-label={`${APPS[id].title} 창`} tabIndex={-1} style={style}
    data-window={id} data-focused={focused ? "" : undefined} data-maximized={maximized ? "" : undefined}
    data-minimized={win.minimized ? "" : undefined} data-detail={detail ? "" : undefined}
    onPointerDownCapture={() => focus(id)}>
    <div className="window-frame">
      {header ?? <WindowTitleBar id={id} />}
      <div className={cn("window-body", bodyClassName)}>{children}</div>
    </div>
    {maximized ? null : RESIZE_DIRS.map((dir) => <div key={dir} className="resize-handle" data-window-resize-handle={dir}
      onPointerDown={(event) => onResize(event, dir)} />)}
  </section>;
}
