import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Popover } from "radix-ui";
import {
  Bold, Code, Download, Heading1, Heading2, Heading3, Italic, Link, List, ListOrdered, ListTodo, Minus, Pilcrow, Redo2, SquareCode, Strikethrough, Table, TextQuote, Undo2, Unlink,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { fileNameOf, labelOf, markdownFile, useNoteMode, useNotes, type Note } from "../../lib/notes";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const SHIFT = MOD === "⌘" ? "⇧" : "Shift+";
const ALT = MOD === "⌘" ? "⌥" : "Alt+";
type Block = "paragraph" | "h1" | "h2" | "h3";
/** 문단 스타일은 목록 대신 단추로 둔다. 목록(Select)은 닫힐 때 초점을 늦게 돌려줘 그 사이 친 글자가 엇나간다. */
const BLOCKS: Array<{ value: Block; label: string; icon: LucideIcon }> = [
  { value: "paragraph", label: "본문 텍스트", icon: Pilcrow }, { value: "h1", label: "제목 1", icon: Heading1 },
  { value: "h2", label: "제목 2", icon: Heading2 }, { value: "h3", label: "제목 3", icon: Heading3 },
];

/** 본문은 Markdown으로 읽고 쓴다. 한 줄 바꿈도 줄바꿈으로 읽어(breaks) 예전 평문 메모의 줄이 합쳐지지 않는다. */
export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // 밑줄은 Markdown 표준 문법이 없어 뺀다.
    underline: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  // 외부 그림은 CSP가 막지만, 원문에 있는 그림 문법은 서식 보기를 오가도 잃지 않게 둔다.
  Image,
  Placeholder.configure({ placeholder: "내용을 입력하세요" }),
  Markdown.configure({ markedOptions: { gfm: true, breaks: true }, indentation: { style: "space", size: 2 } }),
];

/** 위쪽 서식 도구와 아래쪽 입력 창. 서식 보기에서는 고친 내용을 Markdown으로 바꿔 저장한다. */
export function NoteDocument({ note }: { note: Note }) {
  const mode = useNoteMode((state) => state.mode);
  const setMode = useNoteMode((state) => state.setMode);
  const { update } = useNotes.getState();
  // 이 창이 마지막으로 저장한 본문. 다른 곳(다른 탭·되살리기)에서 바뀐 본문만 편집기에 다시 넣는다.
  const emitted = useRef(note.body);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const editor = useEditor({
    extensions,
    content: note.body,
    contentType: "markdown",
    // CSP(style-src 'self')가 인라인 <style>을 막으므로 기본 CSS는 styles.css에 옮겨 두었다.
    injectCSS: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { id: "note-body", class: "note-prose", role: "textbox", "aria-multiline": "true", "aria-label": "본문" },
      // Ctrl/⌘+K는 서식 도구의 링크 칸을 연다.
      handleKeyDown: (_view, event) => {
        if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('.note-toolbar [aria-label="링크"]:not(:disabled)')?.click();
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const body = current.getMarkdown();
      emitted.current = body;
      update(note.id, { body });
    },
  }, [mode === "rich"]);

  useEffect(() => {
    if (mode !== "rich" || !editor || note.body === emitted.current) return;
    emitted.current = note.body;
    editor.commands.setContent(note.body, { contentType: "markdown", emitUpdate: false });
  }, [note.body, editor, mode]);

  function focusBody(at: "start" | "end") {
    if (mode === "rich") editor?.commands.focus(at);
    else { const source = sourceRef.current; source?.focus(); if (source && at === "end") source.setSelectionRange(source.value.length, source.value.length); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdownFile(note)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = fileNameOf(note);
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <FormatToolbar editor={mode === "rich" ? editor : null} mode={mode} onMode={(next) => { emitted.current = note.body; setMode(next); }} onDownload={download} />
    <div className="note-scroll" onMouseDown={(event) => {
      // 본문 아래 빈 곳을 누르면 본문 끝에 커서를 둔다.
      if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains("note-sheet")) { event.preventDefault(); focusBody("end"); }
    }}>
      <div className="note-sheet">
        <input id="note-title" className="note-title" value={note.title} placeholder={labelOf({ ...note, title: "" })} aria-label="제목" maxLength={200}
          autoComplete="off" onChange={(event) => update(note.id, { title: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); focusBody("start"); } }} />
        {mode === "rich"
          ? <EditorContent editor={editor} className="note-rich" />
          : <textarea id="note-body" ref={sourceRef} className="note-source" value={note.body} aria-label="본문" spellCheck={false}
              placeholder={"# 제목\n\n**굵게**, *기울임*, `코드`\n- 목록\n- [ ] 할 일"}
              onChange={(event) => { emitted.current = event.target.value; update(note.id, { body: event.target.value }); }} />}
      </div>
    </div>
  </>;
}

