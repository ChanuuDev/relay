import { describe, expect, test } from "bun:test";
import { seatNode, WalkGraph, type OfficeLayout } from "../src/web/lib/office/layout";
import { seeded } from "../src/web/lib/office/look";
import { JUMP_SECONDS, petHop, petPose, PetSim, remarkFor, SPECIES, TRAITS, type Pet } from "../src/web/lib/office/pets";
import { OfficeSim, type OfficeSession } from "../src/web/lib/office/sim";
import { buildingOf } from "../src/web/lib/office/buildings";

/** 홀 가운데에서 네 방으로 문이 하나씩 난 작은 사무실(격자 없음) */
const layout: OfficeLayout = {
  image: { width: 400, height: 300 },
  zones: {
    working: { door: "w-door", seats: [{ id: "w1", chair: [200, 40], approach: "w-a" }] },
    blocked: { door: "b-door", seats: [{ id: "b1", chair: [40, 150], approach: "b-a" }] },
    handoff: { door: "h-door", seats: [{ id: "h1", chair: [360, 150], approach: "h-a" }] },
    done: { door: "d-door", seats: [{ id: "d1", chair: [200, 260], approach: "d-a", stand: { view: "front" } }] },
  },
  hall: { center: [200, 150], spawn: [[190, 160]], wander: [[170, 140], [230, 140]] },
  nodes: {
    "hall-n": [200, 110], "hall-s": [200, 190], "hall-w": [150, 150], "hall-e": [250, 150],
    "w-door": [200, 80], "w-a": [215, 55], "b-door": [100, 150], "b-a": [55, 150],
    "h-door": [300, 150], "h-a": [345, 150], "d-door": [200, 220], "d-a": [200, 245],
  },
  edges: [["hall-n", "w-door"], ["w-door", "w-a"], ["hall-w", "b-door"], ["b-door", "b-a"], ["hall-e", "h-door"], ["h-door", "h-a"],
    ["hall-s", "d-door"], ["d-door", "d-a"], ["hall-n", "hall-w"], ["hall-n", "hall-e"], ["hall-s", "hall-w"], ["hall-s", "hall-e"]],
  exit: "d-a",
};
const session = (id: string, status: OfficeSession["status"]): OfficeSession => ({
  id, provider: "anthropic", agent: "claude-code", providerSessionId: `${id}-p`, sessionName: id, summary: `${id} 요약`, status,
  createdAt: "2026-11-04T06:00:00.000Z", updatedAt: "2026-11-04T06:00:00.000Z", endedAt: null, endReason: null,
});
const run = (pets: PetSim, seconds: number, agents: Parameters<PetSim["step"]>[1] = []) => { for (let t = 0; t < seconds; t += 0.05) pets.step(0.05, agents); };

