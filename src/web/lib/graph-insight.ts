import { isDoc, type EdgeKind, type GraphEdge, type GraphNode, type NoteGraph, type Vector } from "./note-graph";

/** 그래프를 읽어 내는 계산: 중요도(PageRank), 다리 점(매개 중심성), 주제 사이의 틈, 제안 연결(링크 예측), 가장 가까운 경로.
 *  화면의 「발견」 패널과 CLI(`relay graph map|suggest|path|neighbors`)가 같은 결과를 쓴다. 모두 정렬된 순서로만 돌아 결과가 항상 같다.
 *
 *  참고한 방법
 *  - 중요도와 맥락 퍼뜨리기: PageRank / Personalized PageRank (Page 외 1999, Haveliwala 2002). 씨앗에서 퍼뜨리는 방식은 HippoRAG(Gutiérrez 외 2024)와 같다.
 *  - 다리 점: Brandes(2001)의 매개 중심성. 주제 사이의 틈은 Burt의 구조적 공백을 묶음 단위로 본 것이다.
 *  - 제안 연결: Adamic–Adar(2003) 공통 이웃 점수에 제목 언급·낱말 유사도를 더한다. */

/** 관계의 세기(0..1). 중요도·맥락 퍼뜨리기·경로 찾기가 함께 쓴다. 폴더에 함께 담긴 것은 약한 단서로만 본다. */
export const EDGE_STRENGTH: Record<EdgeKind, number> = { link: 1, mention: 0.7, chain: 0.65, semantic: 0.6, similar: 0.5, tag: 0.45, folder: 0.18 };
export const strengthOf = (edge: GraphEdge) => (edge.kind === "similar" ? 0.2 + 0.6 * edge.weight : edge.kind === "semantic" ? 0.35 + 0.45 * edge.weight : EDGE_STRENGTH[edge.kind]);
/** 내용으로 이어진 선(폴더에 담긴 것은 뺀다). */
export const CONTENT_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["link", "mention", "similar", "tag", "chain", "semantic"]);

type Graph = Pick<NoteGraph, "nodes" | "edges">;
export type Arc = { to: string; edge: GraphEdge; weight: number; /** 선의 방향대로 가는가 */ forward: boolean };

/** 점마다 닿은 선(양쪽 방향). kinds를 주면 그 종류만. 점 ID 순서로 정렬해 돌려준다. */
export function adjacency(graph: Graph, kinds?: ReadonlySet<EdgeKind>): Map<string, Arc[]> {
  const known = new Set(graph.nodes.map((node) => node.id));
  const map = new Map<string, Arc[]>();
  const add = (from: string, arc: Arc) => { const list = map.get(from); if (list) list.push(arc); else map.set(from, [arc]); };
  for (const edge of graph.edges) {
    if ((kinds && !kinds.has(edge.kind)) || edge.source === edge.target || !known.has(edge.source) || !known.has(edge.target)) continue;
    const weight = strengthOf(edge);
    add(edge.source, { to: edge.target, edge, weight, forward: true });
    add(edge.target, { to: edge.source, edge, weight, forward: false });
  }
  for (const list of map.values()) list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.edge.id < b.edge.id ? -1 : 1));
  return map;
}

export type RankOptions = {
  /** 선을 따라갈 확률. 전체 중요도는 0.85, 씨앗 둘레만 보려면 0.5(씨앗으로 자주 돌아와 멀리 퍼지지 않는다). */
  damping?: number;
  /** 씨앗과 무게. 주면 Personalized PageRank가 된다. */
  seeds?: ReadonlyMap<string, number>;
  iterations?: number; tolerance?: number;
  /** 방향 있는 선(링크·이어받기)을 거슬러 가는 무게(0..1). 1이면 방향을 보지 않는다. */
  back?: number;
};

