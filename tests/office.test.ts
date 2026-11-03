import { describe, expect, test } from "bun:test";
import { HALL_CENTER, inside, seatNode, WalkGraph, zoneAt, type OfficeLayout } from "../src/web/lib/office/layout";
import { hash, hslToRgb, lookFor, lookKey, recolor, rgbToHsl, seeded, shift } from "../src/web/lib/office/look";
import { CHAT_GAP, HOME_SECONDS, homeTime, HURRY, IDLE_HOME_MS, LINGER_MS, OfficeSim, WALK_SPEED, type Agent, type OfficeSession, type Talk } from "../src/web/lib/office/sim";
import { agentName, CHAT_TAIL, fits, LINE_GAP, lineSeconds, pickScript, resolveLines, SCRIPTS, speaks, taskName, timeline, type ChatContext, type Cond } from "../src/web/lib/office/chat";
import { bubbleLines, clip, shortId, stamp, talkLine } from "../src/web/lib/office/bubble";
import { badgeFor } from "../src/web/lib/office/render";
import { BUILDINGS } from "../src/web/lib/office/buildings";

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

/** 대화 대본이 형편(시각)에 따라 달라지지 않게 고정한 평일 오후. 시험 세션은 모두 이 시각 바로 뒤에 기록된다(완료 세션은 마지막 기록 10분 뒤 퇴근한다). */
const AFTERNOON = new Date(2026, 10, 4, 15, 0).getTime();
const atAfternoon = () => AFTERNOON;
let clock = 0;
const session = (id: string, status: OfficeSession["status"], extra: Partial<OfficeSession> = {}): OfficeSession => ({
  id, provider: "anthropic", agent: "claude-code", providerSessionId: `${id}-provider`, sessionName: id, summary: `${id} 요약`, status,
  createdAt: new Date(AFTERNOON + clock * 1000).toISOString(), updatedAt: new Date(AFTERNOON + clock++ * 1000).toISOString(), endedAt: null, endReason: null, ...extra,
});
const run = (sim: OfficeSim, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) sim.step(0.05); };
/** 서서 머무는 자리가 셋인 로비 */
const lobby3: OfficeLayout = { ...layout, zones: { ...layout.zones, done: { door: "d-door", seats: [
  { id: "l1", chair: [190, 250], approach: "d-a", stand: { view: "front" } }, { id: "l2", chair: [215, 250], approach: "d-a", stand: { view: "back" } },
  { id: "l3", chair: [240, 255], approach: "d-a", stand: { view: "front" } }] } } };
/**
 * 대화가 끝날 때까지 돌리며 들린 말을 차례대로 적는다(역할:대사, 함께 말하면 쉼표로 잇는다).
 * 말하는 사람이 하나면 서 있는 나머지는 모두 그쪽을 보고, 콩콩 뛰는 것은 신나서 말하는 사람뿐이다.
 */
function listen(sim: OfficeSim, talk: Talk) {
  const heard: string[] = [];
  let last = "", hopped = false;
  for (let t = 0; t < talk.length + 0.5 && sim.conversations().includes(talk); t += 0.05) {
    sim.step(0.05);
    const said = talk.members.map((id, role) => ({ role, agent: sim.agent(id), text: sim.chatLine(id) })).filter((one) => one.text);
    const key = said.map(({ role, text }) => `${role}:${text}`).join(",");
    if (key && key !== last) heard.push(key);
    last = key;
    for (const id of talk.members) {
      if (sim.chatHop(id) <= 0) continue;
      hopped = true;
      expect(said.some(({ agent }) => agent?.id === id)).toBe(true);
    }
    if (said.length !== 1 || !sim.conversations().includes(talk)) continue;
    const speaker = said[0]!.agent!;
    for (const id of talk.members) {
      const one = sim.agent(id);
      if (one && one !== speaker && one.mode === "stand" && Math.abs(speaker.x - one.x) > 3) expect(one.flip).toBe(speaker.x < one.x);
    }
  }
  expect(hopped).toBe(talk.lines.some((line) => line.hop));
  return heard;
}
/** 대본대로라면 들려야 할 말 */
const expected = (talk: Talk) => talk.lines.map((line) => talk.members.map((_, role) => role).filter((role) => speaks(line, role)).map((role) => `${role}:${line.text}`).join(","));

