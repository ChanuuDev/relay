import { Extension, InputRule, Mark, Node as TiptapNode, mergeAttributes, type JSONContent, type MarkdownLexerConfiguration, type MarkdownToken } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import type { Node as ProseNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { gemoji } from "gemoji";
import { mathError, renderMath, renderMathNow } from "../../../lib/math";
import { htmlText, renderSafeHtml, safeUrl, type MarkdownContext } from "./sanitize";

/* GitHub Markdown(GFM)의 나머지 양식: 알림 상자, 각주, 이모지, 인라인 수식, 접기(<details>), 원문 인라인 HTML,
   위·아래 첨자·키보드 키·형광펜·밑줄(HTML 태그), 크기·정렬을 단 그림, 정렬한 표 칸. 모두 원문 Markdown으로 되돌려 저장한다. */

type Token = { type?: string; raw?: string; text?: string; tokens?: Token[]; block?: boolean; [key: string]: unknown };
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── 알림 상자: > [!NOTE] ─────────────────────────────────────

export const ALERTS = {
  note: { label: "참고", icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
  tip: { label: "팁", icon: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5 .7 .7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>' },
  important: { label: "중요", icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v3"/><path d="M12 14h.01"/>' },
  warning: { label: "경고", icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
  caution: { label: "주의", icon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>' },
} as const;
export type AlertKind = keyof typeof ALERTS;
const ALERT_KINDS = Object.keys(ALERTS) as AlertKind[];
const ALERT_MARK = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;
const svgIcon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** 인용(>)을 Markdown으로 쓴다. 알림 상자도 같은 모양에 첫 줄만 [!종류]다. */
function quoteLines(children: JSONContent[], render: (child: JSONContent, index: number) => string, head?: string) {
  const blocks = children.map((child, index) => render(child, index).split("\n").map((line) => (line.trim() === "" ? ">" : `> ${line}`)).join("\n"));
  return [...(head ? [`> ${head}`] : []), blocks.join("\n>\n")].join("\n");
}

/** 인용을 읽을 때 첫 줄이 [!NOTE]·[!TIP]·[!IMPORTANT]·[!WARNING]·[!CAUTION]이면 알림 상자로 읽는다. */
export const NoteBlockquote = Blockquote.extend({
  parseMarkdown: (token: Token, helpers) => {
    const first = token.tokens?.[0];
    const match = first?.type === "paragraph" ? ALERT_MARK.exec(String(first.text ?? first.raw ?? "")) : null;
    if (!match) return helpers.createNode("blockquote", undefined, helpers.parseBlockChildren!(token.tokens ?? []));
    const rest = String(first!.text ?? first!.raw ?? "").slice(match[0].length);
    const content: JSONContent[] = [];
    if (rest.trim()) content.push({ type: "paragraph", content: helpers.parseInline!(helpers.tokenizeInline!(rest) as never) });
    content.push(...helpers.parseBlockChildren!(token.tokens!.slice(1)));
    return { type: "alert", attrs: { kind: match[1]!.toLowerCase() }, content: content.length ? content : [{ type: "paragraph" }] };
  },
});

class AlertView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("div");
  private title = document.createElement("div");
  constructor(private node: ProseNode, editable: boolean, private change: (kind: AlertKind) => void) {
    this.dom.className = "md-alert";
    this.title.className = "md-alert-title";
    this.title.contentEditable = "false";
    this.contentDOM.className = "md-alert-body";
    this.dom.append(this.title, this.contentDOM);
    if (editable) {
      this.title.title = "눌러서 알림 종류 바꾸기";
      this.title.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const at = ALERT_KINDS.indexOf(this.node.attrs.kind as AlertKind);
        this.change(ALERT_KINDS[(at + 1) % ALERT_KINDS.length]!);
      });
    }
    this.paint();
  }
  private paint() {
    const kind = (ALERT_KINDS.includes(this.node.attrs.kind as AlertKind) ? this.node.attrs.kind : "note") as AlertKind;
    this.dom.dataset.alert = kind;
    this.title.innerHTML = `${svgIcon(ALERTS[kind].icon)}<span>${ALERTS[kind].label}</span>`;
  }
  update(node: ProseNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) { return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target); }
  stopEvent(event: Event) { return this.title.contains(event.target as globalThis.Node); }
}

export const Alert = TiptapNode.create({
  name: "alert",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() { return { kind: { default: "note", parseHTML: (element) => element.getAttribute("data-alert") ?? "note", renderHTML: (attrs) => ({ "data-alert": attrs.kind }) } }; },
  parseHTML() { return [{ tag: "div[data-alert]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "md-alert" }), 0]; },
  renderMarkdown: (node, helpers) => quoteLines(node.content ?? [], (child, index) => helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]), `[!${String(node.attrs?.kind ?? "note").toUpperCase()}]`),
  addNodeView() {
    return ({ node, editor, getPos }) => new AlertView(node, editor.isEditable, (kind) => {
      const pos = getPos();
      if (typeof pos === "number") editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { kind }); return true; }).run();
    });
  },
});

