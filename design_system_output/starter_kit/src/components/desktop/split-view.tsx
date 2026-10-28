import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

const STORE_KEY = "app-split-v1";
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

/** 왼쪽 패널(목록·트리)과 오른쪽 내용 사이 경계를 끌어 왼쪽 폭을 바꾼다(shadcn Resizable).
 *  - 왼쪽 폭은 px로 정하고 창 크기를 바꿔도 그대로 둔다(preserve-pixel-size). 오른쪽만 늘고 준다.
 *  - 사용자가 끈 폭만 창마다 기억하고, 경계를 두 번 누르면 기본 폭으로 돌아간다.
 *  - collapse를 주면 좁은 창(899px 이하)에서 한쪽만 보인다(창의 data-detail로 고른다, patterns.css). */
export function SplitView({ name, label, side, main, defaultWidth, minWidth, maxWidth, minMain = 280, collapse, className }: {
  name: string; label: string; side: ReactNode; main: ReactNode; defaultWidth: number; minWidth: number; maxWidth: number; minMain?: number; collapse?: boolean; className?: string;
}) {
  const panel = useRef<PanelImperativeHandle>(null);
  const initial = useMemo(() => {
    const saved = loadWidths()[name];
    return typeof saved === "number" && Number.isFinite(saved) ? Math.min(maxWidth, Math.max(minWidth, saved)) : defaultWidth;
  }, [name, defaultWidth, minWidth, maxWidth]);
  return <ResizablePanelGroup orientation="horizontal" className={cn("split-view", className)} data-collapse={collapse ? "" : undefined}
    onLayoutChanged={(_, meta) => {
      if (!meta.isUserInteraction) return;
      const width = panel.current?.getSize().inPixels;
      if (width) saveWidth(name, Math.round(width));
    }}>
    <ResizablePanel id={`${name}-side`} panelRef={panel} defaultSize={initial} minSize={minWidth} maxSize={maxWidth}
      groupResizeBehavior="preserve-pixel-size" className="split-pane" style={PANE}>{side}</ResizablePanel>
    <ResizableHandle className="split-handle" aria-label={`${label} 너비 조절`} title="끌어서 너비 조절 · 두 번 눌러 기본 너비"
      disableDoubleClick onDoubleClick={() => { panel.current?.resize(defaultWidth); saveWidth(name, defaultWidth); }} />
    <ResizablePanel id={`${name}-main`} minSize={minMain} className="split-pane" style={PANE}>{main}</ResizablePanel>
  </ResizablePanelGroup>;
}