describe("office walk graph", () => {
  test("routes from the hall through a door to a seat and never through another seat", () => {
    const graph = new WalkGraph(layout);
    const path = graph.route(HALL_CENTER, seatNode("w2"))!;
    expect(path.at(-1)).toBe(seatNode("w2"));
    expect(path).toContain("w-door");
    expect(path.filter((node) => node.startsWith("seat:"))).toEqual([seatNode("w2")]);
    expect(graph.route(seatNode("b1"), seatNode("h1"))).toContain("h-door");
  });

  test("every shipped building reaches every seat from the hall", () => {
    for (const { layout: shipped } of BUILDINGS) {
      const graph = new WalkGraph(shipped);
      for (const zone of Object.values(shipped.zones)) {
        expect(zone.seats.length).toBeGreaterThan(0);
        for (const seat of zone.seats) expect(graph.route(HALL_CENTER, seatNode(seat.id))).not.toBeNull();
      }
      for (const [x, y] of Object.values(shipped.nodes)) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(shipped.image.width);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(shipped.image.height);
      }
    }
  });
});

describe("office simulation", () => {
  test("the first list seats everyone at once; a new session appears in the hall and walks to its zone", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(1), clock: atAfternoon });
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
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(2), clock: atAfternoon });
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

  test("a finished session that ended waits in the lobby for a minute, then walks out; ones gone longer never come in", () => {
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
    // 1분이 지나면 스스로 일어나 나가서 사라진다(출구가 없는 배치는 홀 가운데로).
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

  test("idle agents in the hall now and then walk up to a colleague, face each other and talk through a script in turns", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0.1, clock: () => AFTERNOON });
    sim.sync([session("a", null), session("b", null)]);
    const [a, b] = [sim.agent("a")!, sim.agent("b")!];
    run(sim, 3.8);
    const talk = a.chat!;
    expect(talk).toBe(b.chat!);
    expect(talk.kind).toBe("pair");
    const [lead, other] = talk.members.map((id) => sim.agent(id)!) as [Agent, Agent];
    expect(talk.waiting.has(lead.id)).toBe(talk.pending);
    for (let t = 0; talk.pending && t < 5; t += 0.05) sim.step(0.05);
    expect(talk.pending).toBe(false);
    expect([lead.mode, other.mode]).toEqual(["stand", "stand"]);
    expect(Math.abs(lead.x - other.x)).toBeCloseTo(CHAT_GAP, 0);
    // 마주 본다: 왼쪽에 선 쪽은 오른쪽을, 오른쪽에 선 쪽은 왼쪽을 본다.
    const [left, right] = lead.x < other.x ? [lead, other] : [other, lead];
    expect([left.flip, right.flip]).toEqual([false, true]);
    expect(listen(sim, talk)).toEqual(expected(talk));
    run(sim, 1);
    expect(lead.chat).toBeNull();
    expect(other.chat).toBeNull();
    expect(lead.spot).not.toBeNull();
    expect(sim.conversations()).toEqual([]);
  });

  test("sometimes a third colleague is called over: the two stand on either side of the host, who turns to whoever speaks", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0.1, clock: () => AFTERNOON });
    sim.sync([session("a", null), session("b", null), session("c", null)]);
    run(sim, 3.8);
    const talk = sim.agent("a")!.chat!;
    expect(talk.kind).toBe("group");
    expect(talk.members).toHaveLength(3);
    for (const id of talk.members) expect(sim.agent(id)!.chat).toBe(talk);
    for (let t = 0; talk.pending && t < 8; t += 0.05) sim.step(0.05);
    expect(talk.pending).toBe(false);
    const [a, host, c] = talk.members.map((id) => sim.agent(id)!) as [Agent, Agent, Agent];
    // 다가간 둘은 상대의 양옆에 선다.
    expect(Math.abs(a.x - host.x)).toBeCloseTo(CHAT_GAP, 0);
    expect(Math.abs(c.x - host.x)).toBeCloseTo(CHAT_GAP, 0);
    expect(Math.sign(a.x - host.x)).toBe(-Math.sign(c.x - host.x));
    expect(talk.lines.some((line) => line.by === "c" || line.by === "all")).toBe(true);
    expect(listen(sim, talk)).toEqual(expected(talk));
    run(sim, 1);
    expect([a.chat, host.chat, c.chat]).toEqual([null, null, null]);
    expect([a.spot, c.spot].every(Boolean)).toBe(true);
  });

  test("a group ends for everyone when one of them is picked up, and the ones still walking over find a free spot instead", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0.1, clock: () => AFTERNOON });
    sim.sync([session("a", null), session("b", null), session("c", null)]);
    run(sim, 3.75);
    const talk = sim.agent("a")!.chat!;
    expect(talk.pending).toBe(true);
    const [walker, host, third] = talk.members.map((id) => sim.agent(id)!) as [Agent, Agent, Agent];
    expect(sim.grab(host.id)).toBe(true);
    expect([walker.chat, host.chat, third.chat]).toEqual([null, null, null]);
    expect(sim.conversations()).not.toContain(talk);
    for (const one of [walker, third]) {
      expect(one.spot).not.toBeNull();
      expect(one.path).not.toContain("@goal");
    }
    sim.drop(host.id);
    run(sim, 3);
    // 내려놓은 뒤에는 모두 제 갈 길을 간다. 자리를 얻고 서 있으면 그 자리 위에 있다.
    for (const one of [walker, host, third]) if (one.mode === "stand" && one.spot) expect([one.x, one.y]).toEqual([...sim.graph.point(one.spot)]);
  });

  test("a walker passing close by a resting colleague trades a quick greeting without stopping", () => {
    const sim = new OfficeSim(lobby3, { sitSeconds: 0.5, random: () => 0.45, clock: () => AFTERNOON });
    sim.sync([session("a", "done"), session("b", "done")]);
    const [a, b] = [sim.agent("a")!, sim.agent("b")!];
    expect([a.spot, b.spot]).toEqual([seatNode("l1"), seatNode("l2")]);
    b.rest = 100;
    // 쉬다가(6.5초) 빈자리로 옮기며 바로 옆 동료 곁을 지난다.
    run(sim, 6.6);
    const talk = a.chat!;
    expect(talk).toMatchObject({ kind: "pass", pending: false, members: ["a", "b"] });
    expect(b.chat).toBe(talk);
    expect(a.mode).toBe("walk");
    expect(listen(sim, talk)).toEqual(expected(talk));
    expect(a.chat).toBeNull();
    expect(b.chat).toBeNull();
    run(sim, 3);
    expect(a).toMatchObject({ spot: seatNode("l3"), mode: "stand" });
  });

  test("a colleague in the lobby sends off a session that is leaving for home", () => {
    let now = Date.parse("2026-11-02T06:00:00.000Z");
    const sim = new OfficeSim(lobby3, { sitSeconds: 0.5, random: () => 0.1, clock: () => now });
    sim.sync([session("a", "done", { endedAt: new Date(now).toISOString() }), session("b", "done")]);
    const [a, b] = [sim.agent("a")!, sim.agent("b")!];
    b.rest = 100;
    a.rest = 100;
    now += LINGER_MS;
    run(sim, 0.2);
    expect(a.leaving).toBe("home");
    const talk = b.chat!;
    expect(talk).toMatchObject({ kind: "sendoff", members: ["a", "b"] });
    const heard = listen(sim, talk);
    expect(heard).toEqual(expected(talk));
    expect(heard.every((line) => line.startsWith("1:"))).toBe(true);
    expect(b.chat).toBeNull();
  });

  test("a person greeted by a pet turns to it and says a word, unless already talking or leaving", () => {
    const sim = new OfficeSim(lobby3, { sitSeconds: 0.5, random: () => 0.9, clock: atAfternoon });
    sim.sync([session("a", "done"), session("b", null)]);
    const a = sim.agent("a")!;
    expect(a.mode).toBe("stand");
    expect(sim.remark("a", "귀여워!", 2, a.x - 20)).toBe(true);
    expect(a).toMatchObject({ view: "front", flip: true });
    expect(a.rest).toBeGreaterThanOrEqual(3);
    expect(sim.chatLine("a")).toBe("귀여워!");
    run(sim, 2.1);
    expect(sim.chatLine("a")).toBeNull();
    expect(sim.remark("missing", "안녕")).toBe(false);
  });

  test("grabbing one side of a conversation ends it for both", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: () => 0.1, clock: () => AFTERNOON });
    sim.sync([session("a", null), session("b", null)]);
    run(sim, 3.8);
    const talk = sim.agent("a")!.chat!;
    const [lead, other] = talk.members.map((id) => sim.agent(id)!) as [Agent, Agent];
    expect(sim.grab(other.id)).toBe(true);
    expect(other.chat).toBeNull();
    expect(lead.chat).toBeNull();
    expect(sim.conversations()).toEqual([]);
  });

  test("lobby agents do not stand still: after a rest they move to another free spot", () => {
    const lobby: OfficeLayout = { ...layout, zones: { ...layout.zones, done: { door: "d-door", seats: [
      { id: "l1", chair: [190, 250], approach: "d-a", stand: { view: "front" } }, { id: "l2", chair: [215, 250], approach: "d-a", stand: { view: "back" } }] } } };
    const sim = new OfficeSim(lobby, { sitSeconds: 0.5, random: () => 0.9, clock: atAfternoon });
    sim.sync([session("a", "done")]);
    const agent = sim.agent("a")!;
    expect(agent).toMatchObject({ mode: "stand", spot: seatNode("l1") });
    run(sim, 12);
    expect(agent.spot).toBe(seatNode("l2"));
  });

  test("a finished session left open rests in the lobby for ten minutes after its last record, then goes home; a new record brings it back", () => {
    let now = AFTERNOON + 60 * 60 * 1000;
    const sim = new OfficeSim(lobby3, { sitSeconds: 0.5, random: seeded(12), clock: () => now });
    const fresh = session("fresh", "done", { updatedAt: new Date(now - 60 * 1000).toISOString() });
    const stale = session("stale", "done", { updatedAt: new Date(now - IDLE_HOME_MS - 1000).toISOString() });
    sim.sync([fresh, stale]);
    expect(sim.agent("stale")).toBeUndefined();
    expect(sim.agent("fresh")).toMatchObject({ zone: "done", leaving: false, homeAt: Date.parse(fresh.updatedAt) + IDLE_HOME_MS });
    expect(sim.counts().home).toEqual({ shown: 0, total: 1 });
    now = Date.parse(fresh.updatedAt) + IDLE_HOME_MS;
    run(sim, 0.05);
    expect(sim.agent("fresh")).toMatchObject({ leaving: "home", spot: null });
    expect(sim.counts().home.total).toBe(2);
    run(sim, 0.6 + 400 / WALK_SPEED + HOME_SECONDS + 0.2);
    expect(sim.agent("fresh")).toBeUndefined();
    // 같은 세션이 새 기록을 남기면 다시 출근해 로비로 들어온다.
    sim.sync([{ ...stale, updatedAt: new Date(now).toISOString() }]);
    expect(sim.agent("stale")).toMatchObject({ zone: "done", leaving: false, mode: "appear" });
  });

  test("a session long quiet that is moved to the lobby by hand still walks in and rests a minute before it leaves", () => {
    let now = AFTERNOON + 60 * 60 * 1000;
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(13), clock: () => now });
    const old = session("old", "working", { updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() });
    sim.sync([old]);
    now += 5000;
    sim.sync([{ ...old, status: "done" }]);
    const agent = sim.agent("old")!;
    expect(agent).toMatchObject({ zone: "done", leaving: false, hurry: true, homeAt: now + LINGER_MS });
    now += LINGER_MS;
    run(sim, 0.05);
    expect(agent.leaving).toBe("home");
  });

  test("home from the menu leaves at once from wherever the agent is, hurrying to the exit, and stays gone until there is new work", () => {
    const now = AFTERNOON + 60 * 60 * 1000;
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(14), clock: () => now });
    const a = session("a", "working", { updatedAt: new Date(now - 30 * 1000).toISOString() });
    sim.sync([a]);
    sim.sendHome("a");
    const agent = sim.agent("a")!;
    expect(agent).toMatchObject({ leaving: "home", hurry: true, spot: null });
    expect(sim.counts().home.total).toBe(1);
    expect(sim.counts().working.total).toBe(0);
    // 서버가 완료·종료를 받기 전의 목록이 와도 돌아오지 않고, 받은 뒤의 목록(웹에서 끝냄)에서도 그대로 나간다.
    sim.sync([a]);
    expect(agent.leaving).toBe("home");
    const ended = { ...a, status: "done" as const, endedAt: new Date(now).toISOString(), endReason: "web" };
    sim.sync([ended]);
    expect(agent).toMatchObject({ leaving: "home", hurry: true });
    run(sim, 0.6 + 600 / (WALK_SPEED * HURRY) + HOME_SECONDS + 0.2);
    expect(sim.agent("a")).toBeUndefined();
    sim.sync([ended]);
    expect(sim.agent("a")).toBeUndefined();
    expect(sim.counts().home.total).toBe(1);
    // 사용자가 다시 일을 맡기면(완료가 아닌 상태) 출근한다.
    sim.sync([{ ...ended, status: "working" }]);
    expect(sim.agent("a")).toMatchObject({ zone: "working", leaving: false });
  });

  test("a menu send-off that fails comes back to its desk on the next list", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(15), clock: atAfternoon });
    const a = session("a", "blocked");
    sim.sync([a]);
    sim.sendHome("a");
    sim.recall("a");
    sim.sync([a]);
    expect(sim.agent("a")).toMatchObject({ zone: "blocked", leaving: false, spot: seatNode("b1") });
  });

  test("home time: an ended session lingers a minute (none if ended on the web screen), an open one ten minutes after its last record", () => {
    const at = "2026-11-02T12:00:00.000Z", base = Date.parse(at);
    expect(homeTime({ status: "working", updatedAt: at, endedAt: null, endReason: null })).toBeNull();
    expect(homeTime({ status: "done", updatedAt: at, endedAt: null, endReason: null })).toBe(base + IDLE_HOME_MS);
    expect(homeTime({ status: "done", updatedAt: at, endedAt: at, endReason: "prompt_input_exit" })).toBe(base + LINGER_MS);
    expect(homeTime({ status: "done", updatedAt: at, endedAt: at, endReason: "web" })).toBe(base);
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
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, reduced: true, random: seeded(5), clock: atAfternoon });
    sim.sync([session("a", "working")]);
    const a = session("b", "blocked");
    sim.sync([a, session("a", "working")]);
    expect(sim.agent("b")).toMatchObject({ mode: "seated", spot: seatNode("b1"), alpha: 1 });
    sim.sync([{ ...a, status: "done" }, session("a", "working")]);
    expect(sim.agent("b")).toMatchObject({ mode: "seated", spot: seatNode("d1") });
  });

  test("badges follow the zone, sleep for ended sessions and hide while walking", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(6), clock: atAfternoon });
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

