export class RelayError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 2,
    public httpStatus = 400,
    public details?: Record<string, unknown>,
  ) { super(message); }
}

export function storageError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const code = (error as { code?: string })?.code ?? "";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return new RelayError("DB_BUSY", "저장소가 사용 중입니다. 잠금 해제 후 다시 확인하세요.", 5, 503);
  }
  return new RelayError("STORAGE_ERROR", "저장소에 접근할 수 없습니다. 경로와 권한을 확인하세요.", 5, 503);
}

export function errorBody(error: RelayError) {
  return { schemaVersion: 1, error: { code: error.code, message: error.message,
    ...(error.details ? { details: error.details } : {}) } };
}

export function invalid(message: string): never {
  throw new RelayError("INVALID_ARGUMENT", message);
}
