// 메모 글에서 낱말을 뽑고 낱말로 찾는 규칙. 메모 그래프(화면·CLI)와 서버의 검색이 같은 규칙을 써서 어디서 찾아도 같은 결과가 나온다.

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
const IMAGE_PATH = /\/api\/v1\/notes\/images\/[0-9a-f]{64}/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** 한 글자 조사는 남는 말이 두 글자 이상일 때만 뗀다(「회의」의 「의」는 떼지 않는다). 긴 것부터 본다. */
export const JOSA: readonly string[] = [
  "에서부터", "으로부터", "이라고는", "에게서", "이라고", "이라는", "에서는", "으로는", "까지는", "부터는", "에서도", "으로도", "이었다", "였다",
  "입니다", "합니다", "됩니다", "습니다", "에서", "에게", "한테", "께서", "으로", "까지", "부터", "처럼", "보다", "마다", "조차", "밖에", "이나", "이란", "이랑",
  "하고", "라고", "라는", "이며", "이고", "이다", "했다", "한다", "하는", "하기", "하여", "해서", "하면", "했던", "되는", "된다", "되어", "되면", "에는", "에도",
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만", "랑", "요",
].sort((a, b) => b.length - a.length);
const STOP_KO = new Set([
  "그리고", "그러나", "하지만", "그래서", "또한", "그런데", "따라서", "그러면", "있는", "없는", "있다", "없다", "하다", "했다", "한다", "있습니다", "없습니다",
  "같은", "같다", "이런", "저런", "그런", "이것", "그것", "저것", "여기", "거기", "우리", "저희", "너무", "매우", "정말", "아주", "조금", "많이", "가장", "모든",
  "각각", "다른", "통해", "위해", "대한", "대해", "관련", "경우", "때문", "정도", "이후", "이전", "다음", "지금", "오늘", "내일", "어제", "부분", "내용",
  "해당", "기준", "현재", "이상", "이하", "하나", "그냥", "모두", "어떤", "무엇", "어떻게", "언제", "어디", "누가", "왜냐하면", "만약", "혹은", "또는",
  "메모", "정리", "이번", "저번", "다시", "아직", "이미", "계속", "바로", "먼저", "나중", "때문에", "있음", "없음", "함", "됨", "것", "수", "등", "및", "중", "후", "전",
]);
const STOP_EN = new Set(("the and for with that this from are was were you your not but have has had can will would should could into onto about over under "
  + "than then them they their there here what when where which while who whom why how all any each few more most other some such only own same too very "
  + "just also been being does did doing done its it's our ours out off again once both between through during before after above below further "
  + "http https www com org net html htm png jpg jpeg gif svg pdf api notes images true false null undefined").split(" "));