describe("office chat scripts", () => {
  const context = (extra: Partial<ChatContext> = {}): ChatContext => ({
    hour: 15, day: 3, met: false, same: false, leaving: [false, false],
    people: [{ name: "Cursor", task: "가나다라마바사아자…" }, { name: "Claude", task: "agent-ses…" }, { name: "Codex", task: "" }], ...extra,
  });
  const all = Object.entries(SCRIPTS).flatMap(([place, kinds]) => Object.entries(kinds).map(([kind, scripts]) => ({ place, kind, scripts })));

  test("every script is well formed for its kind and short enough for a bubble", () => {
    for (const { kind, scripts } of all) {
      for (const script of scripts) {
        expect(script.lines.length).toBeGreaterThan(0);
        const speakers = new Set(script.lines.map((line) => line.by));
        const text = script.lines.map((line) => line.text).join(" ");
        if (kind === "group") expect(speakers.has("c") || speakers.has("all")).toBe(true);
        else { expect(speakers.has("c")).toBe(false); expect(text).not.toContain("{c"); }
        if (kind === "pair" || kind === "group") expect(script.lines.length).toBeGreaterThan(1);
        if (kind === "sendoff") expect([...speakers]).toEqual(["b"]);
        for (const line of resolveLines(script, context())) {
          expect(line.text).not.toMatch(/[{}]/);
          expect(Array.from(line.text).length).toBeLessThanOrEqual(20);
        }
      }
    }
    expect(SCRIPTS.hall.pair.length).toBeGreaterThanOrEqual(40);
    expect(SCRIPTS.done.pair.length).toBeGreaterThanOrEqual(30);
    expect(new Set(all.flatMap(({ scripts }) => scripts.map((script) => script.id))).size).toBe(all.reduce((sum, { scripts }) => sum + scripts.length, 0));
  });

  test("situational scripts only come up when the time, day or relationship fits", () => {
    const morning = context({ hour: 8 }), night = context({ hour: 23, day: 5, met: true, same: true });
    const has = (ctx: ChatContext, cond: Cond) => SCRIPTS.hall.pair.some((script) => script.when.includes(cond) && fits(script, ctx));
    expect(has(morning, "morning")).toBe(true);
    expect(has(morning, "night")).toBe(false);
    expect(has(morning, "first")).toBe(true);
    expect(has(night, "night") && has(night, "friday") && has(night, "again") && has(night, "same")).toBe(true);
    expect(has(night, "first") || has(night, "other") || has(night, "morning")).toBe(false);
    // 세션 이름이 없으면 이름을 부르는 대본은 고르지 않는다.
    const named = SCRIPTS.done.pair.find((script) => script.when.includes("named"))!;
    expect(fits(named, context())).toBe(true);
    expect(fits(named, context({ people: [{ name: "Claude", task: "" }, { name: "Codex", task: "" }] }))).toBe(false);
    expect(resolveLines(named, context())[0]!.text).toBe("‘agent-ses…’ 끝났어요?");
    expect(agentName("claude-code")).toBe("Claude");
    expect(agentName("cursor-agent")).toBe("Cursor");
    expect(taskName(null)).toBe("");
    expect(taskName("사무실 대기·완료 캐릭터 대화 패턴")).toBe("사무실 대기·완료…");
  });

  test("picking skips recently used scripts while others remain, and fills in names", () => {
    const scripts = SCRIPTS.hall.pass;
    const ctx = context();
    const usable = scripts.filter((script) => fits(script, ctx));
    const last = usable.at(-1)!;
    const recent = usable.slice(0, -1).map((script) => script.id);
    for (const roll of [0, 0.3, 0.99]) expect(pickScript(scripts, ctx, () => roll, recent)).toBe(last);
    // 다 최근에 나왔으면 그중에서 다시 고른다.
    expect(usable).toContain(pickScript(scripts, ctx, () => 0.5, usable.map((script) => script.id))!);
    expect(pickScript([], ctx, () => 0.5)).toBeNull();
    const greet = scripts.find((script) => script.lines[0]!.text.includes("{b}"))!;
    expect(resolveLines(greet, ctx)[0]!.text).toBe("오, Claude 님!");
  });

  test("lines last longer the more there is to read, with a short breath between them", () => {
    expect(lineSeconds("♪")).toBeCloseTo(1.2);
    expect(lineSeconds("어떤 작업 맡으셨어요?")).toBeGreaterThan(lineSeconds("네~"));
    expect(lineSeconds("가".repeat(60))).toBe(3.2);
    const lines = SCRIPTS.hall.pair[0]!.lines;
    const { at, seconds, length } = timeline(lines);
    expect(at[0]).toBe(0);
    for (let index = 1; index < at.length; index++) expect(at[index]!).toBeCloseTo(at[index - 1]! + seconds[index - 1]! + LINE_GAP);
    expect(length).toBeCloseTo(at.at(-1)! + seconds.at(-1)! + CHAT_TAIL);
  });
});
