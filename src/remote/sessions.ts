import type { SessionService } from "../session/session.service";
import type { Filters, NewSession } from "../session/session.types";
import type { Change, ClueReader } from "../session/session.service";
import { directory } from "../validation";
import { RemoteClient } from "./client";

type Method = "record" | "update" | "show" | "list" | "latest" | "chain" | "packet" | "inspect" | "end" | "compact" | "models" | "pin" | "delete";
export type SessionAccess = { [K in Method]: (...args: Parameters<SessionService[K]>) => ReturnType<SessionService[K]> | Promise<ReturnType<SessionService[K]>> };
type Result<K extends Method> = ReturnType<SessionService[K]>;
const target = (providerSessionId: string, provider?: string) => ({ providerSessionId, provider });
const query = (input: object) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
};
export class RemoteSessions implements SessionAccess {
  constructor(public client: RemoteClient, private clue: ClueReader = () => null) {}
  async record(input: NewSession, parentId?: string, parentProvider?: string) {
    const { provider, agent, sessionId, sessionName, model, summary, status } = input;
    const cwd = input.cwd === undefined && parentId ? undefined : directory(input.cwd ?? process.cwd(), true);
    return this.client.write<Result<"record">>(`/api/v1/sessions${parentId ? "/continue" : ""}`, {
      provider, agent, sessionId, sessionName, model, summary, status, cwd, git: cwd ? this.clue(cwd) : null,
      ...(parentId ? { parent: target(parentId, parentProvider) } : {}) });
  }
  async update(id: string, summary: string, provider?: string, change: Change = {}) {
    const found = await this.show(id, provider).catch(() => null);
    return this.client.write<Result<"update">>("/api/v1/sessions/update", { ...target(id, provider), summary, ...change,
      git: found ? this.clue(found.session.workingDirectory) : null });
  }
  show(id: string, provider?: string, history = false, input: { limit?: unknown; offset?: unknown } = {}) {
    return this.client.json<Result<"show">>("/api/v1/sessions/lookup", { ...target(id, provider), history, ...input });
  }
  list(filters: Filters = {}) { return this.client.json<Result<"list">>("/api/v1/sessions?" + query(filters)); }
  latest(alias: string, cwd?: string) { return this.client.json<Result<"latest">>("/api/v1/sessions/latest?" + query({ alias, cwd })); }
  async chain(id: string, provider?: string) {
    return this.client.json<Result<"chain">>("/api/v1/sessions/lookup", { ...target(id, provider), chain: true });
  }
  packet(id: string, provider?: string, input: { limit?: unknown; offset?: unknown } = {}) {
    return this.client.json<Result<"packet">>("/api/v1/sessions/lookup", { ...target(id, provider), history: true, chain: true, ...input });
  }
  inspect(id: string, input: { limit?: unknown; offset?: unknown } = {}) { return this.client.json<Result<"inspect">>(`/api/v1/sessions/${encodeURIComponent(id)}/packet?${query(input)}`); }
  end(id: string, provider?: string, reason?: unknown) { return this.client.write<Result<"end">>("/api/v1/sessions/end", { ...target(id, provider), reason }); }
  compact(id: string, provider?: string, trigger?: unknown) { return this.client.write<Result<"compact">>("/api/v1/sessions/compact", { ...target(id, provider), trigger }); }
  models(id: string, provider: string | undefined, models: readonly unknown[]) { return this.client.write<Result<"models">>("/api/v1/sessions/models", { ...target(id, provider), models }); }
  pin(id: string, pinned: boolean, provider?: string) { return this.client.write<Result<"pin">>("/api/v1/sessions/pin", { ...target(id, provider), pinned }); }
  delete(id: string, provider?: string, force = false) { return this.client.write<Result<"delete">>("/api/v1/sessions/delete", { ...target(id, provider), force }); }
}
