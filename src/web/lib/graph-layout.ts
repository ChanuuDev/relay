import { isContainer, isDoc, type EdgeKind, type GraphCluster, type GraphEdge, type GraphNode } from "./note-graph";

/** 그래프를 늘어놓는 방법. 화면과 무관한 계산만 한다(단위 테스트 대상). 좌표는 (0,0)을 가운데로 하는 세계 좌표이고, 배율 1에서 1px이다.
 *  - network(관계망): 힘으로 당기고 미는 배치. 연결이 많은 메모가 가운데로 모이고 같은 폴더끼리 가깝다.
 *  - focus(집중): 고른 메모를 가운데 두고 1단계·2단계 이웃을 동심원에 놓는다.
 *  - structure(구조): 폴더 트리를 방사형으로 펼친다. 메모는 바깥 고리, 폴더는 안쪽 고리, 폴더 밖 연결은 가운데로 휘어 묶인다.
 *  - topics(주제): 내용으로 묶은 주제마다 거품을 만들고 그 안에 메모를 해바라기 씨처럼 놓는다.
 *  - timeline(시간): 고친 시각을 가로축에, 최상위 폴더를 가로줄로 놓는다. */
export type GraphView = "network" | "focus" | "structure" | "topics" | "timeline";
export const GRAPH_VIEWS: readonly GraphView[] = ["network", "focus", "structure", "topics", "timeline"];
export type Vec = { x: number; y: number };

export type Ring = { r: number; label: string };
export type Sector = { group: string; label: string; start: number; end: number };
export type Bubble = { id: string; x: number; y: number; r: number; label: string; count: number; group: string | null };
export type Lane = { group: string; label: string; y: number; height: number };
export type Tick = { x: number; label: string; major: boolean };
export type Decor =
  | { kind: "none" }
  | { kind: "rings"; rings: Ring[] }
  | { kind: "tree"; inner: number; outer: number; rings: number[]; sectors: Sector[] }
  | { kind: "bubbles"; bubbles: Bubble[] }
  | { kind: "lanes"; lanes: Lane[]; x0: number; x1: number; ticks: Tick[] };

/** 한 보기의 목표 배치. hidden은 이 보기에 보이지 않는 점(제자리에서 사라진다), labelAngle은 방사형으로 눕혀 쓰는 이름의 각도. */
export type Layout = { view: GraphView; positions: Map<string, Vec>; hidden: Set<string>; decor: Decor; labelAngle: Map<string, number>; center: string | null };

/** 선을 그리는 모양: arc(살짝 휜 선) · radial(방사형 트리 가지) · bundle(가운데로 휘어 묶임) · timeline(위로 솟은 호). */
export type EdgeStyle = "arc" | "radial" | "bundle" | "timeline";
export function edgeStyle(view: GraphView, kind: EdgeKind): EdgeStyle {
  if (view === "structure") return kind === "folder" ? "radial" : "bundle";
  if (view === "timeline") return "timeline";
  return "arc";
}

