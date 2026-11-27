import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { useEditorState } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronUp, Search, X, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useDesktop } from "../../lib/desktop-store";
import { enterMenu, exitMenu, reduced } from "../../lib/motion";
import { showsPreview } from "./markdown/preview";

/* 메모 본문 안에서 찾기(Ctrl/⌘+F). 서식 보기는 ProseMirror 꾸밈(decoration)으로, Markdown 보기는 원문 칸 뒤에 같은 글을 깐
   거울 층으로 결과를 칠한다. 둘 다 문서를 바꾸지 않는다. */

export type FindRange = { from: number; to: number };
type Found = { matches: FindRange[]; capped: boolean };
/** 한 번에 칠하는 결과 수. 넘으면 개수에 +를 붙인다. */
const FIND_LIMIT = 1000;
const NONE: Found = { matches: [], capped: false };
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const pattern = (query: string, caseSensitive: boolean) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "giu");

/** text 안에서 찾은 자리를 offset만큼 밀어 out에 더한다. 한도를 넘으면 true. */
function collect(text: string, find: RegExp, offset: number, out: FindRange[]) {
  find.lastIndex = 0;
  for (let match = find.exec(text); match; match = find.exec(text)) {
    if (!match[0]) { find.lastIndex++; continue; }
    if (out.length >= FIND_LIMIT) return true;
    out.push({ from: offset + match.index, to: offset + match.index + match[0].length });
  }
  return false;
}

/** Markdown 원문에서 찾는다. */
export function findInText(text: string, query: string, caseSensitive: boolean): Found {
  if (!query) return NONE;
  const matches: FindRange[] = [];
  return { matches, capped: collect(text, pattern(query, caseSensitive), 0, matches) };
}

/** 서식 문서의 글 블록(문단·제목·코드 블록·표 칸…)마다 찾는다. 그림·수식처럼 글줄 안에 든 덩어리는 한 칸(￼)으로 두어 그 너머로 잇지 않는다. */
export function findInDoc(doc: ProseNode, query: string, caseSensitive: boolean): Found {
  if (!query) return NONE;
  const find = pattern(query, caseSensitive);
  const matches: FindRange[] = [];
  let capped = false;
  doc.descendants((node, pos) => {
    if (capped) return false;
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => { text += child.isText ? child.text! : "￼".repeat(child.nodeSize); });
    capped = collect(text, find, pos + 1, matches);
    return false;
  });
  return { matches, capped };
}

/** pos 이후의 첫 결과(없으면 맨 앞으로 돌아간다). */
const firstFrom = (matches: FindRange[], pos: number) => { const index = matches.findIndex((match) => match.from >= pos); return index === -1 ? 0 : index; };

// ── 서식 보기: ProseMirror 플러그인 ───────────────────────────

type FindState = Found & { query: string; caseSensitive: boolean; current: number; decorations: DecorationSet };
type FindMeta = { query: string; caseSensitive: boolean; anchor: number; found?: Found } | { current: number };
const EMPTY: FindState = { query: "", caseSensitive: false, matches: [], capped: false, current: -1, decorations: DecorationSet.empty };
const findKey = new PluginKey<FindState>("noteFind");
const REVEAL = "note-find-reveal";

/** 결과를 가린 블록: 접힌 접기의 내용, 그림으로 보이는 블록의 원문. 그 블록에만 꾸밈 클래스를 달아 잠시 펼친다(문서의 열림 상태는 그대로). */
function hidersOf(doc: ProseNode, pos: number) {
  const $pos = doc.resolve(pos);
  const out: Array<{ pos: number; node: ProseNode; details: boolean }> = [];
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "details" && !node.attrs.open && depth < $pos.depth && $pos.node(depth + 1).type.name === "detailsContent") out.push({ pos: $pos.before(depth), node, details: true });
    else if (showsPreview(node)) out.push({ pos: $pos.before(depth), node, details: false });
  }
  return out;
}

function decorate(doc: ProseNode, matches: FindRange[], current: number) {
  if (!matches.length) return DecorationSet.empty;
  const decorations = matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === current ? "note-find-match note-find-current" : "note-find-match" }));
  const at = matches[current];
  if (at) for (const hider of hidersOf(doc, at.from)) decorations.push(Decoration.node(hider.pos, hider.pos + hider.node.nodeSize, { class: REVEAL }));
  return DecorationSet.create(doc, decorations);
}