/** 무게 있는 PageRank(거듭 곱하기). 점수의 합은 1이다. 나갈 선이 없는 점의 몫은 씨앗(없으면 모든 점)에 돌려준다. */
export function pageRank(graph: Graph, options: RankOptions = {}): Map<string, number> {
  const { damping = 0.85, iterations = 80, tolerance = 1e-8, back = 1 } = options;
  const ids = graph.nodes.map((node) => node.id);
  const n = ids.length;
  if (!n) return new Map();
  const index = new Map(ids.map((id, at) => [id, at]));
  const targets: number[][] = ids.map(() => []), weights: number[][] = ids.map(() => []);
  const total = new Float64Array(n);
  const arc = (from: number, to: number, weight: number) => { if (weight > 0) { targets[from]!.push(to); weights[from]!.push(weight); total[from]! += weight; } };
  for (const edge of graph.edges) {
    const a = index.get(edge.source), b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const weight = strengthOf(edge);
    arc(a, b, weight);
    arc(b, a, edge.kind === "link" || edge.kind === "chain" ? weight * back : weight);
  }
  const jump = new Float64Array(n);
  let mass = 0;
  for (const [id, weight] of options.seeds ?? []) { const at = index.get(id); if (at !== undefined && weight > 0) { jump[at]! += weight; mass += weight; } }
  if (mass > 0) for (let i = 0; i < n; i++) jump[i]! /= mass; else jump.fill(1 / n);
  let rank = Float64Array.from(jump);
  for (let round = 0; round < iterations; round++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const value = rank[i]!;
      if (!value) continue;
      if (!total[i]) { dangling += value; continue; }
      const share = (damping * value) / total[i]!;
      const to = targets[i]!, w = weights[i]!;
      for (let k = 0; k < to.length; k++) next[to[k]!]! += share * w[k]!;
    }
    const base = 1 - damping + damping * dangling;
    let delta = 0;
    for (let i = 0; i < n; i++) { next[i]! += base * jump[i]!; delta += Math.abs(next[i]! - rank[i]!); }
    rank = next;
    if (delta < tolerance) break;
  }
  return new Map(ids.map((id, at) => [id, rank[at]!]));
}

/** 매개 중심성(Brandes): 다른 점들 사이의 가장 짧은 길에 얼마나 자주 놓이는가. 0..1로 맞춘다. 점이 아주 많으면 출발점을 고르게 솎는다. */
export function betweenness(graph: Graph, kinds: ReadonlySet<EdgeKind> = CONTENT_KINDS): Map<string, number> {
  const around = adjacency(graph, kinds);
  const ids = graph.nodes.map((node) => node.id).sort();
  const score = new Map(ids.map((id) => [id, 0]));
  const step = Math.max(1, Math.ceil(ids.length / 800));
  for (let at = 0; at < ids.length; at += step) {
    const source = ids[at]!;
    const order: string[] = [], before = new Map<string, string[]>();
    const paths = new Map<string, number>([[source, 1]]), distance = new Map<string, number>([[source, 0]]);
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]!;
      order.push(v);
      for (const arc of around.get(v) ?? []) {
        if (!distance.has(arc.to)) { distance.set(arc.to, distance.get(v)! + 1); queue.push(arc.to); }
        if (distance.get(arc.to) === distance.get(v)! + 1) {
          paths.set(arc.to, (paths.get(arc.to) ?? 0) + paths.get(v)!);
          const list = before.get(arc.to); if (list) list.push(v); else before.set(arc.to, [v]);
        }
      }
    }
    const carry = new Map<string, number>();
    for (let k = order.length - 1; k >= 0; k--) {
      const w = order[k]!;
      for (const v of before.get(w) ?? []) carry.set(v, (carry.get(v) ?? 0) + (paths.get(v)! / paths.get(w)!) * (1 + (carry.get(w) ?? 0)));
      if (w !== source) score.set(w, score.get(w)! + (carry.get(w) ?? 0));
    }
  }
  // 같은 선을 두 번 세지 않게 반으로 나누고(방향 없는 그래프), 가능한 쌍의 수로 나눈다.
  const n = ids.length, scale = n > 2 ? (step * 2) / (2 * (n - 1) * (n - 2)) : 0;
  for (const id of ids) score.set(id, Math.min(1, score.get(id)! * scale));
  return score;
}

