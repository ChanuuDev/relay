import { plainLine } from "./notes.js";
import { estimateTokens, redactSecrets } from "./redact.js";

// 메모 한 편을 의미 검색의 단위(절)로 나눈다. 임베딩 모델에 넣는 글은 이 모듈이 만든 글뿐이다.
//  - 코드 울타리 안의 `# 주석`은 소제목이 아니다. 소제목 계층(H1 > H2 > H3)을 따라가며 절마다 그 경로를 적는다.
//  - 절이 길면 빈 줄(문단) → 줄 → 문장 순으로 더 나누고, 이어지는 조각은 앞 조각의 끝을 조금 겹친다. 짧은 절은 다음 절과 묶는다.
//  - 조각 앞에 문서 유형·프로젝트·폴더·제목·소제목 경로를 붙인다(Anthropic Contextual Retrieval: 조각만으로는 무엇에 관한 글인지 모른다).
//  - 그림 주소는 설명만 남기고, 비밀번호·토큰처럼 보이는 값은 가린 뒤에 내보낸다. 원문은 바꾸지 않고 위치(줄·글자)만 기억한다.
// 규칙을 바꾸면 CHUNK_VERSION을 올린다. 모델 키에 들어가므로 모든 메모가 새 규칙으로 다시 색인된다.

export const CHUNK_VERSION = 1;
/** 조각 하나의 본문 상한(어림 토큰). */
export const CHUNK_MAX_TOKENS = 700;
/** 이보다 짧은 절은 다음 절과 묶는다(제목만 있는 절이 제목 유사도만으로 올라오지 않게). */
export const CHUNK_MIN_TOKENS = 50;
/** 길어서 나뉜 조각끼리 겹치는 양. */
export const CHUNK_OVERLAP_TOKENS = 70;
/** 메모 하나에서 만드는 조각 수의 상한. 넘으면 뒤를 버리고 truncated를 알린다. */
export const MAX_CHUNKS = 120;

export type DocType = "memo" | "knowledge" | "design" | "decision";
export type DocStatus = "draft" | "adopted" | "superseded";
export const DOC_TYPES: readonly DocType[] = ["memo", "knowledge", "design", "decision"];
export const DOC_STATUSES: readonly DocStatus[] = ["draft", "adopted", "superseded"];
export const DOC_TYPE_NAME: Record<DocType, string> = { memo: "메모", knowledge: "업무 지식", design: "설계서", decision: "결정 기록" };
export const DOC_STATUS_NAME: Record<DocStatus, string> = { draft: "초안", adopted: "채택", superseded: "대체됨" };

/** 조각 앞에 붙일 문서의 자리. path는 폴더 경로(「설계 › 서버」), summary는 에이전트가 쓴 한 줄 요약(있을 때만). */
export type ChunkContext = { title: string; path?: string; docType?: DocType; project?: string; summary?: string };
/** lineStart·lineEnd는 본문의 줄 번호(1부터, 끝 포함), charStart·charEnd는 본문 글자 위치(UTF-16). text가 임베딩 모델에 들어가는 글이다. */
export type Chunk = { index: number; headingPath: string; lineStart: number; lineEnd: number; charStart: number; charEnd: number; text: string; tokens: number };

type Unit = { heading: string; first: number; last: number; text: string; tokens: number; opens: boolean; /** 앞 조각에서 겹쳐 온 끝부분 */ overlap?: boolean };

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;
const SENTENCE_END = /(?<=[.!?。…])\s+|(?<=[다요음임함됨])\.\s+/;

/** 소제목 줄이면 [단계, 글], 아니면 null. */
export function headingOf(line: string): [level: number, text: string] | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  const text = plainLine(match[2]!);
  return text ? [match[1]!.length, text] : null;
}

const tidy = (text: string) => text.replace(IMAGE, (_match, alt: string) => (alt.trim() ? `[그림: ${alt.trim()}]` : "[그림]"));