// ── 각주: 본문의 [^이름]과 [^이름]: 설명 ───────────────────────

const FOOTNOTE_DEF = /^\[\^([^\]\s]{1,100})\]:[ \t]*/;
const CONTINUES = /^(?: {2,}|\t)\S/;
const NEW_BLOCK = /^\s{0,3}(?:\[\^[^\]\s]+\]:|#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|```|~~~|\$\$|\||<\/?[a-z])/i;

export const FootnoteReference = TiptapNode.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { label: { default: "1", parseHTML: (element) => element.getAttribute("data-footnote") ?? "1" } }; },
  parseHTML() { return [{ tag: "sup[data-footnote]" }]; },
  renderHTML({ node }) { return ["sup", { class: "md-fnref", "data-footnote": node.attrs.label, contenteditable: "false", title: `각주 ${node.attrs.label}` }]; },
  renderText: ({ node }) => `[^${node.attrs.label}]`,
  renderMarkdown: (node) => `[^${node.attrs?.label ?? "1"}]`,
  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start: (src: string) => src.indexOf("[^"),
    tokenize: (src: string) => {
      const match = /^\[\^([^\]\s]{1,100})\](?!:)/.exec(src);
      return match ? { type: "footnoteReference", raw: match[0], label: match[1] } : undefined;
    },
  },
  parseMarkdown: (token: Token) => ({ type: "footnoteReference", attrs: { label: token.label } }),
});

export const FootnoteDefinition = TiptapNode.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() { return { label: { default: "1", parseHTML: (element) => element.getAttribute("data-footnote") ?? "1" } }; },
  parseHTML() { return [{ tag: "div[data-footnote]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "md-footnote", "data-footnote": node.attrs.label }), 0]; },
  renderMarkdown: (node, helpers) => {
    const body = (node.content ?? []).map((child, index) => helpers.renderChild?.(child, index) ?? helpers.renderChildren([child])).join("\n\n");
    return `[^${node.attrs?.label ?? "1"}]: ${body.split("\n").map((line, at) => (at === 0 || !line.trim() ? line : `    ${line}`)).join("\n")}`;
  },
  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start: (src: string) => { const match = /^\[\^[^\]\s]{1,100}\]:/m.exec(src); return match ? match.index : -1; },
    tokenize: (src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) => {
      const first = FOOTNOTE_DEF.exec(src);
      if (!first) return undefined;
      const lines = src.split("\n");
      const taken = [lines[0]!];
      for (let at = 1; at < lines.length; at++) {
        const line = lines[at]!;
        const previous = taken[taken.length - 1]!;
        if (CONTINUES.test(line)) { taken.push(line); continue; }
        if (!line.trim() && at + 1 < lines.length && CONTINUES.test(lines[at + 1]!)) { taken.push(line); continue; }
        // 문단은 들여 쓰지 않은 다음 줄까지 이어진다(게으른 이어짐).
        if (line.trim() && previous.trim() && !NEW_BLOCK.test(line)) { taken.push(line); continue; }
        break;
      }
      const raw = taken.join("\n") + (taken.length < lines.length ? "\n" : "");
      const body = [taken[0]!.slice(first[0].length), ...taken.slice(1).map((line) => line.replace(/^(?: {1,4}|\t)/, ""))].join("\n");
      return { type: "footnoteDefinition", raw, label: first[1], tokens: helpers.blockTokens(`${body}\n`) };
    },
  },
  parseMarkdown: (token: Token, helpers) => {
    const content = helpers.parseBlockChildren!((token.tokens ?? []) as never);
    return { type: "footnoteDefinition", attrs: { label: token.label }, content: content.length ? content : [{ type: "paragraph" }] };
  },
});

