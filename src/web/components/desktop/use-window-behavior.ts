import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { APPS, MENU_BAR_HEIGHT, type AppId } from "../../lib/app-config";
import { clampBox, reservedBottom, useDesktop } from "../../lib/desktop-store";
import { snapTo } from "../../lib/motion";

export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** 상단바 안의 조작 요소에서는 드래그를 시작하지 않는다. */
const INTERACTIVE = "a, button, input, select, textarea, [role=button], [role=tab], [role=menu], summary, [contenteditable]";

function track(handle: HTMLElement, event: ReactPointerEvent, onMove: (moveEvent: PointerEvent) => void, onEnd?: () => void) {
  handle.setPointerCapture(event.pointerId);
  document.body.dataset.windowDragging = "";
  const stop = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    delete document.body.dataset.windowDragging;
    onEnd?.();
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

export function useDragHandle(id: AppId) {
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = useDesktop.getState();
    if (event.button !== 0 || state.mobile || state.windows[id].maximized) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (document.querySelector("[role=menu]")) return;
    const handle = event.currentTarget;
    const startX = event.clientX, startY = event.clientY;
    const { x: originX, y: originY, w } = state.windows[id];
    track(handle, event, (move) => {
      const maxY = Math.max(MENU_BAR_HEIGHT, window.innerHeight - reservedBottom(false) - 40);
      const x = Math.min(Math.max(originX + move.clientX - startX, 80 - w), window.innerWidth - 80);
      const y = Math.min(Math.max(originY + move.clientY - startY, MENU_BAR_HEIGHT), maxY);
      useDesktop.getState().move(id, x, y);
    }, () => {
      // 뷰포트 밖으로 나간 만큼만 제자리로 스냅한다(§3-A7).
      const box = useDesktop.getState().windows[id];
      const snapped = clampBox(box, window.innerWidth, window.innerHeight, APPS[id].min);
      if (snapped.x === box.x && snapped.y === box.y) return;
      snapTo({ x: box.x, y: box.y }, { x: snapped.x, y: snapped.y }, (x, y) => useDesktop.getState().move(id, x, y));
    });
  }, [id]);

  const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (useDesktop.getState().mobile) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    useDesktop.getState().toggleMaximize(id);
  }, [id]);

  return { onPointerDown, onDoubleClick };
}

export function useResizeHandle(id: AppId) {
  return useCallback((event: ReactPointerEvent<HTMLElement>, dir: ResizeDir) => {
    const state = useDesktop.getState();
    if (event.button !== 0 || state.mobile || state.windows[id].maximized) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const start = { px: event.clientX, py: event.clientY, ...state.windows[id] };
    const min = APPS[id].min;
    track(handle, event, (move) => {
      const dx = move.clientX - start.px, dy = move.clientY - start.py;
      let { x, y, w, h } = start;
      if (dir.includes("e")) w = start.w + dx;
      if (dir.includes("s")) h = start.h + dy;
      if (dir.includes("w")) { w = start.w - dx; x = start.x + dx; }
      if (dir.includes("n")) { h = start.h - dy; y = start.y + dy; }
      if (w < min.w) { if (dir.includes("w")) x = start.x + start.w - min.w; w = min.w; }
      if (h < min.h) { if (dir.includes("n")) y = start.y + start.h - min.h; h = min.h; }
      if (x < 0) { w = Math.max(min.w, w + x); x = 0; }
      if (y < MENU_BAR_HEIGHT) { h = Math.max(min.h, h - (MENU_BAR_HEIGHT - y)); y = MENU_BAR_HEIGHT; }
      w = Math.max(min.w, Math.min(w, window.innerWidth - x));
      h = Math.max(min.h, Math.min(h, window.innerHeight - reservedBottom(false) - y));
      useDesktop.getState().resize(id, w, h, x, y);
    });
  }, [id]);
}
