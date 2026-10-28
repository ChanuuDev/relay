import { useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  Bold, ChevronRight, Code, Ellipsis, FilePlus, FileText, Folder, FolderPlus, Heading1, Heading2, Heading3, Italic, Link, List, ListChecks, ListOrdered,
  Pilcrow, Quote, Search, SquareCode, Strikethrough, Trash,
} from "lucide-react";
import { Window } from "@/components/desktop/window";
import { WindowTitleBar } from "@/components/desktop/window-title-bar";
import { SplitView } from "@/components/desktop/split-view";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tip } from "@/components/patterns/tip";

type Node = { id: string; kind: "folder" | "doc"; name: string; children?: Node[] };
const TREE: Node[] = [
  { id: "f1", kind: "folder", name: "디자인 시스템", children: [
    { id: "d1", kind: "doc", name: "유리 재질 규칙" },
    { id: "d2", kind: "doc", name: "타이포그래피" },
    { id: "f2", kind: "folder", name: "컴포넌트", children: [{ id: "d3", kind: "doc", name: "버튼과 입력" }, { id: "d4", kind: "doc", name: "목록 행" }] },
  ] },
  { id: "f3", kind: "folder", name: "회의록", children: [{ id: "d5", kind: "doc", name: "10월 28일 리뷰" }] },
  { id: "d6", kind: "doc", name: "할 일" },
];
const count = (node: Node): number => (node.children ?? []).reduce((sum, child) => sum + (child.kind === "doc" ? 1 : count(child)), 0);

const SOURCE = `# 유리 재질 규칙

크롬(메뉴바·상단바·사이드바)만 **유리**이고, 읽는 내용은 불투명 바탕이다.

- 강조색은 시스템 블루 하나
- 보조 글자는 \`--glass-text-muted\`

> 유리는 뒤에 비칠 바탕화면이 있어야 보인다.
`;

/** 문서 창: 유리 사이드바(검색·트리·저장 상태) | 불투명 내용(경로 줄·서식 도구 막대·제목·본문).
 *  보여 주는 것: 트리 패턴(role=tree, 펼침 갈매기, 깊이 들여쓰기), 서식 도구(aria-pressed 강조색 틴트), 세그먼트, .prose 본문, 고정폭 원문. */
