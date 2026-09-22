import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { APPS, MENU_BAR_HEIGHT, type AppId } from "../../lib/app-config";
import { reservedBottom, useDesktop } from "../../lib/desktop-store";
import {
  bootDelay, enter, enterWindow, exit, exitWindow, flipFrame, minimizeToDock,
  reduced, registerFrame, resetMotion, restoreFromDock, settleFrame, takeFrame,
} from "../../lib/motion";
import { cn } from "../../lib/utils";
import { WindowTitleBar } from "./window-title-bar";
import { RESIZE_DIRS, useResizeHandle } from "./use-window-behavior";

const RADIUS = { normal: 12, maximized: 10 };

export function Window({ id, header, children, bodyClassName, detail }: {
  id: AppId; header?: ReactNode; children: ReactNode; bodyClassName?: string; detail?: boolean;
}) {
  const win = useDesktop((state) => state.windows[id]);
  const closing = useDesktop((state) => Boolean(state.closing[id]));
  const minimizing = useDesktop((state) => Boolean(state.minimizing[id]));
  const focused = useDesktop((state) => state.focused === id);
  const mobile = useDesktop((state) => state.mobile);
  const focus = useDesktop((state) => state.focus);
  const onResize = useResizeHandle(id);
  const frameRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef({ closing: false, shrinking: false });
  const was = useRef({ minimized: win.minimized, maximized: mobile || win.maximized, focused });
  const maximized = mobile || win.maximized;

  // A1 열기: Dock 쪽에서 떠오른다. 첫 로드는 60ms 간격으로 순차.
  useGSAP(() => {
    if (!win.open) return;
    setLeaving(false);
    enterWindow(frameRef.current, bootDelay());
  }, { dependencies: [win.open] });

  // A2 닫기: 종료 트윈이 끝나야 스토어에서 실제로 닫는다. 닫는 중 다시 열리면 원위치.
  useGSAP(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (closing) {
      busy.current.closing = true;
      void exitWindow(frame).then(() => { busy.current.closing = false; useDesktop.getState().finalizeClose(id); });
    } else if (busy.current.closing) {
      busy.current.closing = false;
      settleFrame(frame);
    }
  }, { dependencies: [closing] });

  // A3 최소화: Dock 아이콘 중심으로 빨려 들어간다.
  useGSAP(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (minimizing) {
      busy.current.shrinking = true;
      void minimizeToDock(frame, id).then(() => {
        busy.current.shrinking = false;
        useDesktop.getState().finalizeMinimize(id);
        resetMotion(frame);
      });
    } else if (busy.current.shrinking) {
      busy.current.shrinking = false;
      settleFrame(frame);
    }
  }, { dependencies: [minimizing] });

  // A4 복원: A3의 역재생.
  useGSAP(() => {
    const previous = was.current.minimized;
    was.current.minimized = win.minimized;
    if (win.minimized || !previous) return;
    restoreFromDock(frameRef.current, id);
  }, { dependencies: [win.minimized] });

  // A5 최대화·복원: 스토어가 상태를 바꾸기 전에 떠 둔 Flip 상태로 프레임을 옮긴다.
  useGSAP(() => {
    const state = takeFrame(id);
    const previous = was.current.maximized;
    was.current.maximized = maximized;
    if (previous === maximized) return;
    flipFrame(state, frameRef.current, {
      from: previous ? RADIUS.maximized : RADIUS.normal,
      to: maximized ? RADIUS.maximized : RADIUS.normal,
    });
  }, { dependencies: [maximized] });

  // A8 모바일 창 전환: 들어오는 창은 밀려 들어오고, 나가는 창은 잠시 남아 사라진다.
  useGSAP(() => {
    const frame = frameRef.current;
    const previous = was.current.focused;
    was.current.focused = focused;
    if (!frame || !mobile || reduced() || previous === focused) return;
    if (focused) { setLeaving(false); enter(frame, { x: 12, y: 0 }); return; }
    if (!win.open || closing || minimizing) return;
    setLeaving(true);
    void exit(frame).then(() => setLeaving(false));
  }, { dependencies: [focused, mobile] });

  if (!win.open) return null;
  const style: CSSProperties = maximized
    ? { top: MENU_BAR_HEIGHT, left: 0, right: 0, bottom: reservedBottom(mobile), width: "auto", height: "auto", transform: "none", zIndex: win.z }
    : { top: 0, left: 0, transform: `translate(${win.x}px, ${win.y}px)`, width: win.w, height: win.h, zIndex: win.z };
  return <section className="window" role="region" aria-label={`${APPS[id].title} 창`} tabIndex={-1} style={style}
    data-window={id} data-focused={focused ? "" : undefined} data-maximized={maximized ? "" : undefined}
    data-minimized={win.minimized ? "" : undefined} data-detail={detail ? "" : undefined}
    data-closing={closing ? "" : undefined} data-minimizing={minimizing ? "" : undefined}
    data-leaving={leaving && !focused ? "" : undefined}
    onPointerDownCapture={() => focus(id)}>
    <div className="window-frame" ref={(element) => { frameRef.current = element; registerFrame(id, element); }}>
      {header ?? <WindowTitleBar id={id} />}
      <div className={cn("window-body", bodyClassName)}>{children}</div>
    </div>
    {maximized ? null : RESIZE_DIRS.map((dir) => <div key={dir} className="resize-handle" data-window-resize-handle={dir}
      onPointerDown={(event) => onResize(event, dir)} />)}
  </section>;
}
