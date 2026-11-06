import type { Editor } from "@tiptap/core";
import { DIAGRAM_SAMPLE } from "../../../lib/mermaid";
import type { AlertKind } from "./nodes";
import { insertPreviewBlock } from "./preview";

/* 서식 도구의 "더 넣기"가 넣는 양식. 서식 보기에서는 노드로, Markdown 보기에서는 같은 원문을 커서 자리에 넣는다. */

export type InsertKind = "mermaid" | "math" | "mathInline" | `alert:${AlertKind}` | "details" | "footnote" | "geojson" | "stl" | "html";

export const SAMPLES = {
  mermaid: DIAGRAM_SAMPLE,
  math: "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
  mathInline: "e^{i\\pi} + 1 = 0",
  geojson: JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "서울" }, geometry: { type: "Point", coordinates: [126.978, 37.5665] } },
    { type: "Feature", properties: { name: "부산" }, geometry: { type: "Point", coordinates: [129.0756, 35.1796] } },
    { type: "Feature", properties: { name: "경부선" }, geometry: { type: "LineString", coordinates: [[126.978, 37.5665], [127.385, 36.351], [128.601, 35.871], [129.0756, 35.1796]] } },
  ] }, null, 2),
  stl: "solid pyramid\n  facet normal 0 0 -1\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 1 1 0\n    endloop\n  endfacet\n  facet normal 0 0 -1\n    outer loop\n      vertex 0 0 0\n      vertex 1 1 0\n      vertex 0 1 0\n    endloop\n  endfacet\n  facet normal 0 -1 1\n    outer loop\n      vertex 0 0 0\n      vertex 0.5 0.5 1\n      vertex 1 0 0\n    endloop\n  endfacet\n  facet normal 1 0 1\n    outer loop\n      vertex 1 0 0\n      vertex 0.5 0.5 1\n      vertex 1 1 0\n    endloop\n  endfacet\n  facet normal 0 1 1\n    outer loop\n      vertex 1 1 0\n      vertex 0.5 0.5 1\n      vertex 0 1 0\n    endloop\n  endfacet\n  facet normal -1 0 1\n    outer loop\n      vertex 0 1 0\n      vertex 0.5 0.5 1\n      vertex 0 0 0\n    endloop\n  endfacet\nendsolid pyramid",
  html: "<p align=\"center\">\n  <b>가운데 정렬한 HTML</b><br>\n  <sub>GitHub처럼 허용한 태그만 그립니다</sub>\n</p>",
} as const;

/** 문서에 이미 있는 각주 이름 중 가장 큰 번호 다음 번호. */
function nextFootnote(markdown: string, editor?: Editor) {
  const labels: string[] = [];
  if (editor) editor.state.doc.descendants((node) => { if (node.type.name === "footnoteReference" || node.type.name === "footnoteDefinition") labels.push(String(node.attrs.label)); });
  else for (const match of markdown.matchAll(/\[\^([^\]\s]+)\]/g)) labels.push(match[1]!);
  return String(labels.reduce((top, label) => Math.max(top, /^\d+$/.test(label) ? Number(label) : 0), 0) + 1);
}

/** 서식 보기에서 넣는다. 메뉴에서 고른 직후 친 글자가 사라지지 않게 초점을 바로(동기로) 편집기에 돌린다. */
export function insertRich(editor: Editor, kind: InsertKind) {
  editor.view.focus();
  if (kind === "mermaid" || kind === "math" || kind === "geojson" || kind === "stl" || kind === "html") { insertPreviewBlock(editor, kind, SAMPLES[kind]); return; }
  if (kind === "mathInline") {
    const at = editor.state.selection.from;
    editor.chain().focus().insertContent({ type: "mathInline", attrs: { latex: SAMPLES.mathInline } }).run();
    // 넣은 수식의 원문 칸을 바로 연다.
    requestAnimationFrame(() => editor.view.nodeDOM(at)?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    return;
  }
  if (kind.startsWith("alert:")) {
    const alert = kind.slice(6);
    const inside = editor.isActive("alert");
    if (inside) editor.chain().focus().updateAttributes("alert", { kind: alert }).run();
    else editor.chain().focus().wrapIn("alert", { kind: alert }).run();
    return;
  }
  // 새 접기는 펼친 채 시작해 제목 다음 Enter가 내용으로 들어간다. 공식 확장은 펼친 채 새로 만든 블록을 setTimeout 뒤에 펼치므로,
  // 만든 뒤 따로 펼쳐 바로 펼쳐지게 한다(그 사이 친 Enter가 블록 밖으로 나가지 않게).
  if (kind === "details") { editor.chain().focus().setDetails().run(); editor.chain().updateAttributes("details", { open: true }).run(); return; }
  if (kind === "footnote") {
    const label = nextFootnote("", editor);
    editor.chain().focus().insertContent({ type: "footnoteReference", attrs: { label } }).run();
    editor.chain().insertContentAt(editor.state.doc.content.size, { type: "footnoteDefinition", attrs: { label }, content: [{ type: "paragraph" }] }).run();
    // 넣은 설명을 찾아 그 첫 줄에 커서를 둔다(문서 끝의 빈 줄 등으로 위치가 달라지므로 계산하지 않고 찾는다).
    let target: number | null = null;
    editor.state.doc.descendants((node, pos) => { if (target === null && node.type.name === "footnoteDefinition" && String(node.attrs.label) === label) target = pos; return target === null; });
    if (target !== null) editor.chain().focus().setTextSelection(target + 2).scrollIntoView().run();
  }
}

/** Markdown 보기에서 넣을 원문. block이면 제 줄에 놓는다. */
export function sourceSnippet(kind: InsertKind, markdown: string): { text: string; block: boolean; append?: string } {
  switch (kind) {
    case "mermaid": case "geojson": case "stl": return { text: `\`\`\`${kind}\n${SAMPLES[kind]}\n\`\`\``, block: true };
    case "math": return { text: `$$\n${SAMPLES.math}\n$$`, block: true };
    case "mathInline": return { text: `$${SAMPLES.mathInline}$`, block: false };
    case "html": return { text: SAMPLES.html, block: true };
    case "details": return { text: "<details>\n<summary>자세히 보기</summary>\n\n내용을 입력하세요\n\n</details>", block: true };
    case "footnote": { const label = nextFootnote(markdown); return { text: `[^${label}]`, block: false, append: `[^${label}]: 각주 내용` }; }
    default: return { text: `> [!${kind.slice(6).toUpperCase()}]\n> 내용을 입력하세요`, block: true };
  }
}

/** 표에서 지금 칸이 든 열 전체의 정렬을 바꾼다. Markdown 표는 정렬이 열 단위라 열 칸을 모두 맞춘다. */
export function alignColumn(editor: Editor, align: "left" | "center" | "right" | null) {
  const { state } = editor;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !["tableCell", "tableHeader"].includes($from.node(depth).type.name)) depth--;
  if (depth < 3) return false;
  const column = $from.index(depth - 1);
  const table = $from.node(depth - 2);
  const start = $from.start(depth - 2);
  const tr = state.tr;
  table.forEach((row, offset) => {
    if (column >= row.childCount) return;
    let pos = start + offset + 1;
    for (let index = 0; index < column; index++) pos += row.child(index).nodeSize;
    tr.setNodeMarkup(pos, undefined, { ...row.child(column).attrs, align });
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}
