import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch { return "0.0.0"; }
}

/** server/package.json의 version. dist/version.js와 src/version.ts 모두에서 한 단계 위가 패키지 루트다. */
export const APP_VERSION = readVersion();
