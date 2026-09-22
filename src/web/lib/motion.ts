import { gsap } from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

/** 타이밍 토큰(초). 근거는 `.tasks/motion-design.md` §2. 여기 밖에서 값을 하드코딩하지 않는다. */
export const MOTION = {
  micro: 0.12, fast: 0.16, base: 0.22, window: 0.26,
  stagger: 0.03, staggerMax: 0.3, tight: 0.02, bounce: 0.13, pulse: 0.6,
} as const;

export const EASE = {
  enter: "power3.out", exit: "power2.in", move: "power3.inOut",
  pop: "back.out(1.4)", bounce: "power1.inOut", decay: "power2.out",
} as const;

export type MotionKey = keyof typeof MOTION;
export type FlipSnapshot = Flip.FlipState;

gsap.defaults({ ease: EASE.enter, duration: MOTION.base, overwrite: "auto" });
gsap.config({ force3D: true });

/** 매 호출 시 평가한다(테스트가 실행 중에 emulateMedia로 바꾼다). */
export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const dur = (key: MotionKey) => (reduced() ? 0 : MOTION[key]);

type Target = Element | null | undefined;
type Opts = { x?: number; y?: number; scale?: number; origin?: string; duration?: MotionKey; ease?: string; delay?: number };

const CLEAR = "opacity,transform,transformOrigin";

function mark(els: ArrayLike<Element>, name: string, on: boolean) {
  for (const el of Array.from(els)) on ? el.setAttribute(`data-${name}`, "") : el.removeAttribute(`data-${name}`);
}

/** opacity 0→1(+ y/x/scale). 감소 모드에서는 이동 없이 즉시 적용한다. */
export function enter(el: Target, opts: Opts = {}) {
  if (!el) return;
  const { x, y = 8, scale, origin, duration = "base", ease = EASE.enter, delay = 0 } = opts;
  const soft = reduced();
  const from: gsap.TweenVars = { opacity: 0 };
  const to: gsap.TweenVars = { opacity: 1, duration: dur(duration), ease, delay: soft ? 0 : delay, clearProps: CLEAR };
  if (!soft) {
    if (x) { from.x = x; to.x = 0; }
    if (y) { from.y = y; to.y = 0; }
    if (scale !== undefined) { from.scale = scale; to.scale = 1; }
    if (origin) { from.transformOrigin = origin; to.transformOrigin = origin; }
  }
  return gsap.fromTo(el, from, to);
}

/** opacity → 0. 감소 모드에서는 즉시 숨기고 바로 resolve 한다(언마운트를 늦추지 않는다). */
export function exit(el: Target, opts: Opts = {}): Promise<void> {
  if (!el) return Promise.resolve();
  const { x, y, scale, duration = "fast", ease = EASE.exit } = opts;
  if (reduced()) { gsap.set(el, { opacity: 0 }); return Promise.resolve(); }
  const vars: gsap.TweenVars = { opacity: 0, duration: dur(duration), ease };
  if (x) vars.x = x;
  if (y) vars.y = y;
  if (scale !== undefined) vars.scale = scale;
  return new Promise((resolve) => {
    const done = () => resolve();
    gsap.to(el, { ...vars, onComplete: done, onInterrupt: done });
  });
}

/** 목록 진입. 총 stagger 시간은 staggerMax로 제한한다. */
export function staggerIn(els: ArrayLike<Element>, opts: Opts & { step?: MotionKey } = {}) {
  const list = Array.from(els);
  if (!list.length) return;
  if (reduced()) { gsap.set(list, { clearProps: CLEAR }); return; }
  const { y = 8, duration = "base", ease = EASE.enter, step = "stagger" } = opts;
  mark(list, "entering", true);
  const done = () => mark(list, "entering", false);
  gsap.fromTo(list, { opacity: 0, y }, {
    opacity: 1, y: 0, duration: dur(duration), ease, clearProps: CLEAR,
    stagger: { amount: Math.min(MOTION.staggerMax, list.length * MOTION[step]) },
    onComplete: done, onInterrupt: done,
  });
}