/** 점의 반지름. 연결이 많을수록, 폴더는 담은 메모가 많을수록 조금 크다. */
export function radiusOf(node: GraphNode, degree: number) {
  if (isContainer(node)) return 6.5 + Math.min(7, Math.sqrt(node.count) * 1.5);
  if (node.kind === "tag") return 4 + Math.min(5, Math.sqrt(node.count) * 1.4);
  return 4.2 + Math.min(8, Math.sqrt(degree) * 2) + Math.min(1.6, Math.log10(1 + node.size / 800));
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** 처음 자리: 해바라기 씨 배열(항상 같은 자리라 열 때마다 모양이 같다). */
export const seedPosition = (index: number, spread = 14): Vec => {
  const r = spread * Math.sqrt(0.5 + index), a = index * GOLDEN;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

// ── 힘 시뮬레이션 ──────────────────────────────────────────

export type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null; r: number; charge: number; group: string };
export type SimLink = { source: SimNode; target: SimNode; distance: number; strength: number; bias: number };

const LINK: Record<EdgeKind, { distance: number; strength: number }> = {
  folder: { distance: 46, strength: 0.55 }, link: { distance: 64, strength: 0.8 }, mention: { distance: 74, strength: 0.6 },
  similar: { distance: 92, strength: 0.32 }, tag: { distance: 52, strength: 0.5 }, chain: { distance: 58, strength: 0.7 }, semantic: { distance: 84, strength: 0.38 },
};

type Quad = { x0: number; y0: number; size: number; cx: number; cy: number; charge: number; node: SimNode | null; kids: Array<Quad | undefined> | null };

/** d3-force와 같은 방식의 작은 시뮬레이션(선의 스프링, 서로 미는 힘(점이 많으면 Barnes–Hut), 가운데로 모이는 힘, 같은 묶음끼리 모이는 힘, 겹침 막기). */
export class Simulation {
  alpha = 1;
  alphaMin = 0.002;
  alphaDecay = 1 - Math.pow(0.002, 1 / 300);
  alphaTarget = 0;
  velocityDecay = 0.42;
  centerStrength = 0.045;
  groupStrength = 0.025;
  readonly index: Map<string, SimNode>;
  constructor(readonly nodes: SimNode[], readonly links: SimLink[]) { this.index = new Map(nodes.map((node) => [node.id, node])); }

  static from(nodes: GraphNode[], edges: GraphEdge[], degree: Map<string, number>, start: Map<string, Vec>) {
    const sim: SimNode[] = nodes.map((node, index) => {
      const at = start.get(node.id) ?? seedPosition(index);
      const r = radiusOf(node, degree.get(node.id) ?? 0);
      return { id: node.id, x: at.x, y: at.y, vx: 0, vy: 0, fx: null, fy: null, r, group: node.group,
        charge: isContainer(node) ? -210 : node.kind === "tag" ? -110 : -150 - Math.min(120, (degree.get(node.id) ?? 0) * 12) };
    });
    const byId = new Map(sim.map((node) => [node.id, node]));
    const count = new Map<string, number>();
    for (const edge of edges) for (const id of [edge.source, edge.target]) count.set(id, (count.get(id) ?? 0) + 1);
    const links: SimLink[] = [];
    for (const edge of edges) {
      const source = byId.get(edge.source), target = byId.get(edge.target);
      if (!source || !target) continue;
      const base = LINK[edge.kind];
      const cs = count.get(source.id) ?? 1, ct = count.get(target.id) ?? 1;
      links.push({ source, target, distance: base.distance + (source.r + target.r) * 0.6,
        strength: (base.strength * (edge.kind === "similar" ? 0.6 + edge.weight : 1)) / Math.min(cs, ct), bias: cs / (cs + ct) });
    }
    return new Simulation(sim, links);
  }

  get settled() { return this.alpha < this.alphaMin && this.alphaTarget === 0; }

  tick() {
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    const alpha = this.alpha;
    // 선의 스프링.
    for (const link of this.links) {
      const { source: s, target: t } = link;
      let x = t.x + t.vx - s.x - s.vx || 1e-6, y = t.y + t.vy - s.y - s.vy || 1e-6;
      let l = Math.hypot(x, y);
      l = ((l - link.distance) / l) * alpha * link.strength;
      x *= l; y *= l;
      t.vx -= x * link.bias; t.vy -= y * link.bias;
      s.vx += x * (1 - link.bias); s.vy += y * (1 - link.bias);
    }
    this.charge(alpha);
    // 가운데로, 그리고 같은 묶음의 무게중심으로.
    const centers = new Map<string, { x: number; y: number; n: number }>();
    for (const node of this.nodes) {
      const c = centers.get(node.group) ?? { x: 0, y: 0, n: 0 };
      c.x += node.x; c.y += node.y; c.n++;
      centers.set(node.group, c);
    }
    for (const node of this.nodes) {
      node.vx -= node.x * this.centerStrength * alpha;
      node.vy -= node.y * this.centerStrength * alpha;
      const c = centers.get(node.group)!;
      if (c.n > 1) { node.vx += (c.x / c.n - node.x) * this.groupStrength * alpha; node.vy += (c.y / c.n - node.y) * this.groupStrength * alpha; }
    }
    this.collide();
    for (const node of this.nodes) {
      if (node.fx !== null && node.fy !== null) { node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0; continue; }
      node.vx *= 1 - this.velocityDecay; node.vy *= 1 - this.velocityDecay;
      node.x += node.vx; node.y += node.vy;
    }
  }

  /** alpha가 until 아래로 내려갈 때까지(최대 max번) 돌린다. */
  run(until: number, max = 400) { for (let i = 0; i < max && this.alpha > until; i++) this.tick(); return this; }

  private charge(alpha: number) {
    const nodes = this.nodes;
    const maxD2 = 640 * 640, minD2 = 9;
    if (nodes.length <= 260) {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 > maxD2) continue;
        if (d2 === 0) { dx = (i - j) * 1e-3 || 1e-3; dy = 1e-3; d2 = dx * dx + dy * dy; }
        if (d2 < minD2) d2 = Math.sqrt(minD2 * d2);
        a.vx += (dx * b.charge * alpha) / d2; a.vy += (dy * b.charge * alpha) / d2;
        b.vx -= (dx * a.charge * alpha) / d2; b.vy -= (dy * a.charge * alpha) / d2;
      }
      return;
    }
    const root = this.quadtree();
    const theta2 = 0.81;
    for (const node of nodes) {
      const stack: Quad[] = [root];
      while (stack.length) {
        const quad = stack.pop()!;
        if (!quad.charge) continue;
        const dx = quad.cx - node.x, dy = quad.cy - node.y;
        let d2 = dx * dx + dy * dy;
        if (quad.kids && (quad.size * quad.size) / theta2 >= d2) { for (const kid of quad.kids) if (kid) stack.push(kid); continue; }
        if (quad.node === node || d2 > maxD2 || !d2) continue;
        if (d2 < minD2) d2 = Math.sqrt(minD2 * d2);
        node.vx += (dx * quad.charge * alpha) / d2; node.vy += (dy * quad.charge * alpha) / d2;
      }
    }
  }

  private quadtree(): Quad {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const node of this.nodes) { x0 = Math.min(x0, node.x); y0 = Math.min(y0, node.y); x1 = Math.max(x1, node.x); y1 = Math.max(y1, node.y); }
    const size = Math.max(x1 - x0, y1 - y0, 1) + 1;
    const make = (qx: number, qy: number, qs: number): Quad => ({ x0: qx, y0: qy, size: qs, cx: 0, cy: 0, charge: 0, node: null, kids: null });
    const root = make(x0, y0, size);
    const insert = (quad: Quad, node: SimNode, depth: number) => {
      // 무게중심은 넣으면서 더해 두고 마지막에 나눈다.
      quad.cx += node.x * Math.abs(node.charge); quad.cy += node.y * Math.abs(node.charge); quad.charge += node.charge;
      if (!quad.kids && !quad.node) { quad.node = node; return; }
      if (!quad.kids) {
        if (depth > 24) return;
        const old = quad.node!;
        quad.node = null; quad.kids = [undefined, undefined, undefined, undefined];
        place(quad, old, depth);
      }
      place(quad, node, depth);
    };
    const place = (quad: Quad, node: SimNode, depth: number) => {
      const half = quad.size / 2;
      const right = node.x >= quad.x0 + half ? 1 : 0, bottom = node.y >= quad.y0 + half ? 1 : 0;
      const slot = bottom * 2 + right;
      const kid = quad.kids![slot] ?? (quad.kids![slot] = make(quad.x0 + right * half, quad.y0 + bottom * half, half));
      insert(kid, node, depth + 1);
    };
    for (const node of this.nodes) insert(root, node, 0);
    const finish = (quad: Quad) => {
      const weight = Math.abs(quad.charge) || 1;
      quad.cx /= weight; quad.cy /= weight;
      if (quad.kids) for (const kid of quad.kids) if (kid) finish(kid);
    };
    finish(root);
    return root;
  }

  private collide() {
    const nodes = this.nodes, pad = 7;
    // 칸 나누기로 가까운 점끼리만 본다.
    const cell = 48;
    const grid = new Map<string, SimNode[]>();
    for (const node of nodes) {
      const key = `${Math.floor(node.x / cell)},${Math.floor(node.y / cell)}`;
      const list = grid.get(key); if (list) list.push(node); else grid.set(key, [node]);
    }
    for (const a of nodes) {
      const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const b of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
          if (b === a || b.id < a.id) continue;
          const dx = b.x + b.vx - a.x - a.vx || 1e-3, dy = b.y + b.vy - a.y - a.vy || 1e-3;
          const min = a.r + b.r + pad, d = Math.hypot(dx, dy);
          if (d >= min) continue;
          const push = ((min - d) / d) * 0.35;
          a.vx -= dx * push; a.vy -= dy * push; b.vx += dx * push; b.vy += dy * push;
        }
      }
    }
  }
}

