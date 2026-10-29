import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import gradle from "highlight.js/lib/languages/gradle";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = {
  bash, c, cpp, csharp, css, dart, diff, dockerfile, dos, go, gradle, ini, java, javascript, json, kotlin, latex, less, lua, makefile, markdown, perl, php, plaintext,
  powershell, properties, python, r, ruby, rust, scss, sql, swift, typescript, xml, yaml,
};
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** 이보다 긴 글은 색을 입히지 않고 줄 번호만 붙인다(정규식 강조가 느려지는 지점). */
export const HIGHLIGHT_MAX_CHARS = 600_000;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * highlight.js가 낸 HTML(`<span class="…">`와 `</span>`, 이스케이프된 글자만 있다)을 줄 단위로 나눈다.
 * 주석처럼 여러 줄에 걸친 토큰은 줄마다 같은 class로 다시 열어 각 줄이 홀로 완전한 HTML이 되게 한다.
 */
export function splitLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  const tag = /<span class="([^"]*)">|<\/span>/g;
  const text = (chunk: string) => {
    const parts = chunk.split("\n");
    for (let at = 0; at < parts.length; at += 1) {
      if (at > 0) {
        lines.push(line + "</span>".repeat(open.length));
        line = open.map((name) => `<span class="${name}">`).join("");
      }
      line += parts[at];
    }
  };
  let last = 0;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    text(html.slice(last, match.index));
    if (match[0] === "</span>") { open.pop(); line += "</span>"; }
    else { open.push(match[1]); line += match[0]; }
    last = tag.lastIndex;
  }
  text(html.slice(last));
  lines.push(line);
  return lines;
}

export type Rendered = { html: string; lines: number; highlighted: boolean };

/** 소스 코드를 줄 번호가 붙는 HTML로 만든다. 줄마다 `.viewer-line` 하나이고 번호는 CSS counter가 붙인다. */
export function renderCode(source: string, language: string | null): Rendered {
  const known = language !== null && hljs.getLanguage(language) !== undefined;
  let lines: string[] | null = null;
  if (known && source.length <= HIGHLIGHT_MAX_CHARS) {
    try { lines = splitLines(hljs.highlight(source, { language: language as string, ignoreIllegals: true }).value); }
    catch { lines = null; }
  }
  const highlighted = lines !== null;
  lines ??= escapeHtml(source).split("\n");
  // 줄 안의 토큰을 한 칸(.viewer-text)에 모아 둬야 grid 칸(번호·글)이 토큰마다 쪼개지지 않는다.
  return { html: lines.map((line) => `<span class="viewer-line"><span class="viewer-text">${line}</span></span>`).join(""), lines: lines.length, highlighted };
}
