import {
  Simulation, boundsOf, edgeStyle, focusLayout, networkLayout, radiusOf, seedPosition, structureLayout, timelineLayout, topicsLayout,
  type Decor, type EdgeStyle, type GraphView, type Layout, type Vec,
} from "../../lib/graph-layout";
import { ROOT_GROUP, SESSION_GROUP, TAG_GROUP, isContainer, isDoc, type EdgeKind, type GraphCluster, type GraphEdge, type GraphGroup, type GraphNode } from "../../lib/note-graph";

/** 메모 지식 그래프를 캔버스에 그린다. React는 데이터·보기·고른 점만 넘기고, 움직임(배치 전환·카메라·강조·입자)은 모두 여기서 requestAnimationFrame으로 돈다.
 *  움직일 것이 없으면 프레임을 멈추고 host에 data-settled를 단다(테스트와 전력 절약). */

export type SceneData = { nodes: GraphNode[]; edges: GraphEdge[]; degree: Map<string, number>; groups: GraphGroup[]; clusters: GraphCluster[] };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type SceneEvents = {
  hover: (id: string | null) => void;
  /** 점을 누름(null이면 빈 곳). */
  select: (id: string | null) => void;
  /** 점을 두 번 누름·Enter. */
  open: (id: string) => void;
  /** 시간 흐름 재생이 끝남. */
  replayed?: () => void;
};

type Theme = { dark: boolean; fg: string; bg: string; accent: string; palette: string[]; root: string; tag: string; session: string; scale: number; font: string };
const PALETTE_DARK = ["#64A8FF", "#B98CFF", "#FF7EB6", "#FFA45C", "#3DD6B5", "#8FD96B", "#F5CB5C", "#8E9BFF", "#5CD0F0", "#FF7A70", "#D9A877", "#C3E66B"];
const PALETTE_LIGHT = ["#2F7CF6", "#8B55E0", "#E0458B", "#E07A1F", "#0E9E80", "#3F9A2E", "#C29100", "#5B6CE8", "#1795C2", "#DC4B40", "#A8743F", "#6A9A12"];

type NodeState = {
  node: GraphNode; r: number; color: string;
  x: number; y: number; from: Vec; to: Vec; delay: number;
  vis: number; visFrom: number; visTo: number; appear: number;
  hl: number; pop: number; popV: number; labelAlpha: number;
  angleFrom: number | null; angleTo: number | null; morph: number;
  removed: boolean;
};
type EdgeState = {
  edge: GraphEdge; s: NodeState; t: NodeState; seed: number;
  vis: number; visFrom: number; visTo: number; hl: number;
  draw: number; drawAt: number;
  styleFrom: EdgeStyle; styleTo: EdgeStyle; removed: boolean;
};
type Camera = { x: number; y: number; k: number };

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = (edge0: number, edge1: number, x: number) => { const t = clamp((x - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); };
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 10000; };