// ── 고정 배치 ─────────────────────────────────────────────

/** 각도를 잎(자식이 없는 점) 수에 비례해 나누는 방사형 트리. 돌려주는 값은 점마다 각도와 깊이. */
function radialTree(root: string, childrenOf: (id: string) => string[], start = -Math.PI / 2, span = Math.PI * 2) {
  const leaves = new Map<string, number>();
  const countLeaves = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = childrenOf(id);
    const total = kids.length ? kids.reduce((sum, kid) => sum + countLeaves(kid, seen), 0) || 1 : 1;
    leaves.set(id, total);
    return total;
  };
  countLeaves(root, new Set());
  const out = new Map<string, { angle: number; depth: number; start: number; end: number }>();
  const walk = (id: string, from: number, to: number, depth: number) => {
    out.set(id, { angle: (from + to) / 2, depth, start: from, end: to });
    const kids = childrenOf(id).filter((kid) => leaves.has(kid) && !out.has(kid));
    const total = kids.reduce((sum, kid) => sum + leaves.get(kid)!, 0) || 1;
    let at = from;
    for (const kid of kids) { const share = ((to - from) * leaves.get(kid)!) / total; walk(kid, at, at + share, depth + 1); at += share; }
  };
  walk(root, start, start + span, 0);
  return out;
}

