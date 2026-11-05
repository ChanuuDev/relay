import { invalid } from "./errors.js";
import { SESSION_STATUSES, type SessionStatus } from "./session.types.js";

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

/**
 * 작업 경로를 저장하는 모양으로 다듬는다(절대경로, 구분자는 `/`, 끝 `/` 제거). 실제 존재 여부는 보지 않으므로
 * 원격 서버와 브라우저에서도 쓸 수 있다. 존재 확인이 필요한 CLI는 자기 `directory`를 쓴다.
 */
export function directoryText(value: unknown): string {
  const input = text(value, "cwd", 4096);
  const forward = input.replaceAll("\\", "/");
  if (!/^(\/|[A-Za-z]:\/)/.test(forward)) invalid("경로는 절대경로여야 합니다.");
  const root = /^[A-Za-z]:\//.test(forward) ? forward.slice(0, 3) : "/";
  const collapsed = forward.replace(/\/{2,}/g, "/");
  return collapsed === root ? root : collapsed.replace(/\/$/, "");
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

/** The work state an agent declares; absent means it declared none. */
export function sessionStatus(value: unknown): SessionStatus | null {
  if (value === undefined || value === null) return null;
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!(SESSION_STATUSES as readonly string[]).includes(status)) invalid(`status: ${SESSION_STATUSES.join(" | ")} 중 하나를 입력하세요.`);
  return status as SessionStatus;
}

/** A flag on the CLI arrives as a boolean; a query string carries 1/0 or true/false. */
export function flag(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false") return false;
  return invalid(`${field}: 1/0 또는 true/false를 입력하세요.`);
}

/** 기록에 붙는 git 단서. 서버는 PC의 작업 트리를 모르므로 CLI가 보낸 값을 모양만 확인해 저장한다. */
export function gitClue(value: unknown): { branch: string | null; commit: string | null; dirty: number; at: string } | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("git: { branch, commit, dirty, at } 객체여야 합니다.");
  const raw = value as Record<string, unknown>;
  const branch = raw.branch === null || raw.branch === undefined ? null : text(raw.branch, "git.branch", 200);
  const commit = raw.commit === null || raw.commit === undefined ? null : text(raw.commit, "git.commit", 64);
  const dirty = integer(raw.dirty ?? 0, "git.dirty", 0, 0, 1_000_000);
  const at = text(raw.at, "git.at", 64);
  if (Number.isNaN(Date.parse(at))) invalid("git.at: ISO 8601 시각이어야 합니다.");
  return { branch, commit, dirty, at };
}
