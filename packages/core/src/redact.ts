// 메모 글을 사람이 아닌 곳(에이전트의 맥락, 임베딩 모델의 입력, 검색 결과의 발췌)으로 보낼 때 쓰는 규칙.

/** 토큰 수 어림. 영문·숫자·기호는 3.5글자에 하나, 한글 등은 1.2글자에 하나로 본다. 실제 메모의 조각 500개를 임베딩 모델(KURE-v3)의
 *  토크나이저로 세어 맞춘 값이다(맞춘 식 3.49, 1.18). 앞서 쓰던 4와 1.5는 실제의 0.8배로 적게 셌다. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 3.5 + (text.length - ascii) / 1.2);
}

const PASS_KEYS = "password|passwd|passphrase|pwd|비밀번호|비번|암호|패스워드";
/** 이름만으로 비밀임이 분명한 것. */
const SECRET_KEYS = "secret|api[ _-]?key|access[ _-]?key|secret[ _-]?key|client[ _-]?secret|private[ _-]?key|auth[ _-]?key|인증 ?키|시크릿|비밀 ?키|접속 ?키";
/** 비밀이 아닌 뜻으로도 흔히 쓰는 이름(디자인 토큰, 문법의 토큰). 값이 자격 증명처럼 생겼을 때만 가린다. */
const LOOSE_KEYS = "token|토큰";
const cellOf = (keys: string) => new RegExp(`^[\\s*_\`]*(?:${keys})[\\s*_\`]*$`, "i");
const PASS_CELL = cellOf(`${PASS_KEYS}|pw`), SECRET_CELL = cellOf(SECRET_KEYS), LOOSE_CELL = cellOf(LOOSE_KEYS);
const KEY_VALUE = new RegExp(`((?:${PASS_KEYS}|${SECRET_KEYS}|${LOOSE_KEYS})[^\\S\\n]{0,3}(?:[:=：]|\\|)[^\\S\\n]*)([^\\s|]+)`, "gi");
const PASS_KEY = new RegExp(`^(?:${PASS_KEYS})`, "i");
const LOOSE_KEY = new RegExp(`^(?:${LOOSE_KEYS})`, "i");
export const REDACTED = "[가림]";
const bare = (value: string) => value.trim().replace(/^[`"'*_]+|[`"'*_,.;]+$/g, "");
/** 값이 비밀처럼 생겼는가: 숫자나 기호가 섞인 6자 이상 덩어리. 「토큰: 입력」 같은 설명 글은 가리지 않는다. */
const secretish = (value: string) => value.length >= 6 && /[0-9!@#$%^&*+=~_\-]/.test(value) && /[A-Za-z\p{L}]/u.test(value) && !/^https?:\/\//i.test(value);
/** 글자 종류(소문자·대문자·숫자)가 바뀌는 자리의 비율. 무작위로 만든 값은 두 글자에 한 번꼴로 바뀌고(0.6 안팎),
 *  낱말을 이어 붙인 이름(`RelayDesktopWindow2`)이나 경로는 낱말이 바뀔 때만 바뀐다(0.3 안팎). */
function mixing(value: string): number {
  let turns = 0, count = 0, before = "";
  for (const char of value) {
    const kind = char >= "a" && char <= "z" ? "l" : char >= "A" && char <= "Z" ? "u" : char >= "0" && char <= "9" ? "d" : "";
    if (!kind) continue;
    if (before && before !== kind) turns++;
    before = kind; count++;
  }
  return count > 1 ? turns / (count - 1) : 0;
}
const mixedCase = (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
/** 무작위로 만든 값처럼 보이는가(토큰·키). 파일 경로와 낱말을 이어 붙인 이름은 아니다. */
const randomLike = (value: string, min = 24) => value.length >= min && mixedCase(value) && mixing(value) >= 0.45;
/** 자격 증명처럼 생겼는가: UUID, 글자와 숫자가 여러 번 섞이는 덩어리, 길고 무작위인 값. `--color-surface`·`gray900` 같은 디자인 토큰 이름은 아니다. */
function credentialLike(raw: string): boolean {
  const value = bare(raw);
  if (/\s/.test(value) || /^https?:\/\//i.test(value)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  for (const run of value.match(/[A-Za-z0-9]{8,}/g) ?? []) {
    // 글자와 숫자가 세 번 넘게 번갈아 나온다: `gray900`(한 번)은 이름이고 `8f3k2j9d`는 값이다.
    if ((run.match(/[A-Za-z](?=[0-9])|[0-9](?=[A-Za-z])/g) ?? []).length >= 3) return true;
  }
  return randomLike(value, 20);
}
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
    : PASS_KEY.test(head) || (LOOSE_KEY.test(head) ? credentialLike(value) : secretish(value)) ? mask(`${head}${REDACTED}`) : match));
  // 표: 머리 칸이 비밀번호면 그 열을 모두 가린다. 비밀 키·시크릿이면 값 하나로 된 칸을, 「토큰」이면 자격 증명처럼 생긴 칸만 가린다
  // (디자인 문서의 「토큰」 열은 `--dur-fast` 같은 이름이라, 열을 통째로 가리면 그 표가 임베딩과 발췌에서 사라진다).
  const lines = out.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]!) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) continue;
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|");
    const columns = cells(lines[i]!).map((cell, at): [number, (value: string) => boolean] | null => (PASS_CELL.test(cell) ? [at, () => true]
      : SECRET_CELL.test(cell) ? [at, (value) => bare(value).length >= 4 && !/\s/.test(bare(value))] : LOOSE_CELL.test(cell) ? [at, credentialLike] : null))
      .filter((column): column is [number, (value: string) => boolean] => column !== null);
    let row = i + 2;
    for (; row < lines.length && /^\s*\|.*\|\s*$/.test(lines[row]!); row++) {
      if (!columns.length) continue;
      const parts = cells(lines[row]!);
      let changed = false;
      for (const [at, secret] of columns) if (parts[at]?.trim() && parts[at]!.trim() !== REDACTED && secret(parts[at]!)) { parts[at] = ` ${REDACTED} `; count++; changed = true; }
      if (changed) lines[row] = `|${parts.join("|")}|`;
    }
    i = row - 1;
  }
  out = lines.join("\n");
  // 대소문자와 숫자가 무작위로 뒤섞인 긴 문자열(해시·UUID는 소문자와 숫자뿐이라 걸리지 않는다). 파일 경로와 낱말을 이은 이름은 남긴다:
  // 실제 메모에서 이 규칙에 걸린 값 747개 가운데 672개가 경로였다. 경로 안에 무작위 마디가 있으면 그 마디만 가린다.
  out = out.replace(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_-])/g, (value) => {
    if (!mixedCase(value)) return value;
    const parts = value.split("/");
    if (parts.length === 1) return randomLike(value) ? mask(REDACTED) : value;
    const random = parts.map((part) => randomLike(part, 20));
    const share = parts.reduce((sum, part, at) => sum + (random[at] ? part.length : 0), 0) / value.length;
    // base64는 `/`가 섞여 마디가 짧게 끊긴다: 값 전체가 무작위면 통째로, 마디 대부분이 무작위면 그것도 통째로 가린다.
    if (share >= 0.6 || mixing(value) >= 0.55) return mask(REDACTED);
    if (!random.some(Boolean)) return value;
    return parts.map((part, at) => (random[at] ? mask(REDACTED) : part)).join("/");
  });
  return { text: out, count };
}
