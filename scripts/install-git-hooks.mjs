// npm install(prepare) 때 이 저장소의 .githooks를 깃 훅 폴더로 쓰게 한다. 깃 저장소가 아니면(도커 빌드 등) 조용히 넘어간다.
import { execFileSync } from "node:child_process";
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch { /* 깃이 없거나 저장소가 아님 */ }