/** 너무 긴 덩어리를 상한 아래 조각들로. 줄이 여럿이면 줄 단위로, 한 줄이 길면 문장·글자 단위로 자른다. */
function splitUnit(unit: Unit, lines: string[], max: number): Unit[] {
  const out: Unit[] = [];
  const push = (first: number, last: number, text: string) => out.push({ heading: unit.heading, first, last, text, tokens: estimateTokens(text), opens: unit.opens && !out.length });
  let start = unit.first, buffer: string[] = [], size = 0;
  const flush = (end: number) => { if (buffer.length) { push(start, end, buffer.join("\n")); buffer = []; size = 0; } };
  for (let at = unit.first; at <= unit.last; at++) {
    const line = lines[at]!;
    const cost = estimateTokens(line) + 1;
    if (cost > max) {
      flush(at - 1);
      // 한 줄이 상한을 넘는다: 문장으로 나누고, 그래도 길면 글자 수로 자른다.
      let piece = "";
      const emit = () => { if (piece.trim()) push(at, at, piece.trim()); piece = ""; };
      for (const sentence of line.split(SENTENCE_END)) {
        if (estimateTokens(sentence) > max) {
          emit();
          const width = Math.max(200, Math.floor(max * 1.5));
          for (let offset = 0; offset < sentence.length; offset += width) push(at, at, sentence.slice(offset, offset + width));
          continue;
        }
        if (piece && estimateTokens(`${piece} ${sentence}`) > max) emit();
        piece = piece ? `${piece} ${sentence}` : sentence;
      }
      emit();
      start = at + 1;
      continue;
    }
    if (size + cost > max) { flush(at - 1); start = at; }
    if (!buffer.length) start = at;
    buffer.push(line);
    size += cost;
  }
  flush(unit.last);
  return out;
}

/** 덩어리의 끝부분(줄이나 문장 단위로 budget 토큰까지). 다음 조각의 앞에 겹쳐 싣는다. */
function tailOf(unit: Unit, budget: number): Unit | null {
  const parts = unit.text.split("\n").flatMap((line) => line.split(SENTENCE_END)).filter((part) => part.trim());
  const kept: string[] = [];
  let room = budget;
  for (let at = parts.length - 1; at >= 0; at--) {
    const cost = estimateTokens(parts[at]!) + 1;
    if (cost > room) break;
    kept.unshift(parts[at]!.trim()); room -= cost;
  }
  if (!kept.length || kept.length === parts.length) return null;
  const text = kept.join(" ");
  return { heading: unit.heading, first: unit.last, last: unit.last, text, tokens: estimateTokens(text), opens: false, overlap: true };
}

/** 본문을 덩어리(빈 줄로 나뉜 문단, 코드 울타리 하나, 소제목과 그 아래 첫 문단)로 나눈다. */
function unitsOf(lines: string[], max: number): Unit[] {
  const units: Unit[] = [];
  const stack: string[] = [];
  let heading = "", fence = "", first = -1, opens = false;
  const close = (last: number) => {
    if (first < 0) return;
    const text = tidy(lines.slice(first, last + 1).join("\n"));
    const unit: Unit = { heading, first, last, text, tokens: estimateTokens(text), opens };
    if (unit.tokens > max) units.push(...splitUnit({ ...unit, text: "" }, lines.map(tidy), max)); else units.push(unit);
    first = -1; opens = false;
  };
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!;
    const mark = FENCE_LINE.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) fence = "";
      continue;
    }
    if (mark) { if (first < 0) first = at; fence = mark; continue; }
    const head = headingOf(line);
    if (head) {
      close(at - 1);
      stack.length = Math.max(0, head[0] - 1);
      for (let i = 0; i < stack.length; i++) stack[i] ??= "";
      stack[head[0] - 1] = head[1];
      heading = stack.filter(Boolean).join(" > ");
      first = at; opens = true;
      continue;
    }
    if (!line.trim()) { close(at - 1); continue; }
    if (first < 0) first = at;
  }
  close(lines.length - 1);
  return units;
}

/** 조각 앞에 붙는 머리말. */
function headerOf(context: ChunkContext, heading: string): string {
  const title = context.title.trim();
  const section = heading === title ? "" : heading.startsWith(`${title} > `) ? heading.slice(title.length + 3) : heading;
  const where = [context.docType && context.docType !== "memo" ? `[유형: ${DOC_TYPE_NAME[context.docType]}]` : "",
    context.project ? `[프로젝트: ${context.project}]` : "", context.path ? `[폴더: ${context.path}]` : ""].filter(Boolean).join(" ");
  const name = [title, section].filter(Boolean).join(" > ");
  return [where, name ? `# ${name}` : "", context.summary ? `요약: ${context.summary.replace(/\s+/g, " ").trim()}` : ""].filter(Boolean).join("\n");
}

