import { RelayError } from "../errors";

/** 서버가 받아들이는 Host 값. 80번 포트는 포트 없는 표기도 허용한다. */
export const loopbackHosts = (port: number) =>
  (port === 80 ? ["127.0.0.1", "localhost", "127.0.0.1:80", "localhost:80"] : [`127.0.0.1:${port}`, `localhost:${port}`]);
export const localhostOrigin = (port: number) => (port === 80 ? "http://localhost" : `http://localhost:${port}`);

/** 메인 화면과 API의 보안 헤더. 유튜브 창을 위해 localhost 출처의 플레이어 래퍼(iframe)·섬네일·oEmbed만 바깥에서 받는다. */
export function securityHeaders(port: number) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'self'; img-src 'self' blob: https://i.ytimg.com; script-src 'self'; style-src 'self'; connect-src 'self' https://www.youtube.com; frame-src 'self' ${localhostOrigin(port)}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    "Referrer-Policy": "no-referrer",
  };
}

/** 플레이어 래퍼 페이지의 보안 헤더. 유튜브 플레이어만 넣을 수 있고, 이 서버의 두 루프백 출처만 이 페이지를 iframe으로 넣을 수 있다. */
export function playerHeaders(port: number) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${loopbackHosts(port).map((host) => `http://${host}`).join(" ")}`,
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

/** 메모 저장 한 번에 받는 최대 크기. 본문 하나는 20만 자까지라 여러 메모를 함께 보내도 넉넉하다. */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024;
/** 메모 가져오기 한 번에 받는 최대 크기. 내보낸 파일 하나를 통째로 받으므로 저장 묶음보다 크다. 서버 전체의 본문 상한이기도 하다. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** 쓰기 요청(메모 저장·가져오기, 파일 열기) 검사. 같은 출처 화면이 JSON으로 보낸 요청만 받는다.
 *  Origin이 있어야 하고 Sec-Fetch-Site는 same-origin이어야 하며, JSON 본문이라 다른 사이트의 폼이나 단순 요청으로는 보낼 수 없다. */
export function checkWrite(request: Request, port: number, limit = MAX_WRITE_BYTES) {
  checkRequest(request, port);
  const site = request.headers.get("sec-fetch-site");
  if (!request.headers.get("origin") || (site !== null && site !== "same-origin")) {
    throw new RelayError("FORBIDDEN", "이 화면에서 보낸 저장만 받습니다.", 2, 403);
  }
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new RelayError("UNSUPPORTED_MEDIA_TYPE", "저장은 application/json으로 보내야 합니다.", 2, 415);
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > limit) throw new RelayError("PAYLOAD_TOO_LARGE", `보낸 내용이 너무 큽니다(최대 ${limit / 1024 / 1024}MB).`, 2, 413);
}

export function checkRequest(request: Request, port: number, options: { allowCrossSite?: boolean } = {}) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !loopbackHosts(port).includes(host)) {
    throw new RelayError("FORBIDDEN", "허용하지 않는 Host 또는 Origin입니다.", 2, 403);
  }
  const expectedOrigin = new URL(`http://${host}`).origin;
  // 127.0.0.1 화면이 localhost 출처의 플레이어 래퍼를 iframe으로 넣으면 브라우저는 cross-site로 표시한다. 그 경로만 허용한다.
  if ((origin !== null && origin !== expectedOrigin) || (!options.allowCrossSite && request.headers.get("sec-fetch-site") === "cross-site")) {
    throw new RelayError("FORBIDDEN", "허용하지 않는 Host 또는 Origin입니다.", 2, 403);
  }
}
