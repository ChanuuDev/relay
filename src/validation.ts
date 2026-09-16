import { statSync } from "node:fs";
import path from "node:path";
import { invalid } from "./errors";
import type { SessionStatus } from "./session/session.types";

export function text(value: unknown, field: string, max: number, multiline = false): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max ||
    (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) {
    invalid(`${field}: 비어 있지 않은 ${max}자 이내 텍스트를 입력하세요.`);
  }
  return value;
}

export function identifier(value: unknown, field: string): string {
  const result = text(value, field, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(result)) invalid(`${field}: 영문 소문자·숫자·하이픈을 사용하세요.`);
  return result;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  return value === undefined || value === null ? null : text(value, field, max);
}

export function status(value: unknown, terminal = false): SessionStatus {
  const normalized = text(value, "status", 20).toUpperCase() as SessionStatus;
  if (!["ACTIVE", "INTERRUPTED", "COMPLETED", "ABANDONED"].includes(normalized) ||
    (terminal && normalized === "ACTIVE")) invalid("허용하지 않는 status입니다.");
  return normalized;
}

export function directory(value: unknown, mustExist: boolean): string {
  const input = text(value, "cwd", 4096);
  if (!path.isAbsolute(input)) invalid("경로는 절대경로여야 합니다.");
  const normalized = path.normalize(input);
  if (mustExist) {
    try { if (!statSync(normalized).isDirectory()) invalid("cwd는 실제 디렉터리여야 합니다."); }
    catch { invalid("cwd 디렉터리를 찾거나 읽을 수 없습니다."); }
  }
  // Lexical normalization keeps historical paths queryable after directories disappear.
  const forward = normalized.replaceAll("\\", "/");
  return forward === path.parse(normalized).root.replaceAll("\\", "/") ? forward : forward.replace(/\/$/, "");
}

export function integer(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) invalid(`${field}: 정수를 입력하세요.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) invalid(`${field}: ${min}~${max} 범위여야 합니다.`);
  return n;
}

export function pagination(input: { limit?: unknown; offset?: unknown } = {}) {
  return { limit: integer(input.limit, "limit", 50, 1, 100),
    offset: integer(input.offset, "offset", 0, 0, Number.MAX_SAFE_INTEGER) };
}
