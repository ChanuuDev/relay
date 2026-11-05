import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { root } from "./helpers";

test("Ubuntu 토큰 CLI의 설치·인자 보존·입력 오류·Docker 실패를 실제 셸에서 검증한다", () => {
  const git = Bun.which("git");
  const candidates = process.platform === "win32"
    ? [git && path.resolve(path.dirname(git), "../bin/sh.exe"), "C:/Program Files/Git/bin/sh.exe", Bun.which("sh")]
    : ["/bin/sh"];
  const sh = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  expect(sh).toBeDefined();
  if (!sh) throw new Error("Ubuntu CLI 검증에 필요한 sh를 찾지 못했습니다.");
  const result = Bun.spawnSync([sh, path.join(root, "deploy/test-cli.sh").replaceAll("\\", "/")], { stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("기존 명령 보존 통과");
});
