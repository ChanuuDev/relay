import { Extension, type Editor } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { DIAGRAM_SAMPLE, onThemeChange, renderDiagram, type Diagram } from "../../lib/mermaid";
import { imageFilesOf, imageMarkdown, uploadFailure, uploadImage, useNoteAlert } from "../../lib/note-images";
import { useNotes } from "../../lib/notes";

declare module "@tiptap/core" {
  interface Storage {
    /** 그림을 올리는 사이 편집기가 닫히면(다른 메모로 옮김·보기 전환) 이 메모 끝에 그림을 붙인다. */
    noteImageUpload: { noteId: string | null };
  }
}

// ── 그림 올리기 ─────────────────────────────────────────────
// 붙여 넣거나 끌어 놓은 그림은 그 자리에 미리 보기 자리표시를 두고 서버에 올린 뒤, 돌려받은 주소의 그림으로 바꾼다.

type Upload = { id: object; pos: number; file: File };
type UploadAction = { add: Upload[] } | { remove: object[] };
const uploadKey = new PluginKey<DecorationSet>("noteImageUpload");

/** 올리는 동안 보이는 자리표시: 고른 그림을 흐리게 미리 보이고 그 위에 진행 표시를 얹는다. */
function placeholder(file: File) {
  return () => {
    const box = document.createElement("span");
    box.className = "note-image-uploading";
    box.contentEditable = "false";
    box.setAttribute("role", "status");
    const preview = document.createElement("img");
    preview.alt = "";
    preview.draggable = false;
    preview.src = URL.createObjectURL(file);
    preview.addEventListener("error", () => { URL.revokeObjectURL(preview.src); preview.remove(); box.dataset.empty = ""; }, { once: true });
    const badge = document.createElement("span");
    badge.className = "note-image-uploading-badge";
    const spinner = document.createElement("span");
    spinner.className = "note-spinner";
    spinner.setAttribute("aria-hidden", "true");
    badge.append(spinner, "그림 올리는 중…");
    box.append(preview, badge);
    return box;
  };
}
const releasePreview = (node: globalThis.Node) => { const image = (node as HTMLElement).querySelector?.("img"); if (image?.src.startsWith("blob:")) URL.revokeObjectURL(image.src); };

const placeholderAt = (state: EditorState, ids: object[]) => uploadKey.getState(state)?.find(undefined, undefined, (spec) => ids.includes(spec.id))[0]?.from ?? null;

/** 그림은 블록이라 글 줄 사이에 놓는다. 줄 맨 앞(빈 줄 포함)이면 그 줄 위, 줄 끝이면 그 줄 아래, 가운데면 줄을 나눠 그 사이다.
 *  커서가 그 자리에 있었으면 그림 다음 줄로 옮겨 이어 쓰게 한다(그림이 선택된 채 남아 다음 글자에 덮이지 않게). */
function placeImages(state: EditorState, at: number, urls: string[], ids: object[]) {
  const tr = state.tr.setMeta(uploadKey, { remove: ids } satisfies UploadAction);
  if (!urls.length) return tr;
  const { schema } = state;
  const images = urls.map((src) => schema.nodes.image!.create({ src, alt: "" }));
  const caret = state.selection.empty && state.selection.from === at;
  const $at = state.doc.resolve(at);
  let pos = at;
  if ($at.parent.isTextblock && $at.depth > 0) {
    // 목록 항목의 첫 줄처럼 그 앞에 그림을 둘 수 없는 줄은 줄 맨 앞이라도 그 줄 아래에 둔다.
    const above = $at.node(-1).canReplaceWith($at.index(-1), $at.index(-1), schema.nodes.image!);
    if ($at.parentOffset === 0 && above) pos = $at.before();
    else if ($at.parentOffset === 0 || $at.parentOffset === $at.parent.content.size) pos = $at.after();
    else { tr.split(at); pos = at + 1; }
  }
  const before = tr.doc.content.size;
  tr.insert(pos, images);
  // 그 자리에 그림을 둘 수 없으면(목록 항목의 첫 줄 앞 등) 그 줄이 든 맨 바깥 블록 다음에 둔다.
  if (tr.doc.content.size === before && $at.depth > 0) { pos = tr.mapping.map($at.after(1)); tr.insert(pos, images); }
  const after = pos + (tr.doc.content.size - before);
  if (caret && tr.doc.content.size > before) {
    if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, schema.nodes.paragraph!.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  return tr;
}

/** 편집기가 닫힌 뒤 끝난 그림은 그 메모 본문 끝에 붙인다. */
export function appendToNote(noteId: string | null, url: string) {
  const note = noteId ? useNotes.getState().items[noteId] : undefined;
  if (note?.kind !== "note") return;
  useNotes.getState().update(note.id, { body: `${note.body.replace(/\s+$/, "")}${note.body.trim() ? "\n\n" : ""}${imageMarkdown(url)}\n` });
}

/** 그림 파일들을 at(없으면 지금 선택한 자리)에 넣는다. 고른 글이 있으면 그 글을 그림으로 바꾼다. 모두 올린 뒤 고른 순서대로 한 번에 넣는다. */
export async function insertImages(editor: Editor, files: File[], at?: number) {
  if (!files.length || editor.isDestroyed || !editor.isEditable) return;
  const noteId = editor.storage.noteImageUpload?.noteId ?? null;
  const { view } = editor;
  const tr = view.state.tr;
  if (at === undefined && !tr.selection.empty) tr.deleteSelection();
  const pos = Math.max(0, Math.min(at ?? tr.selection.from, tr.doc.content.size));
  const uploads: Upload[] = files.map((file) => ({ id: {}, pos, file }));
  view.dispatch(tr.setMeta(uploadKey, { add: uploads } satisfies UploadAction).scrollIntoView());
  const results = await Promise.allSettled(uploads.map(({ file }) => uploadImage(file)));
  const urls = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) useNoteAlert.getState().say(uploadFailure(failure.reason, files.length));
  if (editor.isDestroyed) { for (const url of urls) appendToNote(noteId, url); return; }
  const ids = uploads.map((upload) => upload.id);
  const found = placeholderAt(editor.state, ids);
  // 자리표시를 지웠으면(그 줄을 지우는 등) 그림도 넣지 않는다.
  editor.view.dispatch(found === null ? editor.state.tr.setMeta(uploadKey, { remove: ids } satisfies UploadAction) : placeImages(editor.state, found, urls, ids));
}

