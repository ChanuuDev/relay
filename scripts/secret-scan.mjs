#!/usr/bin/env node
// 커밋에 서버 접속 정보·비밀·실제 서비스 식별자가 섞이지 않게 막는 검사.
//   node scripts/secret-scan.mjs --staged   스테이징한 추가 줄·파일 이름·작성자 (pre-commit 훅)
//   node scripts/secret-scan.mjs --all      추적 중인 모든 파일 (npm run check, CI)
//   node scripts/secret-scan.mjs --hash <값> 금지어 해시 계산 (secret-scan.hashes.json에 넣는다)
// 결과에는 찾은 값의 원문을 찍지 않고 위치와 규칙 이름만 보인다.
// 의도한 예외 줄에는 `secret-scan: allow`를 적는다. 급할 때만 `git commit --no-verify`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOW = "secret-scan: allow";
const MAX_BYTES = 2 * 1024 * 1024;

/** 실제 값 대신 sha256(소문자 낱말)만 저장소에 둔다. */
const forbiddenHashes = new Set(JSON.parse(readFileSync(path.join(here, "secret-scan.hashes.json"), "utf8")).sha256);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const contentRules = [
  { name: "개인키 블록", test: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { name: "GitHub 토큰", test: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: "AWS 액세스 키", test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Bearer 토큰 원문", test: /\bBearer\s+[A-Za-z0-9_\-.=]{32,}/ },
  { name: "pem 파일 실제 경로", test: /(?:\b[A-Za-z]:[\\/][^\s"'`<>|]*\.pem\b|-i\s+["']?(?![<$])[^\s"'`<>]*\.pem\b|~[\\/][^\s"'`<>]*\.pem\b)/ },
  { name: "공인 IP 주소", test: (line) => publicIp(line) },
];

const fileRules = [
  { name: "키·인증서 파일", test: /\.(?:pem|key|p12|pfx|ppk)$/i },
  { name: "SSH 키 파일", test: /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/ },
  { name: "환경 변수 파일", test: /(?:^|\/)\.env(?:\.(?!example$)[^/]+)?$/ },
  { name: "비밀 폴더", test: /(?:^|\/)secrets\// },
  { name: "비공개 설계 문서", test: /^설계\/설계\.md$/ },
];

/** 문서용·사설·루프백 대역은 통과시키고 나머지 IPv4만 잡는다. */
function publicIp(line) {
  for (const match of line.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g)) {
    const [a, b, c] = match.slice(1, 4).map(Number);
    if (match.slice(1).some((part) => Number(part) > 255 || (part.length > 1 && part.startsWith("0")))) continue;
    const allowed = a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
      || (a === 198 && (b === 18 || b === 19));
    if (!allowed) return true;
  }
  return false;
}

function forbiddenWord(text) {
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && forbiddenHashes.has(sha256(word))) return true;
  }
  return false;
}

/** 한 줄의 위반 규칙 이름들. */
export function scanLine(line) {
  if (line.includes(ALLOW)) return [];
  const found = contentRules.filter((rule) => (typeof rule.test === "function" ? rule.test(line) : rule.test.test(line))).map((rule) => rule.name);
  if (forbiddenWord(line)) found.push("실제 서비스 식별자(금지어)");
  return found;
}

export function scanPath(file) {
  const found = fileRules.filter((rule) => rule.test.test(file)).map((rule) => rule.name);
  if (forbiddenWord(file)) found.push("실제 서비스 식별자(금지어)");
  return found;
}

const git = (args) => execFileSync("git", ["-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function scanStaged() {
  const problems = [];
  const names = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean);
  for (const name of names) for (const rule of scanPath(name)) problems.push({ where: name, rule });

  const diff = git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"]);
  let file = ""; let lineNo = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, ""); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (raw.startsWith("+") && file) {
      for (const rule of scanLine(raw.slice(1))) problems.push({ where: `${file}:${lineNo}`, rule });
      lineNo++;
    }
  }

  for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    let ident = "";
    try { ident = git(["var", variable]).replace(/\s+\d+\s+[+-]\d{4}\s*$/, ""); } catch { continue; }
    if (forbiddenWord(ident)) problems.push({ where: variable === "GIT_AUTHOR_IDENT" ? "커밋 작성자" : "커미터", rule: "실제 서비스 식별자(금지어)" });
  }
  return problems;
}

function scanAll() {
  const problems = [];
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  for (const name of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    for (const rule of scanPath(name)) problems.push({ where: name, rule });
    const full = path.join(top, name);
    let buffer;
    try { if (statSync(full).size > MAX_BYTES) continue; buffer = readFileSync(full); } catch { continue; }
    if (buffer.subarray(0, 8192).includes(0)) continue;
    buffer.toString("utf8").split(/\r?\n/).forEach((line, index) => {
      for (const rule of scanLine(line)) problems.push({ where: `${name}:${index + 1}`, rule });
    });
  }
  return problems;
}

function main(argv) {
  if (argv[0] === "--hash") {
    if (!argv[1]) { process.stderr.write("사용법: node scripts/secret-scan.mjs --hash <낱말>\n"); return 2; }
    process.stdout.write(sha256(argv[1].toLowerCase()) + "\n");
    return 0;
  }
  const mode = argv[0] ?? "--staged";
  if (mode !== "--staged" && mode !== "--all") { process.stderr.write(`알 수 없는 옵션: ${mode}\n`); return 2; }
  const problems = mode === "--all" ? scanAll() : scanStaged();
  if (problems.length === 0) {
    if (mode === "--all") process.stdout.write("secret-scan: 추적 파일에서 비밀·서버 정보를 찾지 못했습니다.\n");
    return 0;
  }
  process.stderr.write(`secret-scan: 깃에 올리면 안 되는 내용을 ${problems.length}건 찾았습니다 (값은 표시하지 않음).\n`);
  for (const problem of problems.slice(0, 50)) process.stderr.write(`  ${problem.where}  ${problem.rule}\n`);
  if (problems.length > 50) process.stderr.write(`  … 외 ${problems.length - 50}건\n`);
  process.stderr.write("값을 지우거나 비공개 설정(.env·secrets)으로 옮기세요. 의도한 예시라면 그 줄에 `secret-scan: allow`를 적습니다.\n");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
