import type { Config } from "../config";
import { openDatabase } from "../db/database";
import { errorBody, RelayError } from "../errors";
import { SessionRepository } from "../session/session.repository";
import { SessionService } from "../session/session.service";
import { exportFileName, NoteStore, parseBatch, parseExport } from "../notes/notes.store";
import { CalculatorStore, parseHistoryAction } from "../calculator/calculator.store";
import { deleteItems, fileResponse, listDirectory, openPath, pasteItems, places, saveFile, statPath, systemLauncher, systemRemover, type Launcher, type Remover } from "../files/files.service";
import { api, parseAction } from "./api";
import { assets } from "./assets";
import { PID_HEADER, portFailure } from "./control";
import { checkRequest, checkWrite, MAX_IMPORT_BYTES, playerHeaders, securityHeaders } from "./security";
import { playerHtml, playerTarget } from "./youtube-player";
import { PLAYER_PATH } from "./youtube-shared";

export const NOTES_PATH = "/api/v1/notes";
export const NOTES_EXPORT_PATH = "/api/v1/notes/export";
export const NOTES_IMPORT_PATH = "/api/v1/notes/import";
export const FILES_PATH = "/api/v1/files";
export const FILES_OPEN_PATH = "/api/v1/files/open";
export const FILES_PASTE_PATH = "/api/v1/files/paste";
export const FILES_DELETE_PATH = "/api/v1/files/delete";
export const FILES_STAT_PATH = "/api/v1/files/stat";
export const FILES_SAVE_PATH = "/api/v1/files/save";
/** 파일 탐색기의 쓰기 경로. 모두 같은 출처 JSON POST만 받는다. */
const FILES_WRITE_PATHS = new Set([FILES_OPEN_PATH, FILES_PASTE_PATH, FILES_DELETE_PATH, FILES_SAVE_PATH]);
export const CALCULATOR_PATH = "/api/v1/calculator/history";
/** 목록에서 하는 세션 정리. `:id`는 Relay 내부 ID다. */
export const SESSION_ACTIONS = /^\/api\/v1\/sessions\/([^/]+)\/actions$/;

/** 화면이 쓰는 저장소와 기능. 준 것만 그 경로가 열린다. */
export interface Features {
  /** 메모 저장(POST /api/v1/notes)·내보내기·가져오기(POST /api/v1/notes/import) */
  notes?: NoteStore;
  /** 로컬 디스크를 읽는 GET /api/v1/files*, 탐색기·기본 앱으로 넘기는 POST /api/v1/files/open, 복사·이동 POST /api/v1/files/paste, 휴지통 이동 POST /api/v1/files/delete, 뷰어 저장 POST /api/v1/files/save.
   *  remove를 주지 않으면 운영체제의 휴지통(Windows)이나 바로 삭제를 쓴다. */
  files?: { launch: Launcher; remove?: Remover };
  /** 쓰기 연결의 세션 서비스. 목록에서 하는 세션 정리(POST /api/v1/sessions/:id/actions) */
  writer?: SessionService;
  /** 계산기 이력(GET·POST /api/v1/calculator/history) */
  calculator?: CalculatorStore;
}

