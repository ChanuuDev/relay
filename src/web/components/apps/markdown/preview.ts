import { Node as TiptapNode, type Editor } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { hljs } from "../../../lib/highlight";
import { renderMath, mathError } from "../../../lib/math";
import { isDark, onThemeChange, renderDiagram } from "../../../lib/mermaid";
import { renderGeo, type GeoPalette } from "./geo";
import { isInvisibleHtml, renderSafeHtml, safeUrl, ANCHOR_PREFIX, type MarkdownContext } from "./sanitize";
import { renderStl } from "./stl";

/* 미리 보기 블록: 원문은 코드 블록(```mermaid·```math·```geojson·```topojson·```stl·$$…$$)이나 원문 HTML 블록 그대로 두고,
   그 내용을 그림·수식·지도·3D·HTML로 그려 보인다. 누르거나 커서가 들어가면 아래에 원문이 열리고, 고치는 대로 다시 그린다. Esc로 닫는다. */

type Output = { element: Element; caption?: string; interactive?: boolean; destroy?: () => void };
type Renderer = {
  label: string;
  /** card: 카드 안에 그린다. plain: 본문처럼 바로 그린다(수식·HTML). */
  chrome: "card" | "plain";
  /** 화면 테마가 바뀌면 다시 그린다. */
  themed: boolean;
  /** 원문 칸의 색 입히기 언어(highlight.js). */
  source?: string;
  render: (code: string, context: MarkdownContext, editable: boolean) => Promise<Output> | Output;
};

/** 다이어그램은 16px 글자로 재고 그린 뒤 본문 글자 크기(14px)에 맞춰 줄여 보인다. */
const SCALE = 0.875;

const geoPalette = (): GeoPalette => (isDark()
  ? { area: "rgba(61, 208, 170, .22)", areaStroke: "#3dd0aa", line: "#6ea8ff", point: "#ff6b6b", grid: "rgba(255, 255, 255, .07)", label: "#f5f5f7", halo: "#232326" }
  : { area: "rgba(15, 148, 120, .16)", areaStroke: "#0f9478", line: "#2f6fe4", point: "#e5484d", grid: "rgba(0, 0, 0, .06)", label: "#1d1d1f", halo: "#f8f8fa" });

const RENDERERS: Record<string, Renderer> = {
  mermaid: {
    label: "Mermaid", chrome: "card", themed: true,
    render: async (code) => {
      const diagram = await renderDiagram(code);
      const image = document.createElement("img");
      image.draggable = false;
      image.decoding = "async";
      image.width = Math.round(diagram.width * SCALE);
      image.height = Math.round(diagram.height * SCALE);
      image.src = diagram.url;
      image.alt = `Mermaid 다이어그램 (${code.trim().split("\n")[0]!.trim().slice(0, 60)})`;
      return { element: image };
    },
  },
  math: {
    label: "수식", chrome: "plain", themed: false, source: "latex",
    render: async (code) => {
      const box = document.createElement("div");
      box.className = "md-math-display";
      try { box.innerHTML = await renderMath(code.trim(), true); } catch (error) { throw new Error(mathError(error)); }
      return { element: box };
    },
  },
  geojson: { label: "GeoJSON", chrome: "card", themed: true, source: "json", render: (code) => { const { svg, caption } = renderGeo(code, false, geoPalette()); return { element: svg, caption }; } },
  topojson: { label: "TopoJSON", chrome: "card", themed: true, source: "json", render: (code) => { const { svg, caption } = renderGeo(code, true, geoPalette()); return { element: svg, caption }; } },
  stl: {
    label: "STL", chrome: "card", themed: true,
    render: (code) => {
      const { canvas, caption, destroy } = renderStl(code, isDark() ? { body: "#3dd0aa", edge: "rgba(0, 0, 0, .25)", background: "#232326" } : { body: "#0f9478", edge: "rgba(255, 255, 255, .35)", background: "#f8f8fa" });
      return { element: canvas, caption, interactive: true, destroy };
    },
  },
  html: {
    label: "HTML", chrome: "plain", themed: true, source: "xml",
    render: (code, context, editable) => {
      const box = document.createElement("div");
      box.className = "md-html";
      if (isInvisibleHtml(code)) {
        box.dataset.invisible = "";
        if (editable) { const chip = document.createElement("span"); chip.className = "md-html-chip"; chip.textContent = "HTML 주석"; box.append(chip); }
      } else box.append(renderSafeHtml(code, context));
      return { element: box };
    },
  },
};
/** ```math는 GitHub처럼 수식으로, $$…$$로 쓴 블록도 같은 수식 블록이다. */
export const PREVIEW_LANGUAGES = ["mermaid", "math", "geojson", "topojson", "stl"] as const;
const rendererOf = (node: ProseNode) => (node.type.name === "htmlBlock" ? RENDERERS.html! : RENDERERS[String(node.attrs.language ?? "")] ?? null);
const SOURCE_LANGUAGE: Record<string, string> = { html: "xml", math: "latex", geojson: "json", topojson: "json" };

