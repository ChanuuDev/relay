import { cellAt, cellNode, type OfficeLayout, type WalkGraph } from "./layout";
import type { Agent } from "./sim";

/** 사무실을 돌아다니는 반려동물 */
export type Species = "rabbit" | "squirrel" | "cat" | "ferret" | "panda" | "dog" | "turtle";
export const SPECIES: readonly Species[] = ["rabbit", "squirrel", "cat", "ferret", "panda", "dog", "turtle"];
/** 화면에 보이는 이름 */
export const PET_NAMES: Record<Species, string> = { rabbit: "토끼", squirrel: "다람쥐", cat: "고양이", ferret: "페럿", panda: "판다", dog: "강아지", turtle: "거북이" };
export type PetAnim = "front_idle" | "back_idle" | "front_walk" | "back_walk" | "cry" | "jump" | "sleep" | "interact";
/**
 * appear: 빛과 함께 나타남, idle: 서서 쉼, walk: 걷기, cry: 짖기·울기, jump: 제자리 뛰기, sleep: 웅크려 잠,
 * interact: 사람 곁에서 반기기(하트), leave: 출구로 나가는 중, vanish: 사라짐
 */
export type PetMode = "appear" | "idle" | "walk" | "cry" | "jump" | "sleep" | "interact" | "vanish";

export interface Pet {
  id: string;
  species: Species;
  x: number;
  y: number;
  /** 마지막으로 닿은 길 노드 */
  node: string;
  path: string[];
  mode: PetMode;
  /** 지금 모드에 머문 초 */
  t: number;
  /** 지금 동작을 이어 갈 초(울기·뛰기·잠·반기기) */
  hold: number;
  view: "front" | "back";
  flip: boolean;
  alpha: number;
  /** 애니메이션을 서로 어긋나게 하는 초 */
  phase: number;
  /** 다음 할 일을 고르기까지 남은 초 */
  rest: number;
  /** 다가가 반기는 사람(세션 ID) */
  friend: string | null;
  /** 출구로 나가는 중 */
  leaving: boolean;
  /** 지금 내는 소리(말풍선). 없으면 null */
  sound: string | null;
}

interface Traits {
  /** 이름(사람이 부를 때) */
  call: string;
  /** 걷는 빠르기(배경 픽셀/초) */
  speed: number;
  /** 울음소리 */
  sounds: readonly string[];
  /** 반길 때 내는 소리 */
  happy: readonly string[];
}

export const TRAITS: Record<Species, Traits> = {
  rabbit: { call: "토끼야", speed: 30, sounds: ["뀨!", "킁킁", "뀨우"], happy: ["뀨뀨!", "깡총!"] },
  squirrel: { call: "다람쥐야", speed: 38, sounds: ["찍찍!", "쪼르르", "찌익"], happy: ["찍!", "도토리?"] },
  cat: { call: "냥이야", speed: 28, sounds: ["야옹~", "냐아", "먀"], happy: ["골골골", "냐앙~"] },
  ferret: { call: "페럿아", speed: 36, sounds: ["끼익!", "킁킁", "꾹꾹"], happy: ["끼잉~", "꾹꾹!"] },
  panda: { call: "판다야", speed: 16, sounds: ["끼잉~", "음냐", "뀨잉"], happy: ["끼잉!", "냠냠"] },
  dog: { call: "멍멍아", speed: 36, sounds: ["멍!", "왈왈!", "멍멍!"], happy: ["멍!", "헥헥"] },
  turtle: { call: "거북아", speed: 9, sounds: ["...", "끄응", "쉬익"], happy: ["느릿느릿", "..."] },
};

/** 사람이 반려동물을 보고 하는 한마디. {call}은 그 동물을 부르는 말이다. */
export const PET_REMARKS: readonly string[] = ["귀여워!", "{call}, 안녕!", "쓰담쓰담", "어디서 왔니?", "간식 줄까?", "{call}~"];

/** 반려동물 동작의 길이(초) */
export const CRY_SECONDS = 1.6;
export const JUMP_SECONDS = 0.9;
const APPEAR_SECONDS = 0.6;
const VANISH_SECONDS = 0.8;
/** 반기러 갈 사람을 찾는 거리, 그 곁에 머무는 시간 */
const VISIT_RADIUS = 360;
const VISIT_SECONDS = [4, 7] as const;
/** 돌아다닐 때 한 번에 가는 거리 */
const WANDER_RADIUS = 260;
/** 사무실에 처음 있는 수 */
export const PET_COUNT = [3, 5] as const;
/** 가끔 하나가 나가고 다른 동물이 들어온다(초) */
const SWAP_SECONDS = [100, 220] as const;