// ── 이모지: :smile: ─────────────────────────────────────────

const EMOJI = new Map<string, string>();
for (const item of gemoji) for (const name of item.names) EMOJI.set(name, item.emoji);
export const emojiOf = (name: string) => EMOJI.get(name) ?? null;

export const Emoji = TiptapNode.create({
  name: "emoji",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() { return { name: { default: "smile", parseHTML: (element) => element.getAttribute("data-emoji") ?? "smile" } }; },
  parseHTML() { return [{ tag: "span[data-emoji]" }]; },
  renderHTML({ node }) { return ["span", { class: "md-emoji", "data-emoji": node.attrs.name, title: `:${node.attrs.name}:`, contenteditable: "false" }, emojiOf(node.attrs.name) ?? `:${node.attrs.name}:`]; },
  renderText: ({ node }) => emojiOf(node.attrs.name) ?? `:${node.attrs.name}:`,
  renderMarkdown: (node) => `:${node.attrs?.name ?? "smile"}:`,
  markdownTokenizer: {
    name: "emoji",
    level: "inline",
    start: (src: string) => { const match = /:[a-z0-9_+-]+:/i.exec(src); return match ? match.index : -1; },
    tokenize: (src: string) => {
      const match = /^:([a-z0-9_+-]+):/i.exec(src);
      return match && EMOJI.has(match[1]!) ? { type: "emoji", raw: match[0], name: match[1] } : undefined;
    },
  },
  parseMarkdown: (token: Token) => ({ type: "emoji", attrs: { name: token.name } }),
  addInputRules() {
    return [new InputRule({
      find: /:([a-z0-9_+-]+):$/i,
      handler: ({ state, range, match }) => {
        if (!EMOJI.has(match[1]!)) return null;
        state.tr.replaceWith(range.from, range.to, this.type.create({ name: match[1] }));
      },
    })];
  },
});

// ── 수식: $…$, $`…`$, $$…$$ ──────────────────────────────────