/** 여럿에서 한꺼번에 출발하는 가장 가까운 길(비용은 선 세기의 역수). 각 점까지의 비용과 바로 앞 점·선을 돌려준다. */
export function spread(graph: Graph, sources: Iterable<string>, kinds?: ReadonlySet<EdgeKind>, limit = Infinity) {
  const around = adjacency(graph, kinds);
  const cost = new Map<string, number>(), prev = new Map<string, { from: string; edge: GraphEdge }>(), hops = new Map<string, number>();
  const heap: Array<[number, string]> = [];
  const push = (entry: [number, string]) => {
    heap.push(entry);
    for (let i = heap.length - 1; i > 0;) { const up = (i - 1) >> 1; if (less(heap[i]!, heap[up]!)) { [heap[i], heap[up]] = [heap[up]!, heap[i]!]; i = up; } else break; }
  };
  const less = (a: [number, string], b: [number, string]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m;
      }
    }
    return top;
  };
  for (const id of [...sources].sort()) { cost.set(id, 0); hops.set(id, 0); push([0, id]); }
  const done = new Set<string>();
  while (heap.length) {
    const [d, id] = pop();
    if (done.has(id)) continue;
    done.add(id);
    if (d > limit) break;
    for (const arc of around.get(id) ?? []) {
      const next = d + 1 / arc.weight;
      const known = cost.get(arc.to);
      if (known === undefined || next < known - 1e-12) { cost.set(arc.to, next); prev.set(arc.to, { from: id, edge: arc.edge }); hops.set(arc.to, hops.get(id)! + 1); push([next, arc.to]); }
    }
  }
  return { cost, prev, hops };
}

export type GraphPath = { nodes: string[]; edges: GraphEdge[]; cost: number };
/** 두 점을 잇는 가장 가까운 길. 강한 관계(링크)일수록 가깝다. 이어지지 않으면 null. */
export function shortestPath(graph: Graph, from: string, to: string, kinds?: ReadonlySet<EdgeKind>): GraphPath | null {
  if (from === to) return { nodes: [from], edges: [], cost: 0 };
  const { cost, prev } = spread(graph, [from], kinds);
  if (!cost.has(to)) return null;
  const nodes = [to], edges: GraphEdge[] = [];
  for (let at = to; at !== from;) { const step = prev.get(at); if (!step) return null; edges.unshift(step.edge); nodes.unshift(step.from); at = step.from; }
  return { nodes, edges, cost: cost.get(to)! };
}

/** 어떤 점에서 depth단계 안의 이웃. 가까운 단계부터, 같은 단계는 강한 관계부터. */
export function hood(graph: Graph, id: string, depth = 1, kinds?: ReadonlySet<EdgeKind>) {
  const around = adjacency(graph, kinds);
  const seen = new Map<string, { depth: number; from: string; edge: GraphEdge; forward: boolean }>();
  let frontier = [id];
  for (let level = 1; level <= depth && frontier.length; level++) {
    const next: string[] = [];
    for (const from of frontier) for (const arc of [...(around.get(from) ?? [])].sort((a, b) => b.weight - a.weight || (a.to < b.to ? -1 : 1))) {
      if (arc.to === id || seen.has(arc.to)) continue;
      seen.set(arc.to, { depth: level, from, edge: arc.edge, forward: arc.forward });
      next.push(arc.to);
    }
    frontier = next;
  }
  return seen;
}

const dot = (a: Vector | undefined, b: Vector | undefined) => {
  if (!a || !b) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [word, value] of small) { const other = large.get(word); if (other) sum += value * other; }
  return sum;
};
/** 두 글이 함께 쓰는 낱말(무게의 곱이 큰 순). */
export function sharedWords(a: Vector | undefined, b: Vector | undefined, limit = 3): string[] {
  if (!a || !b) return [];
  const out: Array<[string, number]> = [];
  for (const [word, value] of a) { const other = b.get(word); if (other) out.push([word, value * other]); }
  return out.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, limit).map(([word]) => word);
}

