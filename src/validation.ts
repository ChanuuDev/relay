import { statSync } from "node:fs";
import path from "node:path";
import { invalid } from "./errors";
import { text } from "@relay/core";

// 순수 검증은 공용 코어에 있다. 여기에는 실제 디렉터리를 확인하는 `directory`만 남긴다.
export { text, identifier, optionalText, integer, pagination, sessionStatus, flag, directoryText, gitClue } from "@relay/core";

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