/** 낱말로 보지 않는 덩어리: 글자와 숫자가 섞인 것(비밀번호·ID·버전)이나 기호가 여럿 들어간 것. 키워드로 드러나지 않게 미리 거른다. */
const NOT_WORDISH = /(?=.*\p{L})(?=.*\p{N})|[!@#$%^&*=+~|\\<>{}]{2,}|[@:]\S/u;

/** 본문에서 낱말을 뽑는다. 한글은 조사를 떼고 두 글자 이상, 영문은 세 글자 이상(소문자). 주소·코드 주소·ID·비밀번호 같은 덩어리는 버린다. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const clean = text.replace(IMAGE_PATH, " ").replace(URL_LIKE, " ").replace(UUID, " ").replace(/\S+@\S+\.\S+/g, " ");
  for (const raw of clean.split(/\s+/)) {
    if (!raw || raw.length > 60 || NOT_WORDISH.test(raw)) continue;
    for (const match of raw.matchAll(/\p{Script=Hangul}+|\p{Script=Han}+|[A-Za-z][A-Za-z'’-]*[A-Za-z]/gu)) {
      let word = match[0];
      if (/\p{Script=Hangul}/u.test(word)) {
        for (const josa of JOSA) if (word.length - josa.length >= 2 && word.endsWith(josa)) { word = word.slice(0, -josa.length); break; }
        if (word.length < 2 || word.length > 12 || STOP_KO.has(word)) continue;
        out.push(word);
      } else if (/\p{Script=Han}/u.test(word)) {
        if (word.length >= 2 && word.length <= 8) out.push(word);
      } else {
        word = word.toLowerCase().replace(/['’]s$/, "");
        if (word.length < 3 || word.length > 24 || STOP_EN.has(word)) continue;
        out.push(word);
      }
    }
  }
  return out;
}

// ── 낱말 색인(BM25) ───────────────────────────────────────

/** 찾을 글 하나. fields는 [글, 무게]이며 제목·폴더 경로·태그처럼 본문보다 무겁게 셀 글을 따로 준다. text는 낱말이 그대로 나오는지 볼 원문이다. */
export type LexicalDoc = { id: string; title: string; text: string; fields: Array<readonly [text: string, weight: number]> };
type IndexedDoc = { id: string; lower: string; lowerTitle: string; tf: Map<string, number>; length: number };
export type LexicalIndex = { docs: Map<string, IndexedDoc>; df: Map<string, number>; average: number };
/** coverage는 질의의 낱말 가운데 이 글에 든 것의 비율이다(드문 낱말일수록 무겁게 센다). 흔한 말 하나만 걸린 글을 가려내는 데 쓴다.
 *  phrase는 질의가 한 구절 그대로 글에 들어 있다는 뜻이다. */
export type LexicalHit = { score: number; terms: string[]; coverage: number; phrase: boolean };
/** 길이 보정(b)은 0.75보다 낮게 둔다. 메모 길이가 200자에서 19만 자까지라, 0.75에서는 긴 문서에 든 문장을 그대로 물어도 짧은 글에 밀렸다. */
const K1 = 1.2, B = 0.4;
/** 구절로 볼 질의의 최소 길이(글자). 이보다 긴 질의가 글에 그대로 들어 있으면 그 글을 찾는 것으로 본다. */
export const PHRASE_MIN = 12;
/** 띄어 쓴 그대로 찾을 때 건너뛰는 영어의 짧은 말. 두 글자 약어(DB, UI)는 찾아야 하므로 길이로 거르지 않고 이 목록으로 거른다. */
const RAW_STOP = new Set("a an as at be by do go he if in is it me my no of on or so to up us we".split(" "));
export const lowerText = (text: string) => text.normalize("NFC").toLocaleLowerCase("ko-KR");

export function lexicalIndex(docs: Iterable<LexicalDoc>): LexicalIndex {
  const indexed = new Map<string, IndexedDoc>(), df = new Map<string, number>();
  let total = 0;
  for (const doc of docs) {
    const tf = new Map<string, number>();
    for (const [text, weight] of doc.fields) for (const word of tokenize(text)) tf.set(word, (tf.get(word) ?? 0) + weight);
    let length = 0;
    for (const value of tf.values()) length += value;
    for (const word of tf.keys()) df.set(word, (df.get(word) ?? 0) + 1);
    total += length;
    indexed.set(doc.id, { id: doc.id, lower: lowerText(doc.text), lowerTitle: lowerText(doc.title), tf, length });
  }
  return { docs: indexed, df, average: indexed.size ? total / indexed.size : 1 };
}

/** 질의를 낱말(조사를 뗀 것)과 띄어 쓴 그대로의 덩어리로 나눈다. 덩어리에서도 뜻 없는 말(how, to, 어떻게)은 뺀다:
 *  그대로 두면 어떤 질의든 그 말이 든 글에 걸려, 색인에 없는 것을 물어도 결과가 가득 나온다. */
export function queryTerms(query: string): { words: string[]; raw: string[] } {
  return { words: [...new Set(tokenize(query))],
    raw: [...new Set(lowerText(query).split(/[\s,.;:!?()[\]{}"'`“”‘’]+/).filter((term) => term.length >= 2 && !RAW_STOP.has(term) && !STOP_EN.has(term) && !STOP_KO.has(term)))] };
}

/** 질의와 맞는 글. 점수(가장 높은 것이 1)와 맞은 낱말을 돌려준다. 낱말 색인(BM25, k1 1.2 · b 0.4)에 더해, 질의 낱말이 제목·본문에 그대로 나오면 점수를 보탠다
 *  (짧은 영문 약어나 조사가 붙은 낱말, 경로·오류 코드처럼 색인이 놓치는 것을 잡는다). */
export function lexicalRank(index: LexicalIndex, query: string): Map<string, LexicalHit> {
  const { words, raw } = queryTerms(query);
  const out = new Map<string, LexicalHit>();
  if (!words.length && !raw.length) return out;
  const n = index.docs.size;
  // 질의의 낱말마다 무게(IDF). 색인에 없는 낱말이 가장 무겁다: 그 낱말을 빼고 흔한 말만 맞은 글은 질의의 절반도 담지 못한 것이다.
  const weights = words.map((word) => { const seen = index.df.get(word) ?? 0; return Math.log(1 + (n - seen + 0.5) / (seen + 0.5)); });
  const total = weights.reduce((sum, value) => sum + value, 0);
  const phrase = lowerText(query).replace(/\s+/g, " ").trim();
  let top = 0;
  for (const doc of index.docs.values()) {
    let score = 0, covered = 0;
    const terms: string[] = [];
    words.forEach((word, at) => {
      const tf = doc.tf.get(word);
      if (!tf) { if (doc.lower.includes(word) || doc.lowerTitle.includes(word)) covered += weights[at]!; return; }
      score += weights[at]! * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.length / (index.average || 1)));
      covered += weights[at]!;
      terms.push(word);
    });
    let rawHits = 0;
    for (const term of raw) {
      if (doc.lowerTitle.includes(term)) { rawHits++; score += term.length >= 3 ? 1.6 : 0.9; if (!terms.some((word) => term.includes(word) || word.includes(term))) terms.push(term); }
      else if (doc.lower.includes(term)) { rawHits++; score += 0.45; if (!terms.some((word) => term.includes(word) || word.includes(term))) terms.push(term); }
    }
    if (score > 0) {
      // 낱말로 뽑히지 않는 질의(`c#`, `v2`)는 덩어리가 맞은 비율로 센다.
      const coverage = total > 0 ? covered / total : raw.length ? rawHits / raw.length : 0;
      out.set(doc.id, { score, terms, coverage, phrase: phrase.length >= PHRASE_MIN && (doc.lower.includes(phrase) || doc.lowerTitle.includes(phrase)) });
      top = Math.max(top, score);
    }
  }
  for (const entry of out.values()) entry.score /= top;
  return out;
}

/** 질의가 글자 그대로 맞기를 바라는 모양인가: 경로(`/api/…`), 대문자 코드(`PARENT_CONFLICT`), 파일 이름(`compose.yml`), 따옴표로 묶은 구절. */
export function exactIntent(query: string): boolean {
  return /(?:^|\s)\/[\w./-]{3,}|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[\w-]+\.(?:ya?ml|json|tsx?|jsx?|mjs|cjs|md|sql|sh|ps1|py|toml|conf|env|lock|exe)\b|["“][^"”]{2,}["”]/.test(query);
}

// ── 본문의 태그 ───────────────────────────────────────────

const FENCE = /^(\s*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\S\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
/** 줄 처음이나 빈칸·여는 괄호 뒤의 #낱말. 제목(# 제목)·색 값(#fff)·숫자(#12)는 태그가 아니다. */
const TAG = /(^|[\s(（[{,，])#([\p{L}_][\p{L}\p{N}_/-]{0,39})/gmu;
const HEX_COLOR = /^[0-9a-f]{3,8}$/i;

/** 코드 블록·인라인 코드를 뺀 본문(링크·태그를 코드에서 찾지 않는다). */
export const prose = (body: string) => body.replace(FENCE, "\n").replace(INLINE_CODE, " ");

/** 본문의 #태그들(소문자 기준 중복 제거, 처음 쓴 모양을 남긴다). 마크다운 제목 줄의 #은 태그가 아니다. */
export function tagsOf(body: string): string[] {
  const found = new Map<string, string>();
  const text = prose(body).split("\n").filter((line) => !/^\s{0,3}#{1,6}\s/.test(line)).join("\n");
  for (const match of text.matchAll(TAG)) {
    const name = match[2]!.replace(/[/-]+$/, "");
    if (!name || HEX_COLOR.test(name)) continue;
    const key = name.toLocaleLowerCase("ko-KR");
    if (!found.has(key)) found.set(key, name);
  }
  return [...found.values()];
}