/** 인라인 수식. 누르면 그 자리에서 TeX 원문을 고친다. */
class MathView implements NodeView {
  dom = document.createElement("span");
  private input: HTMLInputElement | null = null;
  constructor(private node: ProseNode, private editable: boolean, private commit: (latex: string | null) => void) {
    this.dom.className = "md-math";
    this.dom.contentEditable = "false";
    if (editable) this.dom.addEventListener("mousedown", (event) => { if (!this.input && event.button === 0) { event.preventDefault(); this.open(); } });
    this.paint();
  }
  private paint() {
    const latex = String(this.node.attrs.latex ?? "");
    this.dom.title = latex;
    this.dom.removeAttribute("data-error");
    const now = renderMathNow(latex, false);
    if (now !== null) { this.dom.innerHTML = now; return; }
    this.dom.textContent = latex;
    this.dom.dataset.loading = "";
    renderMath(latex, false).then((html) => { if (this.node.attrs.latex === latex && !this.input) { this.dom.innerHTML = html; delete this.dom.dataset.loading; } },
      (error: unknown) => { if (this.node.attrs.latex === latex && !this.input) { delete this.dom.dataset.loading; this.dom.dataset.error = ""; this.dom.title = mathError(error); } });
  }
  /** 원문 칸을 열어 고친다. Enter·초점 이동은 적용, Esc는 취소, 비우면 지운다. */
  open() {
    if (!this.editable || this.input) return;
    const input = document.createElement("input");
    input.className = "md-math-input";
    input.value = String(this.node.attrs.latex ?? "");
    input.size = Math.max(4, input.value.length + 1);
    input.spellcheck = false;
    input.setAttribute("aria-label", "수식(TeX)");
    this.input = input;
    this.dom.replaceChildren(input);
    this.dom.dataset.editing = "";
    let done = false;
    const finish = (apply: boolean) => {
      if (done) return;
      done = true;
      this.input = null;
      delete this.dom.dataset.editing;
      if (apply && input.value !== this.node.attrs.latex) this.commit(input.value.trim() ? input.value : null);
      else this.paint();
    };
    input.addEventListener("input", () => { input.size = Math.max(4, input.value.length + 1); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }
  update(node: ProseNode) { if (node.type !== this.node.type) return false; const changed = node.attrs.latex !== this.node.attrs.latex; this.node = node; if (changed && !this.input) this.paint(); return true; }
  selectNode() { this.dom.classList.add("ProseMirror-selectednode"); }
  deselectNode() { this.dom.classList.remove("ProseMirror-selectednode"); }
  ignoreMutation() { return true; }
  stopEvent(event: Event) { return this.input !== null && this.input.contains(event.target as globalThis.Node); }
}

const INLINE_MATH = /^\$(?![\s$])((?:\\[\s\S]|[^\\$\n])+?)(?<![\s\\])\$(?![\w$])/;
const INLINE_MATH_CODE = /^\$`([^`\n]+?)`\$/;

export const MathInline = TiptapNode.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: "", parseHTML: (element) => element.getAttribute("data-latex") ?? "" },
      /** $`…`$로 썼으면 "code". 저장할 때 같은 모양으로 되돌린다. */
      form: { default: null, rendered: false },
    };
  },
  parseHTML() { return [{ tag: "span[data-latex]" }]; },
  renderHTML({ node }) { return ["span", { class: "md-math", "data-latex": node.attrs.latex }, node.attrs.latex]; },
  renderText: ({ node }) => `$${node.attrs.latex}$`,
  renderMarkdown: (node) => (node.attrs?.form === "code" ? `$\`${node.attrs?.latex ?? ""}\`$` : `$${node.attrs?.latex ?? ""}$`),
  markdownTokenizer: {
    name: "mathInline",
    level: "inline",
    start: (src: string) => src.indexOf("$"),
    tokenize: (src: string) => {
      const code = INLINE_MATH_CODE.exec(src);
      if (code) return { type: "mathInline", raw: code[0], latex: code[1], form: "code" };
      const match = INLINE_MATH.exec(src);
      return match ? { type: "mathInline", raw: match[0], latex: match[1], form: null } : undefined;
    },
  },
  parseMarkdown: (token: Token) => ({ type: "mathInline", attrs: { latex: token.latex, form: token.form ?? null } }),
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor.isEditable, (latex) => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      if (latex === null) editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
      else editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex }); return true; }).setTextSelection(pos + 1).run();
    });
  },
  addInputRules() {
    return [new InputRule({
      // 글을 치다 $x^2$처럼 닫으면 수식이 된다. 돈 표시($5와 $10)는 닫는 $ 앞이 빈칸이라 바뀌지 않는다.
      find: /(?:^|[^\\$\w])(\$([^\s$](?:[^$\n]*[^\s$\\])?)\$)$/,
      handler: ({ state, range, match }) => {
        const start = range.to - match[1]!.length;
        state.tr.replaceWith(start, range.to, this.type.create({ latex: match[2] }));
      },
    })];
  },
});

/** $$ … $$ 블록 수식. ```math와 같은 수식 블록(코드 블록)으로 읽고, 저장할 때 $$ 모양을 지킨다. */
export const MathBlockSyntax = Extension.create({
  name: "mathBlockSyntax",
  markdownTokenName: "mathBlock",
  markdownTokenizer: {
    name: "mathBlock",
    level: "block",
    start: (src: string) => { const match = /^ {0,3}\$\$/m.exec(src); return match ? match.index : -1; },
    tokenize: (src: string) => {
      const match = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
      return match ? { type: "mathBlock", raw: match[0], latex: match[1]!.replace(/^\n|\n$/g, "") } : undefined;
    },
  },
  parseMarkdown: (token: Token) => ({ type: "codeBlock", attrs: { language: "math", fence: "$$" }, content: token.latex ? [{ type: "text", text: String(token.latex) }] : [] }),
});

// ── 접기: <details><summary>…</summary> … </details> ─────────

/** <details>부터 짝이 맞는 </details>까지(안에 다시 <details>가 있어도) 한 블록으로 읽는다. 안쪽은 Markdown으로 읽는다. */
function readDetails(src: string) {
  const open = /^ {0,3}<details(\s[^>]*)?>[ \t]*/i.exec(src);
  if (!open) return null;
  const pattern = /<details(?:\s[^>]*)?>|<\/details\s*>/gi;
  pattern.lastIndex = open[0].length;
  let depth = 1;
  for (let match = pattern.exec(src); match; match = pattern.exec(src)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth === 0) {
      const lineEnd = src.indexOf("\n", pattern.lastIndex);
      const rest = lineEnd === -1 ? src.slice(pattern.lastIndex) : src.slice(pattern.lastIndex, lineEnd);
      // 닫는 태그 뒤 같은 줄에 다른 글이 있으면 일반 HTML로 둔다.
      if (rest.trim()) return null;
      const raw = lineEnd === -1 ? src : src.slice(0, lineEnd + 1);
      let inner = src.slice(open[0].length, match.index);
      const summary = /^\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary\s*>/i.exec(inner);
      if (summary) inner = inner.slice(summary[0].length);
      return { raw, open: /\sopen(?:[\s=>]|$)/i.test(open[1] ?? ""), summary: summary ? htmlText(summary[1]!) : "", inner };
    }
  }
  return null;
}

