import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cellCenter, cellNode, HALL_CENTER, nearestOpenCell, seatNode, WalkGraph, WORK_ZONES, zoneAt, type OfficeLayout } from "../src/web/lib/office/layout";
import { planWorld, type Kit, type MapDef } from "../src/web/lib/office/iso";
import { drawBefore, frontStatics, hidden, sortDrawables, type Drawable } from "../src/web/lib/office/world";
import { OfficeSim, type OfficeSession } from "../src/web/lib/office/sim";
import { BUILDING_KEY, BUILDINGS, buildingOf, DEFAULT_BUILDING, isBuilding, storeBuilding, storedBuilding } from "../src/web/lib/office/buildings";

const session = (id: string, status: OfficeSession["status"]): OfficeSession => ({
  id, provider: "anthropic", agent: "claude-code", providerSessionId: `${id}-provider`, sessionName: id, summary: `${id} 요약`, status,
  createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", endedAt: null, endReason: null,
});

describe("사옥", () => {
  test("세 사옥은 이름·그림 묶음·지도가 모두 다르다", () => {
    expect(BUILDINGS.map((building) => building.id)).toEqual(["night", "birch", "oak"]);
    expect(new Set(BUILDINGS.map((building) => building.url)).size).toBe(3);
    expect(new Set(BUILDINGS.map((building) => building.name)).size).toBe(3);
    expect(new Set(BUILDINGS.map((building) => JSON.stringify(building.layout.zones))).size).toBe(3);
  });

  for (const building of BUILDINGS) {
    describe(building.name, () => {
      const { layout } = building;
      const graph = new WalkGraph(layout);

      test("홀 가운데에서 모든 좌석과 출구까지 걸어갈 길이 있다", () => {
        for (const zone of WORK_ZONES) {
          expect(layout.zones[zone].seats.length).toBeGreaterThan(0);
          for (const seat of layout.zones[zone].seats) expect(graph.route(HALL_CENTER, seatNode(seat.id))).not.toBeNull();
        }
        expect(layout.exit).toBeTruthy();
        expect(graph.route(HALL_CENTER, layout.exit!)).not.toBeNull();
      });

      test("좌석은 자기 구역 칸에, 홀의 나타나는 자리·배회 자리는 홀 바닥에 있다", () => {
        for (const zone of WORK_ZONES) for (const seat of layout.zones[zone].seats) {
          expect(seat.cell, seat.id).toBeDefined();
          expect(layout.grid!.zones[seat.cell![1] * layout.grid!.cols + seat.cell![0]], seat.id).toBe(zone);
        }
        for (const point of [...layout.hall.spawn, ...layout.hall.wander, layout.hall.center]) expect(zoneAt(layout, ...point)).toBe("hall");
      });

      test("좌석 이름은 겹치지 않고 모든 좌표가 그림 안에 있다", () => {
        const ids = WORK_ZONES.flatMap((zone) => layout.zones[zone].seats.map((seat) => seat.id));
        expect(new Set(ids).size).toBe(ids.length);
        const points = [...Object.values(layout.nodes), ...WORK_ZONES.flatMap((zone) => layout.zones[zone].seats.map((seat) => seat.chair))];
        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(layout.image.width);
          expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(layout.image.height);
        }
      });

      test("처음 받은 목록은 구역마다 자리 수만큼 제자리에 바로 앉고, 왼쪽 위 책상 자리는 왼쪽을 본다", () => {
        const sessions = WORK_ZONES.flatMap((zone) => layout.zones[zone].seats.map((_, index) => session(`${zone}-${index}`, zone)));
        const sim = new OfficeSim(layout, { sitSeconds: 0.5, reduced: false, bodies: 2, random: () => 0.5, clock: () => Date.parse("2026-11-02T00:00:00.000Z") });
        sim.sync(sessions);
        const counts = sim.counts();
        for (const zone of WORK_ZONES) expect(counts[zone].shown).toBe(layout.zones[zone].seats.length);
        for (const zone of WORK_ZONES) for (const seat of layout.zones[zone].seats) {
          const agent = sim.agents().find((entry) => entry.spot === seatNode(seat.id));
          expect(agent, seat.id).toBeDefined();
          expect([agent!.x, agent!.y]).toEqual([...seat.chair]);
          if (seat.lounge) { expect(agent!.mode).toBe("seated"); expect(agent!.view).toBe("front"); expect(agent!.flip).toBe(Boolean(seat.lounge.flip)); }
          else if (!seat.stand) { expect(agent!.mode).toBe("seated"); expect(agent!.view).toBe("back"); expect(agent!.flip).toBe(Boolean(seat.flip)); }
        }
      });

      test("로비에는 소파·안락의자에 앞을 보고 앉는 자리가 있다", () => {
        const lounges = layout.zones.done.seats.filter((seat) => seat.lounge);
        expect(lounges.length).toBeGreaterThanOrEqual(2);
        for (const seat of lounges) expect(seat.stand).toBeUndefined();
      });
    });
  }
});

