// 메모 글을 사람이 아닌 곳(에이전트의 맥락, 임베딩 모델의 입력, 검색 결과의 발췌)으로 보낼 때 쓰는 규칙.

/** 토큰 수 어림. 영문·숫자·기호는 네 글자에 하나, 한글 등은 1.5글자에 하나로 본다(모델마다 다르므로 넉넉하게 잡은 값이다). */
export function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 4 + (text.length - ascii) / 1.5);
}

const PASS_KEYS = "password|passwd|passphrase|pwd|비밀번호|비번|암호|패스워드";
const SOFT_KEYS = "secret|token|api[ _-]?key|access[ _-]?key|secret[ _-]?key|client[ _-]?secret|private[ _-]?key|auth[ _-]?key|토큰|인증 ?키|시크릿|비밀 ?키|접속 ?키";
const KEY_CELL = new RegExp(`^[\\s*_\`]*(?:${PASS_KEYS}|${SOFT_KEYS}|pw)[\\s*_\`]*$`, "i");
const KEY_VALUE = new RegExp(`((?:${PASS_KEYS}|${SOFT_KEYS})[^\\S\\n]{0,3}(?:[:=：]|\\|)[^\\S\\n]*)([^\\s|]+)`, "gi");
const PASS_KEY = new RegExp(`^(?:${PASS_KEYS})`, "i");
export const REDACTED = "[가림]";
/** 값이 비밀처럼 생겼는가: 숫자나 기호가 섞인 6자 이상 덩어리. 「토큰: 입력」 같은 설명 글은 가리지 않는다. */
const secretish = (value: string) => value.length >= 6 && /[0-9!@#$%^&*+=~_\-]/.test(value) && /[A-Za-z\p{L}]/u.test(value) && !/^https?:\/\//i.test(value);
const SHAPES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[가림: 개인 키]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, REDACTED],
];

/** 비밀번호·토큰·키처럼 보이는 값을 가린다. 알려진 토큰 모양, `비밀번호: 값` 꼴, 비밀번호 열이 있는 표, 주소에 든 암호, 길고 뒤섞인 문자열을 본다.
 *  보이는 것만 가리므로 모든 비밀을 막는다고 보지 않는다. */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  const mask = (value: string) => { count++; return value; };
  let out = text;
  for (const [pattern, to] of SHAPES) out = out.replace(pattern, () => mask(to));
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, (_match, head: string) => mask(`${head}${REDACTED}`));
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, (_match, head: string, at: string) => mask(`${head}${REDACTED}${at}`));
  out = out.replace(KEY_VALUE, (match, head: string, value: string) => (value === REDACTED || value.startsWith("[가림") ? match
    : PASS_KEY.test(head) || secretish(value) ? mask(`${head}${REDACTED}`) : match));
  // 표: 머리 칸이 비밀번호·토큰이면 그 열의 값을 가린다.
  const lines = out.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]!) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) continue;
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|");
    const columns = cells(lines[i]!).map((cell, at) => (KEY_CELL.test(cell) ? at : -1)).filter((at) => at >= 0);
    let row = i + 2;
    for (; row < lines.length && /^\s*\|.*\|\s*$/.test(lines[row]!); row++) {
      if (!columns.length) continue;
      const parts = cells(lines[row]!);
      for (const at of columns) if (parts[at]?.trim() && parts[at]!.trim() !== REDACTED) { parts[at] = ` ${REDACTED} `; count++; }
      lines[row] = `|${parts.join("|")}|`;
    }
    i = row - 1;
  }
  out = lines.join("\n");
  // 대소문자와 숫자가 뒤섞인 긴 문자열(해시·UUID는 소문자와 숫자뿐이라 걸리지 않는다).
  out = out.replace(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_-])/g, (value) =>
    (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && !value.includes("/api/") ? mask(REDACTED) : value));
  return { text: out, count };
}