export const NoteDetails = Details.extend({
  markdownTokenName: "details",
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => { const match = /^ {0,3}<details[\s>]/im.exec(src); return match ? match.index : -1; },
    tokenize: (src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) => {
      const found = readDetails(src);
      return found ? { type: "details", raw: found.raw, open: found.open, summary: found.summary, tokens: helpers.blockTokens(`${found.inner.trim()}\n`) } : undefined;
    },
  },
  parseMarkdown: (token: Token, helpers) => {
    const body = helpers.parseBlockChildren!((token.tokens ?? []) as never);
    return {
      type: "details", attrs: { open: Boolean(token.open) },
      content: [{ type: "detailsSummary", content: token.summary ? [{ type: "text", text: String(token.summary) }] : [] }, { type: "detailsContent", content: body.length ? body : [{ type: "paragraph" }] }],
    };
  },
  renderMarkdown: (node, helpers) => {
    const [summary, content] = node.content ?? [];
    const title = (summary?.content ?? []).map((child) => child.text ?? "").join("");
    const body = (content?.content ?? []).map((child, index) => helpers.renderChild?.(child, index) ?? helpers.renderChildren([child])).join("\n\n");
    return `<details${node.attrs?.open ? " open" : ""}>\n<summary>${escapeText(title)}</summary>\n\n${body}\n\n</details>`;
  },
});
// 접기의 제목·내용은 접기가 함께 쓴다. 공식 확장의 ::: 문법은 쓰지 않는다.
const noMarkdown = { markdownTokenizer: null, parseMarkdown: null, renderMarkdown: null, markdownTokenName: null } as unknown as Record<string, never>;
export const NoteDetailsSummary = DetailsSummary.extend(noMarkdown);
export const NoteDetailsContent = DetailsContent.extend(noMarkdown);

// ── HTML로 감싼 Markdown: <div align="center"> (빈 줄) … (빈 줄) </div> ──
// README에서 흔한 모양이다. GitHub은 빈 줄 뒤의 안쪽을 Markdown으로 읽고 바깥 태그의 정렬을 따른다.

const CONTAINER_TAGS = "div|center|section|article|aside|header|footer|figure|p";