const polar = (angle: number, r: number): Vec => ({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
const byLabel = (byId: Map<string, GraphNode>) => (a: string, b: string) => {
  const x = byId.get(a)!, y = byId.get(b)!;
  const kind = (node: GraphNode) => (isContainer(node) ? 0 : node.kind === "note" ? 1 : node.kind === "session" ? 2 : 3);
  return kind(x) - kind(y) || collator.compare(x.label, y.label) || (a < b ? -1 : 1);
};

export type LayoutInput = {
  nodes: GraphNode[]; edges: GraphEdge[]; degree: Map<string, number>; groups: Array<{ id: string; label: string }>; clusters: GraphCluster[];
  /** 집중 보기의 가운데 점(없으면 연결이 가장 많은 메모). */
  focus?: string | null;
  /** 집중 보기에서 몇 단계 이웃까지 보일지. */
  depth?: number;
  /** 시간 보기의 날짜 이름표 형식(테스트는 고정 시간대를 쓴다). */
  timeZone?: string;
};

export function focusOf(input: Pick<LayoutInput, "nodes" | "degree" | "focus">) {
  if (input.focus && input.nodes.some((node) => node.id === input.focus)) return input.focus;
  let best: GraphNode | null = null;
  for (const node of input.nodes) {
    if (node.kind !== "note") continue;
    if (!best || (input.degree.get(node.id) ?? 0) > (input.degree.get(best.id) ?? 0)) best = node;
  }
  return best?.id ?? input.nodes[0]?.id ?? null;
}

/** 집중: 가운데 점에서 너비 우선으로 이웃을 찾아 깊이마다 고리에 놓는다. 이웃의 이웃은 그 이웃 쪽 각도에 모인다. */
export function focusLayout(input: LayoutInput): Layout {
  const { nodes, edges } = input;
  const maxDepth = input.depth ?? 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const center = focusOf(input);
  const positions = new Map<string, Vec>(), hidden = new Set<string>(), labelAngle = new Map<string, number>();
  if (!center) return { view: "focus", positions, hidden, decor: { kind: "none" }, labelAngle, center };
  // 링크 → 언급 → 태그 → 폴더 → 비슷함 순서로 먼저 찾은 쪽을 부모로 삼는다.
  const order: Record<EdgeKind, number> = { link: 0, mention: 1, chain: 2, semantic: 3, tag: 4, folder: 5, similar: 6 };
  const around = new Map<string, Array<{ id: string; rank: number }>>();
  for (const edge of edges) for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
    if (!byId.has(a) || !byId.has(b)) continue;
    const list = around.get(a) ?? [];
    list.push({ id: b, rank: order[edge.kind] });
    around.set(a, list);
  }
  const compare = byLabel(byId);
  const parent = new Map<string, string>();
  const depth = new Map<string, number>([[center, 0]]);
  let frontier = [center];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const list = [...(around.get(id) ?? [])].sort((a, b) => a.rank - b.rank || compare(a.id, b.id));
      for (const { id: other } of list) if (!depth.has(other)) { depth.set(other, d); parent.set(other, id); next.push(other); }
    }
    frontier = next;
  }
  const kids = new Map<string, string[]>();
  for (const [child, from] of parent) kids.set(from, [...(kids.get(from) ?? []), child]);
  const tree = radialTree(center, (id) => kids.get(id) ?? []);
  const perDepth = new Map<number, number>();
  for (const d of depth.values()) perDepth.set(d, (perDepth.get(d) ?? 0) + 1);
  // 고리 사이 간격은 그 고리에 놓일 점이 서로 붙지 않을 만큼(점 하나에 40px) 넓힌다.
  const radii = [0];
  for (let d = 1; d <= maxDepth; d++) radii.push(Math.max(radii[d - 1]! + (d === 1 ? 150 : 130), ((perDepth.get(d) ?? 0) * 40) / (Math.PI * 2)));
  for (const node of nodes) {
    const spot = tree.get(node.id);
    const d = depth.get(node.id);
    if (!spot || d === undefined) { hidden.add(node.id); continue; }
    positions.set(node.id, d === 0 ? { x: 0, y: 0 } : polar(spot.angle, radii[d]!));
  }
  const rings: Ring[] = [];
  for (let d = 1; d <= maxDepth; d++) if (perDepth.get(d)) rings.push({ r: radii[d]!, label: `${d}단계 · ${perDepth.get(d)}개` });
  return { view: "focus", positions, hidden, decor: { kind: "rings", rings }, labelAngle, center };
}

