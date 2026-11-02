import { describe, expect, test } from "bun:test";
import { HALL_CENTER, inside, seatNode, WalkGraph, zoneAt, type OfficeLayout } from "../src/web/lib/office/layout";
import { hash, hslToRgb, lookFor, lookKey, recolor, rgbToHsl, seeded, shift } from "../src/web/lib/office/look";
import { HOME_SECONDS, HURRY, LINGER_MS, OfficeSim, WALK_SPEED, type OfficeSession } from "../src/web/lib/office/sim";
import { bubbleLines, clip, shortId, stamp, talkLine } from "../src/web/lib/office/bubble";
import { badgeFor } from "../src/web/lib/office/render";
import { LAYOUT } from "../src/web/lib/office/office-data";

/** 홀 가운데에서 네 방으로 문이 하나씩 난 작은 사무실 */
const layout: OfficeLayout = {
  image: { width: 400, height: 300 },
  zones: {
    working: { door: "w-door", seats: [{ id: "w1", chair: [200, 40], approach: "w-a" }, { id: "w2", chair: [230, 40], approach: "w-a" }] },
    blocked: { door: "b-door", seats: [{ id: "b1", chair: [40, 150], approach: "b-a" }] },
    handoff: { door: "h-door", seats: [{ id: "h1", chair: [360, 150], approach: "h-a" }] },
    done: { door: "d-door", seats: [{ id: "d1", chair: [200, 260], approach: "d-a" }] },
  },
  hall: { center: [200, 150], spawn: [[190, 160], [210, 160]], wander: [[170, 140], [230, 140], [200, 170]] },
  nodes: {
    "hall-n": [200, 110], "hall-s": [200, 190], "hall-w": [150, 150], "hall-e": [250, 150],
    "w-door": [200, 80], "w-a": [215, 55], "b-door": [100, 150], "b-a": [55, 150],
    "h-door": [300, 150], "h-a": [345, 150], "d-door": [200, 220], "d-a": [200, 245],
  },
  edges: [["hall-n", "w-door"], ["w-door", "w-a"], ["hall-w", "b-door"], ["b-door", "b-a"], ["hall-e", "h-door"], ["h-door", "h-a"],
    ["hall-s", "d-door"], ["d-door", "d-a"], ["hall-n", "hall-w"], ["hall-n", "hall-e"], ["hall-s", "hall-w"], ["hall-s", "hall-e"]],
};

let clock = 0;
const session = (id: string, status: OfficeSession["status"], extra: Partial<OfficeSession> = {}): OfficeSession => ({
  id, provider: "anthropic", agent: "claude-code", providerSessionId: `${id}-provider`, sessionName: id, summary: `${id} 요약`, status,
  createdAt: new Date(2026, 10, 2, 9, clock).toISOString(), updatedAt: new Date(2026, 10, 2, 9, clock++).toISOString(), endedAt: null, ...extra,
});
const run = (sim: OfficeSim, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) sim.step(0.05); };

describe("office walk graph", () => {
  test("routes from the hall through a door to a seat and never through another seat", () => {
    const graph = new WalkGraph(layout);
    const path = graph.route(HALL_CENTER, seatNode("w2"))!;
    expect(path.at(-1)).toBe(seatNode("w2"));
    expect(path).toContain("w-door");
    expect(path.filter((node) => node.startsWith("seat:"))).toEqual([seatNode("w2")]);
    expect(graph.route(seatNode("b1"), seatNode("h1"))).toContain("h-door");
  });

  test("the shipped office layout reaches every seat from the hall", () => {
    const graph = new WalkGraph(LAYOUT);
    for (const zone of Object.values(LAYOUT.zones)) {
      expect(zone.seats.length).toBeGreaterThan(0);
      for (const seat of zone.seats) expect(graph.route(HALL_CENTER, seatNode(seat.id))).not.toBeNull();
    }
    for (const [x, y] of Object.values(LAYOUT.nodes)) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(LAYOUT.image.width);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(LAYOUT.image.height);
    }
  });
});

