import { Copy, Minus, Square, X } from "lucide-react";
import { APPS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";

export function WindowControls({ id }: { id: AppId }) {
  const title = APPS[id].title;
  const mobile = useDesktop((state) => state.mobile);
  const maximized = useDesktop((state) => state.windows[id].maximized) || mobile;
  const close = useDesktop((state) => state.close);
  const minimize = useDesktop((state) => state.minimize);
  const toggleMaximize = useDesktop((state) => state.toggleMaximize);
  const zoomLabel = `${title} 창 ${maximized ? "복원" : "최대화"}`;
  return <div className="window-controls" role="group" aria-label={`${title} 창 조작`}>
    <button type="button" className="window-control" data-window-action="minimize" aria-label={`${title} 창 최소화`} title="최소화" disabled={mobile} onClick={() => minimize(id)}><Minus aria-hidden="true" /></button>
    <button type="button" className="window-control" data-window-action="maximize" aria-label={zoomLabel} aria-pressed={maximized} title={maximized ? "복원" : "최대화"} disabled={mobile} onClick={() => toggleMaximize(id)}>{maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}</button>
    <button type="button" className="window-control" data-window-action="close" aria-label={`${title} 창 닫기`} title="닫기" onClick={() => close(id)}><X aria-hidden="true" /></button>
  </div>;
}