export const NoteImageUpload = Extension.create({
  name: "noteImageUpload",
  addStorage() { return { noteId: null as string | null }; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin<DecorationSet>({
      key: uploadKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          let next = set.map(tr.mapping, tr.doc);
          const action = tr.getMeta(uploadKey) as UploadAction | undefined;
          if (action && "add" in action) {
            next = next.add(tr.doc, action.add.map((upload, index) =>
              Decoration.widget(upload.pos, placeholder(upload.file), { id: upload.id, side: index + 1, destroy: releasePreview })));
          } else if (action) next = next.remove(next.find(undefined, undefined, (spec) => action.remove.includes(spec.id)));
          return next;
        },
      },
      props: {
        decorations: (state) => uploadKey.getState(state),
        handlePaste: (view, event) => {
          const files = imageFilesOf(event.clipboardData);
          // 코드 블록 안에는 그림을 넣지 않는다.
          if (!files.length || !editor.isEditable || view.state.selection.$from.parent.type.spec.code) return false;
          event.preventDefault();
          void insertImages(editor, files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved || !editor.isEditable) return false;
          const files = imageFilesOf(event.dataTransfer, false);
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          void insertImages(editor, files, at?.pos ?? view.state.selection.from);
          return true;
        },
      },
    })];
  },
});

// ── Mermaid 다이어그램 ───────────────────────────────────────
// 언어가 mermaid인 코드 블록(```mermaid)을 다이어그램으로 보인다. 원문은 그대로 코드 블록이라 Markdown 보기·내려받기에서도 같다.
// 다이어그램을 누르거나 커서가 들어가면 아래에 코드가 열리고, 고치는 대로 다시 그린다. Esc로 닫는다.

/** 다이어그램은 16px 글자로 재고 그린 뒤 본문 글자 크기(14px)에 맞춰 줄여 보인다. */
const SCALE = 0.875;
const isDiagram = (node: ProseNode) => node.attrs.language === "mermaid";

/** 다이어그램이 아닌 코드 블록. 기본 모양(pre > code)과 같다. */
class CodeView implements NodeView {
  dom = document.createElement("pre");
  contentDOM = document.createElement("code");
  constructor(private node: ProseNode) { this.dom.append(this.contentDOM); this.paint(); }
  private paint() {
    const language = this.node.attrs.language as string | null;
    if (language) this.contentDOM.className = `language-${language}`; else this.contentDOM.removeAttribute("class");
  }
  update(node: ProseNode) {
    if (node.type !== this.node.type || isDiagram(node)) return false;
    this.node = node;
    this.paint();
    return true;
  }
}