describe("office simulation", () => {
  test("the first list seats everyone at once; a new session appears in the hall and walks to its zone", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(1) });
    sim.sync([session("a", "working"), session("b", "done"), session("c", null)]);
    expect(sim.agent("a")).toMatchObject({ mode: "seated", zone: "working", spot: seatNode("w1"), alpha: 1 });
    expect(sim.agent("b")).toMatchObject({ mode: "seated", spot: seatNode("d1") });
    expect(sim.agent("c")).toMatchObject({ mode: "stand", zone: "hall" });

    sim.sync([session("n", "blocked"), session("a", "working"), session("b", "done"), session("c", null)]);
    const newcomer = sim.agent("n")!;
    expect(newcomer.mode).toBe("appear");
    expect(newcomer.node.startsWith("spawn:")).toBe(true);
    run(sim, 0.7);
    expect(newcomer.mode).toBe("walk");
    run(sim, 400 / WALK_SPEED);
    expect(newcomer).toMatchObject({ mode: "seated", spot: seatNode("b1"), view: "back", flip: false });
    expect([newcomer.x, newcomer.y]).toEqual([40, 150]);
  });

  test("a status change stands the agent up, walks it to the new zone and sits it down", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(2) });
    const a = session("a", "working");
    sim.sync([a]);
    sim.sync([{ ...a, status: "done" }]);
    const agent = sim.agent("a")!;
    expect(agent.mode).toBe("standup");
    expect(agent.spot).toBe(seatNode("d1"));
    run(sim, 0.6);
    expect(agent.mode).toBe("walk");
    run(sim, 500 / WALK_SPEED);
    expect(agent).toMatchObject({ mode: "seated", zone: "done" });
    expect(sim.counts().done).toEqual({ shown: 1, total: 1 });
    expect(sim.counts().working).toEqual({ shown: 0, total: 0 });
  });

  test("a zone only seats as many as it has chairs; the rest are counted", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(3) });
    sim.sync([session("x", "working"), session("y", "working"), session("z", "working")]);
    expect(sim.agents().map((agent) => agent.id).sort()).toEqual(["x", "y"]);
    expect(sim.counts().working).toEqual({ shown: 2, total: 3 });
    expect(new Set(sim.agents().map((agent) => agent.spot)).size).toBe(2);
  });

  test("a standing spot keeps the agent on its feet facing the given way", () => {
    const standing: OfficeLayout = { ...layout, zones: { ...layout.zones, handoff: { door: "h-door", seats: [{ id: "h-s", chair: [345, 160], approach: "h-a", stand: { view: "front", flip: true } }] } } };
    const sim = new OfficeSim(standing, { sitSeconds: 0.5, random: seeded(7) });
    sim.sync([session("a", "handoff")]);
    expect(sim.agent("a")).toMatchObject({ mode: "stand", view: "front", flip: true, spot: seatNode("h-s") });
    run(sim, 30);
    expect(sim.agent("a")).toMatchObject({ mode: "stand", spot: seatNode("h-s") });
    sim.sync([session("a", "working")]);
    expect(sim.agent("a")!.mode).toBe("walk");
  });

  test("a session that drops out walks back to the hall and fades away, freeing its seat", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(4) });
    sim.sync([session("a", "handoff")]);
    sim.sync([]);
    const agent = sim.agent("a")!;
    expect(agent.leaving).toBe("out");
    expect(agent.spot).toBeNull();
    run(sim, 0.6 + 400 / WALK_SPEED + 1);
    expect(sim.agent("a")).toBeUndefined();
  });

  test("a finished session that ended waits in the lobby for ten minutes, then walks out; ones gone longer never come in", () => {
    let now = Date.parse("2026-11-02T12:00:00.000Z");
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(8), clock: () => now });
    const a = session("a", "working");
    const longAgo = new Date(now - LINGER_MS - 1000).toISOString();
    sim.sync([a, session("gone", "done", { endedAt: longAgo })]);
    expect(sim.agent("gone")).toBeUndefined();
    expect(sim.counts().home).toEqual({ shown: 0, total: 1 });
    // 작업을 마치고 세션이 끝나면 먼저 로비(완료 구역)로 서둘러 간다.
    sim.sync([{ ...a, status: "done", endedAt: new Date(now).toISOString() }]);
    const agent = sim.agent("a")!;
    expect(agent).toMatchObject({ zone: "done", leaving: false, hurry: true, homeAt: now + LINGER_MS });
    run(sim, 0.6 + 600 / (WALK_SPEED * HURRY));
    expect(["sitdown", "seated"]).toContain(agent.mode);
    run(sim, 1);
    expect(agent.leaving).toBe(false);
    // 10분이 지나면 스스로 일어나 나가서 사라진다(출구가 없는 배치는 홀 가운데로).
    now += LINGER_MS;
    run(sim, 0.05);
    expect(agent).toMatchObject({ leaving: "home", spot: null });
    expect(sim.counts().home.total).toBe(1);
    run(sim, 0.6 + 400 / WALK_SPEED);
    expect(agent.mode).toBe("vanish");
    expect(agent.node).toBe(HALL_CENTER);
    run(sim, HOME_SECONDS + 0.1);
    expect(sim.agent("a")).toBeUndefined();
  });

  test("grabbing lifts the agent off its seat; dropped in place it lands and hurries back to its own seat", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(10) });
    sim.sync([session("a", "working")]);
    expect(sim.grab("a")).toBe(true);
    const agent = sim.agent("a")!;
    expect(agent.mode).toBe("held");
    run(sim, 0.3);
    expect(agent.lift).toBe(1);
    sim.hold("a", 150, 150);
    expect(agent).toMatchObject({ x: 150, y: 150, loose: true, flip: true });
    sim.drop("a");
    expect(agent.mode).toBe("land");
    run(sim, 0.3);
    expect(agent).toMatchObject({ mode: "walk", hurry: true, lift: 0 });
    run(sim, 600 / (WALK_SPEED * HURRY));
    expect(agent).toMatchObject({ spot: seatNode("w1"), hurry: false });
    expect(["sitdown", "seated"]).toContain(agent.mode);
    expect([agent.x, agent.y]).toEqual([200, 40]);
  });

  test("a status change while held waits for the drop, then walks from the drop point to the new zone", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(11) });
    const a = session("a", "working");
    sim.sync([a]);
    sim.grab("a");
    sim.hold("a", 60, 150);
    sim.sync([{ ...a, status: "blocked" }]);
    const agent = sim.agent("a")!;
    expect(agent).toMatchObject({ mode: "held", zone: "blocked", spot: seatNode("b1") });
    sim.drop("a");
    run(sim, 0.3 + 200 / (WALK_SPEED * HURRY));
    expect(agent).toMatchObject({ zone: "blocked" });
    expect(["sitdown", "seated"]).toContain(agent.mode);
    expect(sim.grab("missing")).toBe(false);
  });

  test("a drop point maps to the zone whose floor polygon holds it", () => {
    const withAreas: OfficeLayout = { ...layout, areas: { working: [[150, 0], [250, 0], [250, 90], [150, 90]], hall: [[150, 100], [250, 100], [250, 200], [150, 200]] } };
    expect(zoneAt(withAreas, 200, 40)).toBe("working");
    expect(zoneAt(withAreas, 200, 150)).toBe("hall");
    expect(zoneAt(withAreas, 10, 10)).toBeNull();
    expect(inside([[0, 0], [10, 0], [0, 10]], 2, 2)).toBe(true);
    expect(inside([[0, 0], [10, 0], [0, 10]], 8, 8)).toBe(false);
  });

  test("a status change hurries the agent to its new zone at the quick pace; it walks normally again once seated", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(9) });
    const a = session("a", "working");
    sim.sync([a]);
    sim.sync([{ ...a, status: "handoff" }]);
    const agent = sim.agent("a")!;
    expect(agent.hurry).toBe(true);
    run(sim, 0.6);
    expect(agent.mode).toBe("walk");
    // 보통 걸음으로는 닿지 못할 시간 안에 도착한다.
    const path = 15 + 30 + 30 + 50 + 50 + 45 + 15;
    run(sim, (path / (WALK_SPEED * HURRY)) * 1.3);
    expect(agent).toMatchObject({ mode: "sitdown", zone: "handoff", hurry: false });
  });

  test("with reduced motion agents go straight to their seats without walking", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, reduced: true, random: seeded(5) });
    sim.sync([session("a", "working")]);
    const a = session("b", "blocked");
    sim.sync([a, session("a", "working")]);
    expect(sim.agent("b")).toMatchObject({ mode: "seated", spot: seatNode("b1"), alpha: 1 });
    sim.sync([{ ...a, status: "done" }, session("a", "working")]);
    expect(sim.agent("b")).toMatchObject({ mode: "seated", spot: seatNode("d1") });
  });

  test("badges follow the zone, sleep for ended sessions and hide while walking", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(6) });
    sim.sync([session("a", "blocked"), session("b", "working", { endedAt: "2026-11-02T00:00:00.000Z" }), session("c", "done"), session("e", "done", { endedAt: "2026-11-02T00:00:00.000Z" }), session("d", null)]);
    expect(badgeFor(sim.agent("a")!)).toBe("blocked");
    expect(badgeFor(sim.agent("b")!)).toBe("ended");
    expect(badgeFor(sim.agent("c")!)).toBe("done");
    expect(sim.agent("e")).toBeUndefined();
    expect(badgeFor(sim.agent("d")!)).toBeNull();
  });
});