/** 배경 하이라이트 한 번(§3-B4). 대상의 현재 배경색으로 되돌아간다. */
export function pulse(el: HTMLElement | null | undefined) {
  if (!el || reduced()) return;
  const style = getComputedStyle(el);
  const tint = style.getPropertyValue("--pulse-tint").trim() || "rgba(10,132,255,.4)";
  const base = style.backgroundColor || "rgba(0,0,0,0)";
  gsap.killTweensOf(el, "backgroundColor");
  el.setAttribute("data-pulsing", "");
  const done = () => { gsap.set(el, { clearProps: "backgroundColor" }); el.removeAttribute("data-pulsing"); };
  gsap.fromTo(el, { backgroundColor: tint }, {
    backgroundColor: base, duration: MOTION.pulse, ease: EASE.decay, onComplete: done, onInterrupt: done,
  });
}

/** 트윈으로 남은 인라인 스타일을 치운다. */
export function resetMotion(el: Target) { if (el) gsap.set(el, { clearProps: CLEAR }); }

// ── 창(§3-A) ──────────────────────────────────────────────

const frames = new Map<string, HTMLElement>();
const frameStates = new Map<string, FlipSnapshot | null>();

/** 스토어가 상태를 바꾸기 전에 프레임을 찾을 수 있도록 등록해 둔다(§3-A5). */
export function registerFrame(id: string, el: HTMLElement | null) { el ? frames.set(id, el) : frames.delete(id); }
export function captureFrame(id: string) {
  const el = frames.get(id);
  frameStates.set(id, el && !reduced() ? Flip.getState(el) : null);
}
export function takeFrame(id: string) { const state = frameStates.get(id) ?? null; frameStates.delete(id); return state; }

let bootIndex = 0;
let booting = true;
/** 첫 로드에서 창을 60ms 간격으로 순차 진입시킨다. */
export function bootDelay() {
  if (!booting) return 0;
  if (bootIndex === 0) requestAnimationFrame(() => { booting = false; });
  return (bootIndex++) * MOTION.stagger * 2;
}

export function enterWindow(frame: HTMLElement | null, delay = 0) {
  return enter(frame, { y: 14, scale: 0.94, origin: "50% 100%", duration: "window", delay });
}
export function exitWindow(frame: HTMLElement | null) {
  return exit(frame, { y: 6, scale: 0.96, duration: "fast" });
}

function dockOffset(frame: HTMLElement, id: string) {
  const rect = frame.getBoundingClientRect();
  const icon = document.querySelector<HTMLElement>(`[data-dock-item="${id}"]`);
  if (!icon) return { x: 0, y: rect.height / 2 };
  const target = icon.getBoundingClientRect();
  return {
    x: target.left + target.width / 2 - (rect.left + rect.width / 2),
    y: target.top + target.height / 2 - (rect.top + rect.height / 2),
  };
}
const SHRUNK = { scale: 0.12, opacity: 0, transformOrigin: "50% 50%" };

export function minimizeToDock(frame: HTMLElement | null, id: string): Promise<void> {
  if (!frame || reduced()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    gsap.to(frame, { ...dockOffset(frame, id), ...SHRUNK, duration: dur("window"), ease: EASE.exit, onComplete: done, onInterrupt: done });
  });
}

export function restoreFromDock(frame: HTMLElement | null, id: string) {
  if (!frame) return;
  if (reduced()) { resetMotion(frame); return; }
  gsap.fromTo(frame, { ...dockOffset(frame, id), ...SHRUNK },
    { x: 0, y: 0, scale: 1, opacity: 1, duration: dur("window"), ease: EASE.enter, clearProps: CLEAR });
}

/** 진행 중인 종료·축소 트윈을 끊고 원래 자리로 되돌린다(닫는 중 다시 열기 등, §4-3). */
export function settleFrame(frame: HTMLElement | null) {
  if (!frame) return;
  if (reduced()) { resetMotion(frame); return; }
  gsap.to(frame, { x: 0, y: 0, scale: 1, opacity: 1, duration: dur("fast"), ease: EASE.enter, clearProps: CLEAR });
}