const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

/** 다이어그램이 아닌 코드 블록. 기본 모양(pre > code)과 같다. */
class CodeView implements NodeView {
  dom = document.createElement("pre");
  contentDOM = document.createElement("code");
  constructor(private node: ProseNode) { this.dom.append(this.contentDOM); this.paint(); }
  private paint() {
    const language = this.node.attrs.language as string | null;
    if (language) { this.contentDOM.className = `language-${language}`; this.dom.dataset.language = language; }
    else { this.contentDOM.removeAttribute("class"); delete this.dom.dataset.language; }
  }
  update(node: ProseNode) {
    if (node.type !== this.node.type || rendererOf(node)) return false;
    this.node = node;
    this.paint();
    return true;
  }
}

/** 원문을 그려 보이는 블록. */
class PreviewView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("code");
  private preview = document.createElement("div");
  private message = document.createElement("p");
  private caption = document.createElement("p");
  private output: Output | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  private stopTheme: () => void;
  private renderer: Renderer;

  constructor(private node: ProseNode, private editor: Editor, private getPos: () => number | undefined, private context: MarkdownContext) {
    this.renderer = rendererOf(node)!;
    const kind = node.type.name === "htmlBlock" ? "html" : String(node.attrs.language);
    this.dom.className = "note-diagram";
    this.dom.dataset.kind = kind;
    this.dom.dataset.chrome = this.renderer.chrome;
    this.preview.className = "note-diagram-preview";
    this.preview.contentEditable = "false";
    this.message.className = "note-diagram-message";
    this.caption.className = "note-diagram-caption";
    this.caption.hidden = true;
    this.preview.append(this.message, this.caption);
    const source = document.createElement("pre");
    source.className = "note-diagram-source";
    source.dataset.label = this.renderer.label;
    source.spellcheck = false;
    this.contentDOM.className = `language-${this.renderer.source ?? kind}`;
    source.append(this.contentDOM);
    this.dom.append(this.preview, source);
    if (editor.isEditable) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "note-diagram-edit";
      edit.title = `${this.renderer.label} 원문 고치기`;
      edit.setAttribute("aria-label", edit.title);
      edit.innerHTML = PENCIL;
      edit.addEventListener("mousedown", (event) => { event.stopPropagation(); this.edit(event); });
      this.preview.append(edit);
      this.preview.title = "눌러서 원문 고치기";
      this.preview.addEventListener("mousedown", (event) => {
        // 3D 보기처럼 끌어서 다루는 그림은 그 위를 눌러도 원문을 열지 않는다(연필 단추로 연다).
        if (this.output?.interactive && this.output.element.contains(event.target as globalThis.Node)) return;
        this.edit(event);
      });
    }
    // 그림 속 링크: 편집 중에는 원문을 열고, 읽기 화면에서는 따라간다(#이름은 이 문서 안에서 찾는다).
    this.preview.addEventListener("click", (event) => {
      const link = (event.target as Element).closest?.("a[href]");
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      if (editor.isEditable && !(event.ctrlKey || event.metaKey)) { event.preventDefault(); return; }
      if (href.startsWith("#")) { event.preventDefault(); scrollToAnchor(editor, href.slice(1)); return; }
      // 상대 링크는 문서 맥락이 연다(파일 뷰어는 그 파일을 뷰어로). http(s)·mailto는 새 창(target=_blank)으로 간다.
      if (!/^(?:https?|mailto):/i.test(href)) { event.preventDefault(); context.openLink?.(href); }
    });
    editor.on("selectionUpdate", this.sync);
    editor.on("focus", this.sync);
    editor.on("blur", this.sync);
    this.stopTheme = this.renderer.themed ? onThemeChange(() => this.draw(true)) : () => {};
    this.draw(true);
  }

  /** 커서가 이 블록 안에 있을 때만 원문을 연다. */
  private sync = () => {
    const pos = this.getPos();
    const { from, to } = this.editor.state.selection;
    const inside = typeof pos === "number" && this.editor.isEditable && this.editor.isFocused && from > pos && to < pos + this.node.nodeSize;
    this.dom.classList.toggle("is-editing", inside);
  };

  /** 원문 끝에 커서를 둔다. */
  private edit = (event: MouseEvent) => {
    if (event.button !== 0 || (event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const pos = this.getPos();
    if (typeof pos === "number") this.editor.chain().focus().setTextSelection(pos + this.node.nodeSize - 1).run();
  };

  private say(state: "empty" | "loading" | "ready" | "error", text = "") {
    this.dom.dataset.state = state;
    this.message.textContent = text;
    this.message.hidden = !text;
    this.message.setAttribute("role", state === "error" ? "alert" : "status");
  }

  private show(output: Output) {
    this.output?.destroy?.();
    this.output?.element.remove();
    this.output = output;
    this.preview.prepend(output.element);
    this.caption.textContent = output.caption ?? "";
    this.caption.hidden = !output.caption;
    this.dom.toggleAttribute("data-hidden", !this.editor.isEditable && output.element instanceof HTMLElement && output.element.dataset.invisible !== undefined);
    this.say("ready");
  }

  /** 고치는 중에는 잠시 멈췄을 때 다시 그린다. 틀린 원문은 마지막으로 그린 그림을 흐리게 두고 오류를 보인다. */
  private draw(now = false) {
    clearTimeout(this.timer);
    const code = this.node.textContent;
    const version = ++this.version;
    if (!code.trim()) {
      this.output?.destroy?.();
      this.output?.element.remove();
      this.output = null;
      this.caption.hidden = true;
      this.say("empty", this.editor.isEditable ? `${this.renderer.label} 원문을 입력하면 여기에 그려집니다.` : "");
      return;
    }
    if (!this.output) this.say("loading", `${this.renderer.label} 그리는 중…`);
    this.timer = setTimeout(() => {
      Promise.resolve().then(() => this.renderer.render(code, this.context, this.editor.isEditable)).then(
        (output) => { if (version === this.version) this.show(output); else output.destroy?.(); },
        (error: unknown) => { if (version === this.version) this.say("error", error instanceof Error ? error.message : `${this.renderer.label}을(를) 그리지 못했습니다.`); },
      );
    }, now ? 0 : this.renderer.chrome === "plain" ? 120 : 280);
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type || rendererOf(node) !== this.renderer) return false;
    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (changed) this.draw();
    this.sync();
    return true;
  }

  /** 원문 밖(그림)의 변화는 편집기가 다시 읽지 않는다. */
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  /** 그림을 누르는 일은 이 보기가 처리한다. 끌어 놓기는 편집기에 맡긴다. */
  stopEvent(event: Event) {
    return this.preview.contains(event.target as globalThis.Node) && !event.type.startsWith("drag") && event.type !== "drop";
  }

  destroy() {
    clearTimeout(this.timer);
    this.version++;
    this.output?.destroy?.();
    this.stopTheme();
    this.editor.off("selectionUpdate", this.sync);
    this.editor.off("focus", this.sync);
    this.editor.off("blur", this.sync);
  }
}

