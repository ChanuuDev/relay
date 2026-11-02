/** 사무실 배경 그림 위의 좌석과 걷는 길. 좌표는 모두 배경 그림의 픽셀이다. */
export type Point = readonly [number, number];
export type WorkZone = "working" | "blocked" | "handoff" | "done";
export type Zone = WorkZone | "hall";
export const WORK_ZONES: readonly WorkZone[] = ["working", "blocked", "handoff", "done"];

/** 앉는 자리. stand가 있으면 의자 대신 그 방향을 보고 서서 머문다(인계 방의 서서 나누는 자리). chair는 발이 닿는 바닥이다.
 *  앉으면 등을 보이고 오른쪽 위 책상을 보며, flip이면 왼쪽 위 책상을 본다. */
export interface Seat { id: string; chair: Point; approach: string; flip?: boolean; stand?: { view: "front" | "back"; flip?: boolean } }
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

/** 배경 좌표가 어느 구역 바닥인지. 벽·바깥이면 null. */
export function zoneAt(layout: OfficeLayout, x: number, y: number): Zone | null {
  for (const [zone, polygon] of Object.entries(layout.areas ?? {}) as [Zone, Point[]][]) if (inside(polygon, x, y)) return zone;
  return null;
}

export const HALL_CENTER = "hall:center";
export const seatNode = (seat: string) => `seat:${seat}`;
export const spawnNode = (index: number) => `spawn:${index}`;
export const wanderNode = (index: number) => `wander:${index}`;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 걷는 길 그래프. 좌석·홀의 생성 지점·배회 지점도 노드로 넣어 한 가지 길찾기로 다룬다. */
export class WalkGraph {
  readonly points = new Map<string, Point>();
  private readonly links = new Map<string, Set<string>>();

  constructor(readonly layout: OfficeLayout) {
    for (const [id, point] of Object.entries(layout.nodes)) this.points.set(id, point);
    for (const [a, b] of layout.edges) this.link(a, b);
    // 홀 가운데는 가까운 길 노드 셋과 잇는다. 홀은 트인 바닥이라 곧게 걸어도 가로막는 것이 없다.
    this.points.set(HALL_CENTER, layout.hall.center);
    const nearest = [...Object.entries(layout.nodes)]
      .sort(([, a], [, b]) => distance(a, layout.hall.center) - distance(b, layout.hall.center)).slice(0, 3);
    for (const [id] of nearest) this.link(HALL_CENTER, id);
    layout.hall.spawn.forEach((point, index) => { this.points.set(spawnNode(index), point); this.link(spawnNode(index), HALL_CENTER); });
    layout.hall.wander.forEach((point, index) => { this.points.set(wanderNode(index), point); this.link(wanderNode(index), HALL_CENTER); });
    for (const zone of Object.values(layout.zones)) {
      for (const seat of zone.seats) { this.points.set(seatNode(seat.id), seat.chair); this.link(seatNode(seat.id), seat.approach); }
    }
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

  /** from에서 to까지 거쳐 갈 노드(from은 빼고 to는 넣는다). 길이 없으면 null. 좌석 노드는 끝점일 때만 지난다. */
  route(from: string, to: string): string[] | null {
    if (from === to) return [];
    const best = new Map<string, number>([[from, 0]]);
    const previous = new Map<string, string>();
    const open = new Set([from]);
    while (open.size) {
      let current = "";
      let score = Infinity;
      for (const id of open) { const value = best.get(id)!; if (value < score) { score = value; current = id; } }
      open.delete(current);
      if (current === to) break;
      for (const next of this.links.get(current) ?? []) {
        if (next !== to && next !== from && next.startsWith("seat:")) continue;
        const value = score + distance(this.point(current), this.point(next));
        if (value < (best.get(next) ?? Infinity)) { best.set(next, value); previous.set(next, current); open.add(next); }
      }
    }
    if (!previous.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(previous.get(path[0]!)!);
    return path.slice(1);
  }
}