/** 최대화·복원: 프레임을 Flip으로 옮기고 모서리 반경도 함께 트윈한다. */
export function flipFrame(state: FlipSnapshot | null, frame: HTMLElement | null, radius: { from: number; to: number }) {
  if (!state || !frame || reduced()) return;
  Flip.from(state, { duration: dur("window"), ease: EASE.move, absolute: true, scale: false });
  gsap.fromTo(frame, { borderRadius: radius.from }, { borderRadius: radius.to, duration: dur("window"), ease: EASE.move, clearProps: "borderRadius" });
}

/** 드래그 종료 후 클램프 위치로 스냅(§3-A7). onStep이 스토어를 갱신한다. */
export function snapTo(from: { x: number; y: number }, to: { x: number; y: number }, onStep: (x: number, y: number) => void) {
  if (reduced()) { onStep(to.x, to.y); return; }
  const proxy = { ...from };
  gsap.to(proxy, { x: to.x, y: to.y, duration: dur("fast"), ease: EASE.enter, onUpdate: () => onStep(proxy.x, proxy.y) });
}

// ── 목록 재정렬(§3-B2, §3-C3) ─────────────────────────────

const ROW = "[data-flip-id]";

export function captureRows(root: HTMLElement | null): FlipSnapshot | null {
  if (!root || reduced()) return null;
  const rows = root.querySelectorAll(ROW);
  return rows.length ? Flip.getState(rows) : null;
}

export function flipRows(state: FlipSnapshot | null, root: HTMLElement | null) {
  if (!state || !root || reduced()) return;
  Flip.from(state, {
    targets: root.querySelectorAll(ROW), duration: dur("base"), ease: EASE.move,
    onEnter: (els) => {
      mark(els, "entering", true);
      const done = () => mark(els, "entering", false);
      return gsap.fromTo(els, { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: dur("base"), ease: EASE.enter, clearProps: CLEAR, onComplete: done, onInterrupt: done });
    },
  });
}

/** 위치만 바뀌는 단일 요소(탭 thumb, Dock 툴팁)를 Flip으로 미끄러뜨린다. */
export function captureMove(el: HTMLElement | null): FlipSnapshot | null {
  return el && !reduced() ? Flip.getState(el) : null;
}
export function playMove(state: FlipSnapshot | null, duration: MotionKey = "fast") {
  if (!state || reduced()) return;
  Flip.from(state, { duration: dur(duration), ease: EASE.move });
}

// ── 클론 오버레이 크로스페이드(§3-C1) ─────────────────────

const CLONE_GUARD = 300;
const STRIP = "[id],[data-testid],[name]";
/** 클론이 실제 콘텐츠와 같은 선택자로 잡히지 않도록, 모양만 인라인으로 옮기고 이름을 떼는 클래스. */
const MASK = ".summary";

function mask(source: HTMLElement, clone: HTMLElement) {
  const origins = source.querySelectorAll<HTMLElement>(MASK);
  Array.from(clone.querySelectorAll<HTMLElement>(MASK)).forEach((node, index) => {
    const origin = origins[index];
    if (origin) {
      const computed = getComputedStyle(origin);
      for (const property of Array.from(computed)) node.style.setProperty(property, computed.getPropertyValue(property));
    }
    node.removeAttribute("class");
  });
}

