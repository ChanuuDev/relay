import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export type MenuEntry =
  | { kind: "separator"; id: string }
  | { kind: "item" | "radio"; id: string; label: string; checked?: boolean; disabled?: boolean; onSelect: () => void };

const ITEMS = "[role=menuitem]:not(:disabled), [role=menuitemradio]:not(:disabled)";

/** 메뉴바 자체가 backdrop 루트라 메뉴는 body로 포털한다(유리가 창을 제대로 흐리게 만든다).
 *  전면 오버레이가 바깥 클릭을 삼켜서 뒤에 있는 창이 실수로 눌리지 않는다. */
export function DesktopMenu({ items, position, onClose, className }: {
  items: MenuEntry[]; position: { left: number; top: number }; onClose: (returnFocus: boolean) => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>(ITEMS)?.focus(); }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []);
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => { event.preventDefault(); buttons[(next + buttons.length) % buttons.length]?.focus(); };
    if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index <= 0 ? buttons.length - 1 : index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(buttons.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); }
    else if (event.key === "Tab") onClose(false);
  }

  return createPortal(<>
    <div className="menu-overlay" onPointerDown={(event) => { event.preventDefault(); onClose(true); }} />
    <div ref={ref} role="menu" className={cn("desktop-menu material-menu", className)} onKeyDown={onKeyDown}
      style={{ left: Math.max(4, Math.min(position.left, window.innerWidth - 220)), top: position.top }}>
      {items.map((item) => item.kind === "separator"
        ? <div key={item.id} role="separator" className="menu-separator" />
        : <button key={item.id} type="button" className="menu-item" disabled={item.disabled}
            role={item.kind === "radio" ? "menuitemradio" : "menuitem"}
            aria-checked={item.kind === "radio" ? Boolean(item.checked) : undefined}
            onClick={() => { item.onSelect(); onClose(true); }}>
            <span className="menu-check" aria-hidden="true">{item.checked ? <Check /> : null}</span>{item.label}
          </button>)}
    </div>
  </>, document.body);
}