/** 구조: 폴더 트리를 방사형으로. 메모는 모두 바깥 고리에 놓고(이름은 바깥쪽으로 눕힌다) 폴더는 깊이마다 안쪽 고리에 놓는다. 태그는 보이지 않는다. */
export function structureLayout(input: LayoutInput): Layout {
  const { nodes } = input;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map<string, Vec>(), hidden = new Set<string>(), labelAngle = new Map<string, number>();
  const ROOT = "\u0000root";
  const kids = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind === "tag") { hidden.add(node.id); continue; }
    const holder = node.parentId ? byId.get(node.parentId) : undefined;
    const parent = holder && isContainer(holder) ? holder.id : ROOT;
    kids.set(parent, [...(kids.get(parent) ?? []), node.id]);
  }
  const groupOrder = new Map(input.groups.map((group, index) => [group.id, index]));
  const compare = byLabel(byId);
  for (const [key, list] of kids) list.sort(key === ROOT
    ? (a, b) => (groupOrder.get(byId.get(a)!.group) ?? 99) - (groupOrder.get(byId.get(b)!.group) ?? 99) || compare(a, b)
    : compare);
  const tree = radialTree(ROOT, (id) => kids.get(id) ?? []);
  const leaves = nodes.filter((node) => node.kind !== "tag" && !(kids.get(node.id)?.length)).length;
  let folderDepth = 0;
  for (const node of nodes) if (isContainer(node)) folderDepth = Math.max(folderDepth, tree.get(node.id)?.depth ?? 0);
  const outer = Math.max((folderDepth + 1) * 110, (leaves * 26) / (Math.PI * 2), 140);
  const ringOf = (d: number) => (outer * d) / (folderDepth + 1);
  for (const node of nodes) {
    if (node.kind === "tag") continue;
    const spot = tree.get(node.id);
    if (!spot) { hidden.add(node.id); continue; }
    // 메모와 빈 폴더(잎)는 바깥 고리, 하위가 있는 폴더는 깊이에 맞는 안쪽 고리.
    const leaf = !(kids.get(node.id)?.length);
    const r = isDoc(node) || leaf ? outer : ringOf(spot.depth);
    positions.set(node.id, polar(spot.angle, r));
    if (isDoc(node) || leaf) labelAngle.set(node.id, spot.angle);
  }
  const sectors: Sector[] = [];
  for (const id of kids.get(ROOT) ?? []) {
    const node = byId.get(id)!, spot = tree.get(id)!;
    const group = input.groups.find((entry) => entry.id === node.group);
    const last = sectors[sectors.length - 1];
    if (last && last.group === node.group) last.end = spot.end;
    else sectors.push({ group: node.group, label: group?.label ?? node.label, start: spot.start, end: spot.end });
  }
  const rings = Array.from({ length: folderDepth }, (_, index) => ringOf(index + 1));
  return { view: "structure", positions, hidden, decor: { kind: "tree", inner: 0, outer, rings, sectors }, labelAngle, center: null };
}