/** `#이름` 링크가 가리키는 곳으로 편집기 안에서 옮긴다. 제목 앵커와 HTML의 id·name을 모두 찾는다. */
export function scrollToAnchor(editor: Editor, name: string) {
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* 그대로 찾는다. */ }
  const id = ANCHOR_PREFIX + decoded;
  const root = editor.view.dom;
  const target = Array.from(root.querySelectorAll<HTMLElement>("[id], [name]")).find((element) => element.id === id || element.getAttribute("name") === id);
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ── 코드 색 입히기 ──────────────────────────────────────────
// highlight.js가 낸 <span class>를 글자 범위로 바꿔 ProseMirror 장식으로 입힌다. 같은 원문은 다시 계산하지 않는다.

type Token = { from: number; to: number; className: string };
const tokenCache = new Map<string, Token[]>();
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#x27;": "'", "&#39;": "'" };

function tokensOf(text: string, language: string): Token[] {
  const key = `${language}\n${text}`;
  const known = tokenCache.get(key);
  if (known) return known;
  let html: string;
  try { html = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { return []; }
  const tokens: Token[] = [];
  const open: string[] = [];
  let offset = 0;
  const pattern = /<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27|#39);|[^<&]+/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const [piece, className] = match;
    if (className !== undefined) { open.push(className); continue; }
    if (piece === "</span>") { open.pop(); continue; }
    const length = piece.startsWith("&") ? (ENTITIES[piece] ?? piece).length : piece.length;
    if (open.length) tokens.push({ from: offset, to: offset + length, className: open.join(" ") });
    offset += length;
  }
  if (tokenCache.size > 300) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(key, tokens);
  return tokens;
}

const languageOf = (node: ProseNode) => {
  const language = node.type.name === "htmlBlock" ? "html" : String(node.attrs.language ?? "").toLowerCase();
  const name = SOURCE_LANGUAGE[language] ?? language;
  return name && hljs.getLanguage(name) ? name : null;
};

