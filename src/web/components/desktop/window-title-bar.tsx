import type { ReactNode } from "react";
import { APPS, type AppId } from "../../lib/app-config";
import { AppIcon } from "./app-icons";
import { WindowControls } from "./window-controls";
import { useDragHandle } from "./use-window-behavior";
import { popoutApp } from "../../lib/popout";

export function WindowTitleBar({ id, title, children, right }: {
  id: AppId; title?: ReactNode; children?: ReactNode; right?: ReactNode;
}) {
  const drag = useDragHandle(id);
  // 별도 창에서는 운영체제 창이 옮기기·닫기를 맡는다. 제목 표시줄을 숨긴 앱 창이면 이 막대를 잡아 창을 옮긴다(CSS app-region).
  const popout = popoutApp === id;
  return <div className="titlebar material-chrome" {...(popout ? { "data-popout-titlebar": "" } : { "data-window-drag-handle": "", ...drag })}>
    <div className="window-title"><AppIcon app={id} size={20} />{title ?? APPS[id].title}</div>
    {children ? <div className="window-toolbar">{children}</div> : null}
    <div className="titlebar-actions">
      {right ? <div className="titlebar-right">{right}</div> : null}
      {popout ? null : <WindowControls id={id} />}
    </div>
  </div>;
}
