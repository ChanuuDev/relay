import { RelayError } from "../errors";

export const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
};

export function checkRequest(request: Request, port: number) {
  const host = request.headers.get("host");
  const allowed = port === 80 ? ["127.0.0.1", "localhost", "127.0.0.1:80", "localhost:80"] : [`127.0.0.1:${port}`, `localhost:${port}`];
  const origin = request.headers.get("origin");
  if (!host || !allowed.includes(host)) {
    throw new RelayError("FORBIDDEN", "허용하지 않는 Host 또는 Origin입니다.", 2, 403);
  }
  const expectedOrigin = new URL(`http://${host}`).origin;
  if ((origin !== null && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RelayError("FORBIDDEN", "허용하지 않는 Host 또는 Origin입니다.", 2, 403);
  }
}