/** 주제: 묶음마다 원(거품)을 나선을 따라 겹치지 않게 놓고, 그 안에 메모를 연결이 많은 것부터 가운데에 놓는다. 폴더·태그는 보이지 않는다. */
export function topicsLayout(input: LayoutInput): Layout {
  const visible = new Set(input.nodes.filter(isDoc).map((node) => node.id));
  const positions = new Map<string, Vec>(), hidden = new Set<string>(), labelAngle = new Map<string, number>();
  for (const node of input.nodes) if (!isDoc(node)) hidden.add(node.id);
  const clusters = input.clusters.map((cluster) => ({ ...cluster, members: cluster.members.filter((id) => visible.has(id)) })).filter((cluster) => cluster.members.length);
  // 묶음에 없는 메모(필터로 생긴 경우)는 홀로 둔다.
  const placed = new Set(clusters.flatMap((cluster) => cluster.members));
  const rest = [...visible].filter((id) => !placed.has(id));
  if (rest.length) clusters.push({ id: "cluster:rest", label: "기타", keywords: [], members: rest });
  const bubbles: Bubble[] = [];
  const groupOf = new Map(input.nodes.map((node) => [node.id, node.group]));
  for (const cluster of clusters) {
    const n = cluster.members.length;
    const r = 46 + Math.sqrt(n) * 34;
    // 큰 묶음부터 가운데에, 다음 묶음은 나선을 따라 처음 비는 자리에.
    let spot = { x: 0, y: 0 };
    if (bubbles.length) {
      for (let step = 0; step < 4000; step++) {
        const a = step * 0.35, d = 6 * a;
        const candidate = { x: Math.cos(a) * d * 1.25, y: Math.sin(a) * d * 0.85 };
        if (bubbles.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= other.r + r + 44)) { spot = candidate; break; }
      }
    }
    // 묶음의 색은 메모 대부분이 속한 폴더 묶음의 색.
    const tally = new Map<string, number>();
    for (const id of cluster.members) tally.set(groupOf.get(id)!, (tally.get(groupOf.get(id)!) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    bubbles.push({ id: cluster.id, x: spot.x, y: spot.y, r, label: cluster.label, count: n, group: top && top[1] / n >= 0.5 ? top[0] : null });
    const c = (r - 24) / Math.sqrt(n + 0.5);
    cluster.members.forEach((id, index) => {
      const d = n === 1 ? 0 : c * Math.sqrt(index + 0.5), a = index * GOLDEN - Math.PI / 2;
      positions.set(id, { x: spot.x + Math.cos(a) * d, y: spot.y + Math.sin(a) * d });
    });
  }
  // 전체를 가운데로.
  if (bubbles.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of bubbles) { x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const b of bubbles) { b.x -= cx; b.y -= cy; }
    for (const [id, p] of positions) positions.set(id, { x: p.x - cx, y: p.y - cy });
  }
  return { view: "topics", positions, hidden, decor: { kind: "bubbles", bubbles }, labelAngle, center: null };
}

