import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AArrowDown, AArrowUp, ChevronLeft, ChevronRight, Copy, FileWarning, FolderOpen, Images, LoaderCircle, Maximize, RotateCw, SquareArrowOutUpRight, WrapText, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "../ui/button";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { extensions } from "./note-editor";
import { useDesktop } from "../../lib/desktop-store";
import { codeLanguage, contentUrl, extensionOf, formatDate, formatSize, openOnSystem, readTextFile } from "../../lib/files";
import { renderCode } from "../../lib/highlight";
import { useViewer, type ViewerDoc } from "../../lib/viewer";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 32;
const ZOOM_STEP = 1.25;
/** 서식 보기로 그리는 Markdown 상한. 더 크면 원문으로만 보인다. */
const RICH_MAX_CHARS = 1_000_000;
const FONT_STEPS = [11, 12, 13, 14, 16, 18, 20, 24];
type Notice = { text: string; tone: "info" | "error"; id: number };

/** 파일 탐색기에서 두 번 누른 그림·글을 여는 창. 그림은 확대·회전·이전/다음, 글은 서식(Markdown)·원문·줄 바꿈·글자 크기. */
export function ViewerWindow() {
  const doc = useViewer((state) => state.doc);
  const siblings = useViewer((state) => state.siblings);
  const isOpen = useDesktop((state) => state.windows.viewer.open);
  const focused = useDesktop((state) => state.focused === "viewer");
  const [notice, setNotice] = useState<Notice | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const at = doc ? siblings.findIndex((item) => item.path === doc.path) : -1;
  const say = (text: string, tone: Notice["tone"] = "info") => setNotice({ text, tone, id: Date.now() });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((now) => (now?.id === notice.id ? null : now)), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  // 앞에 있는 창이면 본문에 초점을 둬 화살표·확대 키가 바로 먹는다.
  useEffect(() => {
    if (!focused || !isOpen) return;
    const frame = requestAnimationFrame(() => { if (!document.activeElement?.closest(".window[data-window=viewer] input, .window[data-window=viewer] button")) bodyRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [focused, isOpen, doc?.path]);

  async function system(target: string, action: "open" | "reveal") {
    try {
      const done = await openOnSystem(target, action);
      say(done === "reveal" ? "탐색기에서 보여 줍니다." : "기본 앱으로 엽니다.");
    } catch (error) { say(error instanceof Error ? error.message : "열지 못했습니다.", "error"); }
  }
  const nav = doc && siblings.length > 1 ? <div className="viewer-nav" role="group" aria-label="이전·다음">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="이전 파일" title="이전 파일 (←)" disabled={at <= 0} onClick={() => useViewer.getState().step(-1)}><ChevronLeft aria-hidden="true" /></Button>
    <span className="viewer-count" aria-live="polite">{at + 1} / {siblings.length}</span>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="다음 파일" title="다음 파일 (→)" disabled={at < 0 || at >= siblings.length - 1} onClick={() => useViewer.getState().step(1)}><ChevronRight aria-hidden="true" /></Button>
  </div> : null;
  const systemTools = doc ? <>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="기본 앱으로 열기" title="기본 앱으로 열기" onClick={() => void system(doc.path, "open")}><SquareArrowOutUpRight aria-hidden="true" /></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="탐색기에서 보기" title="탐색기에서 보기" onClick={() => void system(doc.path, "reveal")}><FolderOpen aria-hidden="true" /></Button>
  </> : null;

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    if (event.key === "Escape") { event.preventDefault(); useDesktop.getState().close("viewer"); return; }
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); useViewer.getState().step(-1); return; }
    if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); useViewer.getState().step(1); }
  }

  return <Window id="viewer" bodyClassName="viewer-body" header={
    <WindowTitleBar id="viewer" title={doc ? doc.name : undefined} right={<div className="viewer-tools" role="group" aria-label="보기 도구" id="viewer-tools" />}>
      {nav}
    </WindowTitleBar>}>
    <div ref={bodyRef} className="viewer-stage" tabIndex={0} aria-label={doc ? `${doc.name} 내용` : "뷰어"} onKeyDown={onKey} data-kind={doc?.kind ?? "empty"}>
      {!doc
        ? <div className="viewer-empty"><Images aria-hidden="true" /><strong>열린 파일이 없습니다</strong><span>파일 탐색기에서 그림·글·소스 코드 파일을 두 번 누르면 여기에 열립니다.</span></div>
        : doc.kind === "image"
          ? <ImageView key={doc.path} doc={doc} tools={systemTools} say={say} />
          : <TextView key={doc.path} doc={doc} tools={systemTools} say={say} />}
    </div>
    {notice && <div className="files-toast material-toast" role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone}><span>{notice.text}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="알림 닫기" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button></div>}
  </Window>;
}

