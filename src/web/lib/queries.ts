import { focusManager, queryOptions } from "@tanstack/react-query";
import type { ChainNode, Page, Session, SessionUpdate } from "../../session/session.types";

export type QueryResult<T> = { data: T | undefined; error: Error | null; isPending: boolean };

export type BriefSession = Pick<Session, "id" | "provider" | "agent" | "providerSessionId" | "sessionName" | "summary" | "status">;
export type ListData<T = Session> = { schemaVersion: number; items: T[]; page: Page };
export type DetailData = { schemaVersion: number; session: Session; parentSession: BriefSession | null };
export type ChainData = { schemaVersion: number; sessionId: string; items: ChainNode[]; truncated: boolean };
export type HealthData = { schemaVersion: number; dataDirectory: string; databasePath: string; appVersion: string };
export type HistoryData = ListData<SessionUpdate>;

focusManager.setEventListener((handleFocus) => {
  const update = () => handleFocus(!document.hidden);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  update();
  return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("pageshow", update); };
});

/** 서버가 꺼져 있을 때 다시 켜는 명령. 기본 포트가 아니면 포트를 함께 적는다. */
const startCommand = () => `relay web --headless${location.port && location.port !== "7474" ? ` --port ${location.port}` : ""}`;

export function resource<T>(url: string, enabled = true) {
  return queryOptions({
    queryKey: ["relay", url], enabled, retry: false, networkMode: "always",
    refetchInterval: 3000, refetchIntervalInBackground: false, refetchOnWindowFocus: "always",
    queryFn: async ({ signal }): Promise<T> => {
      let response: Response;
      try { response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), cache: "no-store" }); }
      catch (error) {
        // 설치한 앱을 서버 없이 열었을 때처럼 서버에 닿지 못하면, 브라우저 오류문 대신 서버를 켜는 방법을 알린다.
        if (error instanceof TypeError) throw new Error(`Relay 서버에 연결할 수 없습니다. 터미널에서 ${startCommand()}로 서버를 켜세요`, { cause: error });
        if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("Relay 서버가 응답하지 않습니다", { cause: error });
        throw error;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
      if (data.schemaVersion !== 1) throw new Error("지원하지 않는 API 버전입니다.");
      return data;
    },
  });
}
