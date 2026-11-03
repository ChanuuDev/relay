/** 사무실 장면의 좌석과 걷는 길. 좌표는 모두 장면 픽셀이다(쿼터뷰 격자를 화면에 투영한 자리). */
export type Point = readonly [number, number];
export type WorkZone = "working" | "blocked" | "handoff" | "done";
export type Zone = WorkZone | "hall";
export const WORK_ZONES: readonly WorkZone[] = ["working", "blocked", "handoff", "done"];

/** 앉는 자리. stand가 있으면 의자 대신 그 방향을 보고 서서 머문다(인계 방의 서서 나누는 자리). chair는 발이 닿는 바닥이다.
 *  앉으면 등을 보이고 오른쪽 위 책상을 보며, flip이면 왼쪽 위 책상을 본다.
 *  책상 자리(stand·lounge가 없는 자리)에는 사옥의 의자 스프라이트를 앉은 사람 앞에 그려 등받이가 등을 가린다.
 *  lounge면 배경의 소파·안락의자에 앞(오른쪽 아래, flip이면 왼쪽 아래)을 보고 앉으며, chair는 발이 닿는 바닥이다. */
export interface Seat {
  id: string; chair: Point; approach: string; flip?: boolean;
  /** 격자 사무실에서 좌석이 놓인 칸 */
  cell?: readonly [number, number];
  stand?: { view: "front" | "back"; flip?: boolean };
  lounge?: { flip?: boolean };
}

/** 책상 자리인지(의자를 그릴 자리). */
export const deskSeat = (seat: Seat) => !seat.stand && !seat.lounge;
export interface ZoneLayout { seats: Seat[]; door: string }
export interface OfficeLayout {
  image: { width: number; height: number };
  zones: Record<WorkZone, ZoneLayout>;
  hall: { center: Point; spawn: Point[]; wander: Point[] };
  nodes: Record<string, Point>;
  edges: [string, string][];
  /** 퇴근하는 세션이 걸어 나가는 출구 노드(로비의 EXIT 문). 없으면 홀 가운데에서 사라진다. */
  exit?: string | null;
  /** 구역마다 바닥 넓이(다각형). 끌어 놓은 자리가 어느 구역인지 가린다. */
  areas?: Partial<Record<Zone, Point[]>>;
  /** 쿼터뷰 격자. 있으면 구역·걷는 칸을 격자 칸으로 가리고, 길은 칸을 따라 꺾임이 적게 잡는다. */
  grid?: GridInfo;
}

/** 2:1 쿼터뷰 격자. 칸 (x, y)의 위 꼭짓점이 화면 origin + ((x - y) * halfW, (x + y) * halfH)이다. */
export interface GridInfo {
  cols: number; rows: number;
  origin: Point;
  halfW: number; halfH: number;
  /** 칸마다 구역(y * cols + x). 바깥은 null */
  zones: readonly (Zone | null)[];
  /** 칸마다 걸어 다닐 수 있는지(가구·좌석·바깥이 아님) */
  open: readonly boolean[];
}

/** 격자 좌표(칸 단위, 연속) → 장면 픽셀 */
export const gridToScene = (grid: GridInfo, gx: number, gy: number): Point =>
  [grid.origin[0] + (gx - gy) * grid.halfW, grid.origin[1] + (gx + gy) * grid.halfH];
/** 장면 픽셀 → 격자 좌표(칸 단위, 연속) */
export function sceneToGrid(grid: GridInfo, x: number, y: number): Point {
  const u = (x - grid.origin[0]) / grid.halfW, v = (y - grid.origin[1]) / grid.halfH;
  return [(u + v) / 2, (v - u) / 2];
}
/** 장면 픽셀이 놓인 칸. 격자 밖이면 null */
export function cellAt(grid: GridInfo, x: number, y: number): readonly [number, number] | null {
  const [gx, gy] = sceneToGrid(grid, x, y);
  const cx = Math.floor(gx), cy = Math.floor(gy);
  return cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows ? [cx, cy] : null;
}
/** 칸 가운데(장면 픽셀) */
export const cellCenter = (grid: GridInfo, cx: number, cy: number) => gridToScene(grid, cx + 0.5, cy + 0.5);
/** 걷는 칸의 길 노드 이름 */
export const cellNode = (cx: number, cy: number) => `c:${cx},${cy}`;
/** 장면 픽셀에서 가장 가까운 걷는 칸. 놓은 칸이 벽·가구·바깥이면 둘레를 넓혀 가며 찾는다. */
export function nearestOpenCell(grid: GridInfo, x: number, y: number): readonly [number, number] | null {
  const [gx, gy] = sceneToGrid(grid, x, y);
  const fx = Math.floor(gx), fy = Math.floor(gy);
  let best: [number, number] | null = null, score = Infinity;
  const limit = grid.cols + grid.rows;
  for (let ring = 0; ring < limit; ring++) {
    for (let cy = fy - ring; cy <= fy + ring; cy++) for (let cx = fx - ring; cx <= fx + ring; cx++) {
      if (Math.max(Math.abs(cx - fx), Math.abs(cy - fy)) !== ring) continue;
      if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows || !grid.open[cy * grid.cols + cx]) continue;
      const value = Math.hypot(cx + 0.5 - gx, cy + 0.5 - gy);
      if (value < score) { score = value; best = [cx, cy]; }
    }
    // 이번 둘레에서 찾았으면 다음 둘레의 칸은 더 멀다.
    if (best && score <= ring + 0.5) return best;
  }
  return best;
}

