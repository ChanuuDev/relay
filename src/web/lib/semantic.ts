import { useCallback, useEffect, useRef, useState } from "react";
import type { IndexStatus, LinkItem, LinksResponse, SearchResponse } from "@relay/core";

// 화면이 메모 의미 검색 API를 부르는 곳. 서버가 이 API를 모르거나(옛 원격 서버) 색인이 없으면 조용히 빈 값을 돌려주고, 화면은 낱말 기능만으로 돈다.

const json = { "Content-Type": "application/json" };

/** 바뀌었을 때만 본문을 받는 GET. 서버가 단 ETag를 기억했다가 If-None-Match로 보낸다. */
function conditional<T>(url: string) {
  let tag: string | null = null, value: T | null = null;
  return async (signal?: AbortSignal): Promise<T | null> => {
    const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}), ...(tag ? { headers: { "If-None-Match": tag } } : {}) });
    if (response.status === 304) return value;
    if (!response.ok) { tag = null; value = null; return null; }
    tag = response.headers.get("etag");
    value = await response.json() as T;
    return value;
  };
}

const EMPTY: LinkItem[] = [];
const readLinks = conditional<LinksResponse>("/api/v1/notes/semantic-links");
let linkCache: LinkItem[] = EMPTY;

/** 그래프에 그릴 의미 연결. 그래프가 열려 있는 동안 30초마다 다시 본다(색인 워커가 뒤에서 계산을 마치면 따라온다). */
export function useSemanticLinks(enabled: boolean): { links: LinkItem[]; dismiss: (a: string, b: string) => Promise<boolean> } {
  const [links, setLinks] = useState<LinkItem[]>(() => (enabled ? linkCache : EMPTY));
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await readLinks(signal);
      const next = data?.items ?? EMPTY;
      linkCache = next;
      setLinks((before) => (before === next || (before.length === next.length && JSON.stringify(before) === JSON.stringify(next)) ? before : next));
    } catch { /* 의미 연결 없이 그린다. */ }
  }, []);
  useEffect(() => {
    if (!enabled) { setLinks(EMPTY); return; }
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [enabled, load]);
  /** 「관련 없음」: 이 쌍을 다시 제안하지 않게 서버에 남기고, 화면에서는 바로 걷는다. */
  const dismiss = useCallback(async (a: string, b: string) => {
    try {
      const response = await fetch(`/api/v1/notes/${encodeURIComponent(a)}/suggestions/${encodeURIComponent(b)}/dismiss`, { method: "POST", headers: json, body: "{}" });
      if (!response.ok) return false;
      linkCache = linkCache.filter((item) => !((item.a === a && item.b === b) || (item.a === b && item.b === a)));
      setLinks(linkCache);
      return true;
    } catch { return false; }
  }, []);
  return { links, dismiss };
}

const readStatus = conditional<IndexStatus>("/api/v1/notes/index-status");
/** 의미 색인의 상태. 계산이 밀려 있고 워커가 켜져 있는 동안에는 5초마다, 아니면 1분마다 본다. */
export function useIndexStatus(enabled: boolean): IndexStatus | null {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer = 0;
    const tick = async () => {
      let next: IndexStatus | null = null;
      try { next = await readStatus(controller.signal); } catch { /* 다음에 다시 본다. */ }
      if (controller.signal.aborted) return;
      setStatus(next);
      timer = window.setTimeout(tick, next && next.summary.pending > 0 && next.embedderOnline ? 5000 : 60_000);
    };
    void tick();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled]);
  return status;
}

export const SEARCH_DELAY = 450;
/** 꺼져 있던 임베딩 서버가 뜨는 데 3초쯤 걸린다. 그 뒤에 다시 묻는다. */
export const RETRY_DELAY = 3500;
/** 낱말과 뜻으로 찾기. 글자를 칠 때마다 부르지 않도록 입력이 멎고 조금 뒤에 한 번 부른다. 두 글자 미만이면 찾지 않는다. */
export function useNoteSearch(query: string): { result: SearchResponse | null; loading: boolean } {
  const [state, setState] = useState<{ result: SearchResponse | null; loading: boolean }>({ result: null, loading: false });
  const latest = useRef("");
  useEffect(() => {
    const text = query.replace(/\s+/g, " ").trim();
    latest.current = text;
    if (text.length < 2) { setState({ result: null, loading: false }); return; }
    setState((before) => ({ result: before.result?.query === text ? before.result : null, loading: true }));
    const controller = new AbortController();
    let again = 0;
    const ask = async (): Promise<SearchResponse | null> => {
      try {
        const response = await fetch("/api/v1/notes/search", { method: "POST", headers: json, body: JSON.stringify({ query: text.slice(0, 500), limit: 8 }), signal: controller.signal });
        if (response.ok) return await response.json() as SearchResponse;
      } catch { /* 낱말로 찾은 결과만 보인다. */ }
      return null;
    };
    const current = () => !controller.signal.aborted && latest.current === text;
    const timer = window.setTimeout(async () => {
      const result = await ask();
      if (!current()) return;
      setState({ result, loading: false });
      // 임베딩 서버가 쉬다 꺼져 있었다: 서버가 이 질의를 받고 띄우기 시작했으니, 뜰 만큼 기다렸다가 한 번 더 물어 결과를 뜻으로 찾은 것으로 바꾼다.
      if (result?.fallbackReason !== "embedder_offline") return;
      again = window.setTimeout(async () => {
        const retried = await ask();
        if (retried && current() && retried.searchMode !== "lexical_fallback") setState({ result: retried, loading: false });
      }, RETRY_DELAY);
    }, SEARCH_DELAY);
    return () => { controller.abort(); window.clearTimeout(timer); window.clearTimeout(again); };
  }, [query]);
  return state;
}

/** 검색이 의미 검색을 쓰지 못한 까닭을 화면에 보일 말로. */
export const FALLBACK_TEXT: Record<string, string> = {
  no_index: "의미 색인이 아직 없어 낱말로만 찾았습니다.",
  embedder_offline: "이 기기에서는 뜻으로 찾지 못해 낱말로만 찾았습니다(임베딩 서버가 꺼져 있거나 이 기기에 없습니다).",
  embedding_timeout: "임베딩 서버가 제때 답하지 않아 낱말로만 찾았습니다.",
  embedding_overloaded: "임베딩 서버가 바빠 낱말로만 찾았습니다.",
  embedding_unavailable: "임베딩 서버가 답하지 못해 낱말로만 찾았습니다.",
  model_mismatch: "이 PC의 임베딩 모델이 색인과 달라 낱말로만 찾았습니다.",
};
