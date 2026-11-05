import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import path from "node:path";
import { dataDirectory } from "./config";

const MAX_BYTES = 2 * 1024 * 1024;

/** ~/.relay/desktop.log 에 한 줄씩. 토큰·비밀은 절대 적지 않는다. 2MB를 넘으면 .1로 돌린다. */
export function log(level: "info" | "warn" | "error", message: string) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`;
  try {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "desktop.log");
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`); } catch { /* 없으면 새로 만든다 */ }
    appendFileSync(file, line);
  } catch { /* 로그를 못 써도 앱은 계속 간다 */ }
  if (level === "error") console.error(line.trimEnd()); else if (process.env.RELAY_DESKTOP_DEBUG) console.log(line.trimEnd());
}

export const logFile = () => path.join(dataDirectory(), "desktop.log");