/** 여는 태그가 제 줄에 홀로 있고 바로 빈 줄이 오며, 짝이 맞는 닫는 태그가 제 줄에 홀로 있을 때만 감싼 블록으로 읽는다. */
function readContainer(src: string) {
  const open = new RegExp(String.raw`^ {0,3}(<(${CONTAINER_TAGS})(\s[^>]*)?>)[ \t]*\n[ \t]*\n`, "i").exec(src);
  if (!open) return null;
  const tag = open[2]!.toLowerCase();
  const pattern = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>|</${tag}\s*>`, "gi");
  pattern.lastIndex = open[0].length;
  let depth = 1;
  for (let match = pattern.exec(src); match; match = pattern.exec(src)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth !== 0) continue;
    const lineStart = src.lastIndexOf("\n", match.index - 1) + 1;
    const lineEnd = src.indexOf("\n", pattern.lastIndex);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (line.trim() !== match[0].trim()) return null;
    return { raw: lineEnd === -1 ? src : src.slice(0, lineEnd + 1), tag, opening: open[1]!, inner: src.slice(open[0].length, lineStart) };
  }
  return null;
}

class ContainerView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("div");
  private label = document.createElement("span");
  constructor(private node: ProseNode, private context: MarkdownContext, editable: boolean) {
    this.dom.className = "md-container";
    this.contentDOM.className = "md-container-body";
    this.label.className = "md-container-label";
    this.label.contentEditable = "false";
    if (editable) this.dom.append(this.label);
    this.dom.append(this.contentDOM);
    this.paint();
  }
  /** 바깥 태그의 허용한 속성(정렬·방향·언어)만 옮긴다. */
  private paint() {
    const opening = String(this.node.attrs.opening ?? "<div>");
    const tag = String(this.node.attrs.tag ?? "div");
    const element = renderSafeHtml(`${opening}</${tag}>`, this.context).firstElementChild;
    for (const name of ["align", "dir", "lang", "title"]) {
      const value = element?.getAttribute(name) ?? (tag === "center" && name === "align" ? "center" : null);
      if (value) this.contentDOM.setAttribute(name, value); else this.contentDOM.removeAttribute(name);
    }
    this.label.textContent = opening;
  }
  update(node: ProseNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) { return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target); }
}

export const HtmlContainer = TiptapNode.create<{ context: MarkdownContext }>({
  name: "htmlContainer",
  group: "block",
  content: "block+",
  defining: true,
  addOptions() { return { context: {} }; },
  addAttributes() { return { opening: { default: "<div>" }, tag: { default: "div" } }; },
  parseHTML() { return [{ tag: "div[data-html-container]" }]; },
  renderHTML({ node }) { return ["div", { "data-html-container": node.attrs.tag }, 0]; },
  markdownTokenName: "htmlContainer",
  markdownTokenizer: {
    name: "htmlContainer",
    level: "block",
    start: (src: string) => { const match = new RegExp(String.raw`^ {0,3}<(?:${CONTAINER_TAGS})[\s>]`, "im").exec(src); return match ? match.index : -1; },
    tokenize: (src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) => {
      const found = readContainer(src);
      return found ? { type: "htmlContainer", raw: found.raw, tag: found.tag, opening: found.opening, tokens: helpers.blockTokens(`${found.inner.trim()}\n`) } : undefined;
    },
  },
  parseMarkdown: (token: Token, helpers) => {
    const content = helpers.parseBlockChildren!((token.tokens ?? []) as never);
    return { type: "htmlContainer", attrs: { opening: token.opening, tag: token.tag }, content: content.length ? content : [{ type: "paragraph" }] };
  },
  renderMarkdown: (node, helpers) => {
    const body = (node.content ?? []).map((child, index) => helpers.renderChild?.(child, index) ?? helpers.renderChildren([child])).join("\n\n");
    return `${node.attrs?.opening ?? "<div>"}\n\n${body}\n\n</${node.attrs?.tag ?? "div"}>`;
  },
  addNodeView() {
    const context = this.options.context;
    return ({ node, editor }) => new ContainerView(node, context, editor.isEditable);
  },
});

// ── 원문 인라인 HTML ─────────────────────────────────────────
// <sub>·<sup>·<kbd>·<mark>·<ins>·<u>·<b>·<i>·<a>·<code> 같은 태그는 편집기의 서식으로 읽고, 그 밖의 태그(<abbr>·<span>·<br>·주석 등)는
// 원문을 그대로 둔 채 허용한 태그만 그려 보인다. <img>는 크기·정렬을 단 그림으로 읽는다.

const NATIVE_INLINE = new Set(["sub", "sup", "kbd", "mark", "ins", "u", "b", "strong", "i", "em", "del", "s", "strike", "code", "a"]);
const VOID_INLINE = new Set(["br", "wbr", "img", "hr", "input", "source"]);
const OPEN_TAG = /^<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;

function readInlineHtml(src: string): { raw: string; tag: string } | null {
  const comment = /^<!--[\s\S]*?-->/.exec(src);
  if (comment) return { raw: comment[0], tag: "!--" };
  const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(src);
  if (close) return NATIVE_INLINE.has(close[1]!.toLowerCase()) ? null : { raw: close[0], tag: close[1]!.toLowerCase() };
  const open = OPEN_TAG.exec(src);
  if (!open) return null;
  const tag = open[1]!.toLowerCase();
  if (NATIVE_INLINE.has(tag)) return null;
  if (VOID_INLINE.has(tag) || open[3]) return { raw: open[0], tag };
  // 짝이 맞는 닫는 태그까지 한 덩어리로 둔다(같은 태그가 안에 다시 열려도 센다).
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}\\s*>`, "gi");
  pattern.lastIndex = open[0].length;
  let depth = 1;
  for (let match = pattern.exec(src); match; match = pattern.exec(src)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { raw: src.slice(0, pattern.lastIndex), tag };
  }
  return { raw: open[0], tag };
}