export interface PetOptions {
  random?: () => number;
  /** 움직임 줄이기: 걷지 않고 제자리에서 쉬거나 잔다. */
  reduced?: boolean;
  /** 처음 있는 수. 기본은 3–5마리 */
  count?: number;
  /** 사무실에 나올 수 있는 종(그림이 있는 종). 기본은 모든 종 */
  species?: readonly Species[];
}

const between = (random: () => number, [low, high]: readonly [number, number]) => low + random() * (high - low);
const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** 사람과 함께 사무실을 돌아다니는 반려동물들. 사람의 시뮬레이션(OfficeSim)과 따로 돌며, 사람을 보기만 한다. */
export class PetSim {
  private readonly pets = new Map<string, Pet>();
  private readonly random: () => number;
  /** 서 있을 수 있는 길 노드(격자 사무실은 걷는 칸, 아니면 좌석이 아닌 노드) */
  private readonly spots: string[];
  private serial = 0;
  /** 다음에 하나가 나가고 새로 들어올 때까지(초) */
  private swap: number;
  /** 사람 곁에 닿아 반기기 시작한 일. 사무실이 그 사람의 한마디로 받는다. */
  private greetings: { pet: Pet; friend: string }[] = [];

  constructor(readonly layout: OfficeLayout, readonly graph: WalkGraph, private readonly options: PetOptions = {}) {
    this.random = options.random ?? Math.random;
    const nodes = [...graph.points.keys()];
    this.spots = layout.grid ? nodes.filter((id) => id.startsWith("c:")) : nodes.filter((id) => !id.startsWith("seat:") && !id.includes(":"));
    if (!this.spots.length) this.spots = nodes.filter((id) => !id.startsWith("seat:"));
    this.swap = between(this.random, SWAP_SECONDS);
    const count = options.count ?? Math.round(between(this.random, PET_COUNT));
    for (let index = 0; index < count; index++) this.arrive(this.pick(), true);
  }

  set reduced(value: boolean) { this.options.reduced = value; }

  all(): Pet[] { return [...this.pets.values()]; }
  pet(id: string) { return this.pets.get(id); }

  /** 사무실에 없는 종 하나를 고른다. 모두 있으면 아무 종이나. */
  private pick(): Species {
    const present = new Set([...this.pets.values()].map((pet) => pet.species));
    const pool = this.options.species?.length ? this.options.species : SPECIES;
    const absent = pool.filter((species) => !present.has(species));
    const list = absent.length ? absent : pool;
    return list[Math.floor(this.random() * list.length)]!;
  }

  /** 새 동물이 들어온다. 처음에는 아무 칸에, 나중에는 출구(없으면 아무 칸)에서 나타난다. */
  private arrive(species: Species, first: boolean) {
    const node = !first && this.layout.exit && this.graph.points.has(this.layout.exit) ? this.layout.exit : this.spots[Math.floor(this.random() * this.spots.length)]!;
    const [x, y] = this.graph.point(node);
    const pet: Pet = {
      id: `pet-${++this.serial}`, species, x, y, node, path: [], mode: "appear", t: 0, hold: 0,
      view: "front", flip: this.random() < 0.5, alpha: first ? 1 : 0, phase: this.random() * 4,
      rest: 1 + this.random() * 4, friend: null, leaving: false, sound: null,
    };
    if (first) pet.mode = "idle";
    this.pets.set(pet.id, pet);
    return pet;
  }

  private setMode(pet: Pet, mode: PetMode, hold = 0) { pet.mode = mode; pet.t = 0; pet.hold = hold; }

  /** 눌러서 부른다: 제자리에서 뛰며 운다. 자고 있었으면 깬다. */
  poke(id: string) {
    const pet = this.pets.get(id);
    if (!pet || pet.leaving || pet.mode === "appear" || pet.mode === "vanish") return false;
    pet.path = []; pet.friend = null;
    pet.view = "front";
    pet.sound = this.say(pet.species, "sounds");
    this.setMode(pet, "jump", JUMP_SECONDS * 2);
    return true;
  }

  private say(species: Species, kind: "sounds" | "happy") {
    const list = TRAITS[species][kind];
    return list[Math.floor(this.random() * list.length)]!;
  }

