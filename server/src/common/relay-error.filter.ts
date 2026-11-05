import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import { RelayError, errorBody } from "@relay/core";

/** 모든 오류를 로컬 서버와 같은 `{ schemaVersion, error: { code, message, details } }` 본문으로 돌려준다. */
@Catch()
export class RelayErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const failure = toRelayError(exception);
    if (failure.httpStatus >= 500) this.logger.error(`${failure.code}: ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`);
    response.status(failure.httpStatus);
    response.setHeader("Cache-Control", "no-store");
    if (failure.code === "DB_BUSY") response.setHeader("Retry-After", "3");
    if (failure.httpStatus === 405 && failure.details?.allow) response.setHeader("Allow", String(failure.details.allow));
    response.json(errorBody(failure));
  }
}

export function toRelayError(exception: unknown): RelayError {
  if (exception instanceof RelayError) return exception;
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message = typeof body === "string" ? body : (body as { message?: unknown })?.message;
    const text = Array.isArray(message) ? message.join(", ") : typeof message === "string" ? message : exception.message;
    if (status === 404) return new RelayError("NOT_FOUND", "요청한 경로가 없습니다.", 3, 404);
    if (status === 400) return new RelayError("INVALID_ARGUMENT", /JSON|body|entity/i.test(text) ? "JSON 본문을 읽을 수 없습니다." : text, 2, 400);
    if (status === 401) return new RelayError("UNAUTHORIZED", "인증이 필요합니다.", 7, 401);
    if (status === 403) return new RelayError("FORBIDDEN", text || "허용하지 않는 요청입니다.", 2, 403);
    if (status === 405) return new RelayError("METHOD_NOT_ALLOWED", text || "허용하지 않는 메서드입니다.", 2, 405);
    if (status === 413) return new RelayError("PAYLOAD_TOO_LARGE", "보낸 내용이 너무 큽니다.", 2, 413);
    if (status === 415) return new RelayError("UNSUPPORTED_MEDIA_TYPE", "application/json으로 보내야 합니다.", 2, 415);
    return new RelayError("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", 5, status >= 500 ? status : 500);
  }
  // body-parser의 JSON 오류·크기 초과는 HttpException이 아닌 채로 온다.
  const typed = exception as { type?: string; status?: number; code?: string };
  if (typed?.type === "entity.too.large" || typed?.status === 413) return new RelayError("PAYLOAD_TOO_LARGE", "보낸 내용이 너무 큽니다.", 2, 413);
  if (typed?.type === "entity.parse.failed" || typed?.status === 400) return new RelayError("INVALID_ARGUMENT", "JSON 본문을 읽을 수 없습니다.", 2, 400);
  if (typed?.type === "charset.unsupported" || typed?.type === "encoding.unsupported" || typed?.status === 415) return new RelayError("UNSUPPORTED_MEDIA_TYPE", "application/json으로 보내야 합니다.", 2, 415);
  if (typeof typed?.code === "string" && /^(ECONNREFUSED|ETIMEDOUT|57P01|08\d{3}|53\d{3})$/.test(typed.code)) {
    return new RelayError("STORAGE_ERROR", "저장소에 접근할 수 없습니다.", 5, 503);
  }
  if (typeof typed?.code === "string" && /^(40001|40P01|55P03)$/.test(typed.code)) return new RelayError("DB_BUSY", "저장소가 사용 중입니다. 잠시 뒤 다시 시도하세요.", 5, 503);
  return new RelayError("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", 5, 500);
}