describe("office looks", () => {
  test("the same session always gets the same look and different sessions vary", () => {
    expect(lookKey(lookFor("ses_1"))).toBe(lookKey(lookFor("ses_1")));
    const keys = new Set(Array.from({ length: 40 }, (_, index) => lookKey(lookFor(`ses_${index}`))));
    expect(keys.size).toBeGreaterThan(30);
    expect(hash("abc")).toBe(hash("abc"));
  });

  test("recolouring moves only palette colours and keeps their shading order", () => {
    expect(hslToRgb(...rgbToHsl(120, 40, 200))).toEqual([120, 40, 200]);
    const base: [number, number, number] = [270, 0.8, 0.5];
    const light = shift([180, 120, 250], base, { h: 30, s: 0.5, l: 0.4 });
    const dark = shift([80, 20, 150], base, { h: 30, s: 0.5, l: 0.4 });
    expect(rgbToHsl(...light)[2]).toBeGreaterThan(rgbToHsl(...dark)[2]);
    const pixels = new Uint8ClampedArray([180, 120, 250, 255, 1, 2, 3, 255, 180, 120, 250, 0]);
    recolor(pixels, new Map([[(180 << 16) | (120 << 8) | 250, "hair"]]), { hair: base, shirt: base, pants: base, skin: base },
      { hair: { h: 30, s: 0.5, l: 0.4 }, shirt: { h: 0, s: 0, l: 0 }, pants: { h: 0, s: 0, l: 0 }, skin: { h: 0, s: 0, l: 0 } });
    expect(Array.from(pixels.slice(0, 3))).toEqual(light);
    expect(Array.from(pixels.slice(4, 8))).toEqual([1, 2, 3, 255]);
    expect(Array.from(pixels.slice(8, 11))).toEqual([180, 120, 250]);
  });
});

