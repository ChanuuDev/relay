import { Maximize2, Minus, X } from "lucide-react";
import { APPS, type AppId } from "../../lib/app-config";
import { useDesktop } from "../../lib/desktop-store";

export function TrafficLights({ id }: { id: AppId }) {
  const title = APPS[id].title;
  const mobile = useDesktop((state) => state.mobile);
  const maximized = useDesktop((state) => state.windows[id].maximized) || mobile;
  const close = useDesktop((state) => state.close);
  const minimize = useDesktop((state) => state.minimize);
  const toggleMaximize = useDesktop((state) => state.toggleMaximize);
  return <div className="traffic-lights">
    <button type="button" className="traffic-light" data-light="close" aria-label={`${title} 창 닫기`} onClick={() => close(id)}><X aria-hidden="true" /></button>
    <button type="button" className="traffic-light" data-light="minimize" aria-label={`${title} 창 최소화`} disabled={mobile} onClick={() => minimize(id)}><Minus aria-hidden="true" /></button>
    <button type="button" className="traffic-light" data-light="zoom" aria-label={`${title} 창 ${maximized ? "복원" : "최대화"}`} disabled={mobile} onClick={() => toggleMaximize(id)}><Maximize2 aria-hidden="true" /></button>
  </div>;
}