/** 시간: 가로는 고친 시각(시각의 실제 간격과 순서를 반씩 섞어 몰린 날도 펼친다), 세로는 최상위 폴더 줄. 한 줄에서 겹치면 위아래로 비켜 놓는다. */
export function timelineLayout(input: LayoutInput): Layout {
  const notes = input.nodes.filter(isDoc).sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1));
  const positions = new Map<string, Vec>(), hidden = new Set<string>(), labelAngle = new Map<string, number>();
  for (const node of input.nodes) if (!isDoc(node)) hidden.add(node.id);
  if (!notes.length) return { view: "timeline", positions, hidden, decor: { kind: "lanes", lanes: [], x0: 0, x1: 0, ticks: [] }, labelAngle, center: null };
  const width = Math.max(720, notes.length * 30);
  const times = [...new Set(notes.map((note) => note.updatedAt))].sort((a, b) => a - b);
  const t0 = times[0]!, t1 = times[times.length - 1]!;
  const span = Math.max(1, t1 - t0);
  const rankOf = (t: number) => {
    if (times.length < 2) return 0.5;
    let lo = 0, hi = times.length - 1;
    if (t <= times[0]!) return 0;
    if (t >= times[hi]!) return 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid]! <= t) lo = mid; else hi = mid; }
    const local = (t - times[lo]!) / Math.max(1, times[hi]! - times[lo]!);
    return (lo + local) / (times.length - 1);
  };
  const xOf = (t: number) => (times.length < 2 ? 0 : ((t - t0) / span * 0.5 + rankOf(t) * 0.5) * width - width / 2);
  const present = new Set(notes.map((note) => note.group));
  const lanesOrder = input.groups.filter((group) => present.has(group.id));
  const laneHeight = 96;
  const lanes: Lane[] = lanesOrder.map((group, index) => ({ group: group.id, label: group.label, y: (index - (lanesOrder.length - 1) / 2) * laneHeight, height: laneHeight }));
  const laneOf = new Map(lanes.map((lane) => [lane.group, lane]));
  const taken = new Map<string, Array<{ x: number; y: number; r: number }>>();
  for (const note of notes) {
    const lane = laneOf.get(note.group) ?? lanes[0]!;
    const x = xOf(note.updatedAt);
    const r = radiusOf(note, input.degree.get(note.id) ?? 0);
    const list = taken.get(lane.group) ?? [];
    let y = lane.y;
    for (let step = 0; step < 40; step++) {
      const offset = step === 0 ? 0 : Math.ceil(step / 2) * 13 * (step % 2 ? -1 : 1);
      const candidate = lane.y + Math.max(-lane.height / 2 + 12, Math.min(lane.height / 2 - 12, offset));
      if (list.every((other) => Math.hypot(other.x - x, other.y - candidate) >= other.r + r + 4)) { y = candidate; break; }
      y = candidate;
    }
    list.push({ x, y, r });
    taken.set(lane.group, list);
    positions.set(note.id, { x, y });
  }
  return { view: "timeline", positions, hidden, decor: { kind: "lanes", lanes, x0: -width / 2, x1: width / 2, ticks: ticksOf(t0, t1, xOf, input.timeZone) }, labelAngle, center: null };
}

