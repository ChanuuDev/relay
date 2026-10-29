import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { cn } from "../../lib/utils";

const STORE_KEY = "relay-split-v1";
/** 패널 안쪽 div가 내용을 세로로 채우게 한다. 스크롤은 내용이 맡는다. */
const PANE: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" };

function loadWidths(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
  } catch { return {}; }
}
function saveWidth(name: string, width: number) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadWidths(), [name]: width })); }
  catch { /* 저장 공간이 없어도 끌기는 동작한다. */ }
}

/** 곁 패널(목록·트리·미리 보기)과 내용 사이 경계를 끌어 곁 패널 폭을 바꾼다(shadcn Resizable). 곁 패널은 기본으로 왼쪽이고 position="end"면 오른쪽이다.
 *  폭은 창마다 px로 기억하고, 창 크기를 바꿔도 곁 패널 폭은 그대로 둔다. 경계를 두 번 누르면 기본 폭으로 돌아간다.
 *  (라이브러리의 두 번 누르기는 defaultSize, 곧 기억한 폭으로 돌아가므로 끄고 직접 되돌린다.) */
export function SplitView({ name, label, side, main, defaultWidth, minWidth, maxWidth, minMain = 280, position = "start", className, ...rest }: {
  name: string; label: string; side: ReactNode; main: ReactNode; defaultWidth: number; minWidth: number; maxWidth: number; minMain?: number;
  position?: "start" | "end"; className?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  const panel = useRef<PanelImperativeHandle>(null);
  const initial = useMemo(() => {
    const saved = loadWidths()[name];
    return typeof saved === "number" && Number.isFinite(saved) ? Math.min(maxWidth, Math.max(minWidth, saved)) : defaultWidth;
  }, [name, defaultWidth, minWidth, maxWidth]);
  const sidePanel = <ResizablePanel key="side" id={`${name}-side`} panelRef={panel} defaultSize={initial} minSize={minWidth} maxSize={maxWidth}
    groupResizeBehavior="preserve-pixel-size" className="split-pane" style={PANE}>{side}</ResizablePanel>;
  const handle = <ResizableHandle key="handle" className="split-handle" aria-label={`${label} 너비 조절`} title="끌어서 너비 조절 · 두 번 눌러 기본 너비"
    disableDoubleClick onDoubleClick={() => { panel.current?.resize(defaultWidth); saveWidth(name, defaultWidth); }} />;
  const mainPanel = <ResizablePanel key="main" id={`${name}-main`} minSize={minMain} className="split-pane" style={PANE}>{main}</ResizablePanel>;
  return <ResizablePanelGroup orientation="horizontal" className={cn("split-view", className)} data-side={position} {...rest}
    onLayoutChanged={(_, meta) => {
      if (!meta.isUserInteraction) return;
      const width = panel.current?.getSize().inPixels;
      if (width) saveWidth(name, Math.round(width));
    }}>
    {position === "end" ? [mainPanel, handle, sidePanel] : [sidePanel, handle, mainPanel]}
  </ResizablePanelGroup>;
}
