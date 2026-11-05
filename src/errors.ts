import { RelayError } from "@relay/core";

// 오류 클래스·본문·코드 표는 로컬 서버와 원격 서버가 함께 쓰는 공용 코어에 있다. 여기에는 SQLite에 묶인 변환만 남긴다.
export { RelayError, errorBody, errorFromBody, invalid, ERROR_CODES } from "@relay/core";

export function storageError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const code = (error as { code?: string })?.code ?? "";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return new RelayError("DB_BUSY", "저장소가 사용 중입니다. 잠금 해제 후 다시 확인하세요.", 5, 503);
  }
  return new RelayError("STORAGE_ERROR", "저장소에 접근할 수 없습니다. 경로와 권한을 확인하세요.", 5, 503);
}
