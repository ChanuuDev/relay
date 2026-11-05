/** Relay 전체(CLI·로컬 서버·원격 서버)가 같은 코드·종료 코드·HTTP 상태로 쓰는 오류. */
export class RelayError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 2,
    public httpStatus = 400,
    public details?: Record<string, unknown>,
  ) { super(message); this.name = "RelayError"; }
}

/** API·CLI `--json`의 오류 본문. */
export function errorBody(error: RelayError) {
  return { schemaVersion: 1, error: { code: error.code, message: error.message,
    ...(error.details ? { details: error.details } : {}) } };
}

export function invalid(message: string): never {
  throw new RelayError("INVALID_ARGUMENT", message);
}

/** 오류 코드별 종료 코드·HTTP 상태. 원격 서버가 돌려준 오류를 CLI가 같은 종료 코드로 되살릴 때 쓴다. */
export const ERROR_CODES: Record<string, { exitCode: number; httpStatus: number }> = {
  INVALID_ARGUMENT: { exitCode: 2, httpStatus: 400 },
  INVALID_CONFIG: { exitCode: 2, httpStatus: 400 },
  FORBIDDEN: { exitCode: 2, httpStatus: 403 },
  UNAUTHORIZED: { exitCode: 7, httpStatus: 401 },
  METHOD_NOT_ALLOWED: { exitCode: 2, httpStatus: 405 },
  UNSUPPORTED_MEDIA_TYPE: { exitCode: 2, httpStatus: 415 },
  PAYLOAD_TOO_LARGE: { exitCode: 2, httpStatus: 413 },
  NOT_FOUND: { exitCode: 3, httpStatus: 404 },
  SESSION_NOT_FOUND: { exitCode: 3, httpStatus: 404 },
  FILE_NOT_FOUND: { exitCode: 3, httpStatus: 404 },
  PARENT_CONFLICT: { exitCode: 4, httpStatus: 409 },
  SESSION_EXISTS: { exitCode: 4, httpStatus: 409 },
  AMBIGUOUS_SESSION_ID: { exitCode: 4, httpStatus: 409 },
  SESSION_LINKED: { exitCode: 4, httpStatus: 409 },
  STORAGE_ERROR: { exitCode: 5, httpStatus: 503 },
  DB_BUSY: { exitCode: 5, httpStatus: 503 },
  SCHEMA_MISMATCH: { exitCode: 5, httpStatus: 503 },
  INTERNAL_ERROR: { exitCode: 5, httpStatus: 500 },
  REMOTE_UNREACHABLE: { exitCode: 7, httpStatus: 502 },
  REMOTE_UNAUTHORIZED: { exitCode: 7, httpStatus: 401 },
  REMOTE_QUEUED: { exitCode: 0, httpStatus: 202 },
  REMOTE_FORBIDDEN_PATH: { exitCode: 2, httpStatus: 403 },
};

/** 원격 서버의 오류 본문을 같은 코드의 RelayError로 되살린다. 모르는 코드는 상태만 따른다. */
export function errorFromBody(body: unknown, httpStatus: number): RelayError {
  const raw = body && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error : undefined;
  const code = typeof raw?.code === "string" && raw.code ? raw.code : httpStatus === 401 ? "REMOTE_UNAUTHORIZED" : httpStatus === 404 ? "NOT_FOUND" : "INTERNAL_ERROR";
  const known = ERROR_CODES[code];
  const message = typeof raw?.message === "string" && raw.message ? raw.message : `원격 서버 오류 (HTTP ${httpStatus})`;
  const details = raw?.details && typeof raw.details === "object" ? raw.details as Record<string, unknown> : undefined;
  return new RelayError(code, message, known?.exitCode ?? 5, known?.httpStatus ?? httpStatus, details);
}