describe("office pets", () => {
  test("a few different pets are already there when the office opens, standing on walkable spots", () => {
    const graph = new WalkGraph(layout);
    const pets = new PetSim(layout, graph, { random: seeded(1) });
    const all = pets.all();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.length).toBeLessThanOrEqual(5);
    expect(new Set(all.map((pet) => pet.species)).size).toBe(all.length);
    for (const pet of all) {
      expect(pet).toMatchObject({ mode: "idle", alpha: 1 });
      expect(pet.node.startsWith("seat:")).toBe(false);
      expect([pet.x, pet.y]).toEqual([...graph.point(pet.node)]);
    }
  });

  test("every shipped building gives pets walkable cells to wander, and they wander, cry, jump and sleep over time", () => {
    for (const { layout: shipped } of [buildingOf("night"), buildingOf("birch"), buildingOf("oak")]) {
      const pets = new PetSim(shipped, new WalkGraph(shipped), { random: seeded(7), count: 5 });
      const seen = new Set<string>();
      const moved = new Set<string>();
      const start = new Map(pets.all().map((pet) => [pet.id, [pet.x, pet.y]]));
      for (let t = 0; t < 240; t += 0.05) {
        pets.step(0.05);
        for (const pet of pets.all()) {
          seen.add(pet.mode);
          const [x, y] = start.get(pet.id) ?? [pet.x, pet.y];
          if (Math.hypot(pet.x - x!, pet.y - y!) > 20) moved.add(pet.id);
          expect(pet.node.startsWith("c:") || pet.node === shipped.exit).toBe(true);
        }
      }
      for (const mode of ["walk", "cry", "jump", "sleep"]) expect(seen).toContain(mode);
      expect(moved.size).toBeGreaterThanOrEqual(3);
    }
  });

  test("a pet walks up to a resting person, greets them with a happy sound and turns to them; the office hears about it once", () => {
    const sim = new OfficeSim(layout, { sitSeconds: 0.5, random: seeded(3), clock: () => Date.parse("2026-11-04T06:01:00.000Z") });
    sim.sync([session("a", "done")]);
    const person = sim.agent("a")!;
    // 반기러 가기(0.36–0.56)를 고르도록 맞춘 난수
    let roll = 0;
    const rolls = [0.5, 0.1, 0.4, 0.0, 0.5];
    const pets = new PetSim(layout, sim.graph, { random: () => rolls[roll++ % rolls.length]!, count: 1 });
    const pet = pets.all()[0]!;
    pet.rest = 0;
    let greeted: { pet: Pet; friend: string }[] = [];
    for (let t = 0; t < 30 && pet.mode !== "interact"; t += 0.05) {
      pets.step(0.05, sim.agents());
      greeted = [...greeted, ...pets.takeGreetings()];
    }
    expect(pet.mode).toBe("interact");
    expect(pet.friend).toBe("a");
    expect(TRAITS[pet.species].happy).toContain(pet.sound!);
    expect(pet.flip).toBe(person.x < pet.x);
    expect(greeted).toEqual([{ pet, friend: "a" }]);
    expect(pets.takeGreetings()).toEqual([]);
    expect(pets.friends().get("a")).toBe(pet);
    expect(petPose(pet)).toBe("interact");
    // 사람이 떠나면 그만두고 쉰다.
    pets.step(0.05, []);
    expect(pet).toMatchObject({ mode: "idle", friend: null, sound: null });
  });

  test("poking a pet makes it hop and call out, waking it if it slept; it settles afterwards", () => {
    const pets = new PetSim(layout, new WalkGraph(layout), { random: seeded(4), count: 1 });
    const pet = pets.all()[0]!;
    Object.assign(pet, { mode: "sleep", hold: 100 });
    expect(pets.poke(pet.id)).toBe(true);
    expect(pet).toMatchObject({ mode: "jump", view: "front" });
    expect(TRAITS[pet.species].sounds).toContain(pet.sound!);
    run(pets, JUMP_SECONDS / 2);
    expect(petHop(pet)).toBeGreaterThan(4);
    run(pets, JUMP_SECONDS * 1.6);
    expect(pet.mode).toBe("idle");
    expect(pet.sound).toBeNull();
    expect(pets.poke("missing")).toBe(false);
  });

  test("with reduced motion pets never walk off; they only rest, sleep or call out where they are", () => {
    const pets = new PetSim(layout, new WalkGraph(layout), { random: seeded(5), reduced: true, count: 3 });
    const start = pets.all().map((pet) => [pet.x, pet.y]);
    run(pets, 120);
    expect(pets.all().map((pet) => [pet.x, pet.y])).toEqual(start);
    expect(pets.all().every((pet) => pet.mode !== "walk" && pet.mode !== "jump")).toBe(true);
  });

  test("now and then one pet leaves by the exit and a different one comes in through it", () => {
    const pets = new PetSim(layout, new WalkGraph(layout), { random: seeded(6), count: 3 });
    const first = new Set(pets.all().map((pet) => pet.id));
    run(pets, 700);
    const now = pets.all();
    expect(now.length).toBe(3);
    expect(now.some((pet) => !first.has(pet.id))).toBe(true);
  });

  test("pets are named in what people say to them, and every species has its own sounds", () => {
    expect(SPECIES).toHaveLength(7);
    for (const species of SPECIES) {
      expect(TRAITS[species].sounds.length).toBeGreaterThan(0);
      expect(remarkFor(species, () => 0.2)).toBe(`${TRAITS[species].call}, 안녕!`);
    }
    expect(seatNode("x")).toBe("seat:x");
  });
});

describe("office pets with part of the art", () => {
  test("only species with art come into the office, even when more are wanted than there are species", () => {
    const pets = new PetSim(layout, new WalkGraph(layout), { random: seeded(8), count: 4, species: ["cat", "panda"] });
    expect(pets.all()).toHaveLength(4);
    expect(new Set(pets.all().map((pet) => pet.species))).toEqual(new Set(["cat", "panda"]));
  });
});