function FormatToolbar({ editor, mode, onMode, onDownload }: {
  editor: Editor | null; mode: "rich" | "source"; onMode: (mode: "rich" | "source") => void; onDownload: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive("bold"), italic: current.isActive("italic"), strike: current.isActive("strike"), code: current.isActive("code"),
      bulletList: current.isActive("bulletList"), orderedList: current.isActive("orderedList"), taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"), codeBlock: current.isActive("codeBlock"), link: current.isActive("link"), table: current.isActive("table"),
      block: ([1, 2, 3] as const).map((level) => current.isActive("heading", { level }) ? `h${level}` as Block : null).find(Boolean) ?? "paragraph",
      canUndo: current.can().undo(), canRedo: current.can().redo(),
    } : null,
  });
  const off = !editor || !state;
  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => { if (editor) command(editor.chain().focus()).run(); };
  const setBlock = (value: Block) => run((chain) => (value === "paragraph" ? chain.setParagraph() : chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })));

  return <div className="note-toolbar" role="toolbar" aria-label="서식">
    <div className="format-group">
      <Tool icon={Undo2} label="실행 취소" keys={`${MOD}Z`} disabled={off || !state.canUndo} onClick={run((chain) => chain.undo())} />
      <Tool icon={Redo2} label="다시 실행" keys={`${MOD}${SHIFT}Z`} disabled={off || !state.canRedo} onClick={run((chain) => chain.redo())} />
    </div>
    <span className="format-sep" aria-hidden="true" />
    <div className="format-group" role="group" aria-label="문단 스타일">
      {BLOCKS.map((block, index) => <Tool key={block.value} icon={block.icon} label={block.label} keys={`${MOD}${ALT}${index}`}
        active={state?.block === block.value && !state.codeBlock} disabled={off || state.codeBlock} onClick={setBlock(block.value)} />)}
    </div>
    <span className="format-sep" aria-hidden="true" />
    <div className="format-group">
      <Tool icon={Bold} label="굵게" keys={`${MOD}B`} active={state?.bold} disabled={off} onClick={run((chain) => chain.toggleBold())} />
      <Tool icon={Italic} label="기울임" keys={`${MOD}I`} active={state?.italic} disabled={off} onClick={run((chain) => chain.toggleItalic())} />
      <Tool icon={Strikethrough} label="취소선" keys={`${MOD}${SHIFT}S`} active={state?.strike} disabled={off} onClick={run((chain) => chain.toggleStrike())} />
      <Tool icon={Code} label="인라인 코드" keys={`${MOD}E`} active={state?.code} disabled={off} onClick={run((chain) => chain.toggleCode())} />
    </div>
    <span className="format-sep" aria-hidden="true" />
    <div className="format-group">
      <Tool icon={List} label="글머리 목록" keys={`${MOD}${SHIFT}8`} active={state?.bulletList} disabled={off} onClick={run((chain) => chain.toggleBulletList())} />
      <Tool icon={ListOrdered} label="번호 목록" keys={`${MOD}${SHIFT}7`} active={state?.orderedList} disabled={off} onClick={run((chain) => chain.toggleOrderedList())} />
      <Tool icon={ListTodo} label="체크리스트" keys={`${MOD}${SHIFT}9`} active={state?.taskList} disabled={off} onClick={run((chain) => chain.toggleTaskList())} />
    </div>
    <span className="format-sep" aria-hidden="true" />
    <div className="format-group">
      <Tool icon={TextQuote} label="인용" keys={`${MOD}${SHIFT}B`} active={state?.blockquote} disabled={off} onClick={run((chain) => chain.toggleBlockquote())} />
      <Tool icon={SquareCode} label="코드 블록" keys={`${MOD}${ALT}C`} active={state?.codeBlock} disabled={off} onClick={run((chain) => chain.toggleCodeBlock())} />
      <Tool icon={Minus} label="구분선" disabled={off} onClick={run((chain) => chain.setHorizontalRule())} />
    </div>
    <span className="format-sep" aria-hidden="true" />
    <div className="format-group">
      <LinkTool editor={editor} active={Boolean(state?.link)} disabled={off || state.codeBlock} />
      <TableTool editor={editor} active={Boolean(state?.table)} disabled={off} />
    </div>
    <div className="format-end">
      <div className="format-mode" role="group" aria-label="보기">
        <button type="button" aria-pressed={mode === "rich"} onClick={() => onMode("rich")}>서식</button>
        <button type="button" aria-pressed={mode === "source"} onClick={() => onMode("source")}>Markdown</button>
      </div>
      <Tool icon={Download} label="Markdown 파일로 저장" onClick={onDownload} />
    </div>
  </div>;
}

