import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";
import {
  Alert, Emoji, FootnoteDefinition, FootnoteReference, Highlight, HtmlContainer, HtmlInline, Ins, Kbd, MathBlockSyntax, MathInline, NoteBlockquote, NoteDetails,
  NoteDetailsContent, NoteDetailsSummary, NoteImage, NoteLink, NoteTableCell, NoteTableHeader, Subscript, Superscript,
} from "./nodes";
import { HtmlBlock, NoteCodeBlock, noteContext } from "./preview";
import { MarkdownDecorations } from "./plugins";
import type { MarkdownContext } from "./sanitize";

export type { MarkdownContext } from "./sanitize";
export { insertPreviewBlock, PREVIEW_LANGUAGES } from "./preview";
export { ALERTS, type AlertKind } from "./nodes";

/**
 * 메모 편집기와 파일 뷰어가 쓰는 Markdown 확장 묶음. GitHub Markdown(GFM)이 읽는 양식을 대부분 읽고 원문으로 되돌려 저장한다:
 * 제목 1~6·앵커, 굵게·기울임·취소선·코드, 목록·할 일, 인용·알림 상자, 표(칸 정렬), 코드 블록(색 입히기), 그림(크기·정렬·링크·배지),
 * 수식($…$, $$…$$, ```math), Mermaid·GeoJSON·TopoJSON·STL 미리 보기, 각주, 이모지(:smile:), 접기(<details>), 원문 HTML(허용한 태그만 그림),
 * 위·아래 첨자·키보드 키·형광펜·밑줄, 인라인 코드의 색상 견본.
 *
 * 편집기마다 새로 부른다. 문법 규칙(marked 확장)은 편집기를 만들 때마다 marked 인스턴스에 더해지므로, 인스턴스를 나눠야 규칙이 쌓이지 않는다.
 * 한 줄 바꿈도 줄바꿈으로 읽어(breaks) 예전 평문 메모의 줄이 합쳐지지 않는다.
 */
export function markdownExtensions(context: MarkdownContext = noteContext, placeholder = "내용을 입력하세요") {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // 밑줄은 Markdown 문법이 없어 <ins>·<u>로 쓰는 Ins로 대신한다. 코드 블록·인용은 아래에서 바꾼 것을 쓴다.
      underline: false,
      codeBlock: false,
      blockquote: false,
      link: false,
    }),
    NoteLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }),
    NoteBlockquote,
    Alert,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
    NoteTableCell,
    NoteTableHeader,
    NoteCodeBlock.configure({ context } as never),
    MathBlockSyntax,
    HtmlBlock.configure({ context }),
    HtmlContainer.configure({ context }),
    HtmlInline.configure({ context }),
    // 그림은 글줄 안에 둔다(배지 여러 장, 링크 건 그림). 큰 그림만 따로 테두리를 두른다.
    NoteImage.configure({ inline: true, HTMLAttributes: { class: "note-image" }, context } as never),
    NoteDetails.configure({ persist: true, HTMLAttributes: { class: "md-details" }, renderToggleButton: ({ element, isOpen }) => {
      element.setAttribute("aria-label", isOpen ? "접기" : "펼치기");
      element.setAttribute("aria-expanded", String(isOpen));
    } }),
    NoteDetailsSummary,
    NoteDetailsContent,
    FootnoteReference,
    FootnoteDefinition,
    Emoji,
    MathInline,
    Subscript,
    Superscript,
    Kbd,
    Highlight,
    Ins,
    MarkdownDecorations.configure({ context }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({ marked: new Marked() as unknown as typeof marked, markedOptions: { gfm: true, breaks: true }, indentation: { style: "space", size: 2 } }),
  ];
}
