import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import { Check } from "lucide-react";
import { enterMenu, exitMenu } from "../../lib/motion";
import { cn } from "../../lib/utils";

export type MenuEntry =
  | { kind: "separator"; id: string }
  | { kind: "label"; id: string; label: string }
  | { kind: "item" | "radio"; id: string; label: string; checked?: boolean; disabled?: boolean; danger?: boolean; onSelect: () => void };

const ITEMS = "[role=menuitem]:not(:disabled), [role=menuitemradio]:not(:disabled)";

/** 마지막 입력이 포인터(마우스·터치·펜)였는지. 메뉴를 어떤 입력으로 열었는지 가린다. */
let pointerLast = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { pointerLast = true; }, true);
  window.addEventListener("keydown", () => { pointerLast = false; }, true);
}

/** 메뉴를 열 때의 초점. 키보드로 열면 첫 항목에 두고, 포인터로 열면 메뉴 자체에 두어 아무 줄도 칠하지 않는다(macOS·Windows 메뉴와 같다).
 *  포인터로 연 뒤에도 ↓·↑로 첫·끝 항목부터 고를 수 있다. */
export function focusMenuOnOpen(menu: HTMLElement | null) {
  if (!menu) return;
  (pointerLast ? menu : menu.querySelector<HTMLElement>(ITEMS) ?? menu).focus({ preventScroll: true });
}

/** 칠하는 줄은 초점 하나뿐이다. 포인터가 지나는 항목으로 초점을 옮겨 마우스와 키보드가 같은 줄을 가리키게 하고,
 *  항목이 아닌 곳(구분선·머리·비활성 항목)이나 메뉴 밖으로 나가면 메뉴 자체로 초점을 돌려 칠을 지운다.
 *  닫히는 중이거나 초점이 이미 메뉴 밖으로 돌아갔으면 건드리지 않는다. */
export function followPointer(menu: HTMLElement, target: EventTarget | null) {
  if (menu.hasAttribute("data-leaving") || !menu.contains(document.activeElement)) return;
  const item = target instanceof Element ? target.closest<HTMLElement>(ITEMS) : null;
  const next = item && menu.contains(item) ? item : menu;
  if (document.activeElement !== next) next.focus({ preventScroll: true });
}

/** 메뉴바 자체가 backdrop 루트라 메뉴는 body로 포털한다(유리가 창을 제대로 흐리게 만든다).
 *  전면 오버레이가 바깥 클릭을 삼켜서 뒤에 있는 창이 실수로 눌리지 않는다.
 *  닫기는 종료 트윈(§3-D1) 뒤에 언마운트하지만, 오버레이는 즉시 걷는다. */
export function DesktopMenu({ items, position, leaving, onClose, onExited, className }: {
  items: MenuEntry[]; position: { left: number; top: number }; leaving: boolean;
  onClose: (returnFocus: boolean) => void; onExited: () => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { focusMenuOnOpen(ref.current); }, []);
  useGSAP(() => {
    if (!leaving) { enterMenu(ref.current); return; }
    void exitMenu(ref.current).then(onExited);
  }, { dependencies: [leaving] });

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
    {leaving ? null : <div className="menu-overlay" onPointerDown={(event) => { event.preventDefault(); onClose(true); }} />}
    <div ref={ref} role="menu" tabIndex={-1} className={cn("desktop-menu material-menu", className)} onKeyDown={onKeyDown}
      onPointerMove={(event) => followPointer(event.currentTarget, event.target)} onPointerLeave={(event) => followPointer(event.currentTarget, null)}
      data-leaving={leaving ? "" : undefined}
      style={{ left: Math.max(4, Math.min(position.left, window.innerWidth - 220)), top: position.top }}>
      {items.map((item) => item.kind === "separator"
        ? <div key={item.id} role="separator" className="menu-separator" />
        : item.kind === "label" ? <div key={item.id} role="presentation" className="menu-label">{item.label}</div>
        : <button key={item.id} type="button" className="menu-item" disabled={item.disabled} data-danger={item.danger ? "" : undefined}
            role={item.kind === "radio" ? "menuitemradio" : "menuitem"}
            aria-checked={item.kind === "radio" ? Boolean(item.checked) : undefined}
            onClick={() => { item.onSelect(); onClose(true); }}>
            <span className="menu-check" aria-hidden="true">{item.checked ? <Check /> : null}</span>{item.label}
          </button>)}
    </div>
  </>, document.body);
}
