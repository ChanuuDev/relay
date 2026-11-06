import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { scrollToAnchor } from "./preview";
import { ANCHOR_PREFIX, safeUrl, type MarkdownContext } from "./sanitize";

/* 문서 전체를 보고 다는 장식: 제목 앵커(GitHub와 같은 id), 각주 번호, 인라인 코드의 색상 견본. 링크 따라가기도 여기서 맡는다. */

/** GitHub의 제목 앵커 규칙: 소문자로 바꾸고, 글자·숫자·빈칸·-·_ 밖의 기호를 지우고, 빈칸을 -로 바꾼다. 같은 이름은 -1, -2를 붙인다. */
export function slugOf(text: string) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
}

const COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([^()]{3,60}\))$/i;

function decorate(doc: ProseNode) {
  const decorations: Decoration[] = [];
  const slugs = new Map<string, number>();
  const order = new Map<string, number>();
  const definitions: Array<{ pos: number; size: number; label: string }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const base = slugOf(node.textContent);
      if (base) {
        const seen = slugs.get(base) ?? 0;
        slugs.set(base, seen + 1);
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { id: ANCHOR_PREFIX + (seen ? `${base}-${seen}` : base) }));
      }
    } else if (node.type.name === "footnoteReference") {
      const label = String(node.attrs.label);
      if (!order.has(label)) order.set(label, order.size + 1);
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-index": String(order.get(label)) }));
    } else if (node.type.name === "footnoteDefinition") {
      definitions.push({ pos, size: node.nodeSize, label: String(node.attrs.label) });
    } else if (node.isText && node.marks.some((mark) => mark.type.name === "code") && COLOR.test(node.text?.trim() ?? "")) {
      const color = node.text!.trim();
      if (typeof CSS === "undefined" || CSS.supports("color", color)) {
        decorations.push(Decoration.widget(pos + node.nodeSize, () => {
          const swatch = document.createElement("span");
          swatch.className = "md-swatch";
          swatch.setAttribute("aria-hidden", "true");
          // CSSOM으로 칠하는 것은 CSP(style-src)가 막지 않는다.
          swatch.style.backgroundColor = color;
          return swatch;
        }, { side: -1, key: `swatch-${color}` }));
      }
    }
    return true;
  });
  // 각주 설명은 본문에서 처음 가리킨 차례로 번호를 받는다. 가리키지 않은 설명은 이름을 그대로 보인다.
  for (const { pos, size, label } of definitions) if (order.has(label)) decorations.push(Decoration.node(pos, pos + size, { "data-index": String(order.get(label)) }));
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<DecorationSet>("markdownDecorations");

/** 각주 번호를 누르면 그 설명으로, 설명의 번호를 누르면 처음 가리킨 곳으로 옮긴다. */
function jumpFootnote(editor: Editor, label: string, to: "definition" | "reference") {
  let target: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (target !== null) return false;
    if ((to === "definition" ? node.type.name === "footnoteDefinition" : node.type.name === "footnoteReference") && String(node.attrs.label) === label) target = pos;
    return true;
  });
  if (target === null) return false;
  const dom = editor.view.nodeDOM(target);
  (dom instanceof HTMLElement ? dom : null)?.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

export const MarkdownDecorations = Extension.create<{ context: MarkdownContext }>({
  name: "markdownDecorations",
  addOptions() { return { context: {} }; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const context = this.options.context;
    return [new Plugin<DecorationSet>({
      key,
      state: { init: (_config, state) => decorate(state.doc), apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set) },
      props: {
        decorations: (state) => key.getState(state),
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          if (node.type.name === "footnoteReference") { event.preventDefault(); return jumpFootnote(editor, String(node.attrs.label), "definition"); }
          return false;
        },
        handleDOMEvents: {
          mousedown: (view, event) => {
            // 편집 중 Ctrl(⌘)+링크는 따라가기다. ProseMirror는 이 조합을 블록 고르기로 쓰므로 여기서 가로챈다(따라가기는 click에서).
            if ((event.ctrlKey || event.metaKey) && view.editable && (event.target as Element).closest?.("a[href]")) { event.preventDefault(); return true; }
            // 각주 설명 앞의 번호(::before)를 누르면 처음 가리킨 곳으로 돌아간다.
            const note = (event.target as Element).closest?.(".md-footnote");
            if (note instanceof HTMLElement && note === event.target) {
              event.preventDefault();
              return jumpFootnote(editor, note.dataset.footnote ?? "", "reference");
            }
            return false;
          },
          // 링크: 읽기 화면에서는 누르면, 편집 중에는 Ctrl(⌘)과 함께 누르면 따라간다. #이름은 이 문서 안에서 찾는다.
          click: (view, event) => {
            const link = (event.target as Element).closest?.("a[href]");
            if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) return false;
            if (view.editable && !(event.ctrlKey || event.metaKey)) return false;
            const href = link.getAttribute("href") ?? "";
            event.preventDefault();
            if (href.startsWith("#")) { scrollToAnchor(editor, href.slice(1)); return true; }
            if (/^(?:https?|mailto):/i.test(href)) { window.open(href, "_blank", "noopener,noreferrer"); return true; }
            if (context.openLink) { context.openLink(href); return true; }
            const url = safeUrl(href, "link", context);
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      },
    })];
  },
});