export type Bridge = { id: string; score: number; between: number; /** 이 점이 잇는 주제 묶음들 */ clusters: string[] };
export type Gap = {
  a: string; b: string;
  /** 두 묶음의 내용이 가까운 정도(0..1) */ affinity: number;
  /** 지금 두 묶음을 잇는 선 수 */ cross: number;
  /** 함께 쓰는 낱말 */ shared: string[];
  /** 이으면 좋을 메모 쌍 */ pair: { from: string; to: string; score: number } | null;
};
/** 그래프가 얼마나 잘 이어져 있는지 보는 지표. 비율은 0..1이다. */
export type Health = {
  /** 글이 있는 점(메모·세션)의 수와, 그 사이의 내용 선(링크·언급·비슷함·이어받음) 수. */
  docs: number; links: number;
  /** 글 하나에 닿은 글의 평균 수. */
  degree: number;
  /** 가능한 쌍 가운데 실제로 이어진 비율. */
  density: number;
  /** 군집 계수: 이웃끼리도 서로 이어진 정도(이웃이 둘 이상인 글의 평균). */
  clustering: number;
  /** 모듈성: 주제 묶음 안의 선이 우연보다 얼마나 많은가(0.3을 넘으면 주제가 뚜렷이 나뉜 것이다). */
  modularity: number;
  /** 가장 큰 덩어리에 든 글의 비율. */
  connected: number;
  /** `[[링크]]`나 ID로 직접 이어진 메모의 비율. */
  linked: number;
  /** 어디에도 닿지 않은 메모의 비율. */
  orphaned: number;
};
export type Insight = {
  /** 중요도(합 1). 링크를 받는 쪽이 조금 더 높다. */
  rank: Map<string, number>;
  /** 중요도를 글이 있는 점 가운데 가장 큰 값으로 나눈 것(0..1). 화면의 빛 세기에 쓴다. */
  glow: Map<string, number>;
  between: Map<string, number>;
  /** 글이 있는 점 → 주제 묶음 ID(홀로인 메모는 없다). */
  clusterOf: Map<string, string>;
  /** 내용으로 이어진 선의 수. */
  degree: Map<string, number>;
  hubs: Array<{ id: string; score: number; degree: number }>;
  bridges: Bridge[];
  gaps: Gap[];
  /** 내용으로는 어디에도 닿지 않은 메모. */
  orphans: string[];
  /** 내용으로 이어진 덩어리 수(홀로인 메모 제외). */
  islands: number;
  health: Health;
};