describe("로비 소파", () => {
  // 홀 가운데에서 로비로 가는 작은 사무실: 소파 자리 하나와 서 있는 자리 하나
  const layout: OfficeLayout = {
    image: { width: 400, height: 300 },
    zones: {
      working: { door: "w-door", seats: [{ id: "w1", chair: [200, 40], approach: "w-a" }] },
      blocked: { door: "b-door", seats: [{ id: "b1", chair: [40, 150], approach: "b-a", flip: true }] },
      handoff: { door: "h-door", seats: [{ id: "h1", chair: [360, 150], approach: "h-a" }] },
      done: { door: "d-door", seats: [
        { id: "sofa", chair: [190, 255], approach: "d-a", lounge: { flip: true } },
        { id: "spot", chair: [230, 255], approach: "d-a", stand: { view: "front" } }] },
    },
    hall: { center: [200, 150], spawn: [[190, 160]], wander: [[170, 140], [230, 140]] },
    nodes: { "hall-n": [200, 110], "hall-s": [200, 190], "w-door": [200, 80], "w-a": [215, 55], "b-door": [100, 150], "b-a": [55, 150],
      "h-door": [300, 150], "h-a": [345, 150], "d-door": [200, 220], "d-a": [200, 245] },
    edges: [["hall-n", "w-door"], ["w-door", "w-a"], ["hall-s", "d-door"], ["d-door", "d-a"], ["hall-n", "b-door"], ["b-door", "b-a"], ["hall-n", "h-door"], ["h-door", "h-a"]],
  };
  const sessionAt = (id: string, status: OfficeSession["status"]) => session(id, status);
  const run = (sim: OfficeSim, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) sim.step(0.05); };

  test("소파 자리에는 앞을 보고 앉고, 책상 자리는 등을 보이며 flip이면 왼쪽을 본다", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0, clock: () => Date.parse("2026-11-02T00:00:00.000Z") });
    sim.sync([sessionAt("a", "done"), sessionAt("b", "blocked"), sessionAt("c", "working")]);
    expect(sim.agent("a")).toMatchObject({ mode: "seated", spot: seatNode("sofa"), view: "front", flip: true });
    expect(sim.agent("b")).toMatchObject({ mode: "seated", view: "back", flip: true });
    expect(sim.agent("c")).toMatchObject({ mode: "seated", view: "back", flip: false });
  });

  test("로비 소파에 앉은 세션은 한참 쉬다가 일어나 다른 빈자리로 옮긴다", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0.9, clock: () => Date.parse("2026-11-02T00:00:00.000Z") });
    sim.sync([sessionAt("a", "done")]);
    const agent = sim.agent("a")!;
    // 처음 받은 목록은 첫 빈자리(소파)에 바로 앉힌다.
    expect(agent).toMatchObject({ mode: "seated", spot: seatNode("sofa") });
    run(sim, 2);
    expect(agent.mode).toBe("seated");
    let stood = false;
    for (let t = 0; t < 30 && !(agent.spot === seatNode("spot") && agent.mode === "stand"); t += 0.05) {
      sim.step(0.05);
      if (agent.mode === "standup") stood = true;
    }
    expect(stood).toBe(true);
    expect(agent).toMatchObject({ mode: "stand", spot: seatNode("spot") });
  });

  test("움직임 줄이기에서는 소파에서 일어나 돌아다니지 않는다", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, reduced: true, random: () => 0.9, clock: () => Date.parse("2026-11-02T00:00:00.000Z") });
    sim.sync([sessionAt("a", "done")]);
    run(sim, 30);
    expect(sim.agent("a")).toMatchObject({ mode: "seated", spot: seatNode("sofa") });
  });
});