  step(seconds: number, agents: readonly Agent[] = []) {
    const dt = Math.min(Math.max(seconds, 0), 0.1);
    this.swap -= dt;
    if (this.swap <= 0) { this.swap = between(this.random, SWAP_SECONDS); this.rotate(); }
    for (const pet of [...this.pets.values()]) {
      pet.t += dt;
      switch (pet.mode) {
        case "appear":
          pet.alpha = Math.min(1, pet.alpha + dt / APPEAR_SECONDS);
          if (pet.alpha >= 1) this.setMode(pet, "idle");
          break;
        case "vanish":
          pet.alpha = Math.max(0, pet.alpha - dt / VANISH_SECONDS);
          if (pet.alpha <= 0) { this.pets.delete(pet.id); if (!this.options.reduced) this.arrive(this.pick(), false); }
          break;
        case "idle":
          pet.rest -= dt;
          if (pet.rest <= 0) this.decide(pet, agents);
          break;
        case "walk":
          this.walk(pet, dt, agents);
          break;
        case "interact": {
          const friend = agents.find((agent) => agent.id === pet.friend);
          // 반기던 사람이 떠나거나 멀어지면 그만둔다.
          if (!friend || friend.leaving || distance(friend.x, friend.y, pet.x, pet.y) > 48) { this.calm(pet); break; }
          if (Math.abs(friend.x - pet.x) > 2) pet.flip = friend.x < pet.x;
          if (pet.t >= pet.hold) this.calm(pet);
          else if (pet.t > 1.6) pet.sound = null;
          break;
        }
        case "cry":
          if (pet.t >= pet.hold) this.calm(pet);
          break;
        case "jump":
          if (pet.t > CRY_SECONDS) pet.sound = null;
          if (pet.t >= pet.hold) this.calm(pet);
          break;
        case "sleep":
          if (pet.t >= pet.hold) this.calm(pet);
          break;
      }
    }
  }

  /** 하던 일을 마치고 잠시 쉰다. */
  private calm(pet: Pet) {
    pet.sound = null;
    pet.friend = null;
    pet.rest = 1.5 + this.random() * 4;
    this.setMode(pet, "idle");
  }

  /** 쉬다가 다음 할 일을 고른다: 돌아다니기, 사람에게 가서 반기기, 잠자기, 울기, 뛰기. */
  private decide(pet: Pet, agents: readonly Agent[]) {
    const roll = this.random();
    const reduced = this.options.reduced;
    if (!reduced && roll < 0.36) { if (this.wander(pet)) return; }
    else if (!reduced && roll < 0.56) { if (this.visit(pet, agents)) return; }
    else if (roll < 0.7) {
      // 거북이와 판다는 더 오래 잔다.
      const long = pet.species === "turtle" || pet.species === "panda" ? 1.6 : 1;
      this.setMode(pet, "sleep", (10 + this.random() * 16) * long);
      return;
    } else if (roll < 0.86) {
      pet.view = "front";
      pet.sound = this.say(pet.species, "sounds");
      this.setMode(pet, "cry", CRY_SECONDS);
      return;
    } else if (!reduced) {
      pet.view = "front";
      this.setMode(pet, "jump", JUMP_SECONDS * (this.random() < 0.5 ? 1 : 2));
      return;
    }
    pet.rest = 2 + this.random() * 4;
  }

  /** 가까운 빈 칸으로 걸어간다. */
  private wander(pet: Pet) {
    const near = this.spots.filter((id) => {
      const [x, y] = this.graph.point(id);
      const d = distance(x, y, pet.x, pet.y);
      return d > 30 && d < WANDER_RADIUS;
    });
    if (!near.length) return false;
    return this.go(pet, near[Math.floor(this.random() * near.length)]!);
  }

  /** 가까이 있는 사람 곁의 칸으로 가서 반긴다. 들려 있거나 떠나는 사람에게는 가지 않는다. */
  private visit(pet: Pet, agents: readonly Agent[]) {
    const people = agents.filter((agent) => !agent.leaving && agent.mode !== "held" && agent.mode !== "land" && agent.mode !== "appear"
      && agent.mode !== "walk" && distance(agent.x, agent.y, pet.x, pet.y) < VISIT_RADIUS);
    if (!people.length) return false;
    const friend = people[Math.floor(this.random() * people.length)]!;
    const spot = this.besides(friend);
    if (!spot || !this.go(pet, spot)) return false;
    pet.friend = friend.id;
    return true;
  }

