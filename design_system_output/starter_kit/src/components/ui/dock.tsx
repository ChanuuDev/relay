"use client";

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type HTMLMotionProps, type MotionValue, type SpringOptions } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MOTION, reduced } from "@/lib/motion";
import { cn } from "@/lib/utils";

const DEFAULT_SPRING = { mass: 0.1, stiffness: 150, damping: 12 };
/** 라벨 아래쪽 끝과 아이콘 위쪽 끝 사이(라벨 24px + 화살표 6px + 여백 4px). */
const LABEL_GAP = 34;

type DockProps = {
  children: ReactNode;
  className?: string;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  baseSize?: number;
  spring?: SpringOptions;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
};
type LabelEntry = { content: ReactNode; ref: RefObject<HTMLButtonElement | null> };
type DockContextType = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
  baseSize: number;
  disabled: boolean;
  register: (key: string, entry: LabelEntry) => () => void;
};
type DockItemContextType = {
  key: string;
  width: MotionValue<number>;
  ref: RefObject<HTMLButtonElement | null>;
};

const DockContext = createContext<DockContextType | undefined>(undefined);
const DockItemContext = createContext<DockItemContextType | undefined>(undefined);

function useDock() {
  const context = useContext(DockContext);
  if (!context) throw new Error("Dock components must be used within Dock");
  return context;
}

function useDockItem() {
  const context = useContext(DockItemContext);
  if (!context) throw new Error("DockIcon and DockLabel must be used within DockItem");
  return context;
}

function watchReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 21st.dev Dock: pointer distance drives spring widths; the panel stays anchored at the bottom.
 *  The label is one element for the whole dock: it follows the item nearest the pointer (or the focused item)
 *  and only swaps its text, so moving along the dock never fades labels in and out. */