/** 제목 표시줄 오른쪽 도구 자리에 보기별 도구를 그린다. */
function Tools({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(document.getElementById("viewer-tools")); }, []);
  return host ? createPortal(children, host) : null;
}

type ImageState = { fit: boolean; scale: number; turn: number };

function ImageView({ doc, tools, say }: { doc: ViewerDoc; tools: ReactNode; say: (text: string, tone?: "info" | "error") => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const [view, setView] = useState<ImageState>({ fit: true, scale: 1, turn: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ x: number; y: number; ratio: number; from: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rotated = view.turn % 2 === 1;
  const shown = natural ? (rotated ? { w: natural.h, h: natural.w } : natural) : null;
  // 맞춤 배율: 창에 들어가도록 줄이되, 작은 그림은 키우지 않는다.
  const fitScale = shown && box.w && box.h ? Math.min(1, (box.w - 32) / shown.w, (box.h - 32) / shown.h) : 1;
  const scale = view.fit ? fitScale : view.scale;
  const origin = (content: number, viewport: number) => Math.max(0, (viewport - content) / 2);
  // 배율을 바꾼 뒤 가리키던 점이 같은 자리에 있도록 스크롤을 맞춘다.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const change = pending.current;
    if (!element || !change || !shown) return;
    pending.current = null;
    const width = shown.w * scale, height = shown.h * scale;
    const oldWidth = width / change.ratio, oldHeight = height / change.ratio;
    const contentX = change.x + element.scrollLeft - origin(oldWidth, box.w);
    const contentY = change.y + element.scrollTop - origin(oldHeight, box.h);
    element.scrollLeft = contentX * change.ratio + origin(width, box.w) - change.x;
    element.scrollTop = contentY * change.ratio + origin(height, box.h) - change.y;
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = (next: number, x?: number, y?: number) => {
    const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const element = scrollRef.current;
    if (element && x !== undefined && y !== undefined) pending.current = { x, y, ratio: target / scale, from: scale };
    else if (element) pending.current = { x: box.w / 2, y: box.h / 2, ratio: target / scale, from: scale };
    setView((now) => ({ ...now, fit: false, scale: target }));
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!natural) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
    zoomTo(scale * factor, event.clientX - rect.left, event.clientY - rect.top);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element || !drag.current) return;
    element.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    element.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try { scrollRef.current?.releasePointerCapture(event.pointerId); } catch { /* 이미 풀렸을 수 있다. */ }
  };
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "+": case "=": event.preventDefault(); zoomTo(scale * ZOOM_STEP); return;
      case "-": event.preventDefault(); zoomTo(scale / ZOOM_STEP); return;
      case "0": event.preventDefault(); setView((now) => ({ ...now, fit: true })); return;
      case "1": event.preventDefault(); zoomTo(1); return;
      case "r": case "R": event.preventDefault(); setView((now) => ({ ...now, turn: (now.turn + (event.shiftKey ? 3 : 1)) % 4 })); return;
    }
  }
  const width = shown ? shown.w * scale : 0, height = shown ? shown.h * scale : 0;
  const overflow = Boolean(shown) && (width > box.w || height > box.h);
  return <>
    <Tools>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="축소" title="축소 (-)" disabled={!natural || scale <= ZOOM_MIN} onClick={() => zoomTo(scale / ZOOM_STEP)}><ZoomOut aria-hidden="true" /></Button>
      <button type="button" className="viewer-zoom" aria-label="배율. 누르면 창에 맞춤" title="창에 맞춤 (0)" disabled={!natural} onClick={() => setView((now) => ({ ...now, fit: true }))}>{Math.round(scale * 100)}%</button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="확대" title="확대 (+)" disabled={!natural || scale >= ZOOM_MAX} onClick={() => zoomTo(scale * ZOOM_STEP)}><ZoomIn aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="실제 크기" title="실제 크기 (1)" aria-pressed={!view.fit && scale === 1} disabled={!natural} onClick={() => zoomTo(1)}><Maximize aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="오른쪽으로 회전" title="오른쪽으로 회전 (R)" disabled={!natural} onClick={() => setView((now) => ({ ...now, turn: (now.turn + 1) % 4 }))}><RotateCw aria-hidden="true" /></Button>
      <span className="viewer-tools-gap" aria-hidden="true" />
      {tools}
    </Tools>
    <div ref={scrollRef} className="viewer-canvas" data-drag={overflow ? "" : undefined} onWheel={onWheel} onKeyDown={onKey}
      onPointerDown={overflow ? onPointerDown : undefined} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={(event) => { if (!natural) return; const rect = event.currentTarget.getBoundingClientRect(); if (view.fit || scale !== 1) zoomTo(1, event.clientX - rect.left, event.clientY - rect.top); else setView((now) => ({ ...now, fit: true })); }}>
      {broken
        ? <div className="viewer-empty" role="alert"><FileWarning aria-hidden="true" /><strong>그림을 읽을 수 없습니다</strong><span>파일이 손상됐거나 브라우저가 지원하지 않는 형식입니다.</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void openOnSystem(doc.path, "open").then(() => say("기본 앱으로 엽니다.")).catch(() => say("열지 못했습니다.", "error"))}><SquareArrowOutUpRight aria-hidden="true" />기본 앱으로 열기</Button></div>
        : <div className="viewer-image-box" style={shown ? { width, height } : undefined} data-ready={natural ? "" : undefined}>
          <img src={contentUrl(doc.path)} alt={doc.name} draggable={false} decoding="async"
            style={natural ? { width: natural.w * scale, height: natural.h * scale, transform: `translate(-50%, -50%) rotate(${view.turn * 90}deg)` } : undefined}
            onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} onError={() => setBroken(true)} />
          {!natural && <span className="viewer-loading"><LoaderCircle aria-hidden="true" /></span>}
        </div>}
    </div>
    <footer className="viewer-status" aria-live="polite">
      <span>{natural ? `${natural.w.toLocaleString("ko-KR")} × ${natural.h.toLocaleString("ko-KR")}` : broken ? "읽을 수 없음" : "불러오는 중…"}{doc.size !== null ? ` · ${formatSize(doc.size)}` : ""}{doc.modified ? ` · ${formatDate(doc.modified)}` : ""}</span>
      <span className="viewer-status-side" title={doc.path}>{doc.path}</span>
    </footer>
  </>;
}

