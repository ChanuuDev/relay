"use client";

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type HTMLMotionProps, type MotionValue, type SpringOptions } from "framer-motion";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MOTION, reduced } from "@/lib/motion";
import { cn } from "@/lib/utils";

const DEFAULT_SPRING = { mass: 0.1, stiffness: 150, damping: 12 };

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
type DockContextType = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
  baseSize: number;
  disabled: boolean;
};
type DockItemContextType = {
  width: MotionValue<number>;
  isHovered: MotionValue<number>;
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

/** 21st.dev Dock: pointer distance drives spring widths; the panel stays anchored at the bottom. */
function Dock({ children, className, spring = DEFAULT_SPRING, magnification = 80, distance = 150,
  panelHeight = 64, baseSize = 48, disabled = false, ref }: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);
  const soft = useSyncExternalStore(watchReducedMotion, reduced, () => false);
  const staticSize = disabled || soft;
  const maxHeight = Math.max(128, magnification + magnification / 2 + 4);
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  useLayoutEffect(() => {
    if (staticSize) { mouseX.set(Infinity); isHovered.set(0); height.jump(panelHeight); }
  }, [staticSize, panelHeight, height, mouseX, isHovered]);

  return <motion.div className="dock-row flex max-w-full items-end" data-static={staticSize ? "" : undefined} style={{ height }}>
    <motion.div ref={ref} className={cn("dock-bar", className)} style={{ height: panelHeight }}
      onMouseMove={(event) => { if (!staticSize) { isHovered.set(1); mouseX.set(event.clientX); } }}
      onMouseLeave={() => { isHovered.set(0); mouseX.set(Infinity); }}
      onFocusCapture={() => { if (!staticSize) isHovered.set(1); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) isHovered.set(0); }}
      role="toolbar" aria-label="앱 바로가기">
      <DockContext.Provider value={{ mouseX, spring, distance, magnification, baseSize, disabled: staticSize }}>
        {children}
      </DockContext.Provider>
    </motion.div>
  </motion.div>;
}

type DockItemProps = Omit<HTMLMotionProps<"button">, "children"> & { children: ReactNode };

function DockItem({ children, className, onFocus, onBlur, ...props }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { distance, magnification, baseSize, mouseX, spring, disabled } = useDock();
  const isHovered = useMotionValue(0);
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
    onHoverStart={() => isHovered.set(1)} onHoverEnd={() => isHovered.set(isFocused.get())}
    onFocus={(event) => {
      isFocused.set(event.currentTarget.matches(":focus-visible") ? 1 : 0);
      isHovered.set(1); onFocus?.(event);
    }}
    onBlur={(event) => { isFocused.set(0); isHovered.set(0); onBlur?.(event); }}>
    <DockItemContext.Provider value={{ width, isHovered, ref }}>{children}</DockItemContext.Provider>
  </motion.button>;
}

type DockPartProps = { className?: string; children: ReactNode };

function DockLabel({ children, className }: DockPartProps) {
  const { width, isHovered, ref } = useDockItem();
  const { disabled } = useDock();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setVisible(isHovered.get() === 1);
    return isHovered.on("change", (value) => setVisible(value === 1));
  }, [isHovered]);

  // Keep the label above the growing icon and outside the dock's backdrop-filter boundary.
  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setPosition({ left: rect.left + rect.width / 2, top: rect.top - 34 });
    };
    update();
    const unsubscribe = width.on("change", update);
    window.addEventListener("resize", update);
    return () => { unsubscribe(); window.removeEventListener("resize", update); };
  }, [visible, width, ref]);

  return createPortal(<AnimatePresence>
    {visible && position && <motion.div role="tooltip" className={cn("dock-tip material-menu", className)}
      style={{ ...position, x: "-50%" }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
      transition={{ duration: disabled ? 0 : MOTION.micro }}>{children}</motion.div>}
  </AnimatePresence>, document.body);
}

function DockIcon({ children, className }: DockPartProps) {
  const { width } = useDockItem();
  return <motion.div style={{ width }} className={cn("dock-icon flex items-center justify-center", className)}>
    {children}
  </motion.div>;
}

export { Dock, DockIcon, DockItem, DockLabel };
