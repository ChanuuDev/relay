import type { ReactNode } from "react";
import { APPS, type AppId } from "../../lib/app-config";
import { TrafficLights } from "./traffic-lights";
import { useDragHandle } from "./use-window-behavior";

export function WindowTitleBar({ id, title, children, right }: {
  id: AppId; title?: ReactNode; children?: ReactNode; right?: ReactNode;
}) {
  const drag = useDragHandle(id);
  return <div className="titlebar material-chrome" data-window-drag-handle="" {...drag}>
    <TrafficLights id={id} />
    <div className="window-title">{title ?? APPS[id].title}</div>
    {children ? <div className="window-toolbar">{children}</div> : null}
    {right ? <div className="titlebar-right">{right}</div> : null}
  </div>;
}