/** <img ...> 원문을 그림 속성으로 읽는다. */
function imageAttrs(html: string) {
  const image = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body.querySelector("img");
  if (!image?.getAttribute("src")) return null;
  const get = (name: string) => image.getAttribute(name);
  return { src: get("src"), alt: get("alt"), title: get("title"), width: get("width"), height: get("height"), align: get("align"), markup: "html" };
}

class HtmlInlineView implements NodeView {
  dom = document.createElement("span");
  constructor(private node: ProseNode, private context: MarkdownContext, private editable: boolean) {
    this.dom.className = "md-html-inline";
    this.dom.contentEditable = "false";
    this.paint();
  }
  private paint() {
    const html = String(this.node.attrs.html ?? "");
    this.dom.title = this.editable ? html : "";
    if (/^<!--/.test(html) || /^<\//.test(html)) { this.dom.replaceChildren(); this.dom.dataset.empty = ""; if (this.editable) this.dom.textContent = /^<!--/.test(html) ? "<!-- -->" : html; return; }
    delete this.dom.dataset.empty;
    this.dom.replaceChildren(renderSafeHtml(html, this.context));
  }
  update(node: ProseNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  ignoreMutation() { return true; }
}

export const HtmlInline = TiptapNode.create<{ context: MarkdownContext }>({
  name: "htmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() { return { context: {} }; },
  addAttributes() { return { html: { default: "", parseHTML: (element) => element.getAttribute("data-html") ?? "" } }; },
  parseHTML() { return [{ tag: "span[data-html]" }]; },
  renderHTML({ node }) { return ["span", { "data-html": node.attrs.html }]; },
  renderText: ({ node }) => htmlText(String(node.attrs.html ?? "")),
  renderMarkdown: (node) => String(node.attrs?.html ?? ""),
  markdownTokenizer: {
    name: "htmlInline",
    level: "inline",
    start: (src: string) => { const match = /<[a-zA-Z!/]/.exec(src); return match ? match.index : -1; },
    tokenize: (src: string) => {
      const found = readInlineHtml(src);
      return found ? { type: "htmlInline", raw: found.raw, tag: found.tag } : undefined;
    },
  },
  parseMarkdown: (token: Token) => {
    const raw = String(token.raw ?? "");
    if (token.tag === "img") { const attrs = imageAttrs(raw); if (attrs) return { type: "image", attrs }; }
    return { type: "htmlInline", attrs: { html: raw } };
  },
  addNodeView() {
    const context = this.options.context;
    return ({ node, editor }) => new HtmlInlineView(node, context, editor.isEditable);
  },
});

// ── HTML 태그로 쓰는 글자 서식 ────────────────────────────────

const tagMark = (name: string, tag: string, also: string[] = [], shortcut?: string) => Mark.create({
  name,
  parseHTML() { return [{ tag }, ...also.map((other) => ({ tag: other }))]; },
  renderHTML({ HTMLAttributes }) { return [tag, HTMLAttributes, 0]; },
  renderMarkdown: (node, helpers) => `<${tag}>${helpers.renderChildren(node)}</${tag}>`,
  addKeyboardShortcuts() { return shortcut ? { [shortcut]: () => this.editor.commands.toggleMark(this.name) } : {}; },
});
export const Subscript = tagMark("subscript", "sub", [], "Mod-,");
export const Superscript = tagMark("superscript", "sup", [], "Mod-.");
export const Kbd = tagMark("kbd", "kbd");
export const Highlight = tagMark("highlight", "mark");
export const Ins = tagMark("ins", "ins", ["u"]);

// ── 그림: 한 줄에 여러 장(배지)·링크 건 그림·크기와 정렬 ──────────

const LARGE = { width: 240, height: 160 };

class ImageView implements NodeView {
  dom = document.createElement("img");
  constructor(private node: ProseNode, private context: MarkdownContext, extraClass: string) {
    this.dom.draggable = true;
    if (extraClass) this.dom.className = extraClass;
    // 배지처럼 작은 그림은 글줄 안에 두고, 큰 그림(화면 캡처 등)만 테두리를 두른 그림으로 보인다.
    this.dom.addEventListener("load", () => this.dom.classList.toggle("is-large", this.dom.naturalWidth >= LARGE.width || this.dom.naturalHeight >= LARGE.height));
    this.paint();
  }
  private paint() {
    const { src, alt, title, width, height, align } = this.node.attrs as Record<string, string | null>;
    const url = src ? safeUrl(src, "image", this.context) : null;
    if (url) { if (this.dom.getAttribute("src") !== url) this.dom.src = url; } else this.dom.removeAttribute("src");
    for (const [key, value] of Object.entries({ alt: alt ?? "", title, width, height, align, loading: "lazy", decoding: "async" })) {
      if (value === null || value === undefined || value === "") { if (key !== "alt") this.dom.removeAttribute(key); else this.dom.setAttribute("alt", ""); }
      else this.dom.setAttribute(key, String(value));
    }
  }
  update(node: ProseNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  ignoreMutation() { return true; }
}

const markdownUrl = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/>/g, "%3E")}>` : url);

export const NoteImage = Image.extend<{ context: MarkdownContext } & Record<string, unknown>>({
  addOptions() { return { ...(this.parent?.() as object), context: {} } as never; },
  addAttributes() {
    return {
      ...this.parent?.(),
      align: { default: null },
      /** HTML(<img>)로 썼으면 "html". 저장할 때 같은 모양으로 되돌린다. */
      markup: { default: null, rendered: false, parseHTML: () => "html" },
    };
  },
  renderMarkdown: (node) => {
    const { src = "", alt = "", title = "", width, height, align, markup } = (node.attrs ?? {}) as Record<string, string | null>;
    const html = markup === "html" || width || height || align;
    let out = html
      ? `<img src="${escapeAttr(src ?? "")}"${alt ? ` alt="${escapeAttr(alt)}"` : ""}${title ? ` title="${escapeAttr(title)}"` : ""}${width ? ` width="${escapeAttr(String(width))}"` : ""}${height ? ` height="${escapeAttr(String(height))}"` : ""}${align ? ` align="${escapeAttr(align)}"` : ""}>`
      : `![${(alt ?? "").replace(/([\\[\]])/g, "\\$1")}](${markdownUrl(src ?? "")}${title ? ` "${title.replace(/"/g, "\\\"")}"` : ""})`;
    // 링크를 건 그림(배지)은 [![…](…)](주소)로 감싼다.
    const link = (node.marks ?? []).find((mark) => mark.type === "link");
    if (link?.attrs?.href) out = `[${out}](${markdownUrl(String(link.attrs.href))})`;
    return out;
  },
  // 붙여넣기·끌기용 HTML도 화면과 같이 주소를 풀어 쓴다(뷰어의 상대 주소 그림이 엉뚱한 주소를 부르지 않게).
  renderHTML({ HTMLAttributes }) {
    const options = this.options as { context?: MarkdownContext; HTMLAttributes?: Record<string, unknown> };
    const src = typeof HTMLAttributes.src === "string" ? safeUrl(HTMLAttributes.src, "image", options.context ?? {}) : null;
    return ["img", mergeAttributes(options.HTMLAttributes ?? {}, { ...HTMLAttributes, src })];
  },
  addNodeView() {
    const options = this.options as { context?: MarkdownContext; HTMLAttributes?: { class?: string } };
    return ({ node }) => new ImageView(node, options.context ?? {}, options.HTMLAttributes?.class ?? "");
  },
});

/** 링크. 공식 확장은 링크를 글자에만 다므로, 링크 안의 그림(배지)·이모지 같은 인라인 노드에도 직접 단다. */
export const NoteLink = Link.extend({
  parseMarkdown: (token: Token, helpers) => {
    const content = helpers.parseInline!((token.tokens ?? []) as never) as JSONContent[];
    const attrs = { href: token.href, title: token.title || null };
    if (content.some((node) => node.type !== "text")) return content.map((node) => ({ ...node, marks: [...(node.marks ?? []), { type: "link", attrs }] }));
    return helpers.applyMark("link", content, attrs);
  },
});

// ── 표: 칸 정렬(:---:)을 align 속성으로 ────────────────────────
// 공식 확장은 정렬을 인라인 style(text-align)로 그려 CSP에 막히므로, 브라우저가 따르는 align 속성으로 바꾼다.

const alignAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => { const value = (element.getAttribute("align") ?? element.style.textAlign ?? "").toLowerCase(); return value === "left" || value === "center" || value === "right" ? value : null; },
  renderHTML: (attrs: Record<string, unknown>) => (attrs.align ? { align: attrs.align } : {}),
};
export const NoteTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), align: alignAttribute }; } });
export const NoteTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), align: alignAttribute }; } });
