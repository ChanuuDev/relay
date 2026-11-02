import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { MotionValue } from "framer-motion";
import type { AppId } from "../../lib/app-config";
import { moveDockItem, sameOrder } from "../../lib/dock-order";
import { dimDockItem, everyFrame, followDockItem, liftDockItem, settleDockItem, shiftOf, slideDockItem } from "../../lib/motion";

/** 이만큼(px) 움직여야 끌기가 시작된다. 그 전에 떼면 그대로 클릭이다. */
const THRESHOLD = 4;
/** Dock 막대 위로 이만큼(커진 아이콘 하나쯤)까지는 Dock 안으로 친다. 좌우와 아래는 끝이 없다:
 *  맨 앞·맨 뒤로 놓으려다 막대 끝을 지나쳐도 빈자리는 끝에 머문다. 위로 들어 올릴 때만 밖이다. */
const ZONE_TOP = 64;

type Drag = {
  id: AppId; item: HTMLElement; pointer: number;
  downX: number; downY: number; x: number; y: number;
  /** 잡은 점: 왼쪽에서의 너비 비율, 아래에서의 높이 비율. 확대로 크기가 바뀌어도 같은 점이 포인터 밑에 있다. */
  fx: number; fy: number;
  /** pending: 문턱 전 · active: 끄는 중 · done: Esc로 취소했고 버튼을 뗄 때까지 click만 버린다. */
  phase: "pending" | "active" | "done";
  inside: boolean;
  origin: AppId[];
};
/** 순서가 바뀌기 직전 각 아이콘의 화면 중심 x. 커밋 뒤 레이아웃 효과가 이 자리에서 새 자리로 미끄러뜨린다. */
type Flip = { before: Map<AppId, number>; settle?: AppId; focus?: AppId };

const centerOf = (el: HTMLElement) => { const rect = el.getBoundingClientRect(); return rect.left + rect.width / 2; };
const slotOf = (el: HTMLElement) => centerOf(el) - shiftOf(el).x;
const swap = (ids: AppId[], a: number, b: number) => { const keep = ids[a]!; ids[a] = ids[b]!; ids[b] = keep; };

/** Dock 아이콘을 끌어(또는 Alt+←/→로) 순서를 바꾼다. 끄는 동안 순서를 바로 바꿔 실제 레이아웃이 빈자리를 만들고,
 *  이웃은 이전 화면 위치에서 새 자리로 미끄러진다. 놓으면 그 순서를 저장하고, Esc·Dock 밖에서 놓기는 원래 순서로 돌린다. */