export function DocsWindow() {
  const [open, setOpen] = useState<Set<string>>(new Set(["f1", "f2"]));
  const [selected, setSelected] = useState("d1");
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [marks, setMarks] = useState<Set<string>>(new Set(["bold"]));
  const toggleMark = (id: string) => setMarks((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const header = <WindowTitleBar id="docs" right={<div className="toolbar-icons">
    <Tip text="새 폴더"><Button variant="ghost" size="icon-sm" aria-label="새 폴더"><FolderPlus /></Button></Tip>
    <Tip text="새 문서"><Button variant="ghost" size="icon-sm" aria-label="새 문서"><FilePlus /></Button></Tip>
    <Tip text="삭제"><Button variant="ghost" size="icon-sm" aria-label="삭제"><Trash /></Button></Tip>
  </div>} />;

  const tool = (id: string, label: string, Icon: typeof Bold, keys?: string) =>
    <Tip key={id} text={keys ? `${label} (${keys})` : label}><Button variant="ghost" size="icon-sm" className="format-tool" aria-label={label}
      aria-pressed={marks.has(id)} disabled={mode === "source"} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleMark(id)}><Icon /></Button></Tip>;

  return <Window id="docs" header={header}>
    <SplitView name="docs" label="문서 목록" defaultWidth={256} minWidth={200} maxWidth={480} minMain={320}
      side={<div className="material-chrome flex min-h-0 flex-1 flex-col">
        <div style={{ padding: "10px 10px 6px" }}>
          <InputGroup><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput placeholder="문서 검색" aria-label="문서 검색" /></InputGroup>
        </div>
        <ul className="tree" role="tree" aria-label="문서">
          {TREE.map((node) => <TreeNode key={node.id} node={node} depth={0} open={open} selected={selected}
            onToggle={(id) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelect={setSelected} />)}
        </ul>
        <div className="sidebar-footer"><span>문서 6개 · 폴더 3개</span><span className="sync-state"><span className="status-dot" />저장됨</span></div>
      </div>}
      main={<div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--background)" }}>
        <div className="detail-topline">
          <span className="flex items-center gap-1">모든 문서 <ChevronRight className="size-3 opacity-60" /> 디자인 시스템</span>
          <time>방금 수정</time>
        </div>
        <div className="format-toolbar" role="toolbar" aria-label="서식">
          <div className="format-group">{tool("p", "본문", Pilcrow)}{tool("h1", "제목 1", Heading1)}{tool("h2", "제목 2", Heading2)}{tool("h3", "제목 3", Heading3)}</div>
          <span className="format-sep" />
          <div className="format-group">{tool("bold", "굵게", Bold, "Ctrl+B")}{tool("italic", "기울임", Italic, "Ctrl+I")}{tool("strike", "취소선", Strikethrough)}{tool("code", "인라인 코드", Code)}</div>
          <span className="format-sep" />
          <div className="format-group">{tool("ul", "글머리 목록", List)}{tool("ol", "번호 목록", ListOrdered)}{tool("task", "체크리스트", ListChecks)}</div>
          <span className="format-sep" />
          <div className="format-group">{tool("quote", "인용", Quote)}{tool("block", "코드 블록", SquareCode)}{tool("link", "링크", Link)}</div>
          <div className="format-end">
            <div className="segmented" role="group" aria-label="보기">
              <button type="button" aria-pressed={mode === "rich"} onClick={() => setMode("rich")}>서식</button>
              <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>Markdown</button>
            </div>
          </div>
        </div>
        <div className="doc-scroll">
          <div className="doc-sheet">
            <input className="doc-title" defaultValue="유리 재질 규칙" aria-label="제목" placeholder="제목" />
            {mode === "rich" ? <article className="prose doc-body">
              <p>크롬(메뉴바·상단바·사이드바)만 <strong>유리</strong>이고, 읽는 내용은 불투명 바탕이다. 자세한 값은 <a href="#tokens">토큰 표</a>를 본다.</p>
              <h2>지킬 것</h2>
              <ul><li>강조색은 시스템 블루 하나</li><li>보조 글자는 <code>--glass-text-muted</code></li><li>모서리는 컨트롤 알약, 창 12px, 카드 8–12px</li></ul>
              <ul className="task-list">
                <li data-checked="true"><label><input type="checkbox" defaultChecked /></label><div>다크·라이트 스크린샷 비교</div></li>
                <li><label><input type="checkbox" /></label><div>모바일 탭바 확인</div></li>
              </ul>
              <blockquote>유리는 뒤에 비칠 바탕화면이 있어야 보인다.</blockquote>
              <pre><code>{".material-chrome {\n  background: var(--glass-chrome-fill);\n  backdrop-filter: blur(40px) saturate(170%);\n}"}</code></pre>
              <table><thead><tr><th>재질</th><th>블러</th><th>쓰임</th></tr></thead>
                <tbody><tr><td>bar</td><td>20px</td><td>메뉴바</td></tr><tr><td>chrome</td><td>40px</td><td>상단바·사이드바</td></tr><tr><td>menu</td><td>30px</td><td>메뉴·툴팁</td></tr></tbody></table>
            </article> : <textarea className="source-editor doc-body" defaultValue={SOURCE} aria-label="Markdown 원문" />}
          </div>
        </div>
      </div>} />
  </Window>;
}

function TreeNode({ node, depth, open, selected, onToggle, onSelect }: {
  node: Node; depth: number; open: Set<string>; selected: string; onToggle: (id: string) => void; onSelect: (id: string) => void;
}) {
  const folder = node.kind === "folder";
  const expanded = folder && open.has(node.id);
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); if (folder) onToggle(node.id); }
    if (folder && ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded))) { event.preventDefault(); onToggle(node.id); }
  };
  const Icon = folder ? Folder : FileText;
  return <li className="tree-item" role="treeitem" aria-level={depth + 1} aria-selected={selected === node.id} aria-expanded={folder ? expanded : undefined}
    data-kind={folder ? "folder" : "doc"} tabIndex={selected === node.id ? 0 : -1} onKeyDown={onKeyDown}>
    <div className="tree-row" style={{ "--depth": depth } as CSSProperties} onClick={() => { onSelect(node.id); if (folder) onToggle(node.id); }}>
      <span className="tree-chevron" data-hidden={folder ? undefined : ""} aria-hidden="true"><ChevronRight /></span>
      <Icon className="tree-icon" aria-hidden="true" />
      <span className="tree-label">{node.name}</span>
      {folder ? <span className="tree-count">{count(node)}</span> : null}
      <button type="button" className="tree-more" aria-label={`${node.name} 메뉴`} onClick={(event) => event.stopPropagation()}><Ellipsis /></button>
    </div>
    {expanded && node.children ? <ul role="group">{node.children.map((child) =>
      <TreeNode key={child.id} node={child} depth={depth + 1} open={open} selected={selected} onToggle={onToggle} onSelect={onSelect} />)}</ul> : null}
  </li>;
}
