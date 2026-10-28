import { create } from "zustand";
import type { Calculation, HistoryAction } from "../../calculator/calculator.store";

export type { Calculation };
export const HISTORY_PATH = "/api/v1/calculator/history";
/** 서버에 아직 보내지 못한 변경. 창을 닫거나 서버가 꺼져 있어도 남았다가 연결되면 차례로 보낸다. */
const PENDING_KEY = "relay-calculator-pending-v1";
const RETRY_MS = 3000;

/** saved: Relay DB와 같다 · saving: 보내는 중 · offline: 서버에 닿지 못해 다시 시도 중 · rejected: 서버가 받지 않은 변경을 버렸다 */
export type Sync = "saved" | "saving" | "offline" | "rejected";
type State = {
  server: Calculation[];
  pending: HistoryAction[];
  /** 화면에 보일 이력: 서버 목록에 아직 보내지 못한 변경을 얹은 것(최근 것부터). */
  items: Calculation[];
  status: "idle" | "loading" | "ready" | "error";
  sync: Sync;
  load: () => Promise<void>;
  add: (expression: string, result: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

function readPending(): HistoryAction[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is HistoryAction => Boolean(entry) && typeof entry === "object" && "action" in entry) : [];
  } catch { return []; }
}
function writePending(pending: HistoryAction[]) {
  try { if (pending.length) localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); else localStorage.removeItem(PENDING_KEY); }
  catch { /* 저장 공간이 없어도 이 창에서는 이력이 보인다. */ }
}
function merge(server: Calculation[], pending: HistoryAction[]) {
  let items = server;
  for (const change of pending) {
    if (change.action === "add") items = items.some((item) => item.id === change.item.id) ? items : [change.item, ...items];
    else if (change.action === "delete") items = items.filter((item) => item.id !== change.id);
    else items = [];
  }
  return [...items].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

class Rejected extends Error {}
async function send(change: HistoryAction) {
  const response = await fetch(HISTORY_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
    cache: "no-store", signal: AbortSignal.timeout(8000) });
  // 4xx는 다시 보내도 받지 않으므로 버리고, 5xx(저장소가 바쁨 등)는 다시 시도한다.
  if (response.status >= 400 && response.status < 500) throw new Rejected(`HTTP ${response.status}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

let flushing = false;
let retry: ReturnType<typeof setTimeout> | undefined;

export const useCalculatorHistory = create<State>((set, get) => {
  const update = (patch: Partial<Pick<State, "server" | "pending">>) => {
    const server = patch.server ?? get().server;
    const pending = patch.pending ?? get().pending;
    if (patch.pending) writePending(pending);
    set({ server, pending, items: merge(server, pending) });
  };
  /** 쌓인 변경을 순서대로 보낸다. 다 보내면 서버 목록을 다시 받는다. */
  async function flush() {
    if (flushing) return;
    flushing = true;
    clearTimeout(retry);
    let rejected = false;
    try {
      while (get().pending.length) {
        const [change] = get().pending;
        set({ sync: "saving" });
        try { await send(change); }
        catch (error) {
          if (!(error instanceof Rejected)) {
            set({ sync: "offline" });
            retry = setTimeout(() => void flush(), RETRY_MS);
            return;
          }
          rejected = true;
        }
        update({ pending: get().pending.slice(1) });
      }
      set({ sync: rejected ? "rejected" : "saved" });
    } finally { flushing = false; }
    if (!get().pending.length) void get().load();
  }
  const queue = (change: HistoryAction) => { update({ pending: [...get().pending, change] }); void flush(); };

  return {
    server: [], pending: [], items: [], status: "idle", sync: "saved",
    async load() {
      if (get().status === "idle") {
        // 지난번에 보내지 못한 변경부터 되살린다.
        const pending = readPending();
        set({ status: "loading", pending, items: merge([], pending) });
        if (pending.length) void flush();
      }
      try {
        const response = await fetch(HISTORY_PATH, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { items?: Calculation[] };
        update({ server: Array.isArray(data.items) ? data.items : [] });
        set({ status: "ready" });
      } catch {
        if (get().status !== "ready") set({ status: "error" });
        clearTimeout(retry);
        retry = setTimeout(() => void get().load(), RETRY_MS);
      }
    },
    add(expression, result) { queue({ action: "add", item: { id: crypto.randomUUID(), expression, result, createdAt: Date.now() } }); },
    remove(id) { queue({ action: "delete", id }); },
    clear() { queue({ action: "clear" }); },
  };
});
