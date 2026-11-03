// 쿼터뷰(2:1 아이소메트릭) 격자 사무실. 바닥 칸·벽 조각·문·가구·소품을 모두 격자 좌표에 놓고,
// 걷는 길·좌석·구역은 그 격자에서 만든다. 그림 한 장에 좌표를 덧대던 방식과 달리 벽과 가구가 칸을 막아
// 캐릭터가 벽·가구를 통과하지 않고, 그릴 때는 바닥 넓이로 앞뒤를 가려 겹침이 바르다.
import { cellCenter, cellNode, gridToScene, type GridInfo, type OfficeLayout, type Point, type Seat, type WorkZone, type Zone, type ZoneLayout } from "./layout";

/** 칸 하나의 화면 반너비·반높이(장면 픽셀). 칸 하나가 대략 1m다. */
export const HALF_W = 32;
export const HALF_H = 16;
/** 벽 높이(장면 픽셀) */
export const WALL_H = 88;
/** 바닥 판 두께(장면 픽셀) */
export const SLAB_H = 20;
/** 장면 가장자리 여백 */
const MARGIN = 36;

export type Cell = readonly [number, number];
/** n: 칸의 위(북)쪽 모서리를 따라 x로 뻗는 벽, w: 칸의 왼(서)쪽 모서리를 따라 y로 뻗는 벽 */
export type Side = "n" | "w";

/** 스프라이트 묶음 그림 안의 자리(r: x, y, 너비, 높이)와 기준점(a: 그림 안에서 격자 기준 꼭짓점이 오는 픽셀) */
export interface KitSprite { r: readonly [number, number, number, number]; a: readonly [number, number] }
/** 가구·소품. f는 기본 방향의 바닥 넓이(x칸, y칸)이고 뒤집으면 바뀐다. 기준점은 바닥 넓이의 위 꼭짓점이다. */
export interface KitItem extends KitSprite {
  f: readonly [number, number];
  /** 앉은 사람보다 앞에 그린다(등받이가 등을 가리는 책상 의자). 아니면 앉은 사람이 앞이다(소파). */
  cover?: boolean;
  /** 밟고 지나가는 바닥 깔개 */
  floor?: boolean;
}
/** 사옥 하나의 그림 묶음. 파이썬 빌드(저장소 밖 output/office/kit)가 만든다. */
export interface Kit {
  atlas: string;
  /** 바닥 재질 그림. 재질마다 [x, y, 한 변, 덮는 칸 수] 정사각형이고 이음매 없이 되풀이된다. */
  floors: string;
  floorTiles: Record<string, readonly [number, number, number, number]>;
  items: Record<string, KitItem>;
  /** 벽 조각(칸 하나 길이). 기준점은 조각이 시작하는 격자 꼭짓점의 바닥이다. */
  walls: Record<string, { n: KitSprite; w: KitSprite }>;
  /** 벽 끝·모서리 기둥. 기준점은 격자 꼭짓점의 바닥이다. */
  posts: Record<string, KitSprite>;
  /** 벽에 붙이는 장식(창·문·화이트보드…). span칸 길이이고 기준점은 첫 조각의 시작 꼭짓점 바닥이다. */
  decor: Record<string, { n: KitSprite; w: KitSprite; span: number }>;
}

/**
 * 벽 한 줄. side가 n이면 (x, y) 칸의 위쪽 모서리부터 x로, w면 왼쪽 모서리부터 y로 pattern 글자 수만큼 뻗는다.
 * W 벽, G 유리 칸막이, L 낮은 벽, D 문 없는 출입구(위에 인방), d 유리 칸막이의 출입구, O 트인 통로(기둥만), o 낮은 벽의 트인 통로,
 * E 출구 유리문(퇴근하는 세션이 나간다), 공백은 벽 없음.
 */
