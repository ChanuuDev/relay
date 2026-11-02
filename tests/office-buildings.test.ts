import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { HALL_CENTER, inside, seatNode, WalkGraph, WORK_ZONES, zoneAt, type OfficeLayout } from "../src/web/lib/office/layout";
import { OfficeSim, type OfficeSession } from "../src/web/lib/office/sim";
import { BUILDING_KEY, BUILDINGS, buildingOf, DEFAULT_BUILDING, isBuilding, storeBuilding, storedBuilding } from "../src/web/lib/office/buildings";

const session = (id: string, status: OfficeSession["status"]): OfficeSession => ({
  id, provider: "anthropic", agent: "claude-code", providerSessionId: `${id}-provider`, sessionName: id, summary: `${id} 요약`, status,
  createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", endedAt: null,
});

describe("사옥", () => {
  test("세 사옥은 이름·그림·좌표가 모두 다르다", () => {
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

      test("좌석은 자기 구역 바닥에, 홀의 나타나는 자리·배회 자리는 홀 바닥에 있다", () => {
        for (const zone of WORK_ZONES) for (const seat of layout.zones[zone].seats) expect(zoneAt(layout, ...seat.chair)).toBe(zone);
        for (const point of [...layout.hall.spawn, ...layout.hall.wander, layout.hall.center]) expect(inside(layout.areas!.hall!, ...point)).toBe(true);
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
