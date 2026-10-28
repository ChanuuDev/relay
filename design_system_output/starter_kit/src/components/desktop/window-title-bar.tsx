import type { ReactNode } from "react";
import { APPS, type AppId } from "@/apps";
import { AppIcon } from "./app-icon";
import { WindowControls } from "./window-controls";
import { useDragHandle } from "./use-window-behavior";

/** 창 상단바(유리 chrome, 최소 52px): 왼쪽 앱 아이콘·제목(+개수 알약) · 가운데 툴바 · 오른쪽 추가 단추와 창 조작.
 *  상단바 전체가 드래그 손잡이이고(버튼·입력은 제외), 두 번 누르면 최대화한다. */
export function WindowTitleBar({ id, title, count, children, right }: {
  id: AppId; title?: ReactNode; count?: number; children?: ReactNode; right?: ReactNode;
}) {
  const drag = useDragHandle(id);
  return <div className="titlebar material-chrome" data-window-drag-handle="" {...drag}>
    <div className="window-title"><AppIcon app={id} size={20} />{title ?? APPS[id].title}
      {count === undefined ? null : <span className="title-count">{count}</span>}</div>
    {children ? <div className="window-toolbar">{children}</div> : null}
    <div className="titlebar-actions">
      {right ? <div className="titlebar-right">{right}</div> : null}
      <WindowControls id={id} />
    </div>
  </div>;
}
