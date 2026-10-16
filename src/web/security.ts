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