class DiagramView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("code");
  private preview = document.createElement("div");
  private message = document.createElement("p");
  private image: HTMLImageElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  private stopTheme: () => void;

  constructor(private node: ProseNode, private editor: Editor, private getPos: () => number | undefined) {
    this.dom.className = "note-diagram";
    this.preview.className = "note-diagram-preview";
    this.preview.contentEditable = "false";
    this.message.className = "note-diagram-message";
    this.preview.append(this.message);
    const source = document.createElement("pre");
    source.className = "note-diagram-source";
    source.spellcheck = false;
    this.contentDOM.className = "language-mermaid";
    source.append(this.contentDOM);
    this.dom.append(this.preview, source);
    if (editor.isEditable) { this.preview.title = "눌러서 다이어그램 코드 고치기"; this.preview.addEventListener("mousedown", this.edit); }
    editor.on("selectionUpdate", this.sync);
    editor.on("focus", this.sync);
    editor.on("blur", this.sync);
    this.stopTheme = onThemeChange(() => this.draw(true));
    this.draw(true);
  }

  /** 커서가 이 블록 안에 있을 때만 코드를 연다. */
  private sync = () => {
    const pos = this.getPos();
    const { from, to } = this.editor.state.selection;
    const inside = typeof pos === "number" && this.editor.isEditable && this.editor.isFocused && from > pos && to < pos + this.node.nodeSize;
    this.dom.classList.toggle("is-editing", inside);
  };

  /** 다이어그램을 누르면 코드 끝에 커서를 둔다. */
  private edit = (event: MouseEvent) => {
    if (event.button !== 0) return;
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

  private show(diagram: Diagram) {
    if (!this.image) {
      this.image = document.createElement("img");
      this.image.draggable = false;
      this.image.decoding = "async";
      this.preview.prepend(this.image);
    }
    const firstLine = this.node.textContent.trim().split("\n")[0]!.trim();
    this.image.alt = `Mermaid 다이어그램 (${firstLine.slice(0, 60)})`;
    this.image.width = Math.round(diagram.width * SCALE);
    this.image.height = Math.round(diagram.height * SCALE);
    this.image.src = diagram.url;
    this.say("ready");
  }

  /** 고치는 중에는 잠시 멈췄을 때 다시 그린다. 틀린 코드는 마지막으로 그린 그림을 흐리게 두고 오류를 보인다. */
  private draw(now = false) {
    clearTimeout(this.timer);
    const code = this.node.textContent;
    const version = ++this.version;
    if (!code.trim()) {
      this.image?.remove();
      this.image = null;
      this.say("empty", this.editor.isEditable ? "Mermaid 코드를 입력하면 여기에 다이어그램이 그려집니다." : "빈 다이어그램");
      return;
    }
    if (!this.image) this.say("loading", "다이어그램을 그리는 중…");
    this.timer = setTimeout(() => {
      renderDiagram(code).then(
        (diagram) => { if (version === this.version) this.show(diagram); },
        (error: unknown) => { if (version === this.version) this.say("error", error instanceof Error ? error.message : "다이어그램을 그리지 못했습니다."); },
      );
    }, now ? 0 : 280);
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type || !isDiagram(node)) return false;
    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (changed) this.draw();
    this.sync();
    return true;
  }

  /** 코드 밖(다이어그램)의 변화는 편집기가 다시 읽지 않는다. */
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  /** 다이어그램을 누르는 일은 이 보기가 처리한다. 끌어 놓기는 편집기에 맡긴다. */
  stopEvent(event: Event) {
    return this.preview.contains(event.target as globalThis.Node) && !event.type.startsWith("drag") && event.type !== "drop";
  }

  destroy() {
    clearTimeout(this.timer);
    this.version++;
    this.stopTheme();
    this.editor.off("selectionUpdate", this.sync);
    this.editor.off("focus", this.sync);
    this.editor.off("blur", this.sync);
  }
}

/** 코드 블록. 언어가 mermaid면 다이어그램으로 보인다. */
export const NoteCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => (isDiagram(node) ? new DiagramView(node, editor, getPos) : new CodeView(node));
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // 다이어그램 코드를 고치다 Esc를 누르면 코드를 닫고 다이어그램 전체를 고른다.
      Escape: () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== this.name || !isDiagram($from.parent)) return false;
        return this.editor.commands.setNodeSelection($from.before());
      },
    };
  },
});

/** 다이어그램 예시를 넣는다. 빈 문단이면 그 자리를, 아니면 지금 블록 다음을 쓰고, 커서를 코드 끝에 둔다. */
export function insertDiagram(editor: Editor) {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  if (block.type.name === "paragraph" && !block.content.size) {
    editor.chain().focus().setNode("codeBlock", { language: "mermaid" }).insertContent(DIAGRAM_SAMPLE).run();
    return;
  }
  const at = $from.depth ? $from.after(1) : editor.state.doc.content.size;
  editor.chain().focus().insertContentAt(at, { type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: DIAGRAM_SAMPLE }] })
    .setTextSelection(at + 1 + DIAGRAM_SAMPLE.length).run();
}
