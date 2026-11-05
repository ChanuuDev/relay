import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { RelayError, invalid, sessionStatus, type ContinueRequest, type RecordRequest, type SessionAction } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { DevicesService } from "../devices/devices.service.js";
import { SessionsService, type ByProvider } from "./sessions.service.js";

/** 쿼리의 키가 허용 목록 안에 있고 중복이 없는지. 로컬 서버의 `params`와 같은 규칙이다. */
function params(query: Record<string, unknown>, allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || Array.isArray(value)) throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
    result[key] = String(value);
  }
  return result;
}

function object(body: unknown, hint: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", `${hint} JSON을 보내세요.`);
  return body as Record<string, unknown>;
}

/** CLI가 보내는 대상: Agent Session ID와 (충돌 때만) provider. */
function target(body: Record<string, unknown>): ByProvider {
  if (typeof body.providerSessionId !== "string") invalid("providerSessionId: Agent Session ID를 주세요.");
  if (body.provider !== undefined && typeof body.provider !== "string") invalid("provider: 문자열이어야 합니다.");
  return { providerSessionId: body.providerSessionId, provider: body.provider as string | undefined };
}

function only(body: Record<string, unknown>, keys: string[]) {
  for (const key of Object.keys(body)) if (!keys.includes(key)) invalid(`허용하지 않는 키: ${key}`);
}

/** 화면의 정리 한 건. 로컬 서버의 `parseAction`과 같다. */
export function parseAction(body: unknown): SessionAction {
  const value = object(body, "{ action }");
  const allow = (...keys: string[]) => only(value, ["action", ...keys]);
  switch (value.action) {
    case "status":
      allow("status");
      if (typeof value.status !== "string") invalid("status: working | blocked | handoff | done 중 하나를 입력하세요.");
      return { action: "status", status: sessionStatus(value.status)! };
    case "pin":
      allow("pinned");
      if (typeof value.pinned !== "boolean") invalid("pinned는 true 또는 false여야 합니다.");
      return { action: "pin", pinned: value.pinned };
    case "end": case "reopen":
      allow();
      return { action: value.action };
    case "delete":
      allow("force");
      if (value.force !== undefined && typeof value.force !== "boolean") invalid("force는 true 또는 false여야 합니다.");
      return { action: "delete", force: value.force === true };
    default:
      return invalid("action: status | pin | end | reopen | delete 중 하나를 입력하세요.");
  }
}

const RECORD_KEYS = ["provider", "agent", "sessionId", "sessionName", "model", "cwd", "summary", "status", "git"];

@Controller("api/v1/sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService, private readonly devices: DevicesService) {}

  // ---- 화면이 쓰는 조회 (Relay 내부 ID) ----

  @Get()
  list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.sessions.list(auth.userId, params(query, ["provider", "agent", "cwd", "q", "status", "pinned", "limit", "offset", "device"]));
  }

  /** `relay latest <alias> [--cwd]` */
  @Get("latest")
  latest(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    const q = params(query, ["alias", "cwd"]);
    return this.sessions.latest(auth.userId, q.alias, q.cwd);
  }

  @Get(":id")
  byId(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    params(query, []);
    return this.sessions.byId(auth.userId, id);
  }

  @Get(":id/updates")
  updates(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.sessions.updates(auth.userId, id, params(query, ["limit", "offset"]));
  }

  @Get(":id/children")
  children(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.sessions.children(auth.userId, id, params(query, ["limit", "offset"]));
  }

  @Get(":id/chain")
  chain(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    params(query, []);
    return this.sessions.chainById(auth.userId, id);
  }

  /** 터미널 상세가 한 번에 읽는 상세+이력+흐름 */
  @Get(":id/packet")
  inspect(@Auth() auth: AuthContext, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.sessions.inspect(auth.userId, id, params(query, ["limit", "offset"]));
  }

  @Post(":id/actions")
  @HttpCode(200)
  act(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    return this.sessions.act(auth.userId, id, parseAction(body));
  }

  // ---- CLI·훅이 쓰는 쓰기·조회 (Agent Session ID) ----

  /** `relay record`와 훅 첫 기록 */
  @Post()
  @HttpCode(200)
  async record(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ provider, agent, sessionId, summary, … }");
    only(value, RECORD_KEYS);
    const result = await this.sessions.record(auth.userId, auth.deviceId, value as unknown as RecordRequest);
    await this.devices.touch(auth.deviceId);
    return result;
  }

  /** `relay continue <이전 ID>` */
  @Post("continue")
  @HttpCode(200)
  async cont(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ parent: { providerSessionId }, provider, agent, sessionId, summary, … }");
    only(value, [...RECORD_KEYS, "parent"]);
    const parent = object(value.parent, "parent: { providerSessionId, provider? }");
    only(parent, ["providerSessionId", "provider"]);
    const result = await this.sessions.record(auth.userId, auth.deviceId, value as unknown as ContinueRequest, target(parent));
    await this.devices.touch(auth.deviceId);
    return result;
  }

  /** `relay show [--history]`, `relay chain`, `relay handoff`(history+chain) */
  @Post("lookup")
  @HttpCode(200)
  lookup(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, history?, chain?, limit?, offset? }");
    only(value, ["providerSessionId", "provider", "history", "chain", "limit", "offset"]);
    return this.sessions.lookup(auth.userId, target(value), value);
  }

  /** `relay update` */
  @Post("update")
  @HttpCode(200)
  async update(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, summary, sessionName?, status?, git? }");
    only(value, ["providerSessionId", "provider", "summary", "sessionName", "status", "git"]);
    const result = await this.sessions.update(auth.userId, target(value), value.summary,
      { sessionName: value.sessionName as string | undefined, status: value.status as string | undefined, git: value.git as never });
    await this.devices.touch(auth.deviceId);
    return result;
  }

  /** 종료 훅 */
  @Post("end")
  @HttpCode(200)
  end(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, reason? }");
    only(value, ["providerSessionId", "provider", "reason"]);
    return this.sessions.end(auth.userId, target(value), value.reason);
  }

  /** 압축 훅 */
  @Post("compact")
  @HttpCode(200)
  compact(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, trigger? }");
    only(value, ["providerSessionId", "provider", "trigger"]);
    return this.sessions.compact(auth.userId, target(value), value.trigger);
  }

  /** 모델 전환·훅이 모은 모델 목록 */
  @Post("models")
  @HttpCode(200)
  models(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, models: [] }");
    only(value, ["providerSessionId", "provider", "models"]);
    return this.sessions.models(auth.userId, target(value), value.models);
  }

  /** `relay pin` / `relay unpin` */
  @Post("pin")
  @HttpCode(200)
  pin(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, pinned }");
    only(value, ["providerSessionId", "provider", "pinned"]);
    return this.sessions.pin(auth.userId, target(value), value.pinned);
  }

  /** `relay delete [--force]` */
  @Post("delete")
  @HttpCode(200)
  remove(@Auth() auth: AuthContext, @Body() body: unknown) {
    const value = object(body, "{ providerSessionId, provider?, force? }");
    only(value, ["providerSessionId", "provider", "force"]);
    if (value.force !== undefined && typeof value.force !== "boolean") invalid("force는 true 또는 false여야 합니다.");
    return this.sessions.delete(auth.userId, target(value), value.force === true);
  }
}