/** 점이 다각형 안에 있는지(짝홀 규칙). */
export function inside(polygon: readonly Point[], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 장면 좌표가 어느 구역 바닥인지. 벽·바깥이면 null. */
export function zoneAt(layout: OfficeLayout, x: number, y: number): Zone | null {
  if (layout.grid) {
    const cell = cellAt(layout.grid, x, y);
    return cell ? layout.grid.zones[cell[1] * layout.grid.cols + cell[0]] ?? null : null;
  }
  for (const [zone, polygon] of Object.entries(layout.areas ?? {}) as [Zone, Point[]][]) if (inside(polygon, x, y)) return zone;
  return null;
}

export const HALL_CENTER = "hall:center";
export const seatNode = (seat: string) => `seat:${seat}`;
export const spawnNode = (index: number) => `spawn:${index}`;
export const wanderNode = (index: number) => `wander:${index}`;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 격자에서 방향을 꺾을 때 더하는 거리. 같은 길이면 꺾임이 적은(곧게 뻗은) 길을 고른다. */
const TURN_COST = 10;

/** 길찾기용 최소 힙 */
class Heap {
  private readonly items: [number, string][] = [];
  get size() { return this.items.length; }
  push(score: number, id: string) {
    const items = this.items;
    items.push([score, id]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent]![0] <= score) break;
      [items[parent], items[index]] = [items[index]!, items[parent]!];
      index = parent;
    }
  }
  pop(): [number, string] {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < items.length && items[left]![0] < items[smallest]![0]) smallest = left;
        if (right < items.length && items[right]![0] < items[smallest]![0]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index]!, items[smallest]!];
        index = smallest;
      }
    }
    return top;
  }
}

/** 걷는 길 그래프. 좌석·홀의 생성 지점·배회 지점도 노드로 넣어 한 가지 길찾기로 다룬다. */
export class WalkGraph {
  readonly points = new Map<string, Point>();
  private readonly links = new Map<string, Set<string>>();

  constructor(readonly layout: OfficeLayout) {
    for (const [id, point] of Object.entries(layout.nodes)) this.points.set(id, point);
    for (const [a, b] of layout.edges) this.link(a, b);
    // 홀 가운데는 가까운 길 노드 셋과 잇는다. 홀은 트인 바닥이라 곧게 걸어도 가로막는 것이 없다.
    // 격자 사무실은 홀에도 가구가 있으므로 홀 가운데·나타나는 자리·배회 자리를 그 칸의 길 노드에만 잇는다.
    this.points.set(HALL_CENTER, layout.hall.center);
    const nearest = [...Object.entries(layout.nodes)]
      .sort(([, a], [, b]) => distance(a, layout.hall.center) - distance(b, layout.hall.center)).slice(0, layout.grid ? 1 : 3);
    for (const [id] of nearest) this.link(HALL_CENTER, id);
    const hub = (point: Point) => (layout.grid ? this.closest(point) : HALL_CENTER);
    layout.hall.spawn.forEach((point, index) => { this.points.set(spawnNode(index), point); this.link(spawnNode(index), hub(point)); });
    layout.hall.wander.forEach((point, index) => { this.points.set(wanderNode(index), point); this.link(wanderNode(index), hub(point)); });
    for (const zone of Object.values(layout.zones)) {
      for (const seat of zone.seats) { this.points.set(seatNode(seat.id), seat.chair); this.link(seatNode(seat.id), seat.approach); }
    }
  }

  /** 지도의 길 노드 중 가장 가까운 것 */
  private closest(point: Point) {
    let best = HALL_CENTER, score = Infinity;
    for (const [id, node] of Object.entries(this.layout.nodes)) {
      const value = distance(node, point);
      if (value < score) { score = value; best = id; }
    }
    return best;
  }

  private link(a: string, b: string) {
    if (!this.links.has(a)) this.links.set(a, new Set());
    if (!this.links.has(b)) this.links.set(b, new Set());
    this.links.get(a)!.add(b);
    this.links.get(b)!.add(a);
  }

  point(id: string): Point {
    const point = this.points.get(id);
    if (!point) throw new Error(`사무실 길 노드가 없습니다: ${id}`);
    return point;
  }

  /** from에서 to까지 거쳐 갈 노드(from은 빼고 to는 넣는다). 길이 없으면 null. 좌석 노드는 끝점일 때만 지난다.
   *  격자 사무실은 같은 길이면 꺾임이 적은 길을 고른다. */
  route(from: string, to: string): string[] | null {
    if (from === to) return [];
    const turn = this.layout.grid ? TURN_COST : 0;
    const best = new Map<string, number>([[from, 0]]);
    const previous = new Map<string, string>();
    const done = new Set<string>();
    const open = new Heap();
    open.push(0, from);
    while (open.size) {
      const [score, current] = open.pop();
      if (done.has(current)) continue;
      done.add(current);
      if (current === to) break;
      const here = this.point(current);
      const back = previous.get(current);
      const before = back ? this.point(back) : null;
      for (const next of this.links.get(current) ?? []) {
        if (done.has(next) || (next !== to && next !== from && next.startsWith("seat:"))) continue;
        const there = this.point(next);
        let value = score + distance(here, there);
        if (turn && before) {
          const cross = (here[0] - before[0]) * (there[1] - here[1]) - (here[1] - before[1]) * (there[0] - here[0]);
          if (Math.abs(cross) > 1) value += turn;
        }
        if (value < (best.get(next) ?? Infinity)) { best.set(next, value); previous.set(next, current); open.push(value, next); }
      }
    }
    if (!previous.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(previous.get(path[0]!)!);
    return path.slice(1);
  }
}