/** 세션 조회는 service(읽기 전용 연결)로 한다. 쓰기는 features에 준 저장소로만 하며 모두 같은 출처 JSON만 받는다. */
export function handler(service: SessionService, config: Config, { notes, files, writer, calculator }: Features = {}) {
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
  /** 다른 환경으로 옮길 파일. 주소로 바로 열어도 날짜를 붙인 이름으로 내려받는다. */
  const exportNotes = (url: URL) => {
    if (url.search) throw new RelayError("INVALID_ARGUMENT", "메모 내보내기는 query를 받지 않습니다.");
    const data = store().exportAll();
    return new Response(`${JSON.stringify(data, null, 2)}\n`, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName()}"` } });
  };
  /** 내보낸 파일을 합친다. 저장과 같은 쓰기 검사를 거치되, 파일 하나를 통째로 받으므로 크기 상한만 크다. */
  const importNotes = async (request: Request) => {
    try {
      checkWrite(request, config.webPort, MAX_IMPORT_BYTES);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "메모 가져오기는 query를 받지 않습니다.");
      const target = store();
      return Response.json(target.merge(parseExport(await readBody(request))), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 탐색기에서 보기·기본 앱으로 열기. 메모 저장과 같은 쓰기 검사(같은 출처 JSON)를 거친다. */
  const openFile = async (request: Request) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "열기 요청은 query를 받지 않습니다.");
      return Response.json(openPath(await readBody(request), files!.launch), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 복사·잘라내기한 항목 붙여넣기와 휴지통으로 옮기기. 열기와 같은 쓰기 검사를 거친다. */
  const writeFiles = async (request: Request, pathname: string) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "파일 정리 요청은 query를 받지 않습니다.");
      const body = await readBody(request);
      return Response.json(pathname === FILES_PASTE_PATH ? pasteItems(body) : deleteItems(body, files!.remove ?? systemRemover), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 뷰어에서 고친 글 저장. 쓰기 검사는 같고, 파일 하나를 base64로 받으므로 크기 상한만 크다. */
  const saveText = async (request: Request) => {
    try {
      checkWrite(request, config.webPort, MAX_IMPORT_BYTES);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "저장 요청은 query를 받지 않습니다.");
      return Response.json(saveFile(await readBody(request)), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 작업 상태·고정·종료·종료 취소·삭제. 메모 저장과 같은 쓰기 검사(같은 출처 JSON)를 거친다. */
  const actOnSession = async (request: Request, encoded: string) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "세션 정리는 query를 받지 않습니다.");
      let id: string;
      try { id = decodeURIComponent(encoded); } catch { throw new RelayError("INVALID_ARGUMENT", "잘못된 URL 인코딩입니다."); }
      return Response.json(writer!.act(id, parseAction(await readBody(request))), { headers });
    } catch (error) { return failed(error, "POST"); }
  };
  /** 계산 이력 추가·지우기. 메모 저장과 같은 쓰기 검사(같은 출처 JSON)를 거친다. */
  const saveCalculation = async (request: Request) => {
    try {
      checkWrite(request, config.webPort);
      if (new URL(request.url).search) throw new RelayError("INVALID_ARGUMENT", "계산 이력 저장은 query를 받지 않습니다.");
      return Response.json(calculator!.apply(parseHistoryAction(await readBody(request))), { headers });
    } catch (error) { return failed(error, "GET, POST"); }
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
    if (url.pathname !== FILES_PATH && url.pathname !== FILES_STAT_PATH) throw new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
    for (const key of url.searchParams.keys()) if (key !== "path") throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
    if (url.searchParams.getAll("path").length !== 1) throw new RelayError("INVALID_ARGUMENT", "path를 한 번 주세요.");
    const target = url.searchParams.get("path");
    return Response.json(url.pathname === FILES_STAT_PATH ? statPath(target) : listDirectory(target), { headers });
  };
  const read = (request: Request): Response => {
    let allow: string | undefined;
    try {
      const url = new URL(request.url);
      const notesPath = url.pathname === NOTES_PATH;
      const exportPath = Boolean(notes) && url.pathname === NOTES_EXPORT_PATH;
      const importPath = Boolean(notes) && url.pathname === NOTES_IMPORT_PATH;
      const filesPath = Boolean(files) && (url.pathname === FILES_PATH || url.pathname.startsWith(`${FILES_PATH}/`));
      const actionPath = Boolean(writer) && SESSION_ACTIONS.test(url.pathname);
      const calculatorPath = Boolean(calculator) && url.pathname === CALCULATOR_PATH;
      if ((notesPath && notes) || calculatorPath) allow = "GET, POST";
      if (importPath || actionPath || (filesPath && FILES_WRITE_PATHS.has(url.pathname))) allow = "POST";
      const player = url.pathname === PLAYER_PATH;
      checkRequest(request, config.webPort, { allowCrossSite: player });
      if (allow === "POST") throw new RelayError("METHOD_NOT_ALLOWED", `${importPath ? "가져오기" : actionPath ? "세션 정리" : filesPath && url.pathname === FILES_SAVE_PATH ? "저장" : filesPath && url.pathname !== FILES_OPEN_PATH ? "파일 정리" : "열기"}는 POST만 허용합니다.`, 2, 405);
      if (request.method !== "GET") throw new RelayError("METHOD_NOT_ALLOWED", allow ? `${calculatorPath ? "계산 이력" : "메모"}는 GET 조회와 POST 저장만 허용합니다.` : "GET 조회만 허용합니다.", 2, 405);
      if (notesPath) return listNotes(request, url);
      if (calculatorPath) {
        if (url.search) throw new RelayError("INVALID_ARGUMENT", "계산 이력은 query를 받지 않습니다.");
        return Response.json(calculator!.list(), { headers });
      }
      if (exportPath) return exportNotes(url);
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
      if (notes && pathname === NOTES_IMPORT_PATH) return importNotes(request);
      if (files && pathname === FILES_OPEN_PATH) return openFile(request);
      if (files && (pathname === FILES_PASTE_PATH || pathname === FILES_DELETE_PATH)) return writeFiles(request, pathname);
      if (files && pathname === FILES_SAVE_PATH) return saveText(request);
      if (calculator && pathname === CALCULATOR_PATH) return saveCalculation(request);
      const action = writer ? SESSION_ACTIONS.exec(pathname) : null;
      if (action) return actOnSession(request, action[1]);
    }
    return read(request);
  };
}

export function startServer(config: Config) {
  const db = openDatabase(config, true);
  // 세션은 읽기 전용 연결로 읽고, 쓰기(메모 저장, 목록에서 하는 세션 정리, 계산 이력)는 따로 연 쓰기 연결로 한다.
  const writeDb = openDatabase(config);
  const service = new SessionService(new SessionRepository(db));
  const writer = new SessionService(new SessionRepository(writeDb), config.retentionDays);
  let server;
  try {
    server = Bun.serve({ hostname: config.webHost, port: config.webPort,
      fetch: handler(service, config, { notes: new NoteStore(writeDb), files: { launch: systemLauncher }, writer, calculator: new CalculatorStore(writeDb) }),
      maxRequestBodySize: MAX_IMPORT_BYTES, development: false, reusePort: false });
  } catch (error) {
    db.close(); writeDb.close();
    if ((error as { code?: string }).code === "EADDRINUSE") throw portFailure(config.webPort, "PORT_IN_USE", "포트가 사용 중입니다. 기존 서버를 확인하거나 --port를 지정하세요.");
    throw new RelayError("SERVER_START_FAILED", "로컬 서버를 시작할 수 없습니다. 포트와 권한을 확인하세요.", 6, 500);
  }
  let stopped = false;
  return { server, async stop() { if (!stopped) { stopped = true; await server.stop(false); db.close(); writeDb.close(); } } };
}
