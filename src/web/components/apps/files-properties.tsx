import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { Copy, LoaderCircle, X } from "lucide-react";
import { Button } from "../ui/button";
import { fileType, formatDate, formatSize, statPath, type FileInfo } from "../../lib/files";

type State = { status: "loading" | "ready" | "error"; info?: FileInfo; message?: string };

/** 파일·폴더의 속성 창. 이름·종류·위치·크기·날짜·특성을 보이고 폴더는 안에 든 항목을 센다. */
export function PropertiesDialog({ path, onClose, onCopy }: { path: string | null; onClose: () => void; onCopy: (target: string) => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    statPath(path, controller.signal)
      .then((info) => setState({ status: "ready", info }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "속성을 읽지 못했습니다." }); });
    return () => controller.abort();
  }, [path]);
  const info = state.info;
  const type = info ? fileType({ name: info.name, kind: info.kind }) : null;
  const Icon = type?.icon;
  const location = info ? info.path.slice(0, Math.max(0, info.path.length - info.name.length)).replace(/[\\/]$/, "") || info.path : "";
  const attributes = info ? [info.readonly ? "읽기 전용" : null, info.hidden ? "숨김" : null, info.link ? "바로 가기" : null].filter(Boolean).join(", ") || "없음" : "";
  return <Dialog.Root open={path !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="confirm-overlay" />
      <Dialog.Content className="properties-dialog material-menu" aria-describedby={undefined}>
        <div className="properties-head">
          {Icon && type ? <Icon aria-hidden="true" className="files-icon properties-icon" data-tone={type.tone} /> : <span className="properties-icon" />}
          <Dialog.Title className="properties-title">{info ? info.name : path ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path : ""}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" size="icon-xs" aria-label="속성 닫기"><X aria-hidden="true" /></Button></Dialog.Close>
        </div>
        {state.status === "loading" && <p className="properties-note" role="status"><LoaderCircle aria-hidden="true" className="files-preview-spin" />읽는 중…</p>}
        {state.status === "error" && <p className="properties-note" role="alert">{state.message}</p>}
        {info && type && <dl className="properties-grid">
          <dt>종류</dt><dd>{type.label}</dd>
          <dt>위치</dt><dd title={location}>{location}</dd>
          {info.kind === "file" && <><dt>크기</dt><dd>{formatSize(info.size)}{info.size !== null && info.size >= 1024 ? ` (${info.size.toLocaleString("ko-KR")} 바이트)` : ""}</dd></>}
          {info.contents && <>
            <dt>크기</dt><dd>{formatSize(info.contents.bytes)}{info.contents.bytes >= 1024 ? ` (${info.contents.bytes.toLocaleString("ko-KR")} 바이트)` : ""}{info.contents.partial ? " 이상" : ""}</dd>
            <dt>내용</dt><dd>파일 {info.contents.files.toLocaleString("ko-KR")}개, 폴더 {info.contents.folders.toLocaleString("ko-KR")}개{info.contents.partial ? " 이상(너무 많아 일부만 셌습니다)" : ""}</dd>
          </>}
          {info.link && info.target && <><dt>대상</dt><dd title={info.target}>{info.target}</dd></>}
          <dt>만든 날짜</dt><dd>{formatDate(info.created) || "알 수 없음"}</dd>
          <dt>수정한 날짜</dt><dd>{formatDate(info.modified) || "알 수 없음"}</dd>
          <dt>액세스한 날짜</dt><dd>{formatDate(info.accessed) || "알 수 없음"}</dd>
          <dt>특성</dt><dd>{attributes}</dd>
        </dl>}
        <div className="properties-actions">
          <Button type="button" variant="ghost" size="sm" disabled={!path} onClick={() => { if (path) onCopy(path); }}><Copy aria-hidden="true" />경로 복사</Button>
          <Dialog.Close asChild><Button type="button" size="sm">닫기</Button></Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
