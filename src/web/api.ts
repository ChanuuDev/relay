import type { Config } from "../config";
import { checkVersion } from "../db/database";
import { invalid, RelayError, storageError } from "../errors";
import type { SessionService } from "../session/session.service";
import type { SessionAction } from "../session/session.types";
import { sessionStatus } from "../validation";
import { version } from "../../package.json";
import { buildId } from "./assets";

function params(url: URL, allowed: string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
    result[key] = value;
  }
  return result;
}

/** 목록에서 고른 정리 한 건. 동작마다 받는 키가 정해져 있고 그 밖의 키나 형식은 저장소에 닿기 전에 거절한다. */
export function parseAction(body: unknown): SessionAction {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("본문은 { action } 객체여야 합니다.");
  const value = body as Record<string, unknown>;
  const only = (...keys: string[]) => {
    for (const key of Object.keys(value)) if (key !== "action" && !keys.includes(key)) invalid(`허용하지 않는 키: ${key}`);
  };
  switch (value.action) {
    case "status":
      only("status");
      if (typeof value.status !== "string") invalid("status: working | blocked | handoff | done 중 하나를 입력하세요.");
      return { action: "status", status: sessionStatus(value.status)! };
    case "pin":
      only("pinned");
      if (typeof value.pinned !== "boolean") invalid("pinned는 true 또는 false여야 합니다.");
      return { action: "pin", pinned: value.pinned };
    case "end": case "reopen":
      only();
      return { action: value.action };
    case "delete":
      only("force");
      if (value.force !== undefined && typeof value.force !== "boolean") invalid("force는 true 또는 false여야 합니다.");
      return { action: "delete", force: value.force === true };
    default:
      return invalid("action: status | pin | end | reopen | delete 중 하나를 입력하세요.");
  }
}

export function api(url: URL, service: SessionService, config: Config): unknown {
  if (url.pathname === "/api/v1/health") {
    params(url, []);
    try { checkVersion(service.repo.db); service.repo.db.query("SELECT id FROM sessions LIMIT 1").get(); }
    catch (error) { throw storageError(error); }
    return { schemaVersion: 1, status: "ok", appVersion: version, build: buildId,
      dataDirectory: config.dataDirectory, databasePath: config.databasePath };
  }
  if (url.pathname === "/api/v1/sessions") return service.list(params(url, ["provider", "agent", "cwd", "q", "status", "pinned", "limit", "offset"]));
  const match = /^\/api\/v1\/sessions\/([^/]+)(?:\/(updates|children|chain))?$/.exec(url.pathname);
  if (match) {
    let id: string;
    try { id = decodeURIComponent(match[1]); } catch { throw new RelayError("INVALID_ARGUMENT", "잘못된 URL 인코딩입니다."); }
    const query = params(url, match[2] === "updates" || match[2] === "children" ? ["limit", "offset"] : []);
    if (match[2] === "updates") return service.updates(id, query);
    if (match[2] === "children") return service.children(id, query);
    if (match[2] === "chain") return service.chainById(id);
    return service.byId(id);
  }
  throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
}