describe("office bubble", () => {
  test("short id, clipped first line and the last three updates oldest first", () => {
    expect(shortId({ providerSessionId: "7C2A-91f0" })).toBe("7c2a");
    expect(clip("  첫 줄입니다\n둘째 줄")).toBe("첫 줄입니다");
    expect(clip("가".repeat(40), 10)).toBe(`${"가".repeat(9)}…`);
    const now = new Date(2026, 10, 2, 12, 0);
    expect(stamp(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe("09:05");
    expect(stamp(new Date(2026, 9, 29, 9, 5).toISOString(), now)).toBe("10/29");
    const s = session("s", "working");
    const updates = [4, 3, 2, 1].map((sequence) => ({ id: `u${sequence}`, sessionId: "s", sequence, summary: `기록 ${sequence}`, status: null,
      createdAt: new Date(2026, 10, 2, 11, sequence).toISOString() }));
    expect(bubbleLines(s, updates, now)).toEqual([{ time: "11:02", text: "기록 2" }, { time: "11:03", text: "기록 3" }, { time: "11:04", text: "기록 4" }]);
    expect(bubbleLines(s, [], now)).toEqual([{ time: stamp(s.updatedAt, now), text: "s 요약" }]);
  });

  test("the over-the-head line keeps the gist of the latest summary", () => {
    expect(talkLine("진행: 사무실 앱(AppId office) 추가 중. 다음은 테스트")).toBe("사무실 앱(AppId offic…");
    expect(talkLine("후속 요청 작업 시작: (1) 완료+종료 세션은 퇴근")).toBe("후속 요청 작업 시작");
    expect(talkLine("API 응답 검증 중. 그다음 정리")).toBe("API 응답 검증 중");
    expect(talkLine(["테스트 통과", "둘째 줄"].join("\n"))).toBe("테스트 통과");
  });
});