/** 도구 단추. 누를 때 편집기에서 초점·선택을 빼앗지 않는다. */
function Tool({ icon: Icon, label, keys, active, disabled, onClick, trigger }: {
  icon: LucideIcon; label: string; keys?: string; active?: boolean; disabled?: boolean; onClick?: () => void; trigger?: (button: ReactNode) => ReactNode;
}) {
  const button = <Button type="button" variant="ghost" size="icon-sm" className="format-tool" aria-label={label} aria-keyshortcuts={keys?.replace("⌘", "Meta+")}
    aria-pressed={active === undefined ? undefined : active} data-active={active ? "" : undefined} disabled={disabled}
    onMouseDown={(event) => event.preventDefault()} onClick={onClick}><Icon aria-hidden="true" /></Button>;
  return <Tooltip>
    <TooltipTrigger asChild>{trigger ? trigger(button) : button}</TooltipTrigger>
    <TooltipContent>{label}{keys && <kbd className="format-keys">{keys}</kbd>}</TooltipContent>
  </Tooltip>;
}

/** 링크 넣기·고치기·지우기. 주소에 프로토콜이 없으면 https를 붙인다. */
function LinkTool({ editor, active, disabled }: { editor: Editor | null; active: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const value = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!value) chain.unsetLink().run();
    else {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("#") ? value : `https://${value}`;
      if (editor.state.selection.empty && !active) chain.insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: url } }] }).run();
      else chain.setLink({ href: url }).run();
    }
    setOpen(false);
  }
  return <Popover.Root open={open} onOpenChange={(next) => { if (next && editor) setHref(String(editor.getAttributes("link").href ?? "")); setOpen(next); }}>
    <Tool icon={Link} label="링크" keys={`${MOD}K`} active={active} disabled={disabled} trigger={(button) => <Popover.Trigger asChild>{button}</Popover.Trigger>} />
    <Popover.Portal>
      <Popover.Content className="format-popover material-menu" side="bottom" align="start" sideOffset={6}
        onCloseAutoFocus={(event) => { event.preventDefault(); editor?.view.focus(); }}>
        <form className="link-form" onSubmit={apply}>
          <Input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://" aria-label="링크 주소" autoFocus
            autoComplete="off" spellCheck={false} inputMode="url" maxLength={2048} />
          <Button type="submit" size="xs">적용</Button>
          {active && <Button type="button" variant="ghost" size="icon-xs" aria-label="링크 지우기" title="링크 지우기"
            onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setOpen(false); }}><Unlink aria-hidden="true" /></Button>}
        </form>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

/** 표 밖에서는 3×3 표를 넣고, 표 안에서는 행·열을 다루는 목록을 연다. */
function TableTool({ editor, active, disabled }: { editor: Editor | null; active: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  if (!active) return <Tool icon={Table} label="표 넣기" disabled={disabled}
    onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />;
  const action = (label: string, command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>, danger = false) =>
    <button type="button" className="menu-item" data-danger={danger ? "" : undefined} role="menuitem"
      onClick={() => { if (editor) command(editor.chain().focus()).run(); setOpen(false); }}>{label}</button>;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Tool icon={Table} label="표 편집" active disabled={disabled} trigger={(button) => <Popover.Trigger asChild>{button}</Popover.Trigger>} />
    <Popover.Portal>
      <Popover.Content className="format-popover format-menu material-menu" role="menu" aria-label="표 편집" side="bottom" align="start" sideOffset={6}
        onCloseAutoFocus={(event) => { event.preventDefault(); editor?.view.focus(); }}>
        {action("위에 행 추가", (chain) => chain.addRowBefore())}
        {action("아래에 행 추가", (chain) => chain.addRowAfter())}
        {action("왼쪽에 열 추가", (chain) => chain.addColumnBefore())}
        {action("오른쪽에 열 추가", (chain) => chain.addColumnAfter())}
        <div role="separator" className="menu-separator" />
        {action("행 삭제", (chain) => chain.deleteRow())}
        {action("열 삭제", (chain) => chain.deleteColumn())}
        {action("표 삭제", (chain) => chain.deleteTable(), true)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