/** 그래프 한 번 훑기. */
export function analyze(graph: NoteGraph): Insight {
  const docs = graph.nodes.filter(isDoc);
  const rank = pageRank(graph, { damping: 0.85, back: 0.35 });
  let top = 0;
  for (const node of docs) top = Math.max(top, rank.get(node.id) ?? 0);
  const glow = new Map(graph.nodes.map((node) => [node.id, top ? Math.min(1, (rank.get(node.id) ?? 0) / top) : 0]));
  const between = betweenness(graph);
  const clusterOf = new Map<string, string>();
  for (const cluster of graph.clusters) if (cluster.id !== "cluster:lonely") for (const id of cluster.members) clusterOf.set(id, cluster.id);
  const around = adjacency(graph, CONTENT_KINDS);
  const degree = new Map(graph.nodes.map((node) => [node.id, around.get(node.id)?.length ?? 0]));

  const hubs = docs.filter((node) => degree.get(node.id)! > 0).map((node) => ({ id: node.id, score: rank.get(node.id) ?? 0, degree: degree.get(node.id)! }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, 12);

  // 다리 점: 이웃(같은 태그를 쓴 메모 포함)이 둘 이상의 주제 묶음에 걸친 점.
  const byId = graph.byId;
  let maxBetween = 0;
  for (const node of docs) maxBetween = Math.max(maxBetween, between.get(node.id) ?? 0);
  const bridges: Bridge[] = [];
  for (const node of docs) {
    const spans = new Set<string>();
    const own = clusterOf.get(node.id);
    if (own) spans.add(own);
    for (const arc of around.get(node.id) ?? []) {
      const other = byId.get(arc.to);
      if (!other) continue;
      if (isDoc(other)) { const cluster = clusterOf.get(other.id); if (cluster) spans.add(cluster); }
      else if (other.kind === "tag") for (const hop of around.get(other.id) ?? []) { const cluster = clusterOf.get(hop.to); if (cluster) spans.add(cluster); }
    }
    if (spans.size < 2) continue;
    const share = maxBetween ? (between.get(node.id) ?? 0) / maxBetween : 0;
    bridges.push({ id: node.id, between: between.get(node.id) ?? 0, clusters: [...spans].sort(), score: 0.55 * share + 0.45 * Math.min(1, (spans.size - 1) / 3) });
  }
  bridges.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  // 주제 사이의 틈: 내용(묶음의 낱말 무게를 더한 것)은 가까운데 잇는 선이 없거나 하나뿐인 묶음 쌍.
  const clusters = graph.clusters.filter((cluster) => cluster.id !== "cluster:lonely" && cluster.members.length >= 2);
  const centroid = new Map<string, Vector>();
  for (const cluster of clusters) {
    const sum: Vector = new Map();
    for (const id of cluster.members) for (const [word, value] of graph.vectors.get(id) ?? []) sum.set(word, (sum.get(word) ?? 0) + value);
    const norm = Math.hypot(...sum.values()) || 1;
    for (const [word, value] of sum) sum.set(word, value / norm);
    centroid.set(cluster.id, sum);
  }
  const cross = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!CONTENT_KINDS.has(edge.kind)) continue;
    const a = clusterOf.get(edge.source), b = clusterOf.get(edge.target);
    if (a && b && a !== b) { const key = a < b ? `${a}\n${b}` : `${b}\n${a}`; cross.set(key, (cross.get(key) ?? 0) + 1); }
  }
  const gaps: Gap[] = [];
  for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
    const [x, y] = clusters[i]!.id < clusters[j]!.id ? [clusters[i]!, clusters[j]!] : [clusters[j]!, clusters[i]!];
    const count = cross.get(`${x.id}\n${y.id}`) ?? 0;
    if (count > 1) continue;
    const affinity = dot(centroid.get(x.id), centroid.get(y.id));
    if (affinity < 0.08) continue;
    let pair: Gap["pair"] = null;
    for (const from of x.members) for (const to of y.members) {
      if (byId.get(from)?.kind !== "note" || byId.get(to)?.kind !== "note") continue;
      const score = dot(graph.vectors.get(from), graph.vectors.get(to));
      if (score > 0 && (!pair || score > pair.score + 1e-12)) pair = { from, to, score };
    }
    gaps.push({ a: x.id, b: y.id, affinity, cross: count, shared: sharedWords(centroid.get(x.id), centroid.get(y.id), 4), pair });
  }
  gaps.sort((p, q) => q.affinity / (1 + q.cross) - p.affinity / (1 + p.cross) || (p.a + p.b < q.a + q.b ? -1 : 1));

  const orphans = docs.filter((node) => node.kind === "note" && !degree.get(node.id)).map((node) => node.id);
  // 덩어리 세기.
  const seen = new Set<string>();
  let islands = 0, largest = 0;
  for (const node of docs) {
    if (seen.has(node.id) || !degree.get(node.id)) continue;
    islands++;
    const stack = [node.id];
    seen.add(node.id);
    let size = 0;
    while (stack.length) { const at = stack.pop()!; if (byId.get(at) && isDoc(byId.get(at)!)) size++; for (const arc of around.get(at) ?? []) if (!seen.has(arc.to)) { seen.add(arc.to); stack.push(arc.to); } }
    largest = Math.max(largest, size);
  }

  // 상태 지표: 글과 글 사이의 선만 본다(태그·폴더를 거친 것은 뺀다).
  const near = new Map<string, Map<string, number>>();
  const explicit = new Set<string>();
  let links = 0;
  for (const edge of graph.edges) {
    if (edge.kind === "link") { explicit.add(edge.source); explicit.add(edge.target); }
    if (edge.kind === "folder" || edge.kind === "tag") continue;
    const a = byId.get(edge.source), b = byId.get(edge.target);
    if (!a || !b || !isDoc(a) || !isDoc(b) || a.id === b.id) continue;
    links++;
    for (const [x, y] of [[a.id, b.id], [b.id, a.id]] as const) { const row = near.get(x) ?? new Map<string, number>(); row.set(y, (row.get(y) ?? 0) + strengthOf(edge)); near.set(x, row); }
  }
  let triads = 0, closed = 0, weight = 0;
  const inside = new Map<string, number>(), mass = new Map<string, number>();
  for (const node of docs) {
    const row = near.get(node.id);
    if (!row) continue;
    const own = clusterOf.get(node.id) ?? node.id;
    for (const [other, value] of row) { weight += value; mass.set(own, (mass.get(own) ?? 0) + value); if ((clusterOf.get(other) ?? other) === own) inside.set(own, (inside.get(own) ?? 0) + value); }
    const list = [...row.keys()];
    if (list.length < 2) continue;
    let pairs = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (near.get(list[i]!)?.has(list[j]!)) pairs++;
    triads++;
    closed += pairs / ((list.length * (list.length - 1)) / 2);
  }
  let modularity = 0;
  if (weight > 0) for (const [cluster, value] of mass) modularity += (inside.get(cluster) ?? 0) / weight - (value / weight) ** 2;
  const notes = docs.filter((node) => node.kind === "note");
  const n = docs.length;
  const health: Health = {
    docs: n, links, degree: n ? (2 * links) / n : 0, density: n > 1 ? (2 * links) / (n * (n - 1)) : 0, clustering: triads ? closed / triads : 0, modularity,
    connected: n ? largest / n : 0, linked: notes.length ? notes.filter((node) => explicit.has(node.id)).length / notes.length : 0, orphaned: notes.length ? orphans.length / notes.length : 0,
  };
  return { rank, glow, between, clusterOf, degree, hubs, bridges: bridges.slice(0, 12), gaps: gaps.slice(0, 8), orphans, islands, health };
}