describe("사옥 고르기 저장", () => {
  // bun에는 localStorage가 없어 이 묶음 동안만 메모리 저장소를 둔다.
  const memory = new Map<string, string>();
  const original = (globalThis as { localStorage?: Storage }).localStorage;
  beforeAll(() => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, String(value)); },
      removeItem: (key: string) => { memory.delete(key); },
    };
  });
  afterAll(() => { (globalThis as { localStorage?: unknown }).localStorage = original; });
  afterEach(() => memory.clear());

  test("고른 사옥을 이 브라우저에 남기고, 모르는 값이면 기본 사옥이다", () => {
    expect(storedBuilding()).toBe(DEFAULT_BUILDING);
    storeBuilding("oak");
    expect(storedBuilding()).toBe("oak");
    memory.set(BUILDING_KEY, "castle");
    expect(storedBuilding()).toBe(DEFAULT_BUILDING);
    expect(isBuilding("birch")).toBe(true);
    expect(isBuilding("castle")).toBe(false);
    expect(buildingOf("birch").name).toBe("자작나무 사옥");
  });
});

// ------------------------------------------------------------------ 격자 사무실

const tiny = { r: [0, 0, 1, 1] as const, a: [0, 0] as const };
const KIT: Kit = {
  atlas: "/kit.png", floors: "/floors.png", floorTiles: { f: [0, 0, 1, 1] },
  items: { desk: { ...tiny, f: [2, 1] }, chair: { ...tiny, f: [1, 1], cover: true }, sofa: { ...tiny, f: [2, 1] }, plant: { ...tiny, f: [1, 1] } },
  walls: Object.fromEntries(["wall", "glass", "low", "header", "glassHeader"].map((kind) => [kind, { n: tiny, w: tiny }])),
  posts: { wall: tiny, glass: tiny, low: tiny },
  decor: {},
};
/** 8×6 작은 격자: 왼쪽 위 WORKING(오른쪽 벽에 출입구 하나, 아래는 막힌 벽), 왼쪽 아래 DONE(낮은 벽에 트인 통로), 오른쪽 홀 */
const MAP: MapDef = {
  cols: 8, rows: 6,
  floor: ["WWWWHHHH", "WWWWHHHH", "WWWWHHHH", "HHHHHHHH", "DDDDHHHH", "DDDDHHHH"],
  legend: { W: { zone: "working", floor: "f" }, H: { zone: "hall", floor: "f" }, D: { zone: "done", floor: "f" } },
  walls: [{ side: "w", x: 4, y: 0, pattern: "WDW" }, { side: "n", x: 0, y: 3, pattern: "WWWW" }, { side: "n", x: 0, y: 4, pattern: "LLoL" }],
  items: [{ sprite: "desk", x: 0, y: 0 }, { sprite: "chair", x: 0, y: 1 }, { sprite: "chair", x: 1, y: 1 }, { sprite: "plant", x: 6, y: 0 }],
  seats: [
    { id: "w1", zone: "working", x: 0, y: 1, kind: "desk" }, { id: "w2", zone: "working", x: 1, y: 1, kind: "desk" },
    { id: "d1", zone: "done", x: 2, y: 5, kind: "stand", view: "front" }, { id: "d2", zone: "done", x: 3, y: 5, kind: "stand", view: "front" },
  ],
  hall: { center: [6, 3], spawn: [[5, 3]], wander: [[7, 3], [5, 5], [7, 5]] },
  exit: [5, 5],
};
const cellOf = (node: string) => node.slice(2).split(",").map(Number) as [number, number];
const box = (x0: number, x1: number, y0: number, y1: number, layer: Drawable["layer"], extra: Partial<Drawable> = {}): Drawable =>
  ({ box: [x0, x1, y0, y1], rect: [0, 0, 100, 100], layer, paint: () => {}, ...extra });
const person = (gx: number, gy: number) => box(gx - 0.2, gx + 0.2, gy - 0.2, gy + 0.2, 2);
const pair = (a: string, b: string) => [a, b].join("|");

