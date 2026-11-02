import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { HALL_CENTER, inside, seatNode, WalkGraph, WORK_ZONES, zoneAt } from "../src/web/lib/office/layout";
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
          if (!seat.stand) expect(agent!.flip).toBe(Boolean(seat.flip));
        }
      });
    });
  }
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
