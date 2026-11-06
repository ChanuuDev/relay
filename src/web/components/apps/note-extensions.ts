import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { imageFilesOf, imageMarkdown, uploadFailure, uploadImage, useNoteAlert } from "../../lib/note-images";
import { useNotes } from "../../lib/notes";
import { joinTexts, readTextFiles, textFailure, textFilesOf } from "../../lib/note-files";

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

/** 붙여 넣은 그림은 저마다 제 줄(문단)에 놓는다. 줄 맨 앞(빈 줄 포함)이면 그 줄 위, 줄 끝이면 그 줄 아래, 가운데면 줄을 나눠 그 사이다.
 *  커서가 그 자리에 있었으면 그림 다음 줄로 옮겨 이어 쓰게 한다(그림이 선택된 채 남아 다음 글자에 덮이지 않게). */
function placeImages(state: EditorState, at: number, urls: string[], ids: object[]) {
  const tr = state.tr.setMeta(uploadKey, { remove: ids } satisfies UploadAction);
  if (!urls.length) return tr;
  const { schema } = state;
  const images = urls.map((src) => schema.nodes.paragraph!.create(null, schema.nodes.image!.create({ src, alt: "" })));
  const caret = state.selection.empty && state.selection.from === at;
  const $at = state.doc.resolve(at);
  let pos = at;
  if ($at.parent.isTextblock && $at.depth > 0) {
    // 목록 항목의 첫 줄처럼 그 앞에 문단을 둘 수 없는 곳은 줄 맨 앞이라도 그 줄 아래에 둔다.
    const container = $at.node(-1);
    const above = !(["listItem", "taskItem"].includes(container.type.name) && $at.index(-1) === 0) && container.canReplaceWith($at.index(-1), $at.index(-1), schema.nodes.paragraph!);
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

/** 편집기가 닫힌 뒤 끝난 그림·글은 그 메모 본문 끝에 붙인다. */
export function appendTextToNote(noteId: string | null, text: string) {
  const note = noteId ? useNotes.getState().items[noteId] : undefined;
  if (note?.kind !== "note") return;
  useNotes.getState().update(note.id, { body: `${note.body.replace(/\s+$/, "")}${note.body.trim() ? "\n\n" : ""}${text}\n` });
}
export const appendToNote = (noteId: string | null, url: string) => appendTextToNote(noteId, imageMarkdown(url));

/** 끌어 놓거나 붙여 넣은 글 파일(.txt·.md)의 내용만 at 자리(없으면 지금 고른 범위를 바꿔)에 넣는다. 본문과 같은 Markdown으로 읽어 넣고,
 *  코드 블록 안에는 글자 그대로 넣는다. 여러 파일은 빈 줄로 잇고, 읽는 사이 편집기가 닫히면 그 메모 끝에 붙인다. */
export async function insertTextFiles(editor: Editor, files: File[], at?: number) {
  const noteId = editor.storage.noteImageUpload?.noteId ?? null;
  const { texts, failures } = await readTextFiles(files);
  if (failures.length) useNoteAlert.getState().say(textFailure(failures));
  const text = joinTexts(texts);
  if (!text) return;
  if (editor.isDestroyed) { appendTextToNote(noteId, text); return; }
  const { selection, doc } = editor.state;
  const pos = at === undefined ? null : Math.max(0, Math.min(at, doc.content.size));
  const range = pos === null ? { from: selection.from, to: selection.to } : { from: pos, to: pos };
  if (doc.resolve(range.from).parent.type.spec.code) {
    editor.view.dispatch(editor.state.tr.insertText(text, range.from, range.to).scrollIntoView());
    editor.commands.focus();
    return;
  }
  editor.chain().focus().insertContentAt(range, text, { contentType: "markdown" }).scrollIntoView().run();
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
          // 탐색기에서 복사한 글 파일은 끌어 놓을 때처럼 내용만 커서 자리에 넣는다.
          const texts = textFilesOf(event.clipboardData?.files);
          if (texts.length && editor.isEditable) { event.preventDefault(); void insertTextFiles(editor, texts); return true; }
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
          // 글 파일은 파일이 아니라 그 내용만 놓은 자리에 들어간다.
          const texts = textFilesOf(event.dataTransfer?.files);
          if (!files.length && !texts.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          if (texts.length) void insertTextFiles(editor, texts, at);
          if (files.length) void insertImages(editor, files, at);
          return true;
        },
      },
    })];
  },
});
