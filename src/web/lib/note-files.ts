/* 메모에 끌어 놓은 글 파일(.txt·.md). 트리에 놓으면 파일마다 새 메모가 되고, 본문 칸에 놓으면 그 내용만 커서 자리에 들어간다. */

const MAX_TITLE = 200;
/** 메모 본문 한도(@relay/core MAX_BODY와 같다). */
export const MAX_TEXT = 200_000;
const TEXT_NAME = /\.(?:txt|text|md|markdown|mdown|mkd)$/i;
const MARKDOWN_NAME = /\.(?:md|markdown|mdown|mkd)$/i;

/** 끌고 들어오는 것이 바깥 파일인지. 끄는 동안에는 파일 이름을 볼 수 없어 형식(type)만 본다. */
export const isFileDrag = (data: DataTransfer | null) => Boolean(data && Array.from(data.types).includes("Files"));
/** 끄는 파일 가운데 글 파일일 수 있는 것이 있는지. .md는 OS에 따라 형식이 비어 있거나 text/markdown이다. */
export function mayHoldText(data: DataTransfer | null) {
  if (!data) return false;
  const files = Array.from(data.items).filter((item) => item.kind === "file");
  // 형식을 알려 주지 않는 브라우저는 놓을 때 이름으로 고른다.
  if (!files.length) return isFileDrag(data);
  return files.some((item) => !item.type || item.type.startsWith("text/") || /markdown/i.test(item.type));
}

/** 놓은 파일에서 메모로 읽을 글 파일(.txt·.md)만 고른다. */
export const textFilesOf = (files: FileList | File[] | null | undefined) => Array.from(files ?? []).filter((file) => TEXT_NAME.test(file.name));
export const isMarkdownFile = (file: File) => MARKDOWN_NAME.test(file.name);

/** 파일 내용을 글로 읽는다. BOM이 없으면 UTF-8로 읽고, UTF-8이 아니면 Windows 한국어 메모장 기본값(CP949)으로 읽는다. 줄 끝은 \n으로 맞춘다. */
export async function readTextFile(file: File): Promise<string> {
  // 본문 한도(글자 수)를 넘을 것이 뻔한 큰 파일은 읽지 않는다. UTF-8 한글은 한 글자가 3바이트다.
  if (file.size > MAX_TEXT * 3) throw new Error(`본문은 ${MAX_TEXT.toLocaleString("ko-KR")}자까지 넣을 수 있습니다.`);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new Error("파일을 읽지 못했습니다."); }
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else {
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start)); }
    catch { text = new TextDecoder("euc-kr").decode(bytes); }
  }
  text = text.replace(/\r\n?/g, "\n");
  if (text.includes("\u0000")) throw new Error("글 파일이 아닙니다.");
  if (text.length > MAX_TEXT) throw new Error(`본문은 ${MAX_TEXT.toLocaleString("ko-KR")}자까지 넣을 수 있습니다.`);
  return text;
}

/** 글 파일 하나로 만들 메모. 제목은 파일 이름(확장자 뺌)이고,
 *  Markdown 파일이 제목 1(# 제목) 한 줄로 시작하면 그 줄을 제목으로 삼아 본문에서 뺀다(메모 내려받기 파일을 다시 넣어도 제목이 겹치지 않는다). */
export function noteOfText(fileName: string, text: string): { title: string; body: string } {
  let title = fileName.replace(/\.[^.]+$/, "").trim();
  let body = text;
  if (MARKDOWN_NAME.test(fileName)) {
    const heading = /^\s*# +(.+?)\s*#*\s*(?:\n|$)/.exec(body);
    if (heading?.[1]) { title = heading[1]; body = body.slice(heading[0].length); }
  }
  return { title: title.slice(0, MAX_TITLE), body: body.replace(/^\n+/, "").replace(/\s+$/, "") };
}

/** 글 파일들을 차례로 읽는다. 읽지 못한 파일은 이름과 까닭을 따로 돌려준다. */
export async function readTextFiles(files: File[]) {
  const texts: Array<{ file: File; text: string }> = [];
  const failures: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    try { texts.push({ file, text: await readTextFile(file) }); }
    catch (error) { failures.push({ name: file.name, reason: error instanceof Error ? error.message : "알 수 없는 오류입니다." }); }
  }
  return { texts, failures };
}

/** 읽지 못한 파일 안내. */
export const textFailure = (failures: Array<{ name: string; reason: string }>) =>
  failures.length === 1 ? `‘${failures[0]!.name}’을(를) 넣지 못했습니다: ${failures[0]!.reason}` : `파일 ${failures.length}개를 넣지 못했습니다: ${failures[0]!.reason}`;
export const NOT_TEXT = "txt·md 파일만 메모로 넣을 수 있습니다.";
/** 본문 칸에 놓은 글 파일들의 내용. 파일 이름 없이 내용만 빈 줄로 잇는다. */
export const joinTexts = (texts: Array<{ text: string }>) => texts.map(({ text }) => text.replace(/^\n+/, "").replace(/\s+$/, "")).filter(Boolean).join("\n\n");