function highlight(doc: ProseNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock" && node.type.name !== "htmlBlock") return true;
    const language = languageOf(node);
    if (language && node.textContent.length <= 120_000) {
      for (const token of tokensOf(node.textContent, language)) decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const highlightKey = new PluginKey<DecorationSet>("noteCodeHighlight");
export const codeHighlight = () => new Plugin<DecorationSet>({
  key: highlightKey,
  state: { init: (_config, state) => highlight(state.doc), apply: (tr, set) => (tr.docChanged ? highlight(tr.doc) : set) },
  props: { decorations: (state) => highlightKey.getState(state) },
});

// ── 노드 ─────────────────────────────────────────────────

/** 코드 블록. ```mermaid·```math·```geojson·```topojson·```stl은 그려 보이고, $$…$$로 쓴 수식은 그 모양 그대로 저장한다. 그 밖의 언어는 색을 입힌다. */
export const NoteCodeBlock = CodeBlock.extend({
  addOptions() { return { ...this.parent!(), context: {} as MarkdownContext }; },
  addAttributes() {
    return {
      ...this.parent?.(),
      /** $$…$$로 쓴 수식 블록이면 "$$". 저장할 때 같은 모양으로 되돌린다. */
      fence: { default: null, rendered: false },
    };
  },
  renderMarkdown: (node, helpers) => {
    const text = helpers.renderChildren(node.content ?? []);
    if (node.attrs?.fence === "$$") return `$$\n${text}\n$$`;
    return `\`\`\`${node.attrs?.language ?? ""}\n${text}\n\`\`\``;
  },
  addNodeView() {
    const context = (this.options as { context?: MarkdownContext }).context ?? {};
    return ({ node, editor, getPos }) => (rendererOf(node) ? new PreviewView(node, editor, getPos, context) : new CodeView(node));
  },
  addProseMirrorPlugins() { return [...(this.parent?.() ?? []), codeHighlight()]; },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // 미리 보기 블록의 원문을 고치다 Esc를 누르면 원문을 닫고 블록 전체를 고른다.
      Escape: () => {
        const { $from } = this.editor.state.selection;
        if (!rendererOf($from.parent)) return false;
        return this.editor.commands.setNodeSelection($from.before());
      },
    };
  },
});

/** Markdown 안의 블록 HTML. 원문을 그대로 두고, 허용한 태그만 다시 만들어 보인다. */
export const HtmlBlock = TiptapNode.create<{ context: MarkdownContext }>({
  name: "htmlBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addOptions() { return { context: {} }; },
  parseHTML() { return [{ tag: "div[data-type=\"html-block\"]", preserveWhitespace: "full" }]; },
  renderHTML() { return ["div", { "data-type": "html-block" }, ["pre", 0]]; },
  markdownTokenName: "html",
  parseMarkdown: (token) => {
    const raw = String(token.raw ?? token.text ?? "").replace(/\s+$/, "");
    if (!raw || !token.block) return null as never;
    return { type: "htmlBlock", content: [{ type: "text", text: raw }] };
  },
  renderMarkdown: (node) => (node.content ?? []).map((child) => child.text ?? "").join(""),
  addNodeView() {
    const context = this.options.context;
    return ({ node, editor, getPos }) => new PreviewView(node, editor, getPos, context);
  },
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== this.name) return false;
        return this.editor.commands.setNodeSelection($from.before());
      },
    };
  },
});

/** 미리 보기 블록 예시를 넣는다. 빈 문단이면 그 자리를, 아니면 지금 블록 다음을 쓰고, 커서를 원문 끝에 둔다. */
export function insertPreviewBlock(editor: Editor, kind: "mermaid" | "math" | "geojson" | "stl" | "html", sample: string) {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  const node = kind === "html" ? { type: "htmlBlock", content: [{ type: "text", text: sample }] }
    : { type: "codeBlock", attrs: { language: kind }, content: [{ type: "text", text: sample }] };
  if (block.type.name === "paragraph" && !block.content.size) {
    const from = $from.before(), to = $from.after();
    editor.chain().focus().insertContentAt({ from, to }, node).setTextSelection(from + 1 + sample.length).run();
    return;
  }
  const at = $from.depth ? $from.after(1) : editor.state.doc.content.size;
  editor.chain().focus().insertContentAt(at, node).setTextSelection(at + 1 + sample.length).run();
}

/** 상대 주소를 푸는 기본 맥락(메모): 그대로 쓴다. */
export const noteContext: MarkdownContext = { resolve: (url) => url };
export { safeUrl };
