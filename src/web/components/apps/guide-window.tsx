import { useDesktop } from "../../lib/desktop-store";
import { Window } from "../desktop/window";
import { ContextGuide } from "../context-guide";

export function GuideWindow() {
  return <Window id="guide" bodyClassName="guide-body">
    <ContextGuide onFind={() => {
      useDesktop.getState().focus("sessions");
      requestAnimationFrame(() => document.getElementById("search")?.focus());
    }} />
  </Window>;
}
