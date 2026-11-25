import { useEffect, useState } from "react";
import type { Session } from "@relay/core";
import { toGraphSession, type GraphSession } from "./note-graph";

/** 메모 그래프에 함께 놓을 작업 세션(에이전트가 Relay에 남긴 기록). 그래프를 열 때 최근 것부터 몇 쪽만 받아 둔다. */
const PAGE = 100;
/** 그래프에 놓을 최근 세션 수. CLI(`relay graph`)는 400개까지 본다. */
const LIMIT = 300;
const FRESH_MS = 20_000;
const EMPTY: GraphSession[] = [];
let cache: { at: number; list: GraphSession[] } | null = null;

async function load(signal: AbortSignal): Promise<GraphSession[]> {
  const list: GraphSession[] = [];
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const response = await fetch(`/api/v1/sessions?limit=${PAGE}&offset=${offset}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`sessions ${response.status}`);
    const data = await response.json() as { items: Session[]; page: { total: number } };
    list.push(...data.items.map(toGraphSession));
    if (!data.items.length || list.length >= data.page.total) break;
  }
  return list;
}

/** 세션 목록. 받지 못하면 빈 목록이다(그래프는 메모만으로 그린다). */
export function useGraphSessions(enabled: boolean): GraphSession[] {
  const [list, setList] = useState<GraphSession[]>(() => (enabled && cache ? cache.list : EMPTY));
  useEffect(() => {
    if (!enabled) { setList(EMPTY); return; }
    if (cache && Date.now() - cache.at < FRESH_MS) { setList(cache.list); return; }
    const controller = new AbortController();
    load(controller.signal).then((next) => { cache = { at: Date.now(), list: next }; setList(next); }).catch(() => { /* 세션 없이 그린다. */ });
    return () => controller.abort();
  }, [enabled]);
  return list;
}