const DAY = 86_400_000;
/** 시간 축 눈금: 기간에 따라 시각·날·주·달·해 단위로, 너무 촘촘하면 건너뛴다. */
export function ticksOf(t0: number, t1: number, xOf: (t: number) => number, timeZone?: string): Tick[] {
  const span = t1 - t0;
  if (span <= 0) return [{ x: xOf(t0), label: new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", timeZone }).format(t0), major: true }];
  const zone = timeZone ? { timeZone } : {};
  const parts = (t: number) => {
    const map = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", ...zone })
      .formatToParts(t).map((part) => [part.type, part.value]));
    return { y: Number(map.year), m: Number(map.month), d: Number(map.day), h: Number(map.hour) };
  };
  const unit = span <= 2 * DAY ? "hour" : span <= 75 * DAY ? "day" : span <= 3 * 365 * DAY ? "month" : "year";
  const step = unit === "hour" ? 3600_000 : unit === "day" ? DAY : 0;
  const candidates: Array<{ t: number; major: boolean }> = [];
  if (step) {
    const first = Math.ceil(t0 / step) * step;
    for (let t = first; t <= t1 && candidates.length < 2000; t += step) {
      const p = parts(t);
      if (unit === "hour" && p.h % 1 === 0) candidates.push({ t, major: p.h === 0 });
      else if (unit === "day") candidates.push({ t: t - ((p.h * 3600_000) % DAY), major: p.d === 1 });
    }
  } else {
    const start = parts(t0);
    for (let y = start.y, m = start.m; candidates.length < 400; ) {
      const t = Date.UTC(y, m - 1, 1);
      if (t > t1) break;
      if (t >= t0) candidates.push({ t, major: m === 1 });
      if (unit === "month") { m++; if (m > 12) { m = 1; y++; } } else { y++; m = 1; }
    }
  }
  const label = (t: number) => new Intl.DateTimeFormat("ko-KR", unit === "hour" ? { hour: "numeric", ...zone } : unit === "day" ? { month: "short", day: "numeric", ...zone }
    : unit === "month" ? { year: "2-digit", month: "short", ...zone } : { year: "numeric", ...zone }).format(t);
  const ticks: Tick[] = [];
  let lastX = -Infinity;
  for (const { t, major } of candidates) {
    const x = xOf(t);
    if (x - lastX < 84) continue;
    ticks.push({ x, label: label(t), major });
    lastX = x;
  }
  return ticks;
}

/** 관계망 보기의 장식은 그릴 때 현재 자리로 구하므로 목표 배치만 만든다. */
export function networkLayout(positions: Map<string, Vec>, nodes: GraphNode[]): Layout {
  return { view: "network", positions, hidden: new Set(nodes.filter((node) => !positions.has(node.id)).map((node) => node.id)), decor: { kind: "none" }, labelAngle: new Map(), center: null };
}

/** 점과 장식이 차지하는 범위. 화면에 맞출 때 쓴다(이름표 자리를 위해 pad만큼 넓힌다). */
export function boundsOf(layout: Layout, pad = 40) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, m = 0) => { x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m); };
  for (const [id, p] of layout.positions) if (!layout.hidden.has(id)) add(p.x, p.y, layout.labelAngle.has(id) ? 120 : 0);
  const decor = layout.decor;
  if (decor.kind === "rings") for (const ring of decor.rings) add(0, 0, ring.r + 16);
  if (decor.kind === "tree") add(0, 0, decor.outer + 130);
  if (decor.kind === "bubbles") for (const b of decor.bubbles) { add(b.x, b.y, b.r); add(b.x, b.y - b.r - 26); }
  if (decor.kind === "lanes" && decor.lanes.length) { add(decor.x0 - 120, decor.lanes[0]!.y - decor.lanes[0]!.height / 2); add(decor.x1 + 40, decor.lanes[decor.lanes.length - 1]!.y + decor.lanes[decor.lanes.length - 1]!.height / 2 + 36); }
  if (!Number.isFinite(x0)) return { x0: -100, y0: -100, x1: 100, y1: 100 };
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}