const wrap = (index: number, total: number) => ((index % total) + total) % total;

declare module "@tiptap/core" {
  interface Storage {
    /** 본문의 Esc. 찾기가 열려 있으면 닫고 true. ProseMirror는 Esc의 기본 동작을 늘 막으므로 창 쪽에서 받지 않고 편집기 단축키로 받는다. */
    noteFind: { escape: (() => boolean) | null };
  }
}

export const NoteFind = Extension.create({
  name: "noteFind",
  // 다른 확장의 Esc(그림 블록의 원문 닫기 등)가 먼저 받는다.
  priority: 50,
  addStorage() { return { escape: null as (() => boolean) | null }; },
  addKeyboardShortcuts() { return { Escape: () => this.storage.escape?.() ?? false }; },
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev) {
          const meta = tr.getMeta(findKey) as FindMeta | undefined;
          if (!meta && (!tr.docChanged || !prev.query)) return prev;
          if (meta && "query" in meta) {
            if (!meta.query) return EMPTY;
            const found = meta.found ?? findInDoc(tr.doc, meta.query, meta.caseSensitive);
            const current = found.matches.length ? firstFrom(found.matches, meta.anchor) : -1;
            return { query: meta.query, caseSensitive: meta.caseSensitive, ...found, current, decorations: decorate(tr.doc, found.matches, current) };
          }
          let { matches, capped, current } = prev;
          // 찾는 동안 본문을 고치면 결과를 다시 찾고, 지금 결과는 고친 뒤의 같은 자리(없으면 그다음)에 둔다.
          if (tr.docChanged) {
            const was = prev.matches[prev.current];
            ({ matches, capped } = findInDoc(tr.doc, prev.query, prev.caseSensitive));
            current = matches.length ? firstFrom(matches, was ? tr.mapping.map(was.from) : 0) : -1;
          }
          if (meta) current = matches.length ? wrap(meta.current, matches.length) : -1;
          return { ...prev, matches, capped, current, decorations: decorate(tr.doc, matches, current) };
        },
      },
      props: { decorations: (state) => findKey.getState(state)?.decorations },
    })];
  },
});

/** 찾기를 마치고 결과로 갈 때 그 결과를 접어 둔 접기를 실제로 펼친다(그 안에 커서를 두므로). 되돌리기 기록에는 넣지 않는다. */
function openDetails(tr: Transaction, pos: number) {
  const closed = hidersOf(tr.doc, pos).filter((hider) => hider.details);
  for (const hider of closed) tr.setNodeMarkup(hider.pos, undefined, { ...hider.node.attrs, open: true });
  if (closed.length) tr.setMeta("addToHistory", false);
}

// ── 화면 ───────────────────────────────────────────────────

/** target이 굴리는 칸(scroller) 안에서 찾기 막대 아래에 보이도록 굴린다. 가로로 굴리는 코드 블록·넓은 표 안이면 그 칸도 맞춘다.
 *  scrollIntoView는 overflow가 숨겨진 바깥 영역까지 밀어 창이 통째로 움직이므로 쓰지 않는다. */
function reveal(scroller: HTMLElement, target: HTMLElement, cover: number) {
  const first = () => target.getClientRects()[0] ?? target.getBoundingClientRect();
  for (let element = target.parentElement; element && element !== scroller; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth + 1 || !/(auto|scroll)/.test(getComputedStyle(element).overflowX)) continue;
    const box = element.getBoundingClientRect(), rect = first();
    if (rect.left < box.left + 8 || rect.right > box.right - 8) element.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
  }
  const box = scroller.getBoundingClientRect(), rect = first();
  const top = box.top + cover, bottom = box.bottom - 16;
  if (rect.top >= top && rect.bottom <= bottom) return;
  scroller.scrollTop += rect.top - (top + Math.max(0, (bottom - top - rect.height) / 2));
}

