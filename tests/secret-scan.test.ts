import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "./helpers";

// 픽스처의 비밀 값은 조각을 이어 붙여 만든다. 이 파일 자체가 검사에 걸리지 않게 하기 위해서다.
const fakeWord = "forbidden" + "sample";
const ip = ["52", "79", "11", "23"].join(".");
const keyHeader = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
const ghToken = "ghp" + "_" + "a1B2c3D4".repeat(5);
const pemPath = "C:" + "\\keys\\server.pem";

const repo = mkdtempSync(path.join(tmpdir(), "relay-secret-scan-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Relay contributors", GIT_AUTHOR_EMAIL: "relay@example.invalid", GIT_COMMITTER_NAME: "Relay contributors", GIT_COMMITTER_EMAIL: "relay@example.invalid" } });
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

function commit(file: string, content: string) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
  git("add", "--", file);
  const result = git("commit", "-q", "-m", `add ${file}`);
  if (result.code !== 0) git("reset", "-q", "HEAD", "--", file);
  return result;
}

git("init", "-q");
mkdirSync(path.join(repo, "scripts"));
cpSync(path.join(root, "scripts/secret-scan.mjs"), path.join(repo, "scripts/secret-scan.mjs"));
writeFileSync(path.join(repo, "scripts/secret-scan.hashes.json"), JSON.stringify({ sha256: [createHash("sha256").update(fakeWord).digest("hex")] }));
cpSync(path.join(root, ".githooks"), path.join(repo, ".githooks"), { recursive: true });
git("config", "core.hooksPath", ".githooks");
git("config", "core.autocrlf", "false");

test("pre-commit 훅이 비밀·서버 정보를 막고 원문 값은 출력하지 않는다", () => {
  const cases: Array<[string, string, string]> = [
    ["notes/ip.md", `서버: ${ip}\n`, "공인 IP 주소"],
    ["notes/key.txt", `${keyHeader}\nabc\n`, "개인키 블록"],
    ["notes/token.md", `token=${ghToken}\n`, "GitHub 토큰"],
    ["notes/ssh.md", `ssh -i ${pemPath} host\n`, "pem 파일 실제 경로"],
    ["notes/domain.md", `https://relay.${fakeWord.toUpperCase()}.com\n`, "실제 서비스 식별자"],
    ["deploy/.env", "A=1\n", "환경 변수 파일"],
    ["keys/server.pem", "x\n", "키·인증서 파일"],
  ];
  for (const [file, content, rule] of cases) {
    const result = commit(file, content);
    expect(result.code, file).not.toBe(0);
    expect(result.out).toContain(rule);
    expect(result.out).not.toContain(ip);
    expect(result.out).not.toContain(ghToken);
    expect(result.out.toLowerCase()).not.toContain(fakeWord);
  }
  expect(git("rev-parse", "--verify", "-q", "HEAD").code).not.toBe(0);
});

test("루프백·사설·문서용 주소, 예시 파일, 허용 표시 줄은 통과한다", () => {
  expect(commit("ok/local.md", "http://127.0.0.1:7474 10.0.0.2 192.168.0.1 203.0.113.5 버전 1.2.3\n/etc/letsencrypt/live/$RELAY_DOMAIN/fullchain.pem\nssh -i <pem> <사용자>@<호스트>\n").code).toBe(0);
  expect(commit("server/.env.example", "DATABASE_URL=postgres://relay@postgres/relay\n").code).toBe(0);
  expect(commit("ok/allowed.md", `예시 ${ip} <!-- secret-scan: allow -->\n`).code).toBe(0);
});

test("--all은 추적 파일 전체에서 같은 규칙을 적용한다", () => {
  const script = path.join(repo, "scripts/secret-scan.mjs");
  const clean = Bun.spawnSync(["node", script, "--all"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  expect(clean.exitCode).toBe(0);
  writeFileSync(path.join(repo, "ok/local.md"), `다시 ${ip}\n`);
  const dirty = Bun.spawnSync(["node", script, "--all"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  expect(dirty.exitCode).toBe(1);
  expect(dirty.stderr.toString()).toContain("ok/local.md:1");
  expect(dirty.stderr.toString()).not.toContain(ip);
});