const rgbCache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let value = rgbCache.get(hex);
  if (!value) {
    const clean = hex.trim().replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
    const n = Number.parseInt(full, 16);
    value = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
    rgbCache.set(hex, value);
  }
  return value;
}
const rgba = (hex: string, alpha: number) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${clamp(alpha).toFixed(3)})`; };

/** 두 카메라 사이를 「멀어졌다가 다가가는」 곡선으로 잇는다(van Wijk & Nuij, d3-interpolateZoom과 같은 식). w는 화면 폭이 덮는 세계 폭. */
function zoomPath(a: [number, number, number], b: [number, number, number]) {
  const rho = Math.SQRT2, [ux0, uy0, w0] = a, [ux1, uy1, w1] = b;
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    return { S, at: (t: number): [number, number, number] => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)] };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1), b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return {
    S, at: (t: number): [number, number, number] => {
      const s = t * S, c0 = Math.cosh(r0), u = (w0 / (2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
    },
  };
}

const EDGE_LOOK: Record<EdgeKind, { alpha: number; width: number; dash: number[] }> = {
  link: { alpha: 0.5, width: 1.35, dash: [] },
  mention: { alpha: 0.34, width: 1.1, dash: [] },
  similar: { alpha: 0.42, width: 1, dash: [4, 4] },
  folder: { alpha: 0.3, width: 1, dash: [] },
  tag: { alpha: 0.3, width: 1, dash: [1.2, 3.4] },
  chain: { alpha: 0.5, width: 1.35, dash: [7, 3] },
};
/** 맥락이 씨앗에서 한 단계 퍼지는 데 걸리는 시간(ms)과 한 점이 밝아지는 시간. */
const WAVE_STEP = 150, WAVE_RISE = 420;

const FORCE_CACHE = new Map<string, Vec>();

export class GraphScene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private nodes = new Map<string, NodeState>();
  private edges = new Map<string, EdgeState>();
  private around = new Map<string, Set<string>>();
  private data: SceneData | null = null;
  private view: GraphView = "network";
  private focus: string | null = null;
  private layout: Layout | null = null;
  private prevDecor: Decor | null = null;
  private transition: { start: number; duration: number; spread: number } | null = null;
  private live = false;
  private sim: Simulation | null = null;
  /** 관계망에서 마지막으로 놓인 자리. 그래프를 닫았다 열어도 같은 모양으로 돌아오게 모듈에 둔다. */
  private forceCache = FORCE_CACHE;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private camTarget: Camera = { x: 0, y: 0, k: 1 };
  private fly: { start: number; duration: number; at: (t: number) => [number, number, number] } | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private matches: Set<string> | null = null;
  private groupLit: string | null = null;
  private ripples: Array<{ id: string; start: number }> = [];
  private pointer: { id: number; x: number; y: number; downX: number; downY: number; node: string | null; moved: boolean; last: number; vx: number; vy: number } | null = null;
  private pinch: { ids: [number, number]; distance: number; k: number; center: Vec } | null = null;
  private touches = new Map<number, Vec>();
  private raf = 0;
  private last = 0;
  private quiet = 0;
  private started = false;
  private theme: Theme;
  private widths = new Map<string, number>();
  private gridTile: { key: string; pattern: CanvasPattern } | null = null;
  /** 이번 프레임에 장식 글자(거품 제목·고리 이름)가 차지한 화면 자리. 메모 이름표는 이 자리를 피한다. */
  private reserved: Array<[number, number, number, number]> = [];
  /** 오른쪽 정보 카드가 열려 있으면 그만큼 비켜서 맞춘다(넓은 화면에서만, 좁으면 카드가 아래에 뜬다). */
  card = false;
  /** 왼쪽 도구 패널이 열려 있으면 그만큼 비켜서 맞춘다(넓은 화면에서만). */
  panel = false;
  /** 중요도(0..1). 높은 점은 둘레에 빛무리가 진다. */
  private glow: Map<string, number> | null = null;
  /** 주제 묶음으로 색을 가를 때: 점 → 묶음 번호. */
  private topics: Map<string, number> | null = null;
  /** 도구가 가리킨 점들(발견 패널의 항목 등). 나머지는 흐려진다. */
  private spot: Set<string> | null = null;
  /** 에이전트 맥락: 씨앗에서 퍼진 점수와, 씨앗에서 몇 단계인지. */
  private heat: { scores: Map<string, number>; seeds: Set<string>; depth: Map<string, number>; start: number; span: number } | null = null;
  /** 두 점을 잇는 길. */
  private route: { nodes: string[]; edges: Set<string>; order: Map<string, number>; start: number } | null = null;
  /** 연결을 만드는 중: 여기서 커서(또는 올린 점)까지 줄을 그린다. */
  private linkFrom: string | null = null;
  private cursor: Vec | null = null;
  /** 미니맵: 점들이 화면 밖으로 나가 있을 때만 떠오른다. 누르거나 끌면 그 자리로 간다. */
  private mini: { x: number; y: number; w: number; h: number; ox: number; oy: number; scale: number } | null = null;
  private miniAlpha = 0;
  private miniDrag: number | null = null;
  /** 만든 순서대로 다시 보이는 중. */
  private replaying: { start: number; span: number; steps: Array<{ at: number; time: number; doc: boolean }>; docs: number } | null = null;
  get insets(): Insets {
    const wide = this.w > 640;
    // 카드와 패널이 함께 들어가지 못하는 너비에서는 패널이 열린 동안 카드가 접힌다.
    const card = this.card && !(this.panel && this.w < 896);
    return { top: wide ? 64 : 104, left: this.panel && wide ? 364 : wide ? 64 : 24, right: card && wide ? 304 : 24,
      bottom: (card || this.panel) && !wide ? Math.min(this.h * 0.48, 420) + 66 : 60 };
  }
  labelsAlways = false;

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private events: SceneEvents) {
    this.ctx = canvas.getContext("2d")!;
    this.theme = this.readTheme();
  }

  private get reduced() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }

  readTheme(): Theme {
    const style = getComputedStyle(this.host);
    const dark = document.documentElement.classList.contains("dark");
    const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const scale = Number.parseFloat(value("--font-scale", "1")) || 1;
    return {
      dark, fg: value("--foreground", dark ? "#f5f5f7" : "#1d1d1f"), bg: value("--background", dark ? "#1e1e20" : "#ffffff"),
      accent: value("--notes-accent", dark ? "#3dd0aa" : "#0f9478"), palette: dark ? PALETTE_DARK : PALETTE_LIGHT,
      root: dark ? "#A6A6AE" : "#86868E", tag: dark ? "#C9CDD8" : "#6B7280", session: dark ? "#F3E9D2" : "#6B5B3E", scale, font: value("--font-sans", "sans-serif"),
    };
  }
  refreshTheme() {
    this.theme = this.readTheme();
    this.gridTile = null;
    this.widths.clear();
    for (const state of this.nodes.values()) state.color = this.colorOf(state.node);
    this.kick();
  }

  private colorOf(node: GraphNode) {
    if (node.group === TAG_GROUP || node.kind === "tag") return this.theme.tag;
    if (node.group === SESSION_GROUP) return this.theme.session;
    if (this.topics && isDoc(node)) {
      const topic = this.topics.get(node.id);
      return topic === undefined ? this.theme.root : this.theme.palette[topic % this.theme.palette.length]!;
    }
    if (node.group === ROOT_GROUP) return this.theme.root;
    const index = this.data?.groups.find((group) => group.id === node.group)?.index ?? 0;
    return this.theme.palette[index % this.theme.palette.length]!;
  }
  groupColor(group: string) {
    if (group === TAG_GROUP) return this.theme.tag;
    if (group === SESSION_GROUP) return this.theme.session;
    if (group === ROOT_GROUP) return this.theme.root;
    const index = this.data?.groups.find((entry) => entry.id === group)?.index ?? 0;
    return this.theme.palette[index % this.theme.palette.length]!;
  }

  resize(width: number, height: number) {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (width === this.w && height === this.h && dpr === this.dpr) return;
    this.w = width; this.h = height; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.gridTile = null;
    // 처음 크기를 알면 그때 들어오는 장면을 시작한다.
    if (!this.started && this.data && width > 0 && height > 0) this.begin();
    this.kick();
  }

  // ── 데이터와 보기 ──────────────────────────────────────

  /** 데이터·보기·가운데 점을 한 번에 맞춘다. 처음이면 가운데에서 피어나며 들어오고, 이후에는 바뀐 점만 나타나거나 사라지며 배치가 옮겨 간다. */
  update(data: SceneData, view: GraphView, focus: string | null) {
    const first = !this.data;
    const viewChanged = view !== this.view || (view === "focus" && focus !== this.focus);
    const dataChanged = data !== this.data;
    this.data = data; this.view = view; this.focus = focus;
    if (dataChanged) this.sync(data);
    if (first) { if (this.w > 0) this.begin(); return; }
    if (!this.started) return;
    if (dataChanged || viewChanged) this.relayout(viewChanged ? "morph" : "update");
  }

  private begin() {
    this.started = true;
    this.relayout("enter");
  }

  private sync(data: SceneData) {
    const seen = new Set<string>();
    data.nodes.forEach((node) => {
      seen.add(node.id);
      const r = radiusOf(node, data.degree.get(node.id) ?? 0);
      const state = this.nodes.get(node.id);
      if (state) { state.node = node; state.r = r; state.removed = false; state.color = this.colorOf(node); return; }
      // 새 점은 이미 있는 이웃(없으면 담은 폴더) 곁에서 나타난다.
      const near = data.edges.find((edge) => (edge.source === node.id && this.nodes.has(edge.target)) || (edge.target === node.id && this.nodes.has(edge.source)));
      const anchor = near ? this.nodes.get(near.source === node.id ? near.target : near.source)! : null;
      const angle = hash(node.id) * Math.PI * 2;
      const x = anchor ? anchor.x + Math.cos(angle) * 24 : 0, y = anchor ? anchor.y + Math.sin(angle) * 24 : 0;
      this.nodes.set(node.id, {
        node, r, color: this.colorOf(node), x, y, from: { x, y }, to: { x, y }, delay: 0, vis: 0, visFrom: 0, visTo: 0, appear: 0,
        hl: 1, pop: 0, popV: 0, labelAlpha: 0, angleFrom: null, angleTo: null, morph: 1, removed: false,
      });
    });
    for (const [id, state] of this.nodes) if (!seen.has(id)) state.removed = true;
    const live = new Set<string>();
    for (const edge of data.edges) {
      live.add(edge.id);
      const s = this.nodes.get(edge.source)!, t = this.nodes.get(edge.target)!;
      const state = this.edges.get(edge.id);
      if (state) { state.edge = edge; state.s = s; state.t = t; state.removed = false; continue; }
      const style = edgeStyle(this.view, edge.kind);
      this.edges.set(edge.id, { edge, s, t, seed: hash(edge.id), vis: 0, visFrom: 0, visTo: 0, hl: 1, draw: 0, drawAt: 0, styleFrom: style, styleTo: style, removed: false });
    }
    for (const [id, state] of this.edges) if (!live.has(id)) state.removed = true;
    this.around = new Map();
    for (const edge of data.edges) for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
      const set = this.around.get(a); if (set) set.add(b); else this.around.set(a, new Set([b]));
    }
  }

  private computeLayout(): Layout {
    const data = this.data!;
    const input = { nodes: data.nodes, edges: data.edges, degree: data.degree, groups: data.groups, clusters: data.clusters, focus: this.focus };
    if (this.view === "focus") return focusLayout(input);
    if (this.view === "structure") return structureLayout(input);
    if (this.view === "topics") return topicsLayout(input);
    if (this.view === "timeline") return timelineLayout(input);
    // 관계망: 지난 자리(없으면 이웃 곁)에서 시작해 거의 멈출 때까지 미리 돌린 자리가 목표다. 전환이 끝나면 그 자리에서 이어서 천천히 가라앉는다.
    const start = new Map<string, Vec>();
    let seeded = 0;
    data.nodes.forEach((node, index) => {
      const cached = this.forceCache.get(node.id);
      if (cached) { start.set(node.id, cached); seeded++; return; }
      const neighbor = [...(this.around.get(node.id) ?? [])].map((id) => this.forceCache.get(id)).find(Boolean);
      const angle = hash(node.id) * Math.PI * 2;
      start.set(node.id, neighbor ? { x: neighbor.x + Math.cos(angle) * 30, y: neighbor.y + Math.sin(angle) * 30 } : seedPosition(index, 18));
    });
    const sim = Simulation.from(data.nodes, data.edges, data.degree, start);
    sim.alpha = seeded >= data.nodes.length * 0.8 && data.nodes.length ? 0.25 : 1;
    sim.run(0.025, 700);
    // 무게중심을 (0,0)에 둔다.
    let cx = 0, cy = 0;
    for (const node of sim.nodes) { cx += node.x; cy += node.y; }
    cx /= sim.nodes.length || 1; cy /= sim.nodes.length || 1;
    for (const node of sim.nodes) { node.x -= cx; node.y -= cy; node.vx = 0; node.vy = 0; }
    this.sim = sim;
    const positions = new Map(sim.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    for (const [id, p] of positions) this.forceCache.set(id, p);
    return networkLayout(positions, data.nodes);
  }

  private relayout(mode: "enter" | "morph" | "update") {
    const now = performance.now();
    const previous = this.layout;
    const keepLive = mode === "update" && this.view === "network" && this.live;
    if (keepLive) {
      // 관계망에서 메모가 늘거나 줄면 시뮬레이션을 지금 자리에서 다시 데워 자연스럽게 자리를 찾게 한다.
      const data = this.data!;
      const start = new Map<string, Vec>();
      for (const node of data.nodes) { const state = this.nodes.get(node.id); if (state) start.set(node.id, { x: state.x, y: state.y }); }
      this.sim = Simulation.from(data.nodes, data.edges, data.degree, start);
      this.sim.alpha = 0.35;
      this.layout = networkLayout(new Map([...start]), data.nodes);
    } else {
      this.live = false;
      this.layout = this.computeLayout();
    }
    const layout = this.layout;
    this.prevDecor = mode === "update" ? null : previous?.decor ?? null;
    const enter = mode === "enter";
    const reduced = this.reduced;
    // 가운데에서 먼 점일수록 조금 늦게 움직여 물결처럼 퍼진다. 처음에는 연결이 많은 점부터 피어난다.
    const targets = [...this.nodes.values()];
    let far = 1;
    for (const state of targets) { const p = layout.positions.get(state.node.id); if (p) far = Math.max(far, Math.hypot(p.x, p.y)); }
    const ranked = enter ? [...targets].sort((a, b) => (this.data!.degree.get(b.node.id) ?? 0) - (this.data!.degree.get(a.node.id) ?? 0)) : targets;
    const spread = reduced ? 0 : enter ? 560 : mode === "morph" ? 280 : 120;
    ranked.forEach((state, rank) => {
      const target = layout.positions.get(state.node.id);
      const hidden = state.removed || !target || layout.hidden.has(state.node.id);
      if (enter) { state.x = 0; state.y = 0; state.vis = 0; state.appear = 0; }
      state.from = { x: state.x, y: state.y };
      state.to = keepLive ? { x: state.x, y: state.y } : target ?? { x: state.x, y: state.y };
      state.visFrom = state.vis;
      state.visTo = hidden ? 0 : 1;
      state.angleFrom = state.morph >= 0.5 ? state.angleTo : state.angleFrom;
      state.angleTo = layout.labelAngle.get(state.node.id) ?? null;
      state.morph = 0;
      const d = target ? Math.hypot(target.x, target.y) / far : 0;
      state.delay = spread * (enter ? 0.55 * (rank / Math.max(1, ranked.length - 1)) + 0.45 * d : d);
    });
    for (const state of this.edges.values()) {
      const style = edgeStyle(layout.view, state.edge.kind);
      state.styleFrom = state.styleTo; state.styleTo = style;
      state.visFrom = state.vis;
      const show = !state.removed && state.s.visTo > 0 && state.t.visTo > 0;
      state.visTo = show ? 1 : 0;
      if (show && (enter || state.vis < 0.05)) {
        // 새로 보이는 선은 두 끝이 자리를 잡아 갈 무렵 한쪽 끝에서 다른 쪽으로 그어진다.
        state.draw = 0;
        state.drawAt = now + Math.max(state.s.delay, state.t.delay) + (enter ? 520 : 260);
      }
    }
    const duration = reduced ? 0 : enter ? 1000 : mode === "morph" ? 900 : 520;
    this.transition = { start: now, duration, spread };
    if (mode !== "update") this.fit(duration ? duration + spread * 0.6 : 0, enter);
    this.kick();
  }

  /** 지금 배치 전체(또는 ids 점들)를 화면 안전 영역에 맞춘다. */
  fit(duration = 700, instant = false, ids?: string[]) {
    if (!this.layout || this.w <= 0) return;
    let bounds = boundsOf(this.layout);
    if (ids?.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids) {
        const state = this.nodes.get(id);
        if (!state) continue;
        const p = state.to;
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      if (Number.isFinite(x0)) bounds = { x0: x0 - 90, y0: y0 - 70, x1: x1 + 90, y1: y1 + 70 };
    }
    const { top, right, bottom, left } = this.insets;
    const aw = Math.max(80, this.w - left - right), ah = Math.max(80, this.h - top - bottom);
    const k = clamp(Math.min(aw / (bounds.x1 - bounds.x0), ah / (bounds.y1 - bounds.y0)), 0.12, ids?.length ? 1.8 : 1.5);
    const target = { x: (bounds.x0 + bounds.x1) / 2 - (left - right) / 2 / k, y: (bounds.y0 + bounds.y1) / 2 - (top - bottom) / 2 / k, k };
    if (instant && this.cam.k === 1 && this.cam.x === 0 && this.cam.y === 0) {
      // 처음 들어올 때는 살짝 멀리서 시작해 다가간다.
      this.cam = { ...target, k: target.k * 0.72 };
      this.flyTo(target, this.reduced ? 0 : 1100);
      return;
    }
    this.flyTo(target, duration);
  }

  flyTo(target: Camera, duration?: number) {
    if (![target.x, target.y, target.k].every(Number.isFinite) || target.k <= 0) return;
    if (this.reduced || duration === 0 || this.w <= 0 || !this.started) { this.cam = { ...target }; this.camTarget = { ...target }; this.fly = null; this.kick(); return; }
    const path = zoomPath([this.cam.x, this.cam.y, this.w / this.cam.k], [target.x, target.y, this.w / target.k]);
    const natural = clamp(path.S * 1000 / Math.SQRT2 * 0.9, 450, 1300);
    this.fly = { start: performance.now(), duration: duration ?? natural, at: path.at };
    this.camTarget = { ...target };
    this.kick();
  }

  /** 점 하나로 날아간다. 지금보다 너무 멀리 있지 않으면 배율은 그대로 둔다. */
  reveal(id: string, zoom?: number) {
    const state = this.nodes.get(id);
    if (!state) return;
    const { top, right, bottom, left } = this.insets;
    const k = zoom ?? Math.max(this.cam.k, 1.05);
    this.flyTo({ x: state.to.x - (left - right) / 2 / k, y: state.to.y - (top - bottom) / 2 / k, k });
  }

  zoomBy(factor: number) {
    const k = clamp(this.camTarget.k * factor, 0.12, 4);
    this.fly = null;
    this.camTarget = { ...this.camTarget, k };
    this.kick();
  }

  /** 메모를 열 때: 점 속으로 파고들듯 다가간 뒤 끝난다. */
  dive(id: string): Promise<void> {
    const state = this.nodes.get(id);
    if (!state || this.reduced) return Promise.resolve();
    this.flyTo({ x: state.x, y: state.y, k: Math.max(3.2, this.cam.k * 2.6) }, 460);
    this.ripples.push({ id, start: performance.now() });
    return new Promise((resolve) => setTimeout(resolve, 360));
  }

  setSelected(id: string | null) {
    if (id === this.selected) return;
    this.selected = id;
    if (id && this.nodes.has(id) && !this.reduced) this.ripples.push({ id, start: performance.now() });
    this.kick();
  }
  setMatches(ids: Set<string> | null) { this.matches = ids; this.kick(); }
  setGroupLit(group: string | null) { this.groupLit = group; this.kick(); }
  setLabelsAlways(on: boolean) { this.labelsAlways = on; this.kick(); }
  setGlow(glow: Map<string, number> | null) { this.glow = glow; this.kick(); }
  /** 주제 묶음 번호로 색을 가른다(null이면 폴더 색). */
  setTopicColors(topics: Map<string, number> | null) {
    this.topics = topics;
    for (const state of this.nodes.values()) state.color = this.colorOf(state.node);
    this.kick();
  }
  topicColor(index: number) { return this.theme.palette[index % this.theme.palette.length]!; }
  setSpot(ids: Iterable<string> | null) { this.spot = ids ? new Set(ids) : null; this.kick(); }
  /** 에이전트 맥락의 점수를 칠한다. 씨앗에서 이웃으로 한 단계씩 번져 간다. */
  setHeat(scores: Map<string, number> | null, seeds: Iterable<string> = []) {
    if (!scores || !scores.size) { if (this.heat) { this.heat = null; this.kick(); } return; }
    const seedSet = new Set([...seeds].filter((id) => this.nodes.has(id)));
    const depth = new Map<string, number>();
    let frontier = [...seedSet];
    for (const id of frontier) depth.set(id, 0);
    for (let level = 1; frontier.length && level < 12; level++) {
      const next: string[] = [];
      for (const id of frontier) for (const other of this.around.get(id) ?? []) if (!depth.has(other) && (scores.get(other) ?? 0) > 0.02) { depth.set(other, level); next.push(other); }
      frontier = next;
    }
    let deepest = 0;
    for (const value of depth.values()) deepest = Math.max(deepest, value);
    // 같은 씨앗에서 점수만 바뀌면(한도·질의 손질) 물결을 다시 일으키지 않는다.
    const same = this.heat && this.heat.seeds.size === seedSet.size && [...seedSet].every((id) => this.heat!.seeds.has(id));
    this.heat = { scores, seeds: seedSet, depth, start: same ? this.heat!.start : performance.now(), span: this.reduced ? 0 : deepest * WAVE_STEP + WAVE_RISE };
    this.kick();
  }
  /** 두 점을 잇는 길을 그린다. 처음에서 끝으로 한 구간씩 그어진다. */
  setRoute(nodes: string[] | null, edges: string[] = []) {
    this.route = nodes && nodes.length ? { nodes, edges: new Set(edges), order: new Map(nodes.map((id, at) => [id, at])), start: performance.now() } : null;
    if (this.route && nodes!.length > 1) this.fit(760, false, nodes!);
    this.kick();
  }
  setLinkFrom(id: string | null) { this.linkFrom = id; this.kick(); }
  /** 점에서 파문을 일으킨다(새 연결이 생긴 두 끝 등). */
  pulse(ids: string[]) {
    if (this.reduced) return;
    const now = performance.now();
    for (const id of ids) if (this.nodes.has(id)) this.ripples.push({ id, start: now });
    this.kick();
  }
  /** 만든 순서대로 점이 하나씩 다시 나타난다(시간 흐름 재생). 태그·폴더는 처음 닿은 글과 함께 나온다. */
  replay() {
    if (!this.layout || !this.data || this.transition) return;
    const now = performance.now();
    const states = [...this.nodes.values()].filter((state) => state.visTo > 0 && !state.removed);
    const born = new Map<string, number>();
    for (const state of states) if (isDoc(state.node)) born.set(state.node.id, state.node.createdAt);
    for (const state of states) {
      if (isDoc(state.node)) continue;
      let first = Infinity;
      for (const other of this.around.get(state.node.id) ?? []) { const time = born.get(other); if (time !== undefined && isDoc(this.nodes.get(other)!.node)) first = Math.min(first, time); }
      born.set(state.node.id, Number.isFinite(first) ? first : state.node.createdAt);
    }
    states.sort((a, b) => born.get(a.node.id)! - born.get(b.node.id)! || (a.node.id < b.node.id ? -1 : 1));
    const span = this.reduced ? 0 : clamp(states.length * 110, 3200, 9000);
    states.forEach((state, at) => {
      state.vis = 0; state.appear = 0; state.visFrom = 0; state.visTo = 1; state.morph = 1;
      state.from = { x: state.x, y: state.y }; state.to = { x: state.x, y: state.y };
      state.delay = span * (at / Math.max(1, states.length - 1));
    });
    for (const state of this.edges.values()) {
      if (state.removed || state.visTo === 0) continue;
      state.vis = 0; state.visFrom = 0; state.draw = 0;
      state.drawAt = now + Math.max(state.s.delay, state.t.delay) + 240;
    }
    this.live = false;
    this.transition = { start: now, duration: this.reduced ? 0 : 620, spread: span };
    this.replaying = { start: now, span, steps: states.map((state) => ({ at: state.delay, time: born.get(state.node.id)!, doc: isDoc(state.node) })), docs: states.filter((state) => isDoc(state.node)).length };
    this.host.dataset.replaying = "";
    this.kick();
  }
  get isReplaying() { return this.replaying !== null; }
  /** 미니맵이 떠 있는가(테스트가 본다). */
  get miniShown() { return this.miniAlpha > 0.5; }
  /** 도구가 가리킨 점이 있는가(테스트가 본다). */
  get spotted() { return this.spot !== null; }

  /** 점의 화면 좌표(문서 기준). 테스트와 툴팁이 쓴다. */
  point(id: string) {
    const state = this.nodes.get(id);
    if (!state || state.visTo === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.project(state.x, state.y);
    return { x: rect.left + x, y: rect.top + y, r: this.screenRadius(state) };
  }
  /** 지금 보이는 점들(문서 순서). */
  visibleIds() { return [...this.nodes.values()].filter((state) => state.visTo > 0).map((state) => state.node.id); }
  get settled() { return this.raf === 0; }
  get camera() { return { ...this.cam }; }

  destroy() { cancelAnimationFrame(this.raf); this.raf = 0; }

  // ── 입력 ──────────────────────────────────────────────

  private project(x: number, y: number): [number, number] { return [(x - this.cam.x) * this.cam.k + this.w / 2, (y - this.cam.y) * this.cam.k + this.h / 2]; }
  private unproject(sx: number, sy: number): Vec { return { x: (sx - this.w / 2) / this.cam.k + this.cam.x, y: (sy - this.h / 2) / this.cam.k + this.cam.y }; }
  private screenRadius(state: NodeState) { return Math.max(1.5, state.r * Math.pow(this.cam.k, 0.6)); }

  /** 화면 좌표(캔버스 기준)에서 가장 가까운 점. 점 반지름보다 조금 넓게 잡는다. */
  hit(sx: number, sy: number): string | null {
    let best: string | null = null, bestD = Infinity;
    for (const state of this.nodes.values()) {
      if (state.visTo === 0 || state.vis < 0.4) continue;
      const [x, y] = this.project(state.x, state.y);
      const d = Math.hypot(x - sx, y - sy);
      const reach = this.screenRadius(state) + 6;
      if (d <= reach && d < bestD) { best = state.node.id; bestD = d; }
    }
    return best;
  }

  private local(event: PointerEvent | WheelEvent | MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  pointerDown(event: PointerEvent) {
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.entries()];
      this.pinch = { ids: [a![0], b![0]], distance: Math.hypot(a![1].x - b![1].x, a![1].y - b![1].y), k: this.cam.k, center: this.unproject(...this.local(event)) };
      this.pointer = null;
      return;
    }
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const [x, y] = this.local(event);
    if (this.miniAt(x, y)) { this.miniDrag = event.pointerId; this.pointer = null; this.miniMove(x, y); return; }
    const node = this.hit(x, y);
    this.fly = null;
    this.camTarget = { ...this.cam };
    this.pointer = { id: event.pointerId, x, y, downX: x, downY: y, node, moved: false, last: performance.now(), vx: 0, vy: 0 };
  }

  pointerMove(event: PointerEvent) {
    if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch) {
      const a = this.touches.get(this.pinch.ids[0]), b = this.touches.get(this.pinch.ids[1]);
      if (a && b) {
        const k = clamp(this.pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.distance), 0.12, 4);
        const rect = this.canvas.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
        this.cam = { k, x: this.pinch.center.x - (mx - this.w / 2) / k, y: this.pinch.center.y - (my - this.h / 2) / k };
        this.camTarget = { ...this.cam };
        this.kick();
      }
      return;
    }
    const [x, y] = this.local(event);
    const pointer = this.pointer;
    this.cursor = { x, y };
    if (this.miniDrag === event.pointerId) { this.miniMove(x, y); return; }
    if (this.linkFrom) this.kick();
    if (!pointer || pointer.id !== event.pointerId) {
      if (event.pointerType === "mouse") this.setHover(this.miniAt(x, y) ? null : this.hit(x, y));
      return;
    }
    if (!pointer.moved && Math.hypot(x - pointer.downX, y - pointer.downY) < 4) return;
    if (!pointer.moved) {
      pointer.moved = true;
      this.host.dataset.dragging = pointer.node ? "node" : "pan";
      if (pointer.node) this.grab(pointer.node);
    }
    const now = performance.now();
    const dt = Math.max(1, now - pointer.last);
    if (pointer.node) {
      const p = this.unproject(x, y);
      const state = this.nodes.get(pointer.node)!;
      state.x = p.x; state.y = p.y; state.to = { ...p }; state.from = { ...p };
      const sim = this.live ? this.sim?.index.get(pointer.node) : undefined;
      if (sim) { sim.fx = p.x; sim.fy = p.y; }
    } else {
      const dx = (x - pointer.x) / this.cam.k, dy = (y - pointer.y) / this.cam.k;
      this.cam.x -= dx; this.cam.y -= dy;
      this.camTarget = { ...this.cam };
      pointer.vx = lerp(pointer.vx, -dx / dt, 0.5); pointer.vy = lerp(pointer.vy, -dy / dt, 0.5);
    }
    pointer.x = x; pointer.y = y; pointer.last = now;
    this.kick();
  }

  pointerUp(event: PointerEvent) {
    this.touches.delete(event.pointerId);
    if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    if (this.miniDrag === event.pointerId) { this.miniDrag = null; return; }
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointer = null;
    delete this.host.dataset.dragging;
    if (!pointer.moved) { this.events.select(pointer.node); return; }
    if (pointer.node) this.release(pointer.node);
    else if (!this.reduced && performance.now() - pointer.last < 80) {
      // 끌던 속도로 조금 더 미끄러진다.
      this.camTarget = { ...this.cam, x: this.cam.x + pointer.vx * 220, y: this.cam.y + pointer.vy * 220 };
      this.kick();
    }
  }

  pointerLeave() { this.cursor = null; if (!this.pointer) this.setHover(null); }

  doubleClick(event: MouseEvent) {
    const [x, y] = this.local(event);
    const id = this.hit(x, y);
    if (id) this.events.open(id);
    else { const p = this.unproject(x, y); this.fly = null; this.zoomAt(p, this.cam.k * 1.8); }
  }

  wheel(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = this.local(event);
    const p = this.unproject(x, y);
    // 트랙패드 두 손가락 끌기는 옮기고, Ctrl(핀치)·마우스 휠은 확대한다.
    if (!event.ctrlKey && event.deltaMode === 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.5 && Math.abs(event.deltaX) > 0) {
      this.fly = null;
      this.camTarget = { ...this.camTarget, x: this.camTarget.x + event.deltaX / this.cam.k, y: this.camTarget.y + event.deltaY / this.cam.k };
      this.kick();
      return;
    }
    const scale = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.012 : 0.0018;
    this.fly = null;
    this.zoomAt(p, this.camTarget.k * Math.exp(-event.deltaY * scale), x, y);
  }

  private zoomAt(world: Vec, k: number, sx = this.w / 2, sy = this.h / 2) {
    const next = clamp(k, 0.12, 4);
    this.camTarget = { k: next, x: world.x - (sx - this.w / 2) / next, y: world.y - (sy - this.h / 2) / next };
    this.kick();
  }

  private grab(id: string) {
    if (this.live && this.sim) { this.sim.alphaTarget = 0.28; const node = this.sim.index.get(id); if (node) { node.fx = node.x; node.fy = node.y; } }
    this.kick();
  }
  private release(id: string) {
    const state = this.nodes.get(id);
    if (this.live && this.sim) {
      this.sim.alphaTarget = 0;
      const node = this.sim.index.get(id);
      if (node) { node.fx = null; node.fy = null; }
    } else if (state && this.layout) {
      // 고정 배치에서는 놓으면 제자리로 튕겨 돌아간다.
      const home = this.layout.positions.get(id);
      if (home) {
        state.from = { x: state.x, y: state.y }; state.to = { ...home }; state.delay = 0;
        this.transition = { start: performance.now(), duration: this.reduced ? 0 : 620, spread: 0 };
        for (const other of this.nodes.values()) if (other !== state) { other.from = { x: other.x, y: other.y }; other.to = { x: other.x, y: other.y }; other.visFrom = other.vis; }
      }
    }
    this.kick();
  }

  private setHover(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    if (id) this.host.dataset.hover = id; else delete this.host.dataset.hover;
    this.events.hover(id);
    this.kick();
  }

  /** 키보드로 방향을 누르면 그쪽에서 가장 가까운 점을 고른다. */
  nearestIn(from: string | null, dx: number, dy: number): string | null {
    const start = from ? this.nodes.get(from) : null;
    if (!start) {
      let best: NodeState | null = null;
      for (const state of this.nodes.values()) if (state.visTo > 0 && (!best || Math.hypot(state.to.x, state.to.y) < Math.hypot(best.to.x, best.to.y))) best = state;
      return best?.node.id ?? null;
    }
    let best: string | null = null, score = Infinity;
    for (const state of this.nodes.values()) {
      if (state === start || state.visTo === 0) continue;
      const vx = state.to.x - start.to.x, vy = state.to.y - start.to.y;
      const d = Math.hypot(vx, vy);
      if (!d) continue;
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.35) continue;
      const value = d * (2 - cos);
      if (value < score) { score = value; best = state.node.id; }
    }
    return best;
  }

  /** 점이 화면 밖이면 보이도록 옮긴다. */
  ensureVisible(id: string) {
    const state = this.nodes.get(id);
    if (!state) return;
    const [x, y] = this.project(state.to.x, state.to.y);
    const { top, right, bottom, left } = this.insets;
    if (x < left + 40 || x > this.w - right - 40 || y < top + 40 || y > this.h - bottom - 40) this.reveal(id, this.cam.k);
  }

  // ── 프레임 ────────────────────────────────────────────

  kick() {
    this.quiet = 0;
    delete this.host.dataset.settled;
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
  }

  private loop = (now: number) => {
    const dt = Math.min(64, Math.max(1, now - this.last));
    this.last = now;
    this.ambient = false;
    const busy = this.step(now, dt);
    if (![this.cam.x, this.cam.y, this.cam.k].every(Number.isFinite)) { this.cam = { x: 0, y: 0, k: 1 }; this.camTarget = { ...this.cam }; this.fly = null; }
    this.draw(now);
    this.quiet = busy ? 0 : this.quiet + 1;
    if (busy && "settled" in this.host.dataset) delete this.host.dataset.settled;
    if (this.quiet > 2) {
      if (!("settled" in this.host.dataset)) this.host.dataset.settled = "";
      if (!this.ambient) { this.raf = 0; return; }
    }
    this.raf = requestAnimationFrame(this.loop);
  };
  /** 이번 프레임에 움직이는 장식(빛 알갱이·검색 깜빡임)이 있는가. 있으면 쉬지 않지만 「멎음」으로 친다. */
  private ambient = false;

  private step(now: number, dt: number): boolean {
    let busy = false;
    const reduced = this.reduced;
    const tr = this.transition;
    if (tr) {
      let done = true;
      for (const state of this.nodes.values()) {
        const p = tr.duration ? clamp((now - tr.start - state.delay) / tr.duration) : 1;
        if (p < 1) done = false;
        const e = easeInOut(p);
        if (!this.live) { state.x = lerp(state.from.x, state.to.x, e); state.y = lerp(state.from.y, state.to.y, e); }
        if (state.visTo >= state.visFrom) {
          const q = clamp(p * 1.5);
          state.vis = lerp(state.visFrom, state.visTo, easeOut(q));
          state.appear = state.visFrom >= 0.99 ? 1 : easeBack(q);
        } else {
          const q = clamp(p * 2.4);
          state.vis = lerp(state.visFrom, state.visTo, easeOut(q));
          state.appear = 1 - easeOut(q) * 0.6;
        }
        state.morph = p;
      }
      if (done) {
        this.transition = null;
        for (const state of this.nodes.values()) { state.vis = state.visFrom = state.visTo; state.appear = state.visTo ? 1 : 0; state.morph = 1; state.angleFrom = state.angleTo; }
        for (const state of this.edges.values()) { state.vis = state.visFrom = state.visTo; state.styleFrom = state.styleTo; }
        for (const [id, state] of this.nodes) if (state.removed && state.vis === 0) this.nodes.delete(id);
        if (this.view === "network" && this.sim) {
          this.live = true;
          // 미리 돌려 둔 자리에서 이어 아주 조금 더 가라앉는다(살아 있는 느낌).
          for (const node of this.sim.nodes) { const state = this.nodes.get(node.id); if (state) { node.x = state.x; node.y = state.y; } }
          if (this.sim.alpha < 0.05) this.sim.alpha = reduced ? 0 : 0.05;
        }
      }
      busy = true;
    }
    if (this.live && this.sim && this.view === "network") {
      const dragging = this.pointer?.moved && this.pointer.node;
      if (reduced && !dragging) { this.sim.run(this.sim.alphaMin, 300); }
      if (!this.sim.settled || dragging) {
        // 시뮬레이션은 초당 60번을 기준으로 돈다. 프레임이 느리면 한 프레임에 여러 번 돌려 실제 시간 안에 가라앉게 한다.
        const ticks = dragging ? 1 : Math.min(4, Math.max(1, Math.round(dt / 16.7)));
        for (let i = 0; i < ticks && (!this.sim.settled || dragging); i++) this.sim.tick();
        busy = true;
      }
      for (const node of this.sim.nodes) {
        const state = this.nodes.get(node.id);
        if (!state || (dragging && node.id === this.pointer?.node)) continue;
        state.x = node.x; state.y = node.y; state.to = { x: node.x, y: node.y };
        this.forceCache.set(node.id, { x: node.x, y: node.y });
      }
    }
    for (const state of this.edges.values()) {
      const p = tr && tr.duration ? clamp((now - tr.start - Math.max(state.s.delay, state.t.delay)) / tr.duration) : 1;
      state.vis = lerp(state.visFrom, state.visTo, state.visTo > state.visFrom ? easeOut(clamp(p * 1.2)) : easeOut(clamp(p * 2.4)));
      if (!tr) state.vis = state.visTo;
      if (state.visTo > 0 && state.draw < 1) {
        state.draw = reduced ? 1 : clamp((now - state.drawAt) / 480);
        busy = true;
      }
    }
    if (!tr) for (const [id, state] of this.edges) if (state.removed && state.vis === 0) this.edges.delete(id);

    // 카메라.
    if (this.fly) {
      const p = clamp((now - this.fly.start) / this.fly.duration);
      const [x, y, w] = this.fly.at(easeInOut(p));
      this.cam = { x, y, k: this.w / w };
      if (p >= 1) { this.cam = { ...this.camTarget }; this.fly = null; }
      busy = true;
    } else if (!this.pointer?.moved || this.pointer.node) {
      const f = reduced ? 1 : 1 - Math.exp(-dt / 90);
      const before = { ...this.cam };
      // 확대는 비율로 다가가야 커서 아래 점이 흔들리지 않는다.
      this.cam.k = Math.exp(lerp(Math.log(this.cam.k), Math.log(this.camTarget.k), f));
      this.cam.x = lerp(this.cam.x, this.camTarget.x, f);
      this.cam.y = lerp(this.cam.y, this.camTarget.y, f);
      if (Math.abs(before.k - this.cam.k) > 1e-4 || Math.abs(before.x - this.cam.x) * this.cam.k > 0.05 || Math.abs(before.y - this.cam.y) * this.cam.k > 0.05) busy = true;
      else this.cam = { ...this.camTarget };
    }

    // 강조(마우스를 올린 점과 이웃만 밝게), 튀어 오름, 이름표.
    const focus = this.hovered ?? this.selected;
    const lit = focus ? this.around.get(focus) ?? new Set<string>() : null;
    const floor = this.hovered ? 0 : this.view === "focus" ? 1 : 0.45;
    const f = reduced ? 1 : 1 - Math.exp(-dt / 110);
    // 도구가 칠한 강조(길·맥락·가리킨 점). 켜져 있는 동안에는 마우스를 올리거나 점을 골라도 이 강조를 덮지 않는다(올린 점은 튀어 오르고 이름표만 뜬다).
    const overlay = this.route || this.heat || this.spot;
    if (this.heat && now - this.heat.start < this.heat.span) busy = true;
    for (const state of this.nodes.values()) {
      const id = state.node.id;
      let target = 1;
      if (overlay) target = this.route ? (this.route.order.has(id) ? 1 : 0) : this.heat ? this.heatLevel(id, now) : this.spot!.has(id) ? 1 : 0;
      else if (focus) target = id === focus || lit!.has(id) ? 1 : floor;
      if (this.matches) target = Math.min(target, this.matches.has(id) ? 1 : 0);
      if (this.groupLit) target = Math.min(target, state.node.group === this.groupLit ? 1 : 0);
      if (Math.abs(target - state.hl) > 0.002) { state.hl = lerp(state.hl, target, f); busy = true; } else state.hl = target;
      const pop = id === this.hovered ? 1 : id === this.selected ? 0.55 : 0;
      if (reduced) { state.pop = pop; state.popV = 0; } else {
        // 살짝 튀는 스프링. 느린 프레임에서도 발산하지 않게 8ms씩 나눠 계산한다(반암시적 오일러).
        for (let left = dt; left > 0; left -= 8) {
          const h = Math.min(8, left) / 1000;
          state.popV += ((pop - state.pop) * 420 - state.popV * 24) * h;
          state.pop += state.popV * h;
        }
        if (Math.abs(pop - state.pop) > 0.002 || Math.abs(state.popV) > 0.01) busy = true; else { state.pop = pop; state.popV = 0; }
      }
    }
    for (const state of this.edges.values()) {
      let target = 1;
      if (overlay) target = this.route ? (this.route.edges.has(state.edge.id) ? 1 : 0) : this.heat ? Math.min(this.heatLevel(state.s.node.id, now), this.heatLevel(state.t.node.id, now))
        : this.spot!.has(state.s.node.id) && this.spot!.has(state.t.node.id) ? 1 : 0;
      else if (focus) target = state.s.node.id === focus || state.t.node.id === focus ? 1 : this.hovered ? 0 : this.view === "focus" ? 0.7 : 0.35;
      if (this.matches) target = Math.min(target, this.matches.has(state.s.node.id) && this.matches.has(state.t.node.id) ? 1 : 0);
      if (this.groupLit) target = Math.min(target, state.s.node.group === this.groupLit && state.t.node.group === this.groupLit ? 1 : 0);
      if (Math.abs(target - state.hl) > 0.002) { state.hl = lerp(state.hl, target, f); busy = true; } else state.hl = target;
    }
    this.ripples = this.ripples.filter((ripple) => now - ripple.start < 900);
    if (this.ripples.length) busy = true;
    // 고른 점의 선 위로 흐르는 입자와 검색에 걸린 점의 깜빡임은 그동안 계속 움직인다.
    if (!reduced && !document.hidden && ((focus && lit && lit.size) || this.matches?.size || this.route || this.heat || this.linkFrom)) this.ambient = true;
    // 미니맵은 보이는 점 가운데 화면 밖으로 나간 것이 있을 때만 떠오른다.
    let outside = false;
    if (this.w > 640 && this.nodes.size >= 8 && !this.replaying) {
      for (const state of this.nodes.values()) {
        if (state.visTo === 0) continue;
        const [x, y] = this.project(state.x, state.y);
        if (x < -4 || y < -4 || x > this.w + 4 || y > this.h + 4) { outside = true; break; }
      }
    }
    const miniTarget = outside || this.miniDrag !== null ? 1 : 0;
    if (Math.abs(miniTarget - this.miniAlpha) > 0.01) { this.miniAlpha = reduced ? miniTarget : lerp(this.miniAlpha, miniTarget, 1 - Math.exp(-dt / 140)); busy = true; } else this.miniAlpha = miniTarget;
    if (this.replaying && now - this.replaying.start > this.replaying.span + 1400) { this.replaying = null; delete this.host.dataset.replaying; this.events.replayed?.(); }
    if (this.replaying) busy = true;
    if (this.hovered) {
      const state = this.nodes.get(this.hovered);
      if (state) {
        const [x, y] = this.project(state.x, state.y);
        this.host.style.setProperty("--tip-x", `${x.toFixed(1)}px`);
        this.host.style.setProperty("--tip-y", `${(y - this.screenRadius(state) * (1 + 0.3 * state.pop) - 10).toFixed(1)}px`);
      }
    }
    return busy;
  }

  /** 맥락 점수가 이 점을 얼마나 밝히는가(0..1). 씨앗에서 먼 점일수록 조금 늦게 밝아진다. */
  private heatLevel(id: string, now: number) {
    const heat = this.heat!;
    const score = heat.scores.get(id) ?? 0;
    if (score <= 0.02) return 0;
    const wave = heat.span ? clamp((now - heat.start - (heat.depth.get(id) ?? 0) * WAVE_STEP) / WAVE_RISE) : 1;
    return (0.2 + 0.8 * Math.sqrt(score)) * easeOut(wave);
  }

  // ── 그리기 ────────────────────────────────────────────

  private draw(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.data) return;
    this.reserved = [];
    this.drawGrid();
    const tr = this.transition;
    const progress = tr ? (tr.duration ? easeInOut(clamp((now - tr.start) / (tr.duration + tr.spread))) : 1) : 1;
    if (this.prevDecor && progress < 1) this.drawDecor(this.prevDecor, 1 - progress, this.layout?.view === "network");
    if (this.layout) this.drawDecor(this.layout.decor, this.prevDecor ? progress : 1, this.layout.view === "network");
    if (!tr) this.prevDecor = null;
    this.drawHalos(now);
    this.drawEdges(now);
    this.drawRoute(now);
    this.drawNodes(now);
    this.drawLabels();
    this.drawRipples(now);
    this.drawLinking(now);
    this.drawReplay(now);
    this.drawMinimap();
  }

  private miniAt(x: number, y: number) {
    const mini = this.mini;
    return Boolean(mini && this.miniAlpha > 0.5 && x >= mini.x && x <= mini.x + mini.w && y >= mini.y && y <= mini.y + mini.h);
  }
  /** 미니맵에서 누른 자리가 화면 가운데에 오게 한다. */
  private miniMove(x: number, y: number) {
    const mini = this.mini;
    if (!mini) return;
    this.fly = null;
    this.camTarget = { ...this.camTarget, x: mini.ox + (x - mini.x) / mini.scale, y: mini.oy + (y - mini.y) / mini.scale };
    this.kick();
  }

  /** 전체 모양과 지금 보는 자리를 작은 창에 그린다. */
  private drawMinimap() {
    if (this.miniAlpha < 0.02 || !this.layout) { if (this.miniAlpha < 0.02) this.mini = null; return; }
    const ctx = this.ctx, { fg, bg, accent, dark } = this.theme;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const state of this.nodes.values()) { if (state.visTo === 0) continue; x0 = Math.min(x0, state.x); y0 = Math.min(y0, state.y); x1 = Math.max(x1, state.x); y1 = Math.max(y1, state.y); }
    if (!Number.isFinite(x0)) return;
    const w = 148, h = 100, pad = 10;
    const { right } = this.insets;
    // 카드가 열려 있으면 그 왼쪽에, 아니면 오른쪽 가장자리에 붙인다(아래의 확대 단추 위).
    const x = this.w - right - w + (right > 24 ? 0 : 12), y = this.h - 62 - h;
    const scale = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
    // 세계 좌표 (ox, oy)가 미니맵의 왼쪽 위 모서리에 온다.
    const ox = (x0 + x1) / 2 - w / 2 / scale, oy = (y0 + y1) / 2 - h / 2 / scale;
    this.mini = { x, y, w, h, ox, oy, scale };
    const alpha = this.miniAlpha;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${(dark ? 0.45 : 0.16) * alpha})`; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = rgba(bg, (dark ? 0.82 : 0.9) * alpha);
    this.roundRect(x, y + (1 - alpha) * 8, w, h, 14);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(fg, 0.12 * alpha); ctx.stroke();
    ctx.clip();
    const top = y + (1 - alpha) * 8;
    for (const state of this.nodes.values()) {
      if (state.vis < 0.05) continue;
      ctx.fillStyle = rgba(state.color, 0.9 * alpha * state.vis);
      ctx.beginPath(); ctx.arc(x + (state.x - ox) * scale, top + (state.y - oy) * scale, isContainer(state.node) ? 2.1 : 1.7, 0, Math.PI * 2); ctx.fill();
    }
    // 지금 화면이 덮는 자리.
    const a = this.unproject(0, 0), b = this.unproject(this.w, this.h);
    const vx = x + (a.x - ox) * scale, vy = top + (a.y - oy) * scale, vw = (b.x - a.x) * scale, vh = (b.y - a.y) * scale;
    ctx.fillStyle = rgba(accent, 0.12 * alpha);
    ctx.strokeStyle = rgba(accent, 0.9 * alpha); ctx.lineWidth = 1.5;
    this.roundRect(vx, vy, vw, vh, Math.min(4, vw / 2, vh / 2));
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** 점 둘레의 빛무리: 중요한 메모는 늘 옅게, 맥락에 든 메모는 점수만큼 밝게. 점보다 먼저 그려 선과 점 아래에 깔린다. */
  private drawHalos(now: number) {
    if (!this.glow && !this.heat) return;
    const ctx = this.ctx, { dark, accent } = this.theme;
    const overlay = this.route || this.heat || this.spot;
    const dimming = Boolean(this.hovered ?? this.selected) || Boolean(this.matches || this.groupLit || overlay);
    for (const state of this.nodes.values()) {
      if (state.vis < 0.05 || !isDoc(state.node)) continue;
      const id = state.node.id;
      const heat = this.heat ? this.heatLevel(id, now) * ((this.heat.scores.get(id) ?? 0) > 0.02 ? 1 : 0) : 0;
      const glow = this.heat ? 0 : this.glow?.get(id) ?? 0;
      const level = this.heat ? heat : glow > 0.3 ? (glow - 0.3) / 0.7 : 0;
      if (level < 0.04) continue;
      const [x, y] = this.project(state.x, state.y);
      const r = this.screenRadius(state) * Math.max(0, state.appear);
      const reach = r * (this.heat ? 2.4 + 2.2 * level : 2.1 + 1.5 * level) + 6;
      if (x < -reach || y < -reach || x > this.w + reach || y > this.h + reach) continue;
      const fade = state.vis * (dimming && !this.heat ? lerp(0.12, 1, state.hl) : 1);
      const color = this.heat ? accent : state.color;
      const strength = (this.heat ? (dark ? 0.42 : 0.3) : (dark ? 0.26 : 0.17)) * level * fade;
      const gradient = ctx.createRadialGradient(x, y, r * 0.6, x, y, reach);
      gradient.addColorStop(0, rgba(color, strength));
      gradient.addColorStop(0.45, rgba(color, strength * 0.36));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(x, y, reach, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** 길: 처음에서 끝으로 한 구간씩 굵은 빛줄기가 그어지고, 그 위로 빛 알갱이가 달린다. */
  private drawRoute(now: number) {
    const route = this.route;
    if (!route) return;
    const ctx = this.ctx, { accent } = this.theme;
    const tr = this.transition;
    const widthScale = clamp(Math.sqrt(this.cam.k), 0.7, 1.4);
    const segments: Array<{ at: number; p0: Vec; p1: Vec; c: [number, number, number, number] }> = [];
    for (const state of this.edges.values()) {
      if (!route.edges.has(state.edge.id) || state.vis < 0.05) continue;
      const a = route.order.get(state.s.node.id), b = route.order.get(state.t.node.id);
      if (a === undefined || b === undefined) continue;
      const [sx, sy] = this.project(state.s.x, state.s.y), [tx, ty] = this.project(state.t.x, state.t.y);
      const blend = tr && tr.duration ? easeInOut(clamp((now - tr.start - Math.max(state.s.delay, state.t.delay)) / tr.duration)) : 1;
      const c = this.controls(state, sx, sy, tx, ty, blend);
      // 길을 따라가는 방향으로 맞춘다(조절점을 맞바꾸면 같은 곡선이 거꾸로 된다).
      segments.push(a <= b ? { at: Math.min(a, b), p0: { x: sx, y: sy }, p1: { x: tx, y: ty }, c } : { at: Math.min(a, b), p0: { x: tx, y: ty }, p1: { x: sx, y: sy }, c: [c[2], c[3], c[0], c[1]] });
    }
    if (!segments.length) return;
    segments.sort((x, y) => x.at - y.at);
    ctx.save();
    ctx.lineCap = "round";
    const point = (seg: (typeof segments)[number], t: number): Vec => {
      const u = 1 - t;
      return { x: u * u * u * seg.p0.x + 3 * u * u * t * seg.c[0] + 3 * u * t * t * seg.c[2] + t * t * t * seg.p1.x, y: u * u * u * seg.p0.y + 3 * u * u * t * seg.c[1] + 3 * u * t * t * seg.c[3] + t * t * t * seg.p1.y };
    };
    segments.forEach((seg, index) => {
      const shown = this.reduced ? 1 : easeOut(clamp((now - route.start - index * 240) / 380));
      if (shown <= 0) return;
      for (const [width, alpha, blur] of [[7, 0.16, 0], [2.6, 0.95, 10]] as const) {
        ctx.strokeStyle = rgba(accent, alpha);
        ctx.lineWidth = width * widthScale;
        ctx.shadowColor = rgba(accent, 0.8); ctx.shadowBlur = blur;
        ctx.beginPath(); ctx.moveTo(seg.p0.x, seg.p0.y);
        const steps = Math.max(2, Math.round(24 * shown));
        for (let i = 1; i <= steps; i++) { const q = point(seg, (i / steps) * shown); ctx.lineTo(q.x, q.y); }
        ctx.stroke();
      }
    });
    ctx.shadowBlur = 0;
    if (!this.reduced && now - route.start > segments.length * 240 + 200) {
      // 처음에서 끝까지 달리는 빛 알갱이.
      const lap = segments.length * 620 + 500;
      const phase = ((now - route.start) % lap) / 620;
      const index = Math.floor(phase);
      if (index < segments.length) {
        for (let tail = 0; tail < 6; tail++) {
          const t = phase - index - tail * 0.035;
          if (t < 0) break;
          const q = point(segments[index]!, easeInOut(t));
          ctx.fillStyle = tail ? rgba(accent, 0.5 - tail * 0.08) : "rgba(255,255,255,0.96)";
          ctx.beginPath(); ctx.arc(q.x, q.y, (tail ? 3.2 - tail * 0.4 : 3.4) * widthScale, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** 연결을 만드는 중: 고른 메모에서 커서(올린 점이 있으면 그 점)까지 점선을 잇는다. */
  private drawLinking(now: number) {
    const from = this.linkFrom ? this.nodes.get(this.linkFrom) : null;
    if (!from || from.vis < 0.2) return;
    const target = this.hovered && this.hovered !== this.linkFrom ? this.nodes.get(this.hovered) : null;
    const [x0, y0] = this.project(from.x, from.y);
    const end = target ? this.project(target.x, target.y) : this.cursor ? [this.cursor.x, this.cursor.y] as [number, number] : null;
    const ctx = this.ctx, { accent } = this.theme;
    ctx.save();
    ctx.strokeStyle = rgba(accent, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x0, y0, this.screenRadius(from) + 6, 0, Math.PI * 2); ctx.stroke();
    if (end) {
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = this.reduced ? 0 : -now / 28;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(end[0], end[1]); ctx.stroke();
      ctx.setLineDash([]);
      if (target) { ctx.beginPath(); ctx.arc(end[0], end[1], this.screenRadius(target) + 6, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.fillStyle = rgba(accent, 0.95); ctx.beginPath(); ctx.arc(end[0], end[1], 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  /** 재생 중: 지금 어느 날까지 왔는지와 나타난 글의 수. */
  private drawReplay(now: number) {
    const replay = this.replaying;
    if (!replay) return;
    const elapsed = now - replay.start;
    let shown = 0, time = 0;
    for (const step of replay.steps) { if (step.at > elapsed) break; if (step.doc) { shown++; time = step.time; } }
    if (!time) return;
    const date = new Date(time);
    const text = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}  ·  ${shown} / ${replay.docs}`;
    const { left, right, bottom } = this.insets;
    const fade = clamp(elapsed / 300) * clamp((replay.span + 1400 - elapsed) / 400);
    this.pill(text, (left + this.w - right) / 2, this.h - bottom - 22, fade, 13);
  }

  /** 세계 좌표에 붙은 점 격자. 끌거나 확대하면 함께 움직인다. */
  private drawGrid() {
    const ctx = this.ctx;
    let step = 36 * this.cam.k;
    while (step < 18) step *= 2;
    while (step > 72) step /= 2;
    const size = Math.round(step * this.dpr);
    const key = `${size}:${this.theme.dark}`;
    if (this.gridTile?.key !== key) {
      const tile = document.createElement("canvas");
      tile.width = size; tile.height = size;
      const tctx = tile.getContext("2d")!;
      tctx.fillStyle = rgba(this.theme.fg, this.theme.dark ? 0.085 : 0.1);
      tctx.beginPath(); tctx.arc(size / 2, size / 2, Math.max(0.7, 0.9 * this.dpr), 0, Math.PI * 2); tctx.fill();
      const pattern = ctx.createPattern(tile, "repeat");
      if (!pattern) return;
      this.gridTile = { key, pattern };
    }
    const [ox, oy] = this.project(0, 0);
    const scale = step / (size / this.dpr) / this.dpr;
    this.gridTile.pattern.setTransform(new DOMMatrix().translateSelf(((ox % step) + step) % step - step / 2, ((oy % step) + step) % step - step / 2).scaleSelf(scale, scale));
    ctx.fillStyle = this.gridTile.pattern;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawDecor(decor: Decor, alpha: number, network: boolean) {
    if (alpha <= 0.01) return;
    const ctx = this.ctx, k = this.cam.k, { fg, dark } = this.theme;
    const [ox, oy] = this.project(0, 0);
    ctx.save();
    if (network) this.drawNebula(alpha);
    if (decor.kind === "rings") {
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      for (const ring of decor.rings) {
        ctx.strokeStyle = rgba(fg, (dark ? 0.13 : 0.14) * alpha);
        ctx.beginPath(); ctx.arc(ox, oy, ring.r * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const ring of decor.rings) this.pill(ring.label, ox, oy - ring.r * k, alpha * 0.9, 10.5);
    } else if (decor.kind === "tree") {
      const outer = (decor.outer + 112) * k;
      for (const sector of decor.sectors) {
        const color = this.groupColor(sector.group);
        const gradient = ctx.createRadialGradient(ox, oy, decor.outer * k * 0.25, ox, oy, outer);
        gradient.addColorStop(0, rgba(color, 0));
        gradient.addColorStop(0.72, rgba(color, (dark ? 0.1 : 0.075) * alpha));
        gradient.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, outer, sector.start + 0.004, sector.end - 0.004); ctx.closePath(); ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = rgba(fg, 0.1 * alpha);
      for (const r of [...decor.rings, decor.outer]) { ctx.beginPath(); ctx.arc(ox, oy, r * k, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
      // 가운데 표지.
      const r = Math.max(10, 15 * Math.pow(k, 0.6));
      ctx.fillStyle = rgba(this.theme.bg, 0.9 * alpha);
      ctx.strokeStyle = rgba(this.theme.accent, 0.7 * alpha);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(this.theme.accent, 0.95 * alpha);
      ctx.beginPath(); ctx.arc(ox, oy, r * 0.36, 0, Math.PI * 2); ctx.fill();
      this.pill("모든 메모", ox, oy + r + 14, alpha, 11);
    } else if (decor.kind === "bubbles") {
      for (const bubble of decor.bubbles) {
        const [x, y] = this.project(bubble.x, bubble.y);
        const r = bubble.r * k;
        const color = bubble.group ? this.groupColor(bubble.group) : this.theme.accent;
        const gradient = ctx.createRadialGradient(x, y - r * 0.4, r * 0.1, x, y, r);
        gradient.addColorStop(0, rgba(color, (dark ? 0.16 : 0.11) * alpha));
        gradient.addColorStop(1, rgba(color, (dark ? 0.05 : 0.04) * alpha));
        ctx.fillStyle = gradient;
        ctx.strokeStyle = rgba(color, (dark ? 0.34 : 0.3) * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      for (const bubble of [...decor.bubbles].sort((a, b) => b.count - a.count)) {
        const [x, y] = this.project(bubble.x, bubble.y);
        const color = bubble.group ? this.groupColor(bubble.group) : this.theme.accent;
        this.caption(bubble.label, `${bubble.count}`, x, y - bubble.r * k - 12, color, alpha);
      }
    } else if (decor.kind === "lanes") {
      const [x0] = this.project(decor.x0 - 60, 0);
      const [x1] = this.project(decor.x1 + 30, 0);
      decor.lanes.forEach((lane, index) => {
        const [, y] = this.project(0, lane.y - lane.height / 2);
        const height = lane.height * k;
        const color = this.groupColor(lane.group);
        ctx.fillStyle = rgba(index % 2 ? fg : color, (index % 2 ? 0.025 : dark ? 0.055 : 0.045) * alpha);
        this.roundRect(x0, y + 3, x1 - x0, height - 6, Math.min(14, height / 3));
        ctx.fill();
        this.legendLabel(lane.label, x0 + 12, y + 16, color, alpha);
      });
      const last = decor.lanes[decor.lanes.length - 1];
      if (last) {
        const [, axisY] = this.project(0, last.y + last.height / 2 + 14);
        ctx.strokeStyle = rgba(fg, 0.18 * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, axisY); ctx.lineTo(x1, axisY); ctx.stroke();
        ctx.font = `500 ${10.5 * this.theme.scale}px ${this.theme.font}`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (const tick of decor.ticks) {
          const [x] = this.project(tick.x, 0);
          ctx.strokeStyle = rgba(fg, (tick.major ? 0.32 : 0.2) * alpha);
          ctx.beginPath(); ctx.moveTo(x, axisY - 3); ctx.lineTo(x, axisY + 3); ctx.stroke();
          ctx.setLineDash([2, 5]);
          ctx.strokeStyle = rgba(fg, 0.06 * alpha);
          const [, top] = this.project(0, decor.lanes[0]!.y - decor.lanes[0]!.height / 2);
          ctx.beginPath(); ctx.moveTo(x, top + 4); ctx.lineTo(x, axisY - 4); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = rgba(fg, (tick.major ? 0.72 : 0.5) * alpha);
          ctx.fillText(tick.label, x, axisY + 7);
        }
      }
    }
    ctx.restore();
  }

  /** 관계망 보기: 같은 폴더 묶음의 무게중심에 은은한 빛무리를 깐다(점이 움직이면 따라간다). */
  private drawNebula(alpha: number) {
    const ctx = this.ctx;
    const sums = new Map<string, { x: number; y: number; n: number; points: Vec[] }>();
    for (const state of this.nodes.values()) {
      if (state.vis < 0.3 || state.node.group === TAG_GROUP) continue;
      const entry = sums.get(state.node.group) ?? { x: 0, y: 0, n: 0, points: [] };
      entry.x += state.x; entry.y += state.y; entry.n++; entry.points.push(state);
      sums.set(state.node.group, entry);
    }
    for (const [group, entry] of sums) {
      if (entry.n < 3) continue;
      const cx = entry.x / entry.n, cy = entry.y / entry.n;
      const spread = Math.sqrt(entry.points.reduce((sum, p) => sum + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / entry.n);
      const [x, y] = this.project(cx, cy);
      const r = (spread * 1.55 + 40) * this.cam.k;
      const color = this.groupColor(group);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, rgba(color, (this.theme.dark ? 0.13 : 0.085) * alpha));
      gradient.addColorStop(0.6, rgba(color, (this.theme.dark ? 0.05 : 0.035) * alpha));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** 선의 두 조절점(화면 좌표). 모양이 바뀌는 동안에는 두 모양 사이를 잇는다. */
  private controls(state: EdgeState, x0: number, y0: number, x1: number, y1: number, blend: number): [number, number, number, number] {
    const a = this.shape(state.styleFrom, state, x0, y0, x1, y1);
    if (blend >= 1 || state.styleFrom === state.styleTo) return blend >= 1 ? this.shape(state.styleTo, state, x0, y0, x1, y1) : a;
    const b = this.shape(state.styleTo, state, x0, y0, x1, y1);
    return [lerp(a[0], b[0], blend), lerp(a[1], b[1], blend), lerp(a[2], b[2], blend), lerp(a[3], b[3], blend)];
  }
  private shape(style: EdgeStyle, state: EdgeState, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const dx = x1 - x0, dy = y1 - y0;
    if (style === "arc") {
      const bend = (state.edge.kind === "folder" ? 0.06 : 0.14) * (state.seed > 0.5 ? 1 : -1);
      return [x0 + dx / 3 - dy * bend, y0 + dy / 3 + dx * bend, x0 + (2 * dx) / 3 - dy * bend, y0 + (2 * dy) / 3 + dx * bend];
    }
    const [ox, oy] = this.project(0, 0);
    if (style === "radial") {
      const a0 = Math.atan2(y0 - oy, x0 - ox), a1 = Math.atan2(y1 - oy, x1 - ox);
      const r0 = Math.hypot(x0 - ox, y0 - oy), r1 = Math.hypot(x1 - ox, y1 - oy), rm = (r0 + r1) / 2;
      return [ox + Math.cos(a0) * rm, oy + Math.sin(a0) * rm, ox + Math.cos(a1) * rm, oy + Math.sin(a1) * rm];
    }
    if (style === "bundle") {
      const pull = 0.3;
      return [ox + (x0 - ox) * pull, oy + (y0 - oy) * pull, ox + (x1 - ox) * pull, oy + (y1 - oy) * pull];
    }
    const lift = Math.min(180, Math.abs(dx) * 0.32 + 24) * Math.min(1.4, this.cam.k);
    return [x0 + dx * 0.15, y0 - lift, x1 - dx * 0.15, y1 - lift];
  }

  private drawEdges(now: number) {
    const ctx = this.ctx, k = this.cam.k, { fg, accent } = this.theme;
    const focus = this.hovered ?? this.selected;
    const overlay = this.route || this.heat || this.spot;
    const tr = this.transition;
    const widthScale = clamp(Math.sqrt(k), 0.65, 1.35);
    ctx.lineCap = "round";
    const wave: Array<{ state: EdgeState; c: [number, number, number, number]; p0: Vec; p1: Vec; t: number }> = [];
    const lit: Array<{ state: EdgeState; c: [number, number, number, number]; p0: Vec; p1: Vec }> = [];
    for (const state of this.edges.values()) {
      const base = state.vis * Math.min(state.s.vis, state.t.vis);
      if (base < 0.01 || state.draw <= 0) continue;
      const look = EDGE_LOOK[state.edge.kind];
      const [x0, y0] = this.project(state.s.x, state.s.y), [x1, y1] = this.project(state.t.x, state.t.y);
      const blend = tr && tr.duration ? easeInOut(clamp((now - tr.start - Math.max(state.s.delay, state.t.delay)) / tr.duration)) : 1;
      const c = this.controls(state, x0, y0, x1, y1, blend);
      const isLit = !overlay && focus !== null && (state.s.node.id === focus || state.t.node.id === focus);
      const dim = focus || this.matches || this.groupLit || overlay ? lerp(0.07, 1, state.hl) : 1;
      // 맥락에 든 두 점 사이의 선은 맥락 색으로 밝힌다.
      const warm = overlay && this.heat ? Math.min(this.heat.scores.get(state.s.node.id) ?? 0, this.heat.scores.get(state.t.node.id) ?? 0) : 0;
      const color = isLit ? (focus === state.s.node.id ? state.s.color : state.t.color)
        : warm > 0.05 ? accent : state.edge.kind === "folder" ? state.t.color : state.edge.kind === "similar" ? accent : state.edge.kind === "chain" ? state.s.color : fg;
      const alpha = base * dim * (isLit ? 0.9 : warm > 0.05 ? 0.4 + 0.5 * Math.sqrt(warm) : look.alpha * (state.edge.kind === "similar" ? 0.55 + state.edge.weight * 0.6 : 1));
      if (alpha < 0.008) continue;
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = (look.width + (isLit ? 0.7 : 0)) * widthScale;
      ctx.setLineDash(look.dash.map((value) => value * widthScale));
      if (look.dash.length) ctx.lineDashOffset = isLit && !this.reduced ? -now / 40 : 0;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      if (state.draw < 1) {
        // 그어지는 중: 곡선의 앞부분만(de Casteljau).
        const t = easeOut(state.draw);
        const ax = lerp(x0, c[0], t), ay = lerp(y0, c[1], t), bx = lerp(c[0], c[2], t), by = lerp(c[1], c[3], t), cx = lerp(c[2], x1, t), cy = lerp(c[3], y1, t);
        const dx = lerp(ax, bx, t), dy = lerp(ay, by, t), ex = lerp(bx, cx, t), ey = lerp(by, cy, t);
        ctx.bezierCurveTo(ax, ay, dx, dy, lerp(dx, ex, t), lerp(dy, ey, t));
      } else ctx.bezierCurveTo(c[0], c[1], c[2], c[3], x1, y1);
      ctx.stroke();
      if (state.draw >= 1 && (state.edge.kind === "link" || state.edge.kind === "chain") && (isLit || k > 1.15)) this.arrow(x1, y1, c[2], c[3], this.screenRadius(state.t), color, alpha);
      if (isLit && state.draw >= 1) lit.push({ state, c, p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 } });
      if (warm > 0.05 && this.heat!.span) {
        // 씨앗 쪽에서 바깥으로 번지는 순간에만 알갱이 하나가 선을 타고 간다.
        const ds = this.heat!.depth.get(state.s.node.id), dt = this.heat!.depth.get(state.t.node.id);
        if (ds !== undefined && dt !== undefined && ds !== dt) {
          const t = (now - this.heat!.start - Math.min(ds, dt) * WAVE_STEP) / (WAVE_STEP + 220);
          if (t > 0 && t < 1) wave.push({ state, c, p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 }, t: ds < dt ? t : 1 - t });
        }
      }
    }
    ctx.setLineDash([]);
    for (const { c, p0, p1, t } of wave) {
      const u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * p1.x;
      const y = u * u * u * p0.y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * p1.y;
      ctx.fillStyle = rgba(accent, 0.3); ctx.beginPath(); ctx.arc(x, y, 6 * widthScale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.beginPath(); ctx.arc(x, y, 2.2 * widthScale, 0, Math.PI * 2); ctx.fill();
    }
    // 고른 점에서 이웃으로 흐르는 빛 알갱이.
    if (!this.reduced && focus) {
      for (const { state, c, p0, p1 } of lit) {
        const outward = state.edge.kind === "link" ? true : state.s.node.id === focus;
        const color = focus === state.s.node.id ? state.s.color : state.t.color;
        for (let i = 0; i < 2; i++) {
          let t = ((now / 1500 + state.seed + i / 2) % 1);
          if (!outward) t = 1 - t;
          const u = 1 - t;
          const x = u * u * u * p0.x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * p1.x;
          const y = u * u * u * p0.y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * p1.y;
          const fade = Math.sin(Math.PI * t) * state.hl;
          ctx.fillStyle = rgba(color, 0.95 * fade);
          ctx.beginPath(); ctx.arc(x, y, 2 * widthScale, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba(color, 0.22 * fade);
          ctx.beginPath(); ctx.arc(x, y, 5 * widthScale, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  private arrow(x: number, y: number, cx: number, cy: number, r: number, color: string, alpha: number) {
    const angle = Math.atan2(y - cy, x - cx);
    const tipX = x - Math.cos(angle) * (r + 2.5), tipY = y - Math.sin(angle) * (r + 2.5);
    const size = 6 * clamp(Math.sqrt(this.cam.k), 0.7, 1.3);
    const ctx = this.ctx;
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(angle - 0.45) * size, tipY - Math.sin(angle - 0.45) * size);
    ctx.lineTo(tipX - Math.cos(angle + 0.45) * size, tipY - Math.sin(angle + 0.45) * size);
    ctx.closePath(); ctx.fill();
  }

  private drawNodes(now: number) {
    const ctx = this.ctx, { bg } = this.theme;
    const focus = this.hovered ?? this.selected;
    const overlay = this.route || this.heat || this.spot;
    const dimming = Boolean(focus || this.matches || this.groupLit || overlay);
    const list = [...this.nodes.values()].filter((state) => state.vis > 0.01);
    // 강조된 점이 위에 오도록.
    list.sort((a, b) => a.hl - b.hl || (a.node.id === focus ? 1 : 0) - (b.node.id === focus ? 1 : 0) || (a.node.kind === "folder" ? -1 : 0) - (b.node.kind === "folder" ? -1 : 0));
    for (const state of list) {
      const [x, y] = this.project(state.x, state.y);
      const scale = Math.max(0, state.appear) * (1 + 0.32 * state.pop);
      const r = this.screenRadius(state) * scale;
      if (r <= 0.2 || x < -60 || y < -60 || x > this.w + 60 || y > this.h + 60) continue;
      const alpha = state.vis * (dimming ? lerp(0.16, 1, state.hl) : 1);
      const id = state.node.id;
      const special = id === this.selected || id === this.hovered;
      ctx.save();
      if (special && !this.reduced) { ctx.shadowColor = rgba(state.color, 0.75); ctx.shadowBlur = 18; }
      this.nodePath(state, x, y, r);
      if (isContainer(state.node)) {
        ctx.fillStyle = rgba(bg, alpha);
        ctx.fill();
        ctx.fillStyle = rgba(state.color, (this.theme.dark ? 0.3 : 0.2) * alpha);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.7;
        ctx.strokeStyle = rgba(state.color, alpha);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(state.color, alpha);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(bg, 0.9 * alpha);
        ctx.stroke();
        if (state.node.kind === "session" && r > 3.5) {
          // 작업 세션은 가운데가 빈 육각형으로 메모와 가른다.
          ctx.fillStyle = rgba(bg, 0.92 * alpha);
          ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, Math.PI * 2); ctx.fill();
        }
        if (state.node.kind === "note" && r > 5) {
          // 위쪽에 아주 옅은 빛을 얹어 구슬처럼 보이게.
          const gloss = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r * 1.1);
          gloss.addColorStop(0, `rgba(255,255,255,${(0.42 * alpha).toFixed(3)})`);
          gloss.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gloss;
          this.nodePath(state, x, y, r);
          ctx.fill();
        }
      }
      ctx.restore();
      if (id === this.selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(state.color, 0.9 * state.vis);
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
      if (overlay && this.heat?.seeds.has(id)) {
        // 맥락의 씨앗: 숨 쉬듯 커졌다 줄어드는 고리.
        const breath = this.reduced ? 0.5 : (Math.sin(now / 520) + 1) / 2;
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(this.theme.accent, (0.75 + 0.2 * breath) * state.vis);
        ctx.beginPath(); ctx.arc(x, y, r + 5 + breath * 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      if (overlay && this.route?.order.has(id)) {
        const end = this.route.order.get(id) === 0 || this.route.order.get(id) === this.route.nodes.length - 1;
        ctx.lineWidth = end ? 2.4 : 1.6;
        ctx.strokeStyle = rgba(this.theme.accent, 0.95 * state.vis);
        ctx.beginPath(); ctx.arc(x, y, r + (end ? 6 : 4), 0, Math.PI * 2); ctx.stroke();
      }
      if (overlay && !this.route && !this.heat && this.spot?.has(id)) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(state.color, 0.85 * state.vis);
        ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, Math.PI * 2); ctx.stroke();
      }
      if (this.matches?.has(id)) {
        const pulse = this.reduced ? 0.5 : (Math.sin(now / 260) + 1) / 2;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(this.theme.accent, (0.45 + 0.4 * pulse) * state.vis);
        ctx.beginPath(); ctx.arc(x, y, r + 4 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  private nodePath(state: NodeState, x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (state.node.kind === "folder") this.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45);
    else if (state.node.kind === "session" || state.node.kind === "project") {
      const size = r * 1.12;
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; if (i) ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size); else ctx.moveTo(x + Math.cos(a) * size, y + Math.sin(a) * size); }
      ctx.closePath();
    }
    else if (state.node.kind === "tag") { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private measure(text: string, font: string) {
    const key = `${font}\n${text}`;
    let width = this.widths.get(key);
    if (width === undefined) { this.ctx.font = font; width = this.ctx.measureText(text).width; this.widths.set(key, width); }
    return width;
  }

  /** 이름표: 강조된 점·검색에 걸린 점은 늘, 나머지는 확대할수록·연결이 많을수록 먼저 보인다. 서로 겹치면 중요한 것만 남긴다. */
  private drawLabels() {
    const ctx = this.ctx, k = this.cam.k, { fg, bg, scale } = this.theme;
    const focus = this.hovered ?? this.selected;
    const lit = focus ? this.around.get(focus) : null;
    const overlay = this.route || this.heat || this.spot;
    const dimming = Boolean(focus || this.matches || this.groupLit || overlay);
    type Candidate = { state: NodeState; priority: number; forced: boolean; alpha: number };
    const candidates: Candidate[] = [];
    for (const state of this.nodes.values()) {
      if (state.vis < 0.05 || state.appear < 0.3) continue;
      const id = state.node.id;
      // 마우스를 올린 점(고른 점이 아니면)은 위에 뜬 이름표가 이름을 보이므로 캔버스에는 쓰지 않는다.
      if (id === this.hovered && id !== this.selected) continue;
      const degree = this.data?.degree.get(id) ?? 0;
      const marked = overlay ? (this.route ? this.route.order.has(id) : this.heat ? (this.heat.scores.get(id) ?? 0) >= 0.3 : this.spot!.has(id)) : false;
      const forced = marked || (!overlay && (id === focus || Boolean(lit?.has(id)))) || Boolean(this.matches?.has(id)) || (this.groupLit !== null && state.node.group === this.groupLit && k > 0.5);
      const importance = degree + (isContainer(state.node) ? 4 : 0);
      const at = 1.05 - Math.min(0.8, importance * 0.1);
      // 구조 보기는 이름이 바깥으로 눕혀져 서로 덜 겹치므로 늘 보인다.
      let alpha = this.labelsAlways || this.view === "structure" ? 1 : forced ? 1 : smooth(at - 0.12, at + 0.08, k);
      if (dimming && !forced) alpha *= lerp(0.15, 1, state.hl) * 0.6;
      alpha *= state.vis;
      // 방사형 이름표로 바뀌는 순간에는 잠깐 흐려졌다가 다시 보인다.
      if (state.angleFrom !== state.angleTo && state.morph < 1) alpha *= Math.abs(1 - 2 * state.morph);
      if (alpha < 0.03) continue;
      candidates.push({ state, priority: (id === focus ? 1000 : forced ? 500 : 0) + importance, forced, alpha });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    const placed: Array<[number, number, number, number]> = [...this.reserved];
    const dots: Array<[number, number, number, number, NodeState]> = [];
    for (const state of this.nodes.values()) {
      if (state.vis < 0.3) continue;
      const [x, y] = this.project(state.x, state.y);
      const r = this.screenRadius(state) * Math.max(0, state.appear);
      dots.push([x - r, y - r, x + r, y + r, state]);
    }
    const overlaps = (x0: number, y0: number, x1: number, y1: number) => placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b);
    for (const { state, forced, alpha } of candidates) {
      const id = state.node.id;
      const strong = id === focus;
      const size = (strong ? 12.5 : 11.5) * scale;
      const font = `${strong ? 650 : state.node.kind === "folder" ? 600 : 500} ${size}px ${this.theme.font}`;
      const [x, y] = this.project(state.x, state.y);
      const r = this.screenRadius(state) * Math.max(0, state.appear) * (1 + 0.32 * state.pop);
      const width = this.measure(state.node.label, font);
      const angle = state.morph >= 0.5 ? state.angleTo : state.angleFrom;
      ctx.font = font;
      ctx.lineJoin = "round";
      if (angle !== null && angle !== undefined) {
        // 방사형: 점 바깥쪽으로 눕힌다. 왼쪽 절반은 글자가 뒤집히지 않게 돌린다.
        const flip = Math.cos(angle) < 0;
        const gap = r + 6;
        const ax = x + Math.cos(angle) * gap, ay = y + Math.sin(angle) * gap;
        const ex = x + Math.cos(angle) * (gap + width), ey = y + Math.sin(angle) * (gap + width);
        const box: [number, number, number, number] = [Math.min(ax, ex) - 2, Math.min(ay, ey) - size / 2, Math.max(ax, ex) + 2, Math.max(ay, ey) + size / 2];
        if (!forced && overlaps(...box)) continue;
        placed.push(box);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(flip ? angle + Math.PI : angle);
        ctx.textAlign = flip ? "right" : "left";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = rgba(bg, 0.85 * alpha); ctx.lineWidth = 3.5;
        ctx.strokeText(state.node.label, 0, 0);
        ctx.fillStyle = rgba(fg, (strong ? 1 : 0.82) * alpha);
        ctx.fillText(state.node.label, 0, 0);
        ctx.restore();
        continue;
      }
      // 점 아래가 기본이고, 다른 이름과 겹치면 위·오른쪽·왼쪽 순서로 비켜 놓는다. 강조된 이름은 모두 겹쳐도 아래에 쓴다.
      const spots: Array<[number, number, CanvasTextAlign]> = [[x, y + r + 4, "center"], [x, y - r - 4 - size, "center"], [x + r + 6, y - size / 2, "left"], [x - r - 6, y - size / 2, "right"]];
      let chosen: [number, number, CanvasTextAlign] | null = null;
      let chosenBox: [number, number, number, number] | null = null;
      for (const spot of spots) {
        const [sx, sy, align] = spot;
        const left = align === "center" ? sx - width / 2 : align === "left" ? sx : sx - width;
        const box: [number, number, number, number] = [left - 3, sy, left + width + 3, sy + size + 2];
        const onDot = dots.some(([a, b, c, d, owner]) => owner !== state && box[0] < c && box[2] > a && box[1] < d && box[3] > b);
        if (!overlaps(...box) && !onDot) { chosen = spot; chosenBox = box; break; }
      }
      if (!chosen) {
        if (!forced) continue;
        chosen = spots[0]!;
        chosenBox = [x - width / 2 - 3, chosen[1], x + width / 2 + 3, chosen[1] + size + 2];
      }
      placed.push(chosenBox!);
      const [tx, ty, align] = chosen;
      ctx.textAlign = align;
      ctx.textBaseline = "top";
      ctx.strokeStyle = rgba(bg, 0.85 * alpha); ctx.lineWidth = 3.5;
      ctx.strokeText(state.node.label, tx, ty);
      ctx.fillStyle = rgba(fg, (strong ? 1 : 0.8) * alpha);
      ctx.fillText(state.node.label, tx, ty);
    }
  }

  private drawRipples(now: number) {
    const ctx = this.ctx;
    for (const ripple of this.ripples) {
      const state = this.nodes.get(ripple.id);
      if (!state) continue;
      const p = clamp((now - ripple.start) / 900);
      const [x, y] = this.project(state.x, state.y);
      const r = this.screenRadius(state) + 4 + easeOut(p) * 34;
      ctx.lineWidth = 2 * (1 - p) + 0.5;
      ctx.strokeStyle = rgba(state.color, 0.7 * (1 - p));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  }

  /** 둥근 바탕 위의 작은 글자(고리 이름 등). */
  private pill(text: string, x: number, y: number, alpha: number, px: number) {
    const ctx = this.ctx, { fg, bg, scale } = this.theme;
    const size = px * scale;
    const font = `600 ${size}px ${this.theme.font}`;
    const width = this.measure(text, font) + 14;
    ctx.fillStyle = rgba(bg, 0.88 * alpha);
    ctx.strokeStyle = rgba(fg, 0.12 * alpha);
    ctx.lineWidth = 1;
    this.roundRect(x - width / 2, y - size / 2 - 5, width, size + 10, (size + 10) / 2);
    ctx.fill(); ctx.stroke();
    this.reserved.push([x - width / 2, y - size / 2 - 5, x + width / 2, y + size / 2 + 5]);
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(fg, 0.66 * alpha);
    ctx.fillText(text, x, y + 0.5);
  }

  /** 주제 거품 위의 제목과 메모 수. */
  private caption(label: string, count: string, x: number, y: number, color: string, alpha: number) {
    const ctx = this.ctx, { fg, bg, scale } = this.theme;
    const size = 12 * scale;
    const font = `650 ${size}px ${this.theme.font}`, small = `600 ${10.5 * scale}px ${this.theme.font}`;
    const cw = this.measure(count, small) + 12;
    const hits = (x0: number, x1: number) => this.reserved.some(([a, b, c, d]) => x0 < c && x1 > a && y - 9 < d && y + 9 > b);
    // 다른 제목과 겹치면 수만 남기고, 그래도 겹치면 쓰지 않는다.
    let text = label, tw = this.measure(text, font);
    if (hits(x - (tw + 8 + cw) / 2, x + (tw + 8 + cw) / 2)) { text = ""; tw = -8; }
    const total = tw + 8 + cw;
    const left = x - total / 2;
    if (hits(left, left + total)) return;
    this.reserved.push([left - 4, y - 10, left + total + 4, y + 10]);
    ctx.font = font; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.strokeStyle = rgba(bg, 0.8 * alpha); ctx.lineWidth = 4; ctx.lineJoin = "round";
    ctx.strokeText(text, left, y);
    ctx.fillStyle = rgba(fg, 0.9 * alpha);
    ctx.fillText(text, left, y);
    ctx.fillStyle = rgba(color, (this.theme.dark ? 0.24 : 0.16) * alpha);
    this.roundRect(left + tw + 8, y - 8, cw, 16, 8);
    ctx.fill();
    ctx.font = small; ctx.textAlign = "center";
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillText(count, left + tw + 8 + cw / 2, y + 0.5);
  }

  /** 시간 보기의 줄 이름(색 점 + 이름). */
  private legendLabel(text: string, x: number, y: number, color: string, alpha: number) {
    const ctx = this.ctx, { fg, scale } = this.theme;
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath(); ctx.arc(x + 4, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${11 * scale}px ${this.theme.font}`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(fg, 0.72 * alpha);
    ctx.fillText(text, x + 13, y + 0.5);
  }
}