  /** 사람 곁의 걷는 칸(사람 칸 둘레). 격자가 없으면 가장 가까운 노드. */
  private besides(agent: Agent): string | null {
    const grid = this.layout.grid;
    if (!grid) return this.closest(agent.x, agent.y, 12);
    const cell = cellAt(grid, agent.x, agent.y);
    if (!cell) return null;
    const options = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => [cell[0] + dx!, cell[1] + dy!] as const)
      .filter(([cx, cy]) => this.graph.points.has(cellNode(cx, cy)))
      .filter(([cx, cy]) => !this.all().some((other) => other.node === cellNode(cx, cy) && other.mode !== "walk"));
    if (!options.length) return null;
    const [cx, cy] = options[Math.floor(this.random() * Math.min(options.length, 4))]!;
    return cellNode(cx, cy);
  }

  private closest(x: number, y: number, min = 0) {
    let best: string | null = null, score = Infinity;
    for (const id of this.spots) {
      const [px, py] = this.graph.point(id);
      const value = distance(x, y, px, py);
      if (value >= min && value < score) { score = value; best = id; }
    }
    return best;
  }

  private go(pet: Pet, target: string) {
    const route = this.graph.route(pet.node, target);
    if (!route || !route.length) return false;
    pet.path = route;
    this.setMode(pet, "walk");
    return true;
  }

  private walk(pet: Pet, dt: number, agents: readonly Agent[]) {
    let budget = TRAITS[pet.species].speed * dt;
    while (budget > 0) {
      const next = pet.path[0];
      if (!next) { this.reach(pet, agents); return; }
      const [tx, ty] = this.graph.point(next);
      const dx = tx - pet.x, dy = ty - pet.y;
      const length = Math.hypot(dx, dy);
      if (length > 0.01) {
        if (Math.abs(dy) > 0.2) pet.view = dy > 0 ? "front" : "back";
        if (Math.abs(dx) > 0.2) pet.flip = dx < 0;
      }
      if (length <= budget) {
        pet.x = tx; pet.y = ty; pet.node = next; pet.path.shift();
        budget -= length;
        continue;
      }
      pet.x += (dx / length) * budget;
      pet.y += (dy / length) * budget;
      budget = 0;
    }
  }

  /** 걸어서 닿았다. 나가는 중이면 사라지고, 반기러 왔으면 사람을 보고 반긴다. */
  private reach(pet: Pet, agents: readonly Agent[]) {
    pet.path = [];
    if (pet.leaving) { this.setMode(pet, "vanish"); return; }
    const friend = pet.friend ? agents.find((agent) => agent.id === pet.friend) : undefined;
    if (friend && !friend.leaving && distance(friend.x, friend.y, pet.x, pet.y) < 48) {
      pet.view = "front";
      pet.flip = friend.x < pet.x;
      pet.sound = this.say(pet.species, "happy");
      this.setMode(pet, "interact", between(this.random, VISIT_SECONDS));
      this.greetings.push({ pet, friend: friend.id });
      return;
    }
    pet.friend = null;
    pet.rest = 2 + this.random() * 5;
    this.setMode(pet, "idle");
  }

  /** 하나가 출구로 나가고, 사라지면 다른 동물이 들어온다. */
  private rotate() {
    if (this.options.reduced) return;
    const candidates = this.all().filter((pet) => !pet.leaving && (pet.mode === "idle" || pet.mode === "sleep"));
    const exit = this.layout.exit && this.graph.points.has(this.layout.exit) ? this.layout.exit : null;
    if (!candidates.length || !exit || this.random() < 0.4) return;
    const pet = candidates[Math.floor(this.random() * candidates.length)]!;
    pet.leaving = true;
    pet.friend = null;
    pet.sound = null;
    if (!this.go(pet, exit)) { pet.leaving = false; return; }
  }

  /** 지난번 뒤로 사람 곁에 닿아 반기기 시작한 일들을 꺼낸다. */
  takeGreetings() {
    const list = this.greetings;
    this.greetings = [];
    return list;
  }

  /** 반기는 사람(세션 ID) → 그 사람을 반기는 반려동물 */
  friends(): Map<string, Pet> {
    const map = new Map<string, Pet>();
    for (const pet of this.pets.values()) if (pet.mode === "interact" && pet.friend) map.set(pet.friend, pet);
    return map;
  }
}

/** 뛰는 동안 바닥에서 떠오르는 높이(배경 픽셀). 그림은 웅크렸다 뻗는 자세만 있고 높이는 여기서 준다. */
export function petHop(pet: Pet) {
  if (pet.mode !== "jump") return 0;
  return Math.round(Math.abs(Math.sin((pet.t / JUMP_SECONDS) * Math.PI)) * 7);
}

/** 사람이 반려동물을 보고 하는 한마디 */
export function remarkFor(species: Species, random: () => number = Math.random) {
  const line = PET_REMARKS[Math.floor(random() * PET_REMARKS.length)]!;
  return line.replace("{call}", TRAITS[species].call);
}

/** 동물마다 그릴 칸: 쉬기·걷기는 앞뒤, 나머지는 앞(오른쪽 아래를 봄)만 있다. 왼쪽을 볼 때는 좌우를 뒤집는다. */
export function petPose(pet: Pet): PetAnim {
  switch (pet.mode) {
    case "walk": return pet.view === "front" ? "front_walk" : "back_walk";
    case "cry": return "cry";
    case "jump": return "jump";
    case "sleep": return "sleep";
    case "interact": return "interact";
    default: return pet.view === "front" ? "front_idle" : "back_idle";
  }
}