export interface WallRun { side: Side; x: number; y: number; pattern: string }
/** 벽 장식. (x, y)는 장식이 시작하는 벽 조각의 칸이다. */
export interface Decor { side: Side; x: number; y: number; sprite: string }
/** 구역 이름 간판. 벽 조각 위에 붙는다. */
export interface Sign { side: Side; x: number; y: number; span: number; title: string; sub: string; zone: Zone; /** 바닥에서 간판 아래까지(장면 픽셀). 기본 56 */ lift?: number; /** 작은 간판(출구 표지) */ small?: boolean }
/** 가구·소품. flip이면 좌우를 뒤집어 놓는다(바닥 넓이의 x·y가 바뀐다). */
export interface Placed { sprite: string; x: number; y: number; flip?: boolean }
/**
 * 좌석. desk는 그 칸의 책상 의자에 등을 보이고 앉아 위쪽(-y, flip이면 -x) 책상을 본다.
 * lounge는 소파·안락의자에 앞(+x, flip이면 +y)을 보고 앉는다. stand는 빈 바닥에 그 방향을 보고 선다.
 */
export interface SeatDef { id: string; zone: WorkZone; x: number; y: number; kind: "desk" | "lounge" | "stand"; flip?: boolean; view?: "front" | "back" }
export interface MapDef {
  cols: number; rows: number;
  /** 한 줄에 칸 하나씩 바닥 글자. 공백은 바깥 */
  floor: readonly string[];
  /** 바닥 글자 → 구역과 바닥 재질 */
  legend: Record<string, { zone: Zone; floor: string }>;
  walls: readonly WallRun[];
  decor?: readonly Decor[];
  signs?: readonly Sign[];
  items: readonly Placed[];
  seats: readonly SeatDef[];
  hall: { center: Cell; spawn: readonly Cell[]; wander: readonly Cell[] };
  /** 출구 유리문 앞 칸. 퇴근하는 세션이 여기서 문으로 나간다. */
  exit: Cell;
  /** 홀 바닥에 새긴 글자 */
  logo?: { x: number; y: number; text: string };
}

export interface PlannedWall { side: Side; x: number; y: number; kind: string }
export interface PlannedItem { sprite: string; x: number; y: number; w: number; h: number; flip: boolean; item: KitItem }
export interface PlannedSeat extends SeatDef { point: Point; approach: Cell }
/** 지도 정의를 풀어 놓은 것. 시뮬레이션은 layout만, 그리기는 나머지를 쓴다. */
export interface WorldPlan {
  map: MapDef;
  kit: Kit;
  grid: GridInfo;
  width: number; height: number;
  floors: readonly (string | null)[];
  walls: readonly PlannedWall[];
  /** 기둥: 격자 꼭짓점과 종류 */
  posts: readonly { x: number; y: number; kind: string }[];
  items: readonly PlannedItem[];
  seats: readonly PlannedSeat[];
  layout: OfficeLayout;
}

/** 벽 글자 → 그릴 벽 조각 종류(없으면 그리지 않음)와 지나갈 수 있는지 */
const WALL_KINDS: Record<string, { kind: string | null; post: string | null; pass: boolean }> = {
  W: { kind: "wall", post: "wall", pass: false },
  G: { kind: "glass", post: "glass", pass: false },
  L: { kind: "low", post: "low", pass: false },
  D: { kind: "header", post: "wall", pass: true },
  d: { kind: "glassHeader", post: "glass", pass: true },
  O: { kind: null, post: "wall", pass: true },
  o: { kind: null, post: "low", pass: true },
  E: { kind: "wall", post: "wall", pass: false },
  " ": { kind: null, post: null, pass: true },
};

/** 앉은 사람의 엉덩이 자리: 칸 가운데에서 얼마나 옮기는지(flip이면 x를 뒤집는다). 앉는 그림의 기준점이 의자 방석에 오게 한다. */
const SIT_OFFSET: Record<"desk" | "lounge", Point> = { desk: [-4, -18], lounge: [0, -14] };

const index = (map: MapDef, x: number, y: number) => y * map.cols + x;
const edgeKey = (side: Side, x: number, y: number) => `${side}:${x},${y}`;

