import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { captureMove, enter, playMove } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type GlassTab = { value: string; label: ReactNode; count?: ReactNode; content: ReactNode };

const ACTIVE_TRIGGER = '[data-slot="tabs-trigger"][data-state="active"]';
const ACTIVE_CONTENT = '[data-slot="tabs-content"][data-state="active"]';

/** 유리 알약 탭. 활성 배경은 별도 thumb가 Flip으로 미끄러지고(160ms), 새 콘텐츠는 아래에서 6px 올라온다.
 *  Radix 트리거의 active 배경은 투명으로 두고 thumb이 대신한다(patterns.css .glass-tabs). */
export function GlassTabs({ value, onValueChange, tabs, className, listClassName }: {
  value: string; onValueChange: (value: string) => void; tabs: GlassTab[]; className?: string; listClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const was = useRef(value);

  /** thumb를 활성 탭 위에 놓는다. */
  const place = useCallback(() => {
    const root = rootRef.current;
    const thumb = root?.querySelector<HTMLElement>(".tabs-thumb");
    const active = root?.querySelector<HTMLElement>(ACTIVE_TRIGGER);
    if (!thumb || !active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.setAttribute("data-ready", "");
  }, []);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const moved = was.current !== value;
    was.current = value;
    const state = moved ? captureMove(root.querySelector<HTMLElement>(".tabs-thumb")) : null;
    place();
    if (state) playMove(state, "fast");
    if (moved) enter(root.querySelector(ACTIVE_CONTENT), { y: 6, duration: "fast" });
  }, { dependencies: [value] });

  // 폭이 바뀌면 애니메이션 없이 다시 맞춘다(관찰을 시작할 때 한 번 불려 첫 위치도 이때 놓인다).
  useEffect(() => {
    const list = rootRef.current?.querySelector<HTMLElement>('[data-slot="tabs-list"]');
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(list);
    return () => observer.disconnect();
  }, [place]);

  return <Tabs ref={rootRef} value={value} onValueChange={onValueChange} className={className}>
    <TabsList className={cn("glass-tabs", listClassName)}><span className="tabs-thumb" aria-hidden="true" />
      {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}{tab.count === undefined ? null : <span>{tab.count}</span>}</TabsTrigger>)}
    </TabsList>
    {tabs.map((tab) => <TabsContent key={tab.value} value={tab.value}>{tab.content}</TabsContent>)}
  </Tabs>;
}