type TextState = { status: "loading" | "ready" | "binary" | "error"; text?: string; truncated?: boolean; message?: string };
type TextMode = "rich" | "source";

function TextView({ doc, tools, say }: { doc: ViewerDoc; tools: ReactNode; say: (text: string, tone?: "info" | "error") => void }) {
  const markdown = extensionOf(doc.name) === "md" || extensionOf(doc.name) === "markdown";
  const language = codeLanguage(doc.name);
  const [state, setState] = useState<TextState>({ status: "loading" });
  const [mode, setMode] = useState<TextMode>(markdown ? "rich" : "source");
  const [wrap, setWrap] = useState(true);
  const [fontAt, setFontAt] = useState(2);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    readTextFile(doc.path, controller.signal)
      .then(({ text, truncated }) => setState(text === null ? { status: "binary" } : { status: "ready", text, truncated }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "읽지 못했습니다." }); });
    return () => controller.abort();
  }, [doc.path, doc.modified]);
  const text = state.status === "ready" ? state.text ?? "" : "";
  const richAllowed = markdown && text.length <= RICH_MAX_CHARS;
  const effective: TextMode = richAllowed && mode === "rich" ? "rich" : "source";
  const stats = useMemo(() => (state.status === "ready" ? { lines: text.length ? text.split("\n").length : 0, chars: text.length } : null), [state.status, text]);
  async function copyAll() {
    try { await navigator.clipboard.writeText(text); say("내용을 복사했습니다."); }
    catch { say("클립보드에 복사하지 못했습니다.", "error"); }
  }
  return <>
    <Tools>
      {markdown && <div className="files-segment" role="radiogroup" aria-label="보기 방식">
        <button type="button" role="radio" aria-checked={effective === "rich"} disabled={!richAllowed} title={richAllowed ? "서식 보기" : "파일이 너무 커서 원문으로만 봅니다"} onClick={() => setMode("rich")}>서식</button>
        <button type="button" role="radio" aria-checked={effective === "source"} title="원문 보기" onClick={() => setMode("source")}>원문</button>
      </div>}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="줄 바꿈" title="줄 바꿈" aria-pressed={wrap} disabled={effective === "rich"} onClick={() => setWrap((now) => !now)}><WrapText aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="글자 작게" title="글자 작게" disabled={fontAt <= 0} onClick={() => setFontAt((now) => Math.max(0, now - 1))}><AArrowDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="글자 크게" title="글자 크게" disabled={fontAt >= FONT_STEPS.length - 1} onClick={() => setFontAt((now) => Math.min(FONT_STEPS.length - 1, now + 1))}><AArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="내용 복사" title="내용 복사" disabled={state.status !== "ready"} onClick={() => void copyAll()}><Copy aria-hidden="true" /></Button>
      <span className="viewer-tools-gap" aria-hidden="true" />
      {tools}
    </Tools>
    <div className="viewer-document" data-mode={effective} style={{ ["--viewer-font" as string]: `${FONT_STEPS[fontAt]}px` }}>
      {state.status === "loading" ? <div className="viewer-empty" role="status"><LoaderCircle aria-hidden="true" className="viewer-spin" /><span>불러오는 중…</span></div>
        : state.status === "binary" ? <div className="viewer-empty" role="alert"><FileWarning aria-hidden="true" /><strong>글자로 읽을 수 없는 파일입니다</strong><span>이진 파일이거나 알 수 없는 인코딩입니다.</span></div>
          : state.status === "error" ? <div className="viewer-empty" role="alert"><FileWarning aria-hidden="true" /><strong>파일을 열 수 없습니다</strong><span>{state.message}</span></div>
            : effective === "rich" ? <MarkdownView text={text} />
              : language ? <CodeView text={text} language={language.language} wrap={wrap} />
                : <pre className="viewer-source" data-wrap={wrap ? "" : undefined}>{text}</pre>}
      {state.status === "ready" && state.truncated && <p className="viewer-truncated" role="status">파일이 커서 앞 8MB까지만 보입니다.</p>}
    </div>
    <footer className="viewer-status" aria-live="polite">
      <span>{language ? `${language.label} · ` : ""}{stats ? `줄 ${stats.lines.toLocaleString("ko-KR")} · 글자 ${stats.chars.toLocaleString("ko-KR")}` : state.status === "loading" ? "불러오는 중…" : "읽을 수 없음"}{doc.size !== null ? ` · ${formatSize(doc.size)}` : ""}{doc.modified ? ` · ${formatDate(doc.modified)}` : ""}</span>
      <span className="viewer-status-side" title={doc.path}>{doc.path}</span>
    </footer>
  </>;
}

/** 소스 코드: 줄 번호와 구문 강조. 줄마다 `.viewer-line` 하나이고 번호 자리는 줄 수의 자릿수만큼이다. */
function CodeView({ text, language, wrap }: { text: string; language: string; wrap: boolean }) {
  const rendered = useMemo(() => renderCode(text, language), [text, language]);
  return <pre className="viewer-source viewer-code" data-language={language} data-wrap={wrap ? "" : undefined} data-plain={rendered.highlighted ? undefined : ""}
    style={{ ["--gutter" as string]: `${Math.max(2, String(rendered.lines).length)}ch` }} dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

/** Markdown을 메모 창과 같은 서식으로 그린다(읽기 전용 tiptap). */
function MarkdownView({ text }: { text: string }) {
  const editor = useEditor({
    extensions, content: text, contentType: "markdown", editable: false, injectCSS: false, immediatelyRender: true, shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: "note-prose viewer-prose", "aria-label": "본문" } },
  }, [text]);
  return <EditorContent editor={editor} className="viewer-rich" />;
}