function Dock({ children, className, spring = DEFAULT_SPRING, magnification = 80, distance = 150,
  panelHeight = 64, baseSize = 48, disabled = false, ref }: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const soft = useSyncExternalStore(watchReducedMotion, reduced, () => false);
  const staticSize = disabled || soft;
  const entries = useRef(new Map<string, LabelEntry>());
  const [active, setActive] = useState<string | null>(null);
  const [labels, setLabels] = useState(0);
  const pointer = useRef<number | null>(null);
  const focused = useRef<string | null>(null);
  const labelX = useMotionValue(0);
  const labelY = useMotionValue(0);

  const register = useCallback((key: string, entry: LabelEntry) => {
    entries.current.set(key, entry);
    setLabels((count) => count + 1);
    return () => { entries.current.delete(key); setLabels((count) => count + 1); };
  }, []);
  /** 라벨 자리를 그 항목의 아이콘 위로 맞춘다. 상태 대신 MotionValue라 다시 그리지 않는다. */
  const place = useCallback((key: string | null) => {
    const rect = key ? entries.current.get(key)?.ref.current?.getBoundingClientRect() : undefined;
    if (rect) { labelX.set(rect.left + rect.width / 2); labelY.set(rect.top - LABEL_GAP); }
  }, [labelX, labelY]);
  const nearest = useCallback((clientX: number) => {
    let best: string | null = null;
    let gap = Infinity;
    for (const [key, entry] of entries.current) {
      const rect = entry.ref.current?.getBoundingClientRect();
      if (!rect) continue;
      const distanceToCenter = Math.abs(clientX - rect.left - rect.width / 2);
      if (distanceToCenter < gap) { gap = distanceToCenter; best = key; }
    }
    return best;
  }, []);
  const show = useCallback((key: string | null) => { place(key); setActive(key); }, [place]);
  const keyOf = (target: EventTarget | null) => {
    for (const [key, entry] of entries.current) if (entry.ref.current && target instanceof Node && entry.ref.current.contains(target)) return key;
    return null;
  };

  useLayoutEffect(() => {
    if (staticSize) mouseX.set(Infinity);
  }, [staticSize, mouseX]);
  // 아이콘이 커지고 줄어드는 동안 라벨이 아이콘 위를 따라간다. 라벨이 보일 때만 돈다.
  useEffect(() => {
    if (!active) return;
    let frame = requestAnimationFrame(function follow() { place(active); frame = requestAnimationFrame(follow); });
    return () => cancelAnimationFrame(frame);
  }, [active, place]);
  // 라벨을 단 항목이 사라지면 그 라벨도 내린다.
  useEffect(() => { if (active && !entries.current.has(active)) setActive(null); }, [active, labels]);

  const current = active ? entries.current.get(active) : undefined;
  return <motion.div className="dock-row flex max-w-full items-end" data-static={staticSize ? "" : undefined} style={{ height: panelHeight }}>
    <motion.div ref={ref} className={cn("dock-bar", className)} style={{ height: panelHeight }}
      onMouseMove={(event) => {
        pointer.current = event.clientX;
        if (!staticSize) mouseX.set(event.clientX);
        const key = nearest(event.clientX);
        if (key !== active) show(key);
      }}
      onMouseLeave={() => { pointer.current = null; mouseX.set(Infinity); show(focused.current); }}
      onFocusCapture={(event) => {
        // 키보드 초점만 라벨을 붙잡는다. 눌러서 생긴 초점은 포인터가 떠나면 라벨도 내린다.
        focused.current = (event.target as HTMLElement).matches(":focus-visible") ? keyOf(event.target) : null;
        show(focused.current ?? (pointer.current === null ? null : nearest(pointer.current)));
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focused.current = null;
        show(pointer.current === null ? null : nearest(pointer.current));
      }}
      role="toolbar" aria-label="앱 바로가기">
      <DockContext.Provider value={{ mouseX, spring, distance, magnification, baseSize, disabled: staticSize, register }}>
        {children}
      </DockContext.Provider>
    </motion.div>
    {createPortal(<AnimatePresence>
      {current && <motion.div key="dock-tip" role="tooltip" className="dock-tip"
        style={{ left: labelX, top: labelY, x: "-50%" }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
        transition={{ duration: staticSize ? 0 : MOTION.micro }}>{current.content}</motion.div>}
    </AnimatePresence>, document.body)}
  </motion.div>;
}

type DockItemProps = Omit<HTMLMotionProps<"button">, "children"> & { children: ReactNode };

function DockItem({ children, className, onFocus, onBlur, ...props }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const key = useId();
  const { distance, magnification, baseSize, mouseX, spring, disabled } = useDock();
  const isFocused = useMotionValue(0);
  const mouseDistance = useTransform(mouseX, (value) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return value - rect.x - rect.width / 2;
  });
  const widthTransform = useTransform(mouseDistance, [-distance, 0, distance], [baseSize, magnification, baseSize]);
  const target = useTransform(() => {
    const pointerWidth = widthTransform.get();
    const focused = isFocused.get();
    return disabled ? baseSize : focused ? magnification : pointerWidth;
  });
  const width = useSpring(target, spring);

  // Keep the same MotionValue bindings when the viewport or motion preference changes.
  useLayoutEffect(() => {
    if (disabled || (!Number.isFinite(mouseX.get()) && !isFocused.get())) width.jump(baseSize);
  }, [disabled, baseSize, width, mouseX, isFocused]);

  return <motion.button {...props} ref={ref} type="button" className={cn("dock-item", className)}
    style={{ width }}
    onFocus={(event) => { isFocused.set(event.currentTarget.matches(":focus-visible") ? 1 : 0); onFocus?.(event); }}
    onBlur={(event) => { isFocused.set(0); onBlur?.(event); }}>
    <DockItemContext.Provider value={{ key, width, ref }}>{children}</DockItemContext.Provider>
  </motion.button>;
}

type DockPartProps = { className?: string; children: ReactNode };

/** 항목의 라벨 내용을 Dock에 맡긴다. 화면에는 Dock이 하나뿐인 라벨로 그린다. */
function DockLabel({ children }: DockPartProps) {
  const { key, ref } = useDockItem();
  const { register } = useDock();
  useLayoutEffect(() => register(key, { content: children, ref }), [register, key, ref, children]);
  return null;
}

function DockIcon({ children, className }: DockPartProps) {
  const { width } = useDockItem();
  return <motion.div style={{ width }} className={cn("dock-icon flex items-center justify-center", className)}>
    {children}
  </motion.div>;
}

export { Dock, DockIcon, DockItem, DockLabel };
