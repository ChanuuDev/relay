import type { Config } from "../config";
import { checkVersion } from "../db/database";
import { RelayError, storageError } from "../errors";
import type { SessionService } from "../session/session.service";
import { version } from "../../package.json";

function params(url: URL, allowed: string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
    result[key] = value;
  }
  return result;
}

export function api(url: URL, service: SessionService, config: Config): unknown {
  if (url.pathname === "/api/v1/health") {
    params(url, []);
    try { checkVersion(service.repo.db); service.repo.db.query("SELECT id FROM sessions LIMIT 1").get(); }
    catch (error) { throw storageError(error); }
    return { schemaVersion: 1, status: "ok", appVersion: version,
      dataDirectory: config.dataDirectory, databasePath: config.databasePath };
  }
  if (url.pathname === "/api/v1/sessions") return service.list(params(url, ["status", "provider", "agent", "cwd", "q", "limit", "offset"]));
  const match = /^\/api\/v1\/sessions\/([^/]+)(?:\/(updates|children))?$/.exec(url.pathname);
  if (match) {
    let id: string;
    try { id = decodeURIComponent(match[1]); } catch { throw new RelayError("INVALID_ARGUMENT", "잘못된 URL 인코딩입니다."); }
    const query = params(url, match[2] ? ["limit", "offset"] : []);
    if (match[2] === "updates") return service.updates(id, query);
    if (match[2] === "children") return service.children(id, query);
    return service.byId(id);
  }
  throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
}