/** 교체 직전 DOM을 떠서 같은 자리에 겹쳐 둔다. 테스트가 잡는 id·testid는 지운다. */
export function captureClone(container: HTMLElement | null, selector: string): HTMLElement | null {
  if (!container || reduced()) return null;
  const source = container.querySelector<HTMLElement>(selector);
  if (!source) return null;
  dropClones(container);
  const rect = source.getBoundingClientRect();
  const host = container.getBoundingClientRect();
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.remove("detail-panel");
  clone.classList.add("detail-clone");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.removeAttribute("id");
  for (const node of Array.from(clone.querySelectorAll(STRIP))) {
    node.removeAttribute("id"); node.removeAttribute("data-testid"); node.removeAttribute("name");
  }
  mask(source, clone);
  const fill = getComputedStyle(source).backgroundColor;
  const place = {
    position: "absolute", margin: "0", pointerEvents: "none",
    left: `${rect.left - host.left}px`, top: `${rect.top - host.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
  };
  // 두 겹이 동시에 반투명해지면 뒤 배경이 비치므로, 불투명한 바탕을 한 장 깔고 그 위에서 교차한다.
  if (!/,\s*0\s*\)$/.test(fill)) {
    const backdrop = document.createElement("div");
    backdrop.className = "detail-clone-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    Object.assign(backdrop.style, place, { backgroundColor: fill });
    container.appendChild(backdrop);
  }
  Object.assign(clone.style, place, { overflow: "hidden", backgroundColor: fill });
  container.appendChild(clone);
  clone.scrollTop = source.scrollTop;
  return clone;
}

export function dropClones(container: HTMLElement | null) {
  for (const node of Array.from(container?.querySelectorAll(".detail-clone, .detail-clone-backdrop") ?? [])) node.remove();
}

/** 클론을 페이드아웃하고 300ms 안에 반드시 제거한다(타임아웃 가드). */
export function fadeClone(clone: HTMLElement | null) {
  if (!clone) return;
  const backdrop = clone.previousElementSibling?.classList.contains("detail-clone-backdrop") ? clone.previousElementSibling : null;
  void exit(clone, { x: -10 }).then(() => clone.remove());
  // 바탕은 들어오는 패널이 완전히 불투명해질 때까지 남기고, 가드 시점에 반드시 걷는다.
  setTimeout(() => { clone.remove(); backdrop?.remove(); }, CLONE_GUARD);
}

// ── 그 밖의 작은 전환(§3-D·E·F) ───────────────────────────

export function popIn(el: Target) { return enter(el, { y: 0, scale: 0.9, duration: "micro" }); }
export function enterToast(el: Target) { return enter(el, { y: 16, scale: 0.96, ease: EASE.pop }); }
export function exitToast(el: Target) { return exit(el, { y: 8 }); }
export function enterMenu(el: Target) { return enter(el, { y: -6, scale: 0.98, origin: "top left" }); }
export function exitMenu(el: Target) { return exit(el, { y: -4, duration: "micro" }); }

/** Dock 실행 바운스(2회, 총 520ms). CSS transition과 겹치지 않게 잠시 꺼 둔다. */
export function bounceIcon(el: HTMLElement | null) {
  if (!el || reduced()) return;
  gsap.killTweensOf(el);
  gsap.set(el, { transition: "none" });
  const tl = gsap.timeline({ onComplete: () => gsap.set(el, { clearProps: "transform,transition" }) });
  for (let i = 0; i < 2; i++) {
    tl.to(el, { y: -12, duration: MOTION.bounce, ease: EASE.bounce })
      .to(el, { y: 0, duration: MOTION.bounce, ease: EASE.bounce });
  }
}

/** 선택 행의 좌측 강조선이 위에서 아래로 그려진다(§3-B3). */
export function growAccent(el: Target) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 0%", duration: dur("micro"), ease: EASE.enter, clearProps: CLEAR });
}

export function fadeDot(el: Target, to = 0.6) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { opacity: 0 }, { opacity: to, duration: dur("micro"), ease: EASE.enter, clearProps: "opacity" });
}

export function popScale(el: Target, scale = 1.4) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { scale: 1 }, { scale, duration: MOTION.micro / 2, ease: EASE.enter, yoyo: true, repeat: 1, clearProps: "transform" });
}

export function spinIn(el: Target) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { rotate: -90, opacity: 0 }, { rotate: 0, opacity: 1, duration: dur("micro"), ease: EASE.enter, clearProps: CLEAR });
}

export function expandHeight(el: HTMLElement | null) {
  if (!el) return;
  if (reduced()) { gsap.set(el, { clearProps: "height,opacity,overflow" }); return; }
  gsap.fromTo(el, { height: 0, opacity: 0, overflow: "hidden" },
    { height: "auto", opacity: 1, duration: dur("base"), ease: EASE.move, clearProps: "height,opacity,overflow" });
}

export function collapseHeight(el: HTMLElement | null): Promise<void> {
  if (!el || reduced()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    gsap.to(el, { height: 0, opacity: 0, overflow: "hidden", duration: dur("base"), ease: EASE.move, onComplete: done, onInterrupt: done });
  });
}
