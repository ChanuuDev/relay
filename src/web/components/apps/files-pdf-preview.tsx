import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { PDF_PREVIEW_BYTES, readBytes, type FileEntry } from "../../lib/files";

type State = { status: "loading" | "ready" | "error"; pages?: number; message?: string };
type PdfModule = typeof import("pdfjs-dist");
let pdfModule: Promise<PdfModule> | null = null;
/** pdf.js는 처음 PDF를 고를 때 한 번만 읽는다. 작업 스레드는 서버가 /pdf.worker.mjs로 내준다. */
function loadPdf(): Promise<PdfModule> {
  pdfModule ??= import("pdfjs-dist").then((module) => { module.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs"; return module; });
  return pdfModule;
}

/** 미리 보기 창의 PDF 첫 쪽. 창 폭에 맞춰 선명하게(devicePixelRatio) 그린다. */
export function PdfPreview({ entry, width }: { entry: FileEntry; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const tooLarge = (entry.size ?? 0) > PDF_PREVIEW_BYTES;
  useEffect(() => {
    if (tooLarge || width <= 0) return;
    const controller = new AbortController();
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const pdf = await loadPdf();
      const data = await readBytes(entry.path, controller.signal);
      const task = pdf.getDocument({ data });
      const document = await task.promise;
      try {
        if (cancelled) return;
        const page = await document.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`; canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setState({ status: "ready", pages: document.numPages });
      } finally { void task.destroy(); }
    })().catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      const name = (error as { name?: string })?.name;
      setState({ status: "error", message: name === "PasswordException" ? "암호가 걸린 PDF입니다." : name === "InvalidPDFException" ? "PDF 형식이 아니거나 손상된 파일입니다." : error instanceof Error ? error.message : "PDF를 읽지 못했습니다." });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [entry.path, entry.modified, width, tooLarge]);

  if (tooLarge) return <div className="files-preview-art" data-tone="doc"><FileText aria-hidden="true" className="files-icon" data-tone="doc" /></div>;
  return <div className="files-preview-pdf" data-status={state.status} aria-busy={state.status === "loading"}>
    <canvas ref={canvasRef} aria-label={`${entry.name} 첫 쪽`} />
    {state.status === "loading" && <span className="files-preview-note"><LoaderCircle aria-hidden="true" className="files-preview-spin" />PDF 여는 중…</span>}
    {state.status === "error" && <span className="files-preview-note" role="alert">{state.message}</span>}
    {state.status === "ready" && state.pages !== undefined && <span className="files-preview-pages">{state.pages.toLocaleString("ko-KR")}쪽</span>}
  </div>;
}
