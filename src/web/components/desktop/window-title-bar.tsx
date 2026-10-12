import type { ReactNode } from "react";
import { APPS, type AppId } from "../../lib/app-config";
import { AppIcon } from "./app-icons";
import { WindowControls } from "./window-controls";
import { useDragHandle } from "./use-window-behavior";

export function WindowTitleBar({ id, title, children, right }: {
  id: AppId; title?: ReactNode; children?: ReactNode; right?: ReactNode;
}) {
  const drag = useDragHandle(id);
  return <div className="titlebar material-chrome" data-window-drag-handle="" {...drag}>
    <div className="window-title"><AppIcon app={id} size={20} />{title ?? APPS[id].title}</div>
    {children ? <div className="window-toolbar">{children}</div> : null}
    <div className="titlebar-actions">
      {right ? <div className="titlebar-right">{right}</div> : null}
      <WindowControls id={id} />
    </div>
  </div>;
}