/** 지도 정의를 걷는 길·좌석·구역(시뮬레이션)과 그릴 것들(바닥·벽·가구)로 푼다. 지도가 잘못되면 이유를 들어 던진다. */
export function planWorld(map: MapDef, kit: Kit): WorldPlan {
  const { cols, rows } = map;
  if (map.floor.length !== rows) throw new Error(`바닥 줄 수가 ${rows}이 아닙니다: ${map.floor.length}`);
  const zones: (Zone | null)[] = [], floors: (string | null)[] = [];
  for (let y = 0; y < rows; y++) {
    const line = map.floor[y]!;
    if (line.length !== cols) throw new Error(`${y}번째 바닥 줄 길이가 ${cols}이 아닙니다: ${line.length}`);
    for (let x = 0; x < cols; x++) {
      const entry = line[x] === " " ? null : map.legend[line[x]!];
      if (line[x] !== " " && !entry) throw new Error(`모르는 바닥 글자: ${line[x]}`);
      zones.push(entry?.zone ?? null);
      floors.push(entry?.floor ?? null);
    }
  }
  const origin: Point = [MARGIN + rows * HALF_W, MARGIN + WALL_H];
  const width = Math.ceil(2 * MARGIN + (cols + rows) * HALF_W);
  const height = Math.ceil(2 * MARGIN + WALL_H + (cols + rows) * HALF_H + SLAB_H);

  // 벽: 그릴 조각과 막힌 모서리, 끝마다 기둥
  const walls: PlannedWall[] = [];
  const blocked = new Set<string>();
  const posts = new Map<string, { x: number; y: number; kind: string }>();
  const post = (x: number, y: number, kind: string) => {
    const key = `${x},${y}`;
    const rank = (value: string) => ["low", "glass", "wall"].indexOf(value);
    const before = posts.get(key);
    if (!before || rank(kind) > rank(before.kind)) posts.set(key, { x, y, kind });
  };
  for (const run of map.walls) {
    [...run.pattern].forEach((char, step) => {
      const spec = WALL_KINDS[char];
      if (!spec) throw new Error(`모르는 벽 글자: ${char}`);
      const x = run.side === "n" ? run.x + step : run.x, y = run.side === "n" ? run.y : run.y + step;
      if (!spec.pass) blocked.add(edgeKey(run.side, x, y));
      if (spec.kind) {
        if (!kit.walls[spec.kind]) throw new Error(`그림 묶음에 벽 조각이 없습니다: ${spec.kind}`);
        walls.push({ side: run.side, x, y, kind: spec.kind });
      }
      if (spec.post) {
        // 조각의 두 끝. 같은 종류가 이어지는 가운데 이음매에도 세워 유리 칸막이의 창살·벽의 이음매가 된다.
        const prev = run.pattern[step - 1], next = run.pattern[step + 1];
        const endX = run.side === "n" ? x + 1 : x, endY = run.side === "n" ? y : y + 1;
        if (char === "G" || char === "d" || !prev || prev !== char) post(x, y, spec.post);
        if (char === "G" || char === "d" || !next || next !== char) post(endX, endY, spec.post);
      }
    });
  }

  // 가구: 칸을 차지한다(깔개는 빼고).
  const taken = new Array<boolean>(cols * rows).fill(false);
  const items: PlannedItem[] = map.items.map((placed) => {
    const item = kit.items[placed.sprite];
    if (!item) throw new Error(`그림 묶음에 가구가 없습니다: ${placed.sprite}`);
    const flip = Boolean(placed.flip);
    const [w, h] = flip ? [item.f[1], item.f[0]] : item.f;
    for (let y = placed.y; y < placed.y + h; y++) for (let x = placed.x; x < placed.x + w; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows || !zones[index(map, x, y)]) throw new Error(`${placed.sprite}가 바닥 밖에 있습니다: ${x},${y}`);
      if (!item.floor) {
        if (taken[index(map, x, y)]) throw new Error(`${placed.sprite}가 다른 가구와 겹칩니다: ${x},${y}`);
        taken[index(map, x, y)] = true;
      }
    }
    return { sprite: placed.sprite, x: placed.x, y: placed.y, w, h, flip, item };
  });
  // 좌석 칸도 길이 아니다(앉으러 갈 때만 들어간다).
  const seatCells = new Set(map.seats.map((seat) => `${seat.x},${seat.y}`));
  const open = zones.map((zone, at) => zone !== null && !taken[at] && !seatCells.has(`${at % cols},${Math.floor(at / cols)}`));
  const grid: GridInfo = { cols, rows, origin, halfW: HALF_W, halfH: HALF_H, zones, open };

  // (x, y)에서 (x + dx, y + dy)로 한 칸 걸을 때 넘는 모서리가 막혔는지
  const crossing = (x: number, y: number, dx: number, dy: number) =>
    dx === 1 ? edgeKey("w", x + 1, y) : dx === -1 ? edgeKey("w", x, y) : dy === 1 ? edgeKey("n", x, y + 1) : edgeKey("n", x, y);
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && open[index(map, x, y)]!;
  const passable = (x: number, y: number, dx: number, dy: number) => !blocked.has(crossing(x, y, dx, dy));

  const nodes: Record<string, Point> = {};
  const edges: [string, string][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!isOpen(x, y)) continue;
    nodes[cellNode(x, y)] = cellCenter(grid, x, y);
    if (isOpen(x + 1, y) && passable(x, y, 1, 0)) edges.push([cellNode(x, y), cellNode(x + 1, y)]);
    if (isOpen(x, y + 1) && passable(x, y, 0, 1)) edges.push([cellNode(x, y), cellNode(x, y + 1)]);
  }

  // 홀 가운데에서 닿지 않는 칸(책상 뒤 벽과의 틈 같은 막힌 곳)은 걷는 칸에서 뺀다. 끌어 놓아도 그곳에는 내려앉지 않는다.
  const [hx, hy] = map.hall.center;
  if (isOpen(hx, hy)) {
    const links = new Map<string, string[]>();
    for (const [a, b] of edges) { links.set(a, [...(links.get(a) ?? []), b]); links.set(b, [...(links.get(b) ?? []), a]); }
    const reached = new Set([cellNode(hx, hy)]);
    const queue = [cellNode(hx, hy)];
    while (queue.length) for (const next of links.get(queue.shift()!) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!open[index(map, x, y)] || reached.has(cellNode(x, y))) continue;
      open[index(map, x, y)] = false;
      delete nodes[cellNode(x, y)];
    }
    for (let at = edges.length - 1; at >= 0; at--) if (!nodes[edges[at]![0]] || !nodes[edges[at]![1]]) edges.splice(at, 1);
  }

  // 좌석: 앉는 자리(장면 픽셀)와 들어가는 칸
  const seats: PlannedSeat[] = map.seats.map((seat) => {
    const zone = zones[index(map, seat.x, seat.y)];
    if (zone !== seat.zone) throw new Error(`${seat.id} 좌석이 ${seat.zone} 구역 밖에 있습니다`);
    const flip = Boolean(seat.flip);
    // 들어가는 칸: 책상 자리는 책상 반대쪽, 소파는 보는 쪽, 서는 자리는 보는 쪽부터
    const prefer: Cell[] = seat.kind === "desk" ? [flip ? [1, 0] : [0, 1]]
      : seat.kind === "lounge" ? [flip ? [0, 1] : [1, 0]]
      : [seat.view === "back" ? (flip ? [-1, 0] : [0, -1]) : (flip ? [0, 1] : [1, 0])];
    const order: Cell[] = [...prefer, [0, 1], [1, 0], [0, -1], [-1, 0]];
    const step = order.find(([dx, dy]) => isOpen(seat.x + dx, seat.y + dy) && passable(seat.x, seat.y, dx, dy));
    if (!step) throw new Error(`${seat.id} 좌석에 들어갈 칸이 없습니다`);
    const center = cellCenter(grid, seat.x, seat.y);
    const offset = seat.kind === "stand" ? [0, 0] : SIT_OFFSET[seat.kind];
    const point: Point = [center[0] + (flip ? -offset[0]! : offset[0]!), center[1] + offset[1]!];
    return { ...seat, point, approach: [seat.x + step[0], seat.y + step[1]] };
  });
  const zoneLayouts = Object.fromEntries((["working", "blocked", "handoff", "done"] as WorkZone[]).map((zone) => {
    const list = seats.filter((seat) => seat.zone === zone);
    const layoutSeats: Seat[] = list.map((seat) => ({
      id: seat.id, chair: seat.point, approach: cellNode(...seat.approach), cell: [seat.x, seat.y] as const,
      ...(seat.kind === "desk" && seat.flip ? { flip: true } : {}),
      ...(seat.kind === "stand" ? { stand: { view: seat.view ?? "front", ...(seat.flip ? { flip: true } : {}) } } : {}),
      ...(seat.kind === "lounge" ? { lounge: seat.flip ? { flip: true } : {} } : {}),
    }));
    return [zone, { seats: layoutSeats, door: list[0] ? cellNode(...list[0].approach) : "" } satisfies ZoneLayout];
  })) as Record<WorkZone, ZoneLayout>;

  const cellPoint = ([x, y]: Cell, what: string) => {
    if (!isOpen(x, y)) throw new Error(`${what} 칸(${x},${y})이 걷는 바닥이 아닙니다`);
    return cellCenter(grid, x, y);
  };
  const layout: OfficeLayout = {
    image: { width, height },
    zones: zoneLayouts,
    hall: {
      center: cellPoint(map.hall.center, "홀 가운데"),
      spawn: map.hall.spawn.map((cell) => cellPoint(cell, "나타나는 자리")),
      wander: map.hall.wander.map((cell) => cellPoint(cell, "배회 자리")),
    },
    nodes, edges,
    exit: exitNode(map, cellPoint(map.exit, "출구"), blocked, grid, nodes, edges),
    grid,
  };
  return { map, kit, grid, width, height, floors, walls, posts: [...posts.values()], items, seats, layout };
}

