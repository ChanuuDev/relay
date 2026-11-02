import { APP_IDS, type AppId } from "./app-config";

/** Dock 아이콘 순서. 배경화면·글자 크기처럼 이 브라우저의 localStorage에 둔다. 창 배치 초기화와는 따로 남는다. */
export const DOCK_ORDER_KEY = "relay-dock-order";

/** 저장한 순서를 지금 앱 목록에 맞춘다. 없어진 앱과 중복은 버리고, 새로 생긴 앱은 기본 순서에서 바로 앞에 있던 앱 뒤에 끼운다. */
export function mergeDockOrder(saved: unknown): AppId[] {
  const known = new Set<string>(APP_IDS);
  const order: AppId[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) if (typeof id === "string" && known.has(id) && !order.includes(id as AppId)) order.push(id as AppId);
  }
  APP_IDS.forEach((id, index) => {
    if (order.includes(id)) return;
    // 앞 앱은 저장돼 있었거나 이 반복에서 이미 끼워졌다. 맨 앞 앱이면 맨 앞에 둔다.
    order.splice(index === 0 ? 0 : order.indexOf(APP_IDS[index - 1]!) + 1, 0, id);
  });
  return order;
}

export function readDockOrder(): AppId[] {
  try { return mergeDockOrder(JSON.parse(localStorage.getItem(DOCK_ORDER_KEY) ?? "null")); }
  catch { return [...APP_IDS]; }
}

export function writeDockOrder(order: readonly AppId[]) {
  try { localStorage.setItem(DOCK_ORDER_KEY, JSON.stringify(order)); } catch { /* 저장 실패는 화면 동작에 영향이 없다. */ }
}

/** id를 to 자리로 옮긴 새 배열. 범위를 넘으면 끝에 붙인다. */
export function moveDockItem(order: readonly AppId[], id: AppId, to: number): AppId[] {
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

export const sameOrder = (a: readonly AppId[], b: readonly AppId[]) => a.length === b.length && a.every((id, index) => id === b[index]);