/** 상태 지표를 읽고 먼저 손볼 곳을 한두 줄로 알린다(화면의 발견 패널과 `relay graph map`이 함께 쓴다). */
export function healthNotes(health: Health): string[] {
  if (health.docs < 4) return [];
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const notes: string[] = [];
  if (health.orphaned > 0.3) notes.push(`메모의 ${percent(health.orphaned)}가 어디에도 닿지 않습니다. 본문에 [[제목]]이나 #태그를 적어 이어 보세요.`);
  if (health.linked < 0.3) notes.push(`직접 링크로 이어진 메모가 ${percent(health.linked)}뿐입니다. 제안 연결부터 이으면 그래프가 또렷해집니다.`);
  if (health.connected < 0.5 && health.docs >= 8) notes.push(`가장 큰 덩어리에 든 글이 ${percent(health.connected)}입니다. 주제 사이의 틈에 다리를 놓으면 덩어리가 이어집니다.`);
  if (health.modularity < 0.15 && health.docs >= 12 && health.links >= 12) notes.push("주제가 뚜렷이 나뉘지 않고 한데 뭉쳐 있습니다. 태그나 폴더로 갈래를 잡아 보세요.");
  return notes.length ? notes.slice(0, 2) : ["메모가 고르게 이어져 있습니다."];
}

/** semantic은 임베딩으로 잰 뜻의 가까움이며, 근거가 된 두 절(from 쪽·to 쪽의 소제목)을 함께 싣는다. */
export type SuggestReason = { kind: "mention" | "similar" | "neighbors" | "gap" | "semantic"; text: string; evidence?: { from: string; to: string } };
export type Suggestion = { from: string; to: string; score: number; reasons: SuggestReason[] };

/** 제안 연결: 아직 `[[링크]]`로 잇지 않았지만 이으면 좋을 메모 쌍. from 메모의 본문에 to로 가는 링크를 적는 쪽으로 제안한다.
 *  - 제목이 본문에 나오는데 링크가 아닌 쌍(언급)이 가장 강한 신호다.
 *  - 드문 낱말을 함께 쓰는 쌍, 같은 점에 함께 이어진 쌍(Adamic–Adar: 이웃이 적은 점을 함께 알수록 높다), 주제 사이의 틈을 메우는 쌍. */