/** 옮겨 간 결과를 잠깐 고리로 짚어 눈이 따라가게 한다(Web Animations: 편집기 DOM의 속성은 건드리지 않는다). */
function flash(targets: HTMLElement[]) {
  if (reduced()) return;
  for (const target of targets) {
    const ring = getComputedStyle(target).getPropertyValue("--find-ring").trim() || "rgba(255, 159, 10, .5)";
    target.animate([{ boxShadow: `0 0 0 6px ${ring}` }, { boxShadow: "0 0 0 0 transparent" }], { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
  }
}

/** 화면에 붙은 편집기의 view. 붙기 전(보기를 막 바꾼 사이)이나 닫힌 뒤에는 null. */
function viewOf(editor: Editor) {
  try { return editor.isDestroyed ? null : editor.view.dom ? editor.view : null; } catch { return null; }
}

/** 키의 글자. 한글 입력 상태에서 Ctrl과 함께 누르면 key가 자모일 수 있어 자리(code)로 읽는다. */
const letterOf = (event: KeyboardEvent) => (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : "");

export type NoteFindController = ReturnType<typeof useNoteFind>;

/** 찾기 상태와 동작. 서식 보기는 편집기 플러그인이, Markdown 보기는 이 훅이 결과를 들고 있다. */
export function useNoteFind({ mode, editor, sourceRef, scrollRef, body }: {
  mode: "rich" | "source"; editor: Editor | null; sourceRef: RefObject<HTMLTextAreaElement | null>; scrollRef: RefObject<HTMLDivElement | null>; body: string;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [text, setText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  // Markdown 보기에서 실제로 찾은 말(한글을 조합하는 중에 결과가 없으면 앞의 결과를 그대로 둔다)과 지금 결과의 시작 자리.
  const [applied, setApplied] = useState("");
  const [sourceAt, setSourceAt] = useState(0);
  const [request, setRequest] = useState<{ flash: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  /** 열기 전의 초점(닫을 때 결과가 없으면 돌아간다)과 결과를 고르기 시작할 자리(커서 또는 보고 있던 곳). */
  const before = useRef<Element | null>(null);
  const anchor = useRef(0);
  const generation = useRef(0);
  const rich = mode === "rich" ? editor : null;

  const richState = useEditorState({
    editor: rich,
    selector: ({ editor: current }) => {
      const state = current && !current.isDestroyed ? findKey.getState(current.state) : undefined;
      return state ? { total: state.matches.length, current: state.current, capped: state.capped } : null;
    },
  });
  const sourceFound = useMemo(() => (mode === "source" && open ? findInText(body, applied, caseSensitive) : NONE), [mode, open, body, applied, caseSensitive]);
  const sourceCurrent = sourceFound.matches.length ? firstFrom(sourceFound.matches, sourceAt) : -1;
  const total = rich ? richState?.total ?? 0 : sourceFound.matches.length;
  const current = rich ? richState?.current ?? -1 : sourceCurrent;
  const capped = rich ? Boolean(richState?.capped) : sourceFound.capped;

  /** 지금 보기에서 찾는다. 한글을 조합하는 중이고 결과가 없으면 칠한 결과를 그대로 둔다(글자마다 깜박이지 않게). */
  function search(query: string, matchCase: boolean, composing = false) {
    if (rich) {
      const found = findInDoc(rich.state.doc, query, matchCase);
      if (composing && query && !found.matches.length) return;
      rich.view.dispatch(rich.state.tr.setMeta(findKey, { query, caseSensitive: matchCase, anchor: anchor.current, found } satisfies FindMeta));
    } else {
      if (composing && query && !findInText(body, query, matchCase).matches.length) return;
      setApplied(query);
      setSourceAt(anchor.current);
    }
    setRequest({ flash: false });
  }

  /** 서식 보기는 커서, 없으면 보고 있던 곳의 맨 위. Markdown 보기도 같다. */
  function anchorNow() {
    const scroller = scrollRef.current;
    const top = (scroller?.getBoundingClientRect().top ?? 0) + 4;
    if (rich) {
      const view = viewOf(rich);
      if (!view) return 0;
      if (view.hasFocus()) return rich.state.selection.from;
      const box = view.dom.getBoundingClientRect();
      return view.posAtCoords({ left: box.left + 2, top: Math.max(box.top + 2, top) })?.pos ?? 0;
    }
    const source = sourceRef.current;
    if (!source) return 0;
    if (document.activeElement === source) return source.selectionStart;
    const box = source.getBoundingClientRect();
    const caret = document.caretPositionFromPoint?.(box.left + 2, Math.max(box.top + 2, top));
    return caret?.offsetNode === source ? caret.offset : 0;
  }
  /** 본문에서 한 줄 안쪽으로 고른 글이 있으면 찾을 말로 쓴다. */
  function selectedText() {
    let value = "";
    if (rich && viewOf(rich)?.hasFocus()) { const { from, to } = rich.state.selection; value = rich.state.doc.textBetween(from, to, "\n", "\n"); }
    else if (!rich && sourceRef.current && document.activeElement === sourceRef.current) { const source = sourceRef.current; value = source.value.slice(source.selectionStart, source.selectionEnd); }
    return value.trim() && !value.includes("\n") && value.length <= 200 ? value : "";
  }

  /** 찾기를 열고(열려 있으면 그대로) 찾을 말 칸에 초점을 둔다. 본문에서 고른 글이 있으면 그 말로 찾고, 없으면 지난번 말을 다시 찾는다. */
  function show() {
    const seed = selectedText();
    const showing = open && !leaving;
    generation.current++;
    if (!showing) {
      const active = document.activeElement;
      if (!barRef.current?.contains(active)) before.current = active;
      setOpen(true);
      // 닫히는 중이었으면 사라지던 막대를 그 자리에서 되살린다.
      if (leaving) { setLeaving(false); enterMenu(barRef.current); }
    }
    if (!showing || seed) anchor.current = anchorNow();
    if (seed) setText(seed);
    const query = seed || text;
    if (query && (!showing || seed)) search(query, caseSensitive);
    // 곧바로 친 글자가 본문에 들어가지 않게 초점은 늦추지 않는다: 막대가 있으면 지금, 없으면 그려진 직후(아래 layout effect)에 옮긴다.
    // 찾을 말을 바꿨으면 바뀐 말이 칸에 들어간 뒤에 전체를 고른다.
    const input = inputRef.current;
    if (showing && !seed && input) { input.focus(); input.select(); return; }
    if (showing) input?.focus();
    focusInput.current = true;
  }
  const focusInput = useRef(false);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!focusInput.current || !input) return;
    focusInput.current = false;
    input.focus();
    input.select();
  });

  /** 찾기를 닫는다. toMatch면 지금 결과를 본문에서 골라 그 자리에서 이어 쓰게 하고, 결과가 없으면 열기 전의 초점으로 돌아간다. */
  function close(toMatch: boolean) {
    if (!open || leaving) return;
    const restore = before.current;
    before.current = null;
    let landed = false;
    if (rich) {
      const state = findKey.getState(rich.state);
      const view = viewOf(rich);
      const at = toMatch && view ? state?.matches[state.current] : undefined;
      const tr = rich.state.tr.setMeta(findKey, { query: "", caseSensitive, anchor: 0 } satisfies FindMeta);
      if (at) { openDetails(tr, at.from); tr.setSelection(TextSelection.create(tr.doc, at.from, at.to)); }
      rich.view.dispatch(tr);
      if (at && view) { view.focus(); landed = true; }
    } else {
      const at = toMatch ? sourceFound.matches[sourceCurrent] : undefined;
      const source = sourceRef.current;
      setApplied("");
      if (at && source) { source.focus({ preventScroll: true }); source.setSelectionRange(at.from, at.to); landed = true; }
    }
    if (!landed && barRef.current?.contains(document.activeElement)) {
      const view = rich ? viewOf(rich) : null;
      if (restore && view?.dom.contains(restore)) view.focus();
      else if (restore instanceof HTMLElement && restore !== document.body && restore.isConnected) restore.focus({ preventScroll: true });
    }
    const ticket = ++generation.current;
    setLeaving(true);
    void exitMenu(barRef.current).then(() => { if (generation.current === ticket) { setOpen(false); setLeaving(false); } });
  }

  function type(value: string, composing: boolean) {
    setText(value);
    search(value, caseSensitive, composing);
  }
  function toggleCase() {
    const next = !caseSensitive;
    setCaseSensitive(next);
    search(text, next);
  }
  function step(direction: 1 | -1) {
    if (!total) return;
    const next = wrap(current + direction, total);
    if (rich) {
      rich.view.dispatch(rich.state.tr.setMeta(findKey, { current: next } satisfies FindMeta));
      anchor.current = findKey.getState(rich.state)?.matches[next]?.from ?? anchor.current;
    } else {
      const at = sourceFound.matches[next]!.from;
      setSourceAt(at);
      anchor.current = at;
    }
    setRequest({ flash: true });
  }

  // 찾은 뒤(말을 바꾸거나 다음·이전으로 옮긴 뒤) 지금 결과가 보이도록 굴린다. 찾는 동안 본문을 고칠 때는 굴리지 않는다.
  useLayoutEffect(() => {
    if (!request || !open) return;
    const scroller = scrollRef.current;
    const root = rich ? viewOf(rich)?.dom : mirrorRef.current;
    const targets = Array.from(root?.querySelectorAll<HTMLElement>(rich ? ".note-find-current" : "mark[data-current]") ?? []);
    if (!scroller || !targets[0]) return;
    const bar = barRef.current?.getBoundingClientRect();
    reveal(scroller, targets[0], bar ? bar.bottom - scroller.getBoundingClientRect().top + 12 : 16);
    if (request.flash) flash(targets);
  }, [request]);

  // 막대가 나타날 때 위에서 살짝 내려온다.
  useLayoutEffect(() => { if (open && !leaving) enterMenu(barRef.current); }, [open]);

  // 찾는 중에 보기(서식 ↔ Markdown)를 바꾸면 새 보기에서 처음부터 다시 찾는다. 서식 보기의 편집기는 보기를 바꾼 다음 렌더에서
  // 새로 만들어지므로 편집기가 바뀔 때도 다시 넣는다.
  const shown = useRef({ mode, rich });
  useEffect(() => {
    const was = shown.current;
    shown.current = { mode, rich };
    if ((was.mode === mode && was.rich === rich) || !open || leaving) return;
    anchor.current = 0;
    if (rich && !rich.isDestroyed) rich.view.dispatch(rich.state.tr.setMeta(findKey, { query: text, caseSensitive, anchor: 0 } satisfies FindMeta));
    else if (!rich) { setApplied(text); setSourceAt(0); }
  }, [mode, rich]);

  // Ctrl/⌘+F는 메모 창 어디서든(본문·제목·목록) 찾기를 연다. 찾는 동안 F3·Ctrl/⌘+G(Shift: 이전)로 옮기고,
  // 본문·도구 막대에서 Esc를 누르면 커서는 그대로 둔 채 닫는다(막대 안의 Esc는 막대가 받는다).
  const latest = useRef({ show, close, step, open: open && !leaving });
  latest.current = { show, close, step, open: open && !leaving };
  useEffect(() => {
    const inNotes = (event: KeyboardEvent) => {
      const scroller = scrollRef.current;
      if (!scroller?.isConnected || !scroller.getClientRects().length) return false;
      const target = event.target as Element;
      const frame = scroller.closest("[data-window]");
      if (target.closest?.("[role=dialog], [role=alertdialog], [role=menu]")) return false;
      if (frame?.contains(target)) return true;
      return (target === document.body || target === document.documentElement) && useDesktop.getState().focused === "notes";
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !inNotes(event)) return;
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const letter = letterOf(event);
      if (mod && !event.shiftKey && letter === "f") { event.preventDefault(); event.stopPropagation(); latest.current.show(); return; }
      if (latest.current.open && (event.key === "F3" || (mod && letter === "g"))) { event.preventDefault(); event.stopPropagation(); latest.current.step(event.shiftKey ? -1 : 1); }
    };
    // 서식 본문의 Esc는 편집기 단축키(NoteFind)가 받는다. 여기서는 제목·Markdown 원문 칸·도구 막대의 Esc만 본다.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !latest.current.open) return;
      const target = event.target as Element;
      if (barRef.current?.contains(target) || target.closest?.(".ProseMirror") || !scrollRef.current?.closest(".note-editor")?.contains(target)) return;
      event.preventDefault();
      latest.current.close(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscape);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keydown", onEscape); };
  }, []);
  useEffect(() => {
    if (!editor) return;
    editor.storage.noteFind.escape = () => { if (!latest.current.open) return false; latest.current.close(false); return true; };
    return () => { if (!editor.isDestroyed) editor.storage.noteFind.escape = null; };
  }, [editor]);

  return {
    open, leaving, text, caseSensitive, total, current, capped, inputRef, barRef, mirrorRef,
    sourceMatches: sourceFound.matches, sourceCurrent,
    show, close, type, step, toggleCase,
    toggle: () => (open && !leaving ? close(false) : show()),
  };
}

function FindButton({ icon: Icon, label, keys, onClick, disabled, pressed, className }: {
  icon: LucideIcon; label: string; keys?: string; onClick: () => void; disabled?: boolean; pressed?: boolean; className?: string;
}) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className={`note-find-button${className ? ` ${className}` : ""}`} aria-label={label} aria-pressed={pressed} disabled={disabled}
        aria-keyshortcuts={keys?.replace("⌘", "Meta+")} onMouseDown={(event) => event.preventDefault()} onClick={onClick}><Icon aria-hidden="true" /></button>
    </TooltipTrigger>
    <TooltipContent>{label}{keys && <kbd className="format-keys">{keys}</kbd>}</TooltipContent>
  </Tooltip>;
}