/** 같은 바닥 줄을 여러 번 되풀이해 지도 바닥을 만든다. */
export const repeatRows = (lines: readonly (readonly [number, string])[]) => lines.flatMap(([count, line]) => Array<string>(count).fill(line));

/** 두 사람 벤치 책상(2×1, 모니터가 +y를 봄)과 앞줄 책상 의자·좌석. flip이면 1×2로 눕혀 모니터가 +x를 본다. */
export function deskGroup(id: string, zone: WorkZone, x: number, y: number, flip = false): { items: Placed[]; seats: SeatDef[] } {
  const cells: [number, number][] = flip ? [[x + 1, y], [x + 1, y + 1]] : [[x, y + 1], [x + 1, y + 1]];
  return {
    items: [{ sprite: "desk", x, y, flip }, ...cells.map(([cx, cy]) => ({ sprite: "chair", x: cx, y: cy, flip }))],
    seats: cells.map(([cx, cy], index) => ({ id: `${id}${index + 1}`, zone, x: cx, y: cy, kind: "desk" as const, flip })),
  };
}

/** 출구 노드. 출구 칸 옆 모서리에 출구 유리문(E)이 있으면 문턱(모서리 가운데)까지 걸어가 문으로 나가고, 없으면 그 칸에서 사라진다. */
function exitNode(map: MapDef, _point: Point, blocked: Set<string>, grid: GridInfo, nodes: Record<string, Point>, edges: [string, string][]) {
  const [x, y] = map.exit;
  const door = map.walls.flatMap((run) => [...run.pattern].map((char, step) => ({ char, side: run.side, x: run.side === "n" ? run.x + step : run.x, y: run.side === "n" ? run.y : run.y + step })))
    .find((edge) => edge.char === "E" && blocked.has(edgeKey(edge.side, edge.x, edge.y))
      && ((edge.side === "n" && edge.x === x && (edge.y === y || edge.y === y + 1)) || (edge.side === "w" && edge.y === y && (edge.x === x || edge.x === x + 1))));
  if (!door) return cellNode(x, y);
  const mid = door.side === "n" ? gridToScene(grid, door.x + 0.5, door.y) : gridToScene(grid, door.x, door.y + 0.5);
  nodes[EXIT_DOOR] = mid;
  edges.push([cellNode(x, y), EXIT_DOOR]);
  return EXIT_DOOR;
}
/** 출구 유리문 문턱 노드 */
export const EXIT_DOOR = "door:exit";

/** 격자 꼭짓점의 장면 픽셀 */
export const cornerPoint = (plan: Pick<WorldPlan, "grid">, x: number, y: number) => gridToScene(plan.grid, x, y);
