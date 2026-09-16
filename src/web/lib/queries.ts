import { focusManager, queryOptions } from "@tanstack/react-query";
import type { Page, Session, SessionUpdate } from "../../session/session.types";

export type QueryResult<T> = { data: T | undefined; error: Error | null; isPending: boolean };

export type BriefSession = Pick<Session, "id" | "provider" | "providerSessionId" | "sessionName" | "summary">;
export type ListData<T = Session> = { schemaVersion: number; items: T[]; page: Page };
export type DetailData = { schemaVersion: number; session: Session; parentSession: BriefSession | null };
export type HealthData = { schemaVersion: number; dataDirectory: string; databasePath: string; appVersion: string };
export type HistoryData = ListData<SessionUpdate>;

focusManager.setEventListener((handleFocus) => {
  const update = () => handleFocus(!document.hidden);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  update();
  return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("pageshow", update); };
});

export function resource<T>(url: string, enabled = true) {
  return queryOptions({
    queryKey: ["relay", url], enabled, retry: false, networkMode: "always",
    refetchInterval: 3000, refetchIntervalInBackground: false, refetchOnWindowFocus: "always",
    queryFn: async ({ signal }): Promise<T> => {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
      if (data.schemaVersion !== 1) throw new Error("지원하지 않는 API 버전입니다.");
      return data;
    },
  });
}