/** 메모 본문을 조각으로 나눈다. 제목도 본문도 없으면 조각이 없다(임베딩하지 않는다). 본문이 없고 제목만 있으면 머리말만 든 조각 하나다. */
export function chunkNote(body: string, context: ChunkContext, max = CHUNK_MAX_TOKENS): { chunks: Chunk[]; truncated: boolean } {
  const raw = body.split("\n");
  const lines = raw.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const offsets: number[] = [];
  for (let at = 0, offset = 0; at < raw.length; at++) { offsets.push(offset); offset += raw[at]!.length + 1; }
  const units = unitsOf(lines, max);
  if (!units.length) {
    if (!context.title.trim()) return { chunks: [], truncated: false };
    const text = redactSecrets(headerOf(context, "")).text;
    return { chunks: [{ index: 0, headingPath: "", lineStart: 1, lineEnd: 1, charStart: 0, charEnd: 0, text, tokens: estimateTokens(text) }], truncated: false };
  }

  // 덩어리를 상한까지 채워 조각으로 묶는다. 새 절이 시작될 때 지금 조각이 충분히 길면 끊는다(짧은 절은 다음 절과 한 조각이 된다).
  const groups: Unit[][] = [];
  let current: Unit[] = [], size = 0, carried = 0;
  for (const unit of units) {
    const full = current.length > 0 && size + unit.tokens > max;
    if (full || (current.length > 0 && unit.opens && size - carried >= CHUNK_MIN_TOKENS)) {
      groups.push(current);
      const tail: Unit[] = [];
      if (full) {
        // 길어서 끊은 자리에서는 앞 조각의 끝을 조금 가져와 문맥이 끊기지 않게 한다.
        let room = CHUNK_OVERLAP_TOKENS;
        for (let i = current.length - 1; i > 0 && current[i]!.tokens <= room; i--) { tail.unshift(current[i]!); room -= current[i]!.tokens; }
        // 마지막 덩어리가 겹칠 양보다 크면 그 끝의 몇 문장만 가져온다.
        if (!tail.length) { const piece = tailOf(current[current.length - 1]!, CHUNK_OVERLAP_TOKENS); if (piece) tail.push(piece); }
        if (tail.reduce((sum, item) => sum + item.tokens, 0) + unit.tokens > max) tail.length = 0;
      }
      current = tail;
      size = carried = tail.reduce((sum, item) => sum + item.tokens, 0);
    }
    current.push(unit);
    size += unit.tokens;
  }
  if (current.length) groups.push(current);
  // 마지막 조각이 너무 짧으면 앞 조각에 붙인다.
  if (groups.length > 1) {
    const last = groups[groups.length - 1]!, before = groups[groups.length - 2]!;
    const own = last.filter((unit) => !unit.overlap && !before.includes(unit));
    const sum = (list: Unit[]) => list.reduce((total, unit) => total + unit.tokens, 0);
    if (sum(own) < CHUNK_MIN_TOKENS && sum(before) + sum(own) <= max * 1.25) { before.push(...own); groups.pop(); }
  }

  const truncated = groups.length > MAX_CHUNKS;
  const chunks = groups.slice(0, MAX_CHUNKS).map((group, index): Chunk => {
    const first = group[0]!, last = group[group.length - 1]!;
    // 소제목만 든 첫 덩어리와 묶였으면 실제 글이 시작되는 절의 경로를 쓴다.
    const heading = group.find((unit) => !unit.overlap && unit.tokens >= 8 && !headingOf(unit.text.split("\n")[0]!))?.heading ?? group[group.length - 1]!.heading;
    const text = redactSecrets(`${headerOf(context, heading)}\n\n${group.map((unit) => unit.text).join("\n\n")}`.trim()).text;
    return { index, headingPath: heading, lineStart: first.first + 1, lineEnd: last.last + 1, charStart: offsets[first.first]!,
      charEnd: offsets[last.last]! + lines[last.last]!.length, text, tokens: estimateTokens(text) };
  });
  return { chunks, truncated };
}

/** 조각을 만드는 데 드는 모든 입력을 한 줄로. 이 값의 해시가 같으면 조각도 같으므로 다시 임베딩하지 않는다. */
export const chunkInput = (body: string, context: ChunkContext) =>
  JSON.stringify([CHUNK_VERSION, context.title, body, context.path ?? "", context.docType ?? "memo", context.project ?? "", context.summary ?? ""]);

/** line(1부터)이 든 절의 소제목 경로. 색인이 낡았을 때 지금 본문에서 절을 다시 찾는 데 쓴다. */
export function headingAt(body: string, line: number): string {
  const stack: string[] = [];
  let fence = "";
  const lines = body.split("\n");
  for (let at = 0; at < Math.min(line, lines.length); at++) {
    const mark = FENCE_LINE.exec(lines[at]!)?.[1];
    if (fence) { if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = ""; continue; }
    if (mark) { fence = mark; continue; }
    const head = headingOf(lines[at]!);
    if (!head) continue;
    stack.length = Math.max(0, head[0] - 1);
    for (let i = 0; i < stack.length; i++) stack[i] ??= "";
    stack[head[0] - 1] = head[1];
  }
  return stack.filter(Boolean).join(" > ");
}