describe("격자 사무실", () => {
  const plan = planWorld(MAP, KIT);
  const { layout: grid } = plan;

  test("벽과 가구가 칸을 막아 길은 이웃 칸만 잇고, 출입구로만 방에 들어간다", () => {
    const linked = new Set(grid.edges.map(([a, b]) => pair(a, b)));
    for (const [a, b] of grid.edges) {
      if (!a.startsWith("c:") || !b.startsWith("c:")) continue;
      const [ax, ay] = cellOf(a), [bx, by] = cellOf(b);
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
    // 오른쪽 벽: 출입구(y=1)만 열리고 위아래는 막혔다. 아래 벽은 모두 막혔다.
    expect(linked.has(pair(cellNode(3, 1), cellNode(4, 1)))).toBe(true);
    expect(linked.has(pair(cellNode(3, 0), cellNode(4, 0)))).toBe(false);
    expect(linked.has(pair(cellNode(3, 2), cellNode(4, 2)))).toBe(false);
    for (let x = 0; x < 4; x++) expect(linked.has(pair(cellNode(x, 2), cellNode(x, 3)))).toBe(false);
    // 낮은 벽의 트인 통로(x=2)로 로비에 들어간다.
    expect(linked.has(pair(cellNode(2, 3), cellNode(2, 4)))).toBe(true);
    expect(linked.has(pair(cellNode(1, 3), cellNode(1, 4)))).toBe(false);
    const path = new WalkGraph(grid).route(HALL_CENTER, seatNode("w1"))!;
    const at = path.indexOf(cellNode(3, 1));
    expect(path[at - 1]).toBe(cellNode(4, 1));
    expect(path.at(-1)).toBe(seatNode("w1"));
  });

  test("가구 칸과 좌석 칸은 걷는 칸이 아니고, 책상 자리는 책상 반대쪽 칸에서 들어가 그 칸의 의자에 앉는다", () => {
    const open = (x: number, y: number) => grid.grid!.open[y * MAP.cols + x];
    expect([open(0, 0), open(1, 0), open(6, 0), open(0, 1), open(1, 1)]).toEqual([false, false, false, false, false]);
    expect(open(0, 2)).toBe(true);
    const w1 = grid.zones.working.seats.find((seat) => seat.id === "w1")!;
    expect(w1.approach).toBe(cellNode(0, 2));
    expect(w1.cell).toEqual([0, 1]);
    // 엉덩이 자리는 칸 가운데에서 위로 올라가 의자 방석에 온다.
    const [cx, cy] = cellCenter(grid.grid!, 0, 1);
    expect(w1.chair[1]).toBeLessThan(cy);
    expect(Math.abs(w1.chair[0] - cx)).toBeLessThan(8);
    expect(zoneAt(grid, cx, cy)).toBe("working");
  });

  test("지도가 잘못되면 이유를 들어 알린다", () => {
    expect(() => planWorld({ ...MAP, items: [...MAP.items, { sprite: "plant", x: 1, y: 0 }] }, KIT)).toThrow(/겹칩니다/);
    expect(() => planWorld({ ...MAP, seats: [{ id: "x", zone: "blocked", x: 5, y: 2, kind: "stand" }] }, KIT)).toThrow(/구역 밖/);
    expect(() => planWorld({ ...MAP, walls: [{ side: "n", x: 0, y: 0, pattern: "Q" }] }, KIT)).toThrow(/벽 글자/);
    expect(() => planWorld({ ...MAP, items: [{ sprite: "sofa", x: 7, y: 2 }] }, KIT)).toThrow(/바닥 밖/);
  });

  test("바닥 넓이로 앞뒤를 가린다: 벽 너머 사람은 벽 뒤, 앞 사람은 벽 앞, 2칸 책상 앞 사람은 책상 앞", () => {
    const wall = box(0, 1, 2.99, 3.01, 0);
    expect(drawBefore(person(0.5, 2.5), wall)).toBe(true);
    expect(drawBefore(person(0.5, 3.5), wall)).toBe(false);
    const desk = box(0.04, 1.96, 0.04, 0.96, 1);
    expect(drawBefore(desk, person(0.5, 1.5))).toBe(true);
    expect(drawBefore(desk, person(1.5, 1.5))).toBe(true);
    expect(drawBefore(person(2.5, 0.5), desk)).toBe(false);
    // 같은 칸: 책상 의자는 앉은 사람 앞(등받이가 등을 가림), 소파는 앉은 사람 뒤
    expect(drawBefore(person(0.5, 1.5), box(0.04, 0.96, 1.04, 1.96, 1, { cover: true }))).toBe(true);
    expect(drawBefore(person(0.5, 1.5), box(0.04, 0.96, 1.04, 1.96, 1))).toBe(false);
    // 대각선으로 떨어진 것끼리는 순서를 정하지 않는다.
    expect(drawBefore(box(0, 1, 2, 3, 1), box(1, 2, 0, 1, 1))).toBeNull();
    const back = person(0.5, 2.5), front = box(0.04, 0.96, 3.04, 3.96, 1);
    expect(sortDrawables([front, wall, back])).toEqual([back, wall, front]);
  });

  test("끌어 좌석 칸에 놓으면 그 좌석으로 옮기고 앉아 있던 사람과 맞바꾸며, 고른 자리를 기억한다", () => {
    const pins = new Map<string, string>();
    const told: string[] = [];
    const sim = new OfficeSim(grid, { sitSeconds: 0.2, random: () => 0.5, pins, onPin: (id, seat) => told.push(id + ">" + seat) });
    sim.sync([session("a", "working"), session("b", "working")]);
    expect(sim.agent("a")!.spot).toBe(seatNode("w1"));
    expect(sim.agent("b")!.spot).toBe(seatNode("w2"));
    expect(sim.grab("a")).toBe(true);
    sim.hold("a", ...cellCenter(grid.grid!, 1, 1));
    sim.drop("a");
    expect(sim.agent("a")!.spot).toBe(seatNode("w2"));
    expect(sim.agent("b")!.spot).toBe(seatNode("w1"));
    expect(told).toEqual(["a>" + seatNode("w2"), "b>" + seatNode("w1")]);
    for (let t = 0; t < 20; t += 0.05) sim.step(0.05);
    const [w1, w2] = grid.zones.working.seats;
    expect(sim.agent("a")).toMatchObject({ mode: "seated", x: w2!.chair[0], y: w2!.chair[1] });
    expect(sim.agent("b")).toMatchObject({ mode: "seated", x: w1!.chair[0], y: w1!.chair[1] });
    // 다시 열면 기억한 자리에 앉는다.
    const again = new OfficeSim(grid, { sitSeconds: 0.2, random: () => 0.5, pins });
    again.sync([session("a", "working"), session("b", "working")]);
    expect(again.agent("a")!.spot).toBe(seatNode("w2"));
  });

  test("홀 빈 바닥에 놓으면 그 칸에 머물고, 가구 위에 놓으면 가장 가까운 걷는 칸에 내려앉는다", () => {
    const sim = new OfficeSim(grid, { sitSeconds: 0.2, random: () => 0.99 });
    sim.sync([session("h", null)]);
    const agent = sim.agent("h")!;
    sim.grab("h");
    sim.hold("h", ...cellCenter(grid.grid!, 7, 5));
    sim.drop("h");
    expect(agent.spot).toBe(cellNode(7, 5));
    for (let t = 0; t < 1; t += 0.05) sim.step(0.05);
    expect([agent.x, agent.y]).toEqual([...cellCenter(grid.grid!, 7, 5)]);
    expect(agent.mode).toBe("stand");
    sim.grab("h");
    const plant = cellCenter(grid.grid!, 6, 0);
    sim.hold("h", ...plant);
    sim.drop("h");
    const landed = nearestOpenCell(grid.grid!, ...plant)!;
    expect(Math.abs(landed[0] - 6) + Math.abs(landed[1] - 0)).toBe(1);
    expect([agent.x, agent.y]).toEqual([...cellCenter(grid.grid!, landed[0], landed[1])]);
  });
});

describe("모든 사옥의 격자", () => {
  for (const building of BUILDINGS) {
    test(building.name + ": 걷는 칸은 모두 홀 가운데와 이어져 있고, 길은 이웃 칸만 잇는다", () => {
      const { layout } = building;
      const links = new Map<string, string[]>();
      for (const [a, b] of layout.edges) {
        links.set(a, [...(links.get(a) ?? []), b]);
        links.set(b, [...(links.get(b) ?? []), a]);
        if (a.startsWith("c:") && b.startsWith("c:")) {
          const [ax, ay] = cellOf(a), [bx, by] = cellOf(b);
          expect(Math.abs(ax - bx) + Math.abs(ay - by), pair(a, b)).toBe(1);
        }
      }
      const start = Object.entries(layout.nodes).find(([, point]) => point[0] === layout.hall.center[0] && point[1] === layout.hall.center[1])![0];
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) for (const next of links.get(queue.shift()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      const stranded = Object.keys(layout.nodes).filter((node) => !seen.has(node));
      expect(stranded).toEqual([]);
    });
  }
});

describe("끌기 미리 보기와 가림", () => {
  const plan = planWorld(MAP, KIT);
  const { layout: grid } = plan;

  test("끄는 동안의 표시는 놓을 때와 같은 답이다: 좌석 칸이면 그 좌석과 맞바꿀 동료, 빈 좌석 곁이면 그 좌석, 홀 빈 칸이면 머물 칸", () => {
    const sim = new OfficeSim(grid, { sitSeconds: 0.2, random: () => 0.5 });
    sim.sync([session("a", "working"), session("b", "working"), session("h", null)]);
    // a가 b의 좌석(1,1) 위에 있으면 b와 맞바꾼다.
    const onSeat = sim.dropTarget("a", ...cellCenter(grid.grid!, 1, 1))!;
    expect(onSeat).toMatchObject({ seat: seatNode("w2"), cell: [1, 1], zone: "working", swap: "b", stay: null });
    // 자기 좌석이면 맞바꿀 사람이 없다.
    expect(sim.dropTarget("a", ...cellCenter(grid.grid!, 0, 1))!.swap).toBeNull();
    // 홀 사람은 홀 빈 칸에 머물고, 다른 구역 좌석이면 맞바꾸지 않는다(상태가 바뀐 뒤 빈자리를 받는다).
    expect(sim.dropTarget("h", ...cellCenter(grid.grid!, 7, 5))).toMatchObject({ seat: null, cell: [7, 5], zone: "hall", stay: cellNode(7, 5) });
    expect(sim.dropTarget("h", ...cellCenter(grid.grid!, 1, 1))).toMatchObject({ seat: seatNode("w2"), swap: null });
    // 빈 좌석 곁(한 칸 반 안)의 바닥이면 그 좌석을 고른다. 좌석이 차 있으면 바닥 칸 그대로다.
    const free = new OfficeSim(grid, { sitSeconds: 0.2, random: () => 0.5 });
    free.sync([session("c", "working")]);
    expect(free.dropTarget("c", ...cellCenter(grid.grid!, 1, 2))).toMatchObject({ seat: seatNode("w2"), cell: [1, 1], land: [1, 2] });
    expect(sim.dropTarget("h", ...cellCenter(grid.grid!, 2, 2))).toMatchObject({ seat: null, cell: [2, 2], zone: "working", stay: null });
  });

  test("정적인 층 위에 다시 그릴 것은 캐릭터 앞에서 겹치는 것과 그 앞의 것뿐이다", () => {
    const wall = box(0, 1, 2.99, 3.01, 0, { solid: true });
    const desk = box(0.04, 1.96, 3.5, 3.96, 1);
    const plant = box(0.04, 0.96, 4.04, 4.96, 1);
    const far = box(5, 6, 5, 6, 1, { rect: [500, 500, 600, 600] });
    const statics = [wall, desk, plant, far];
    const outs = [[1, 2], [2], [], []];
    // 벽 뒤 사람: 벽 앞의 책상·화분까지 이어서 다시 그린다. 화면에서 떨어진 것은 그리지 않는다.
    expect(frontStatics(statics, outs, [person(0.5, 2.5)])).toEqual([0, 1, 2]);
    // 벽과 책상 사이 사람: 책상과 화분만
    expect(frontStatics(statics, outs, [person(0.5, 3.25)])).toEqual([1, 2]);
    // 맨 앞 사람: 다시 그릴 것이 없다.
    expect(frontStatics(statics, outs, [person(0.5, 5.5)])).toEqual([]);
  });

  test("단단한 벽에 몸 절반 넘게 가린 캐릭터만 실루엣을 덧그린다", () => {
    const behind = { ...person(0.5, 2.5), rect: [0, 0, 20, 40] as const };
    const tall = box(0, 1, 2.99, 3.01, 0, { solid: true, rect: [0, 0, 40, 60] });
    const glass = box(0, 1, 2.99, 3.01, 0, { rect: [0, 0, 40, 60] });
    const short = box(0, 1, 2.99, 3.01, 0, { solid: true, rect: [0, 30, 40, 60] });
    expect(hidden(behind, [tall])).toBe(true);
    expect(hidden(behind, [glass])).toBe(false);
    expect(hidden(behind, [short])).toBe(false);
    // 벽 앞에 선 사람은 가리지 않는다.
    expect(hidden({ ...person(0.5, 3.5), rect: [0, 0, 20, 40] }, [tall])).toBe(false);
  });
});