/** 본문 위 오른쪽에 뜨는 찾기 막대: 찾을 말 · 몇 번째 / 모두 · 대소문자 구분 | 이전 · 다음 · 닫기. */
export function NoteFindBar({ find }: { find: NoteFindController }) {
  const none = Boolean(find.text) && find.total === 0;
  const count = find.total ? `${find.current + 1}/${find.total}${find.capped ? "+" : ""}` : none ? "결과 없음" : "";
  const spoken = find.total ? `${find.total}${find.capped ? "개 넘게" : "개"} 중 ${find.current + 1}번째` : none ? "결과 없음" : "";
  return <div ref={find.barRef} className="note-find material-menu" role="search" aria-label="본문에서 찾기" data-none={none ? "" : undefined} inert={find.leaving}
    onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); find.inputRef.current?.focus(); } }}>
    <Search className="note-find-icon" aria-hidden="true" />
    <input ref={find.inputRef} type="text" value={find.text} placeholder="본문에서 찾기" aria-label="찾을 말" autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={200}
      onChange={(event) => find.type(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
      onCompositionEnd={(event) => find.type(event.currentTarget.value, false)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); find.step(event.shiftKey ? -1 : 1); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); find.close(true); }
      }} />
    <span className="note-find-count" role="status">{count && <><span aria-hidden="true">{count}</span><span className="sr-only">{spoken}</span></>}</span>
    <FindButton icon={CaseSensitive} label="대소문자 구분" pressed={find.caseSensitive} className="note-find-case" onClick={find.toggleCase} />
    <span className="note-find-sep" aria-hidden="true" />
    <FindButton icon={ChevronUp} label="이전 결과" keys="Shift+Enter" disabled={!find.total} onClick={() => find.step(-1)} />
    <FindButton icon={ChevronDown} label="다음 결과" keys="Enter" disabled={!find.total} onClick={() => find.step(1)} />
    <FindButton icon={X} label="찾기 닫기" keys="Esc" onClick={() => find.close(true)} />
  </div>;
}

/** Markdown 원문 칸 뒤에 같은 글을 같은 글꼴·줄바꿈으로 깔고 찾은 곳만 칠한다(글자는 투명, 원문 칸이 그 위에 보인다). */
export function SourceHighlights({ find, text }: { find: NoteFindController; text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  find.sourceMatches.forEach((match, index) => {
    if (match.from > at) parts.push(text.slice(at, match.from));
    parts.push(<mark key={match.from} data-current={index === find.sourceCurrent ? "" : undefined}>{text.slice(match.from, match.to)}</mark>);
    at = match.to;
  });
  // 끝 줄바꿈 뒤의 빈 줄도 원문 칸처럼 한 줄을 차지하게 한다.
  parts.push(`${text.slice(at)}​`);
  return <div ref={find.mirrorRef} className="note-source-mirror" aria-hidden="true">{parts}</div>;
}

export { MOD as FIND_MOD };
