import type { Config } from "../config";
import { openDatabase } from "../db/database";
import { errorBody, RelayError } from "../errors";
import { SessionRepository } from "../session/session.repository";
import { SessionService } from "../session/session.service";
import { NoteStore, parseBatch } from "../notes/notes.store";
import { fileResponse, listDirectory, openPath, places, systemLauncher, type Launcher } from "../files/files.service";
import { api } from "./api";
import { assets } from "./assets";
import { PID_HEADER } from "./control";
import { checkRequest, checkWrite, MAX_WRITE_BYTES, playerHeaders, securityHeaders } from "./security";
import { playerHtml, playerTarget } from "./youtube-player";
import { PLAYER_PATH } from "./youtube-shared";

export const NOTES_PATH = "/api/v1/notes";
export const FILES_PATH = "/api/v1/files";
export const FILES_OPEN_PATH = "/api/v1/files/open";

/** 세션은 읽기만 한다. 쓰기는 메모 저장(POST /api/v1/notes) 하나뿐이고, 메모 저장소(notes)가 있을 때만 열린다.
 *  파일 탐색기(files)를 주면 로컬 디스크를 읽는 GET /api/v1/files*와, 탐색기·기본 앱으로 넘기는 POST /api/v1/files/open이 열린다. */
export function handler(service: SessionService, config: Config, notes?: NoteStore, files?: { launch: Launcher }) {
  // 보안 헤더에 이 프로세스의 ID를 더한다. `relay web --close`가 이 값으로 종료할 서버를 찾는다.
  const pid = { [PID_HEADER]: String(process.pid) };
  const headers = { ...securityHeaders(config.webPort), ...pid };
  const failed = (error: unknown, allow?: string) => {
    const failure = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", 5, 500);
    return Response.json(errorBody(failure), { status: failure.httpStatus,
      headers: { ...headers, ...(failure.code === "DB_BUSY" ? { "Retry-After": "3" } : {}),
        ...(failure.httpStatus === 405 ? { Allow: allow ?? "GET" } : {}) } });
  };
  const store = () => { if (!notes) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404); return notes; };
  /** 메모 목록. ETag가 저장 번호(revision)라 바뀌지 않았으면 304로 본문 없이 답한다. */
  const listNotes = (request: Request, url: URL) => {
    if (url.search) throw new RelayError("INVALID_ARGUMENT", "메모 목록은 query를 받지 않습니다.");
    const tag = `"${store().revision()}"`;
    if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { ...headers, ETag: tag } });
    const data = store().list();
    return Response.json(data, { headers: { ...headers, ETag: `"${data.revision}"` } });
  };
  const saveNotes = async (request: Request) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "메모 저장은 query를 받지 않습니다.");
      const target = store();
      let body: unknown;
      try { body = await request.json(); } catch { throw new RelayError("INVALID_ARGUMENT", "JSON 본문을 읽을 수 없습니다."); }
      return Response.json(target.apply(parseBatch(body)), { headers });
    } catch (error) { return failed(error, "GET, POST"); }
  };
  const readBody = async (request: Request) => {
    try { return await request.json() as unknown; } catch { throw new RelayError("INVALID_ARGUMENT", "JSON 본문을 읽을 수 없습니다."); }
  };
  /** 탐색기에서 보기·기본 앱으로 열기. 메모 저장과 같은 쓰기 검사(같은 출처 JSON)를 거친다. */
  const openFile = async (request: Request) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "열기 요청은 query를 받지 않습니다.");
      return Response.json(openPath(await readBody(request), files!.launch), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 파일 탐색기 조회. 디스크 내용이라 다른 사이트(같은 컴퓨터의 다른 포트 포함)가 넣는 요청은 받지 않는다. */
  const readFiles = (request: Request, url: URL): Response => {
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") throw new RelayError("FORBIDDEN", "이 화면에서 보낸 요청만 받습니다.", 2, 403);
    if (url.pathname === `${FILES_PATH}/content`) return fileResponse(request, url, headers);
    if (url.pathname === `${FILES_PATH}/places`) {
      if (url.search) throw new RelayError("INVALID_ARGUMENT", "places는 query를 받지 않습니다.");
      return Response.json(places(), { headers });
    }
    if (url.pathname !== FILES_PATH) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
    for (const key of url.searchParams.keys()) if (key !== "path") throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
    if (url.searchParams.getAll("path").length !== 1) throw new RelayError("INVALID_ARGUMENT", "path를 한 번 주세요.");
    return Response.json(listDirectory(url.searchParams.get("path")), { headers });
  };
  const read = (request: Request): Response => {
    let allow: string | undefined;
    try {
      const url = new URL(request.url);
      const notesPath = url.pathname === NOTES_PATH;
      const filesPath = Boolean(files) && (url.pathname === FILES_PATH || url.pathname.startsWith(`${FILES_PATH}/`));
      if (notesPath && notes) allow = "GET, POST";
      if (filesPath && url.pathname === FILES_OPEN_PATH) allow = "POST";
      const player = url.pathname === PLAYER_PATH;
      checkRequest(request, config.webPort, { allowCrossSite: player });
      if (allow === "POST") throw new RelayError("METHOD_NOT_ALLOWED", "열기는 POST만 허용합니다.", 2, 405);
      if (request.method !== "GET") throw new RelayError("METHOD_NOT_ALLOWED", allow ? "메모는 GET 조회와 POST 저장만 허용합니다." : "GET 조회만 허용합니다.", 2, 405);
      if (notesPath) return listNotes(request, url);
      if (filesPath) return readFiles(request, url);
      if (player) return new Response(playerHtml(playerTarget(url)), { headers: { ...playerHeaders(config.webPort), ...pid, "Content-Type": "text/html; charset=utf-8" } });
      if (url.pathname.startsWith("/api/")) return Response.json(api(url, service, config), { headers });
      const asset = assets.get(/^\/sessions\/[^/]+$/.test(url.pathname) ? "/" : url.pathname);
      if (!asset) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
      if ("file" in asset) return new Response(Bun.file(asset.file), { headers: { ...headers, "Content-Type": asset.type, "Cache-Control": asset.cache } });
      return new Response(asset.body, { headers: { ...headers, "Content-Type": asset.type } });
    } catch (error) { return failed(error, allow); }
  };
  return (request: Request): Response | Promise<Response> => {
    if (request.method === "POST") {
      const pathname = new URL(request.url).pathname;
      if (notes && pathname === NOTES_PATH) return saveNotes(request);
      if (files && pathname === FILES_OPEN_PATH) return openFile(request);
    }
    return read(request);
  };
}

export function startServer(config: Config) {
  const db = openDatabase(config, true);
  // 세션은 읽기 전용 연결로 읽고, 메모만 따로 연 쓰기 연결로 저장한다.
  const notesDb = openDatabase(config);
  const service = new SessionService(new SessionRepository(db));
  let server;
  try {
    server = Bun.serve({ hostname: config.webHost, port: config.webPort, fetch: handler(service, config, new NoteStore(notesDb), { launch: systemLauncher }),
      maxRequestBodySize: MAX_WRITE_BYTES, development: false, reusePort: false });
  } catch (error) {
    db.close(); notesDb.close();
    if ((error as { code?: string }).code === "EADDRINUSE") throw new RelayError("PORT_IN_USE", "포트가 사용 중입니다. 기존 서버를 확인하거나 --port를 지정하세요.", 6, 500);
    throw new RelayError("SERVER_START_FAILED", "로컬 서버를 시작할 수 없습니다. 포트와 권한을 확인하세요.", 6, 500);
  }
  let stopped = false;
  return { server, async stop() { if (!stopped) { stopped = true; await server.stop(false); db.close(); notesDb.close(); } } };
}