export function useDockReorder({ order, commit, bar, mouseX, enabled }: {
  order: AppId[]; commit: (order: AppId[]) => void; bar: RefObject<HTMLElement | null>; mouseX: MotionValue<number>; enabled: boolean;
}) {
  const [draft, setDraft] = useState<AppId[] | null>(null);
  const [dragging, setDragging] = useState<AppId | null>(null);
  const shown = draft ?? order;
  const live = useRef(shown);
  live.current = shown;
  const drag = useRef<Drag | null>(null);
  const flip = useRef<Flip | null>(null);
  const swallow = useRef(false);
  const detach = useRef<(() => void) | null>(null);
  const stopFrames = useRef<(() => void) | null>(null);

  const item = (id: AppId) => bar.current?.querySelector<HTMLElement>(`[data-dock-item="${id}"]`) ?? null;
  const capture = (extra: Omit<Flip, "before"> = {}) => {
    const before = new Map<AppId, number>();
    for (const id of live.current) { const el = item(id); if (el) before.set(id, centerOf(el)); }
    flip.current = { before, ...extra };
  };

  /** 끄는 아이콘의 잡은 점을 포인터 밑에 둔다. 확대 스프링이 레이아웃을 미는 동안에도 매 프레임 따라잡는다. */
  const follow = () => {
    const d = drag.current;
    if (d?.phase !== "active") return;
    const rect = d.item.getBoundingClientRect();
    const shift = shiftOf(d.item);
    followDockItem(d.item, d.x - d.fx * rect.width - (rect.left - shift.x), d.y + d.fy * rect.height - (rect.bottom - shift.y));
  };

  /** 끄는 아이콘의 화면 중심이 이웃 자리의 가까운 가장자리를 넘으면(반쯤 겹치면) 한 칸씩 자리를 바꾼다.
   *  중심끼리 비교하면 이웃이 끄는 아이콘 밑에 완전히 가려진 뒤에야 비킨다. 되돌아가려면 대략 간격(12px)만큼 물러나야 해 떨리지 않는다.
   *  이웃은 미끄러지는 중이어도 도착할 자리로 잰다. 여러 칸을 한 번에 넘어도 뒤 이웃의 자리는 그대로라 차례로 견주면 된다. */
  const target = (d: Drag) => {
    const ids = [...live.current];
    const from = ids.indexOf(d.id);
    let index = from;
    const at = d.x + d.item.getBoundingClientRect().width * (0.5 - d.fx);
    const edge = (id: AppId, side: "left" | "right") => {
      const el = item(id);
      return el ? el.getBoundingClientRect()[side] - shiftOf(el).x : side === "left" ? Infinity : -Infinity;
    };
    while (index < ids.length - 1 && at > edge(ids[index + 1]!, "left")) { swap(ids, index, index + 1); index += 1; }
    // 한 번에 한 방향만 본다. 오른쪽으로 넘은 이웃은 아직 옛 자리에 있어, 왼쪽 검사가 방금 바꾼 자리를 되돌린다.
    if (index === from) while (index > 0 && at < edge(ids[index - 1]!, "right")) { swap(ids, index, index - 1); index -= 1; }
    return ids;
  };

  const within = (y: number) => {
    const rect = bar.current?.getBoundingClientRect();
    return rect !== undefined && y >= rect.top - ZONE_TOP;
  };

  const begin = (d: Drag) => {
    d.phase = "active";
    d.origin = [...live.current];
    swallow.current = true;
    // 포인터가 빠르게 움직여 아이콘 밖으로 잠깐 벗어나도 쥔 손 커서를 유지하고 글자 선택을 막는다.
    document.body.dataset.dockDragging = "";
    liftDockItem(d.item);
    stopFrames.current = everyFrame(follow);
    setDraft(d.origin);
    setDragging(d.id);
  };

  const finish = (keep: boolean) => {
    const d = drag.current;
    if (d?.phase !== "active") return;
    d.phase = "done";
    stopFrames.current?.(); stopFrames.current = null;
    delete document.body.dataset.dockDragging;
    const next = keep && d.inside ? live.current : d.origin;
    capture({ settle: d.id });
    live.current = next;
    if (!sameOrder(next, d.origin)) commit(next);
    setDraft(null);
    setDragging(null);
    // 포인터가 막대 위에 없으면 확대를 내린다. 막대 위면 다음 움직임부터 Dock이 다시 추적한다.
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || d.x < rect.left || d.x > rect.right || d.y < rect.top || d.y > rect.bottom) mouseX.set(Infinity);
  };

  const end = () => {
    detach.current?.(); detach.current = null;
    const d = drag.current;
    drag.current = null;
    // 끈 뒤 같은 작업으로 이어지는 click은 버리고, 다음 작업에서 푼다.
    if (d && d.phase !== "pending") setTimeout(() => { swallow.current = false; }, 0);
  };

  const onMove = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointer || d.phase === "done") return;
    d.x = event.clientX; d.y = event.clientY;
    if (d.phase === "pending") {
      if (Math.hypot(d.x - d.downX, d.y - d.downY) < THRESHOLD) return;
      begin(d);
    }
    const inside = within(d.y);
    if (inside !== d.inside) { d.inside = inside; dimDockItem(d.item, !inside); }
    mouseX.set(inside ? d.x : Infinity);
    // 밖에서는 빈자리가 원래 자리로 돌아가 있어, 놓으면 어디로 돌아가는지 보인다.
    const next = inside ? target(d) : d.origin;
    // 바로 그려 둔다: 다음 움직임이 커밋 전의 옛 자리로 재면 방금 바꾼 자리를 되돌릴 수 있다.
    if (!sameOrder(next, live.current)) { capture(); live.current = next; flushSync(() => setDraft(next)); }
    follow();
  };
  const onUp = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointer) { finish(true); end(); } };
  const onCancel = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointer) { finish(false); end(); } };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || drag.current?.phase !== "active") return;
    event.preventDefault(); event.stopImmediatePropagation();
    finish(false);
  };
  const onBlur = () => { finish(false); end(); };

  const onPointerDown = (id: AppId, event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || event.pointerType === "touch" || drag.current) return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    drag.current = { id, item: el, pointer: event.pointerId, downX: event.clientX, downY: event.clientY, x: event.clientX, y: event.clientY,
      fx: (event.clientX - rect.left) / rect.width, fy: (rect.bottom - event.clientY) / rect.height, phase: "pending", inside: true, origin: live.current };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  };

  const onKeyDown = (id: AppId, event: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled || drag.current || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // 끝에서도 막는다: 브라우저의 Alt+← 뒤로 가기로 새지 않게.
    event.preventDefault();
    const index = live.current.indexOf(id);
    const next = moveDockItem(live.current, id, index + (event.key === "ArrowLeft" ? -1 : 1));
    if (sameOrder(next, live.current)) return;
    capture({ focus: id });
    live.current = next;
    commit(next);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (swallow.current) { event.preventDefault(); event.stopPropagation(); }
  };

  // 순서가 바뀐 커밋 직후, 그리기 전에 이웃을 이전 화면 위치로 되돌려 놓고 새 자리로 미끄러뜨린다.
  const key = shown.join();
  useLayoutEffect(() => {
    const pending = flip.current;
    flip.current = null;
    if (pending) {
      for (const id of live.current) {
        const el = item(id);
        const before = pending.before.get(id);
        if (!el || before === undefined || (drag.current?.phase === "active" && drag.current.id === id)) continue;
        const from = before - slotOf(el);
        if (id === pending.settle) settleDockItem(el, from);
        else if (Math.abs(from - shiftOf(el).x) > 0.5) slideDockItem(el, from);
        // 오른쪽으로 옮기면 React가 이 버튼을 다시 끼워 초점이 빠진다. 키보드로 옮겼으면 되돌려 준다.
        if (id === pending.focus && document.activeElement !== el) el.focus({ preventScroll: true });
      }
    }
    follow();
  }, [key, dragging]);

  // 모바일로 바뀌거나 Dock이 사라지면 끌기를 거둔다.
  useEffect(() => { if (!enabled && drag.current) { finish(false); end(); } }, [enabled]);
  useEffect(() => () => { detach.current?.(); stopFrames.current?.(); delete document.body.dataset.dockDragging; }, []);

  return {
    order: shown,
    dragging,
    bind: (id: AppId) => enabled ? {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(id, event),
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(id, event),
      onClickCapture,
      "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight",
    } : { onClickCapture },
  };
}