export function suggestLinks(graph: NoteGraph, insight: Insight = analyze(graph), options: { limit?: number; only?: string } = {}): Suggestion[] {
  const { limit = 12, only } = options;
  const byId = graph.byId;
  const isNote = (id: string) => byId.get(id)?.kind === "note";
  const key = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const linked = new Set<string>(), direct = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "link") linked.add(key(edge.source, edge.target));
    if (edge.kind !== "folder") direct.add(key(edge.source, edge.target));
  }
  const found = new Map<string, Suggestion>();
  const propose = (from: string, to: string, score: number, reason: SuggestReason, directed = false) => {
    if (from === to || !isNote(from) || !isNote(to) || linked.has(key(from, to))) return;
    const id = key(from, to);
    const known = found.get(id);
    if (known) { known.score = Math.min(0.99, Math.max(known.score, score) + 0.12 * Math.min(known.score, score)); known.reasons.push(reason); if (directed) { known.from = from; known.to = to; } return; }
    // 방향이 정해지지 않은 쌍은 더 최근에 고친 메모에 링크를 적는다(지금 손대고 있을 가능성이 높다).
    const [x, y] = directed || (byId.get(from)!.updatedAt >= byId.get(to)!.updatedAt) ? [from, to] : [to, from];
    found.set(id, { from: x, to: y, score, reasons: [reason] });
  };
  const name = (id: string) => byId.get(id)?.label ?? id;

  for (const edge of graph.edges) {
    if (edge.kind === "mention") propose(edge.source, edge.target, 0.9, { kind: "mention", text: `본문에 ‘${name(edge.target)}’ 제목이 나오지만 링크가 아닙니다` }, true);
    else if (edge.kind === "similar") {
      const words = sharedWords(graph.vectors.get(edge.source), graph.vectors.get(edge.target));
      propose(edge.source, edge.target, 0.3 + 0.55 * edge.weight, { kind: "similar", text: `드문 낱말을 함께 씁니다${words.length ? `: ${words.join(", ")}` : ""}` });
    } else if (edge.kind === "semantic") {
      const item = graph.semantic.get(key(edge.source, edge.target));
      const section = (id: string) => (item ? (item.a === id ? item.aHeading : item.bHeading) : "");
      const reason: SuggestReason = { kind: "semantic", text: "낱말은 달라도 뜻이 가깝습니다" };
      propose(edge.source, edge.target, 0.42 + 0.48 * edge.weight, reason);
      // 근거 절은 링크를 적을 쪽(from)과 받을 쪽(to)에 맞춰 적는다(쌍의 방향은 propose가 정한다).
      const made = found.get(key(edge.source, edge.target));
      if (made && item) {
        reason.evidence = { from: section(made.from), to: section(made.to) };
        const names = [reason.evidence.from, reason.evidence.to].filter(Boolean);
        if (names.length) reason.text = `낱말은 달라도 뜻이 가깝습니다: ${names.map((value) => `「${value.split(" > ").pop()}」`).join(" ↔ ")}`;
      }
    }
  }

  // 공통 이웃(Adamic–Adar). 태그·세션도 이웃으로 친다.
  const around = adjacency(graph, CONTENT_KINDS);
  const common = new Map<string, { score: number; via: string[] }>();
  for (const node of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const arcs = around.get(node.id) ?? [];
    const near = [...new Set(arcs.map((arc) => arc.to))].filter(isNote).sort();
    if (near.length < 2 || near.length > 40) continue;
    const gain = 1 / Math.log(1 + near.length);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const id = `${near[i]}\n${near[j]}`;
      const entry = common.get(id);
      if (entry) { entry.score += gain; entry.via.push(node.id); } else common.set(id, { score: gain, via: [node.id] });
    }
  }
  for (const [id, entry] of common) {
    const [a, b] = id.split("\n") as [string, string];
    if (entry.via.length < 2 && direct.has(id) === false) continue;
    if (entry.score < 1) continue;
    const via = entry.via.slice(0, 3).map(name).join(", ");
    propose(a, b, Math.min(0.8, 0.28 + 0.2 * entry.score), { kind: "neighbors", text: `같은 점 ${entry.via.length}개에 함께 이어져 있습니다: ${via}` });
  }

  const clusterLabel = new Map(graph.clusters.map((cluster) => [cluster.id, cluster.label]));
  for (const gap of insight.gaps) {
    if (!gap.pair) continue;
    propose(gap.pair.from, gap.pair.to, Math.min(0.85, 0.42 + gap.affinity), { kind: "gap", text: `떨어져 있는 주제 ‘${clusterLabel.get(gap.a)}’와 ‘${clusterLabel.get(gap.b)}’를 잇는 다리가 됩니다` });
  }

  return [...found.values()].filter((entry) => !only || entry.from === only || entry.to === only)
    .sort((a, b) => b.score - a.score || (a.from + a.to < b.from + b.to ? -1 : 1)).slice(0, limit);
}

/** 그래프에 든 것의 수. */
export function tally(graph: Graph) {
  const nodes: Record<GraphNode["kind"], number> = { note: 0, folder: 0, tag: 0, session: 0, project: 0 };
  for (const node of graph.nodes) nodes[node.kind]++;
  const edges: Record<EdgeKind, number> = { link: 0, mention: 0, similar: 0, folder: 0, tag: 0, chain: 0, semantic: 0 };
  for (const edge of graph.edges) edges[edge.kind]++;
  return { nodes, edges };
}
