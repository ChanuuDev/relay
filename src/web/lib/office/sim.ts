import type { SessionStatus } from "../../../session/session.types";
import { HALL_CENTER, seatNode, spawnNode, WalkGraph, wanderNode, WORK_ZONES, type OfficeLayout, type Seat, type Zone } from "./layout";
import { lookFor, type Look } from "./look";

/** 사무실이 쓰는 세션 정보. 목록 API의 세션에서 이것만 읽는다. */
export interface OfficeSession {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null;
  summary: string; status: SessionStatus | null; createdAt: string; updatedAt: string; endedAt: string | null;
}

/** held: 마우스로 등을 잡혀 들린 채 버둥거림. land: 내려놓아 바닥에 닿는 중. */
export type Mode = "appear" | "walk" | "stand" | "sitdown" | "seated" | "standup" | "vanish" | "held" | "land";
/** 앞(오른쪽 아래를 봄)·뒤(오른쪽 위를 봄). flip이면 좌우를 뒤집어 왼쪽을 본다. */
export type View = "front" | "back";

export interface Agent {
  id: string;
  session: OfficeSession;
  look: Look;
  zone: Zone;
  /** 차지한 자리(좌석 노드 또는 홀 배회 지점). 떠나는 중이면 null. */
  spot: string | null;
  /** 떠나는 중: out은 목록에서 빠져 조용히 사라지고, home은 로비에서 머문 뒤 퇴근한다. */
  leaving: false | "out" | "home";
  /** 작업 상태가 바뀌어 새 구역으로 서둘러 가는 중(빠른 걸음) */
  hurry: boolean;
  /** 완료하고 세션도 끝나 로비에 머무는 세션이 스스로 퇴근할 시각(ms). 아니면 null. */
  homeAt: number | null;
  /** 노드가 아닌 곳에 서 있다(내려놓은 자리). 다음 걸음은 가장 가까운 노드부터 잡는다. */
  loose: boolean;
  /** 들린 높이 0–1. 잡으면 올라가고 내려놓으면 내려온다. */
  lift: number;
  /** 마지막으로 닿은 노드 */
  node: string;
  x: number;
  y: number;
  path: string[];
  mode: Mode;
  /** 지금 모드에 머문 초 */
  t: number;
  view: View;
  flip: boolean;
  alpha: number;
  /** 애니메이션을 서로 어긋나게 하는 초 */
  phase: number;
  /** 홀에서 다음 배회까지 남은 초 */
  rest: number;
}

export const zoneOf = (status: SessionStatus | null): Zone => status ?? "hall";
/** 완료하고 세션도 끝난 뒤 로비에 머무는 시간. 그 뒤에는 스스로 퇴근해 보이지 않는다. */
export const LINGER_MS = 10 * 60 * 1000;
/** 완료+종료 후 머무는 시간이 지났으면 퇴근한 것이다. 사무실에 남지 않는다. */
export const wentHome = (session: Pick<OfficeSession, "status" | "endedAt">, now: number) =>
  session.status === "done" && Boolean(session.endedAt) && now - Date.parse(session.endedAt!) >= LINGER_MS;
/** 로비에서 스스로 퇴근할 시각. 완료+종료가 아니면 null. */
export const homeTime = (session: Pick<OfficeSession, "status" | "endedAt">) =>
  session.status === "done" && session.endedAt ? Date.parse(session.endedAt) + LINGER_MS : null;
/** 범례가 세는 묶음: 구역들과 퇴근 */
export type Tally = Zone | "home";
export const TALLIES: readonly Tally[] = [...WORK_ZONES, "hall", "home"];

/** 걷는 빠르기(배경 픽셀/초) */
export const WALK_SPEED = 54;
/** 상태가 바뀌어 옮길 때의 걸음 배율 */
export const HURRY = 2.2;
const APPEAR_SECONDS = 0.6;
const VANISH_SECONDS = 0.5;
/** 퇴근할 때 출구(없으면 홀의 빛기둥) 속으로 사라지는 시간 */
export const HOME_SECONDS = 1.1;
/** 잡아 올리는 시간과 내려놓는 시간 */
export const LIFT_SECONDS = 0.16;
export const LAND_SECONDS = 0.22;
/** 홀 대기 인원 상한. 배회 지점보다 많아지지 않는다. */
const HALL_LIMIT = 10;

export interface SimOptions {
  /** 의자에 앉는 애니메이션 길이(초). 일어설 때는 거꾸로 같은 길이로 튼다. */
  sitSeconds: number;
  /** 움직임 줄이기: 걷지 않고 바로 자리로 간다. */
  reduced?: boolean;
  /** 스프라이트 몸체(머리 모양) 수 */
  bodies?: number;
  random?: () => number;
  /** 지금 시각(ms). 로비에 머무는 시간을 잰다. */
  clock?: () => number;
}

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class OfficeSim {
  readonly graph: WalkGraph;
  private readonly byId = new Map<string, Agent>();
  /** 자리 노드 → 차지한 에이전트 ID */
  private readonly taken = new Map<string, string>();
  private readonly capacity: Record<Zone, number>;
  private readonly seats = new Map<string, Seat>();
  private readonly random: () => number;
  private readonly clock: () => number;
  private synced = false;
  private totals: Record<Tally, number> = { hall: 0, working: 0, blocked: 0, handoff: 0, done: 0, home: 0 };

  constructor(readonly layout: OfficeLayout, private readonly options: SimOptions) {
    this.graph = new WalkGraph(layout);
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? Date.now;
    for (const zone of Object.values(layout.zones)) for (const seat of zone.seats) this.seats.set(seatNode(seat.id), seat);
    this.capacity = {
      hall: Math.min(HALL_LIMIT, layout.hall.wander.length),
      working: layout.zones.working.seats.length, blocked: layout.zones.blocked.seats.length,
      handoff: layout.zones.handoff.seats.length, done: layout.zones.done.seats.length,
    };
  }

  agents(): Agent[] { return [...this.byId.values()]; }
  agent(id: string) { return this.byId.get(id); }

  /** 구역마다 보이는 인원과 전체 인원. 퇴근한 세션은 보이지 않고 수만 센다. */
  counts(): Record<Tally, { shown: number; total: number }> {
    const shown: Record<Tally, number> = { hall: 0, working: 0, blocked: 0, handoff: 0, done: 0, home: 0 };
    for (const agent of this.byId.values()) if (!agent.leaving) shown[agent.zone] += 1;
    return Object.fromEntries(TALLIES.map((tally) => [tally, { shown: shown[tally], total: this.totals[tally] }])) as Record<Tally, { shown: number; total: number }>;
  }

  set reduced(value: boolean) { this.options.reduced = value; }

  /** 최근 갱신 순 세션 목록을 받아 누가 어느 구역에 있어야 하는지 정한다. 처음 받은 목록은 모두 제자리에 바로 앉힌다. */
  sync(sessions: readonly OfficeSession[]) {
    const now = this.clock();
    const totals: Record<Tally, number> = { hall: 0, working: 0, blocked: 0, handoff: 0, done: 0, home: 0 };
    const chosen = new Map<string, { session: OfficeSession; zone: Zone }>();
    const home = new Map<string, OfficeSession>();
    for (const session of sessions) {
      if (wentHome(session, now)) { totals.home += 1; home.set(session.id, session); continue; }
      const zone = zoneOf(session.status);
      totals[zone] += 1;
      if (totals[zone] <= this.capacity[zone]) chosen.set(session.id, { session, zone });
    }
    this.totals = totals;
    const first = !this.synced;
    // 자리를 먼저 비운 뒤 새로 고른다. 그래야 구역을 옮기는 세션이 빈자리를 바로 얻는다.
    for (const agent of this.byId.values()) {
      const next = chosen.get(agent.id);
      if (!next) {
        const finished = home.get(agent.id);
        if (finished) agent.session = finished;
        const kind = finished ? "home" : "out";
        if (agent.leaving !== kind && agent.leaving !== "home") this.leave(agent, kind);
        continue;
      }
      agent.session = next.session;
      agent.homeAt = homeTime(next.session);
      if (agent.zone !== next.zone || agent.leaving) {
        // 작업 상태가 바뀌면 새 구역으로 서둘러 간다. 처음 들어오거나 다시 돌아온 세션은 보통 걸음이다.
        agent.hurry = agent.zone !== next.zone && !agent.leaving && !first;
        this.release(agent); agent.zone = next.zone; agent.leaving = false;
      }
    }
    this.synced = true;
    for (const { session, zone } of chosen.values()) {
      const agent = this.byId.get(session.id);
      if (agent) { if (!agent.spot) { agent.spot = this.claim(zone, agent.id); this.retarget(agent); } continue; }
      this.add(session, zone, first);
    }
  }

  private add(session: OfficeSession, zone: Zone, placeAtSpot: boolean) {
    const spot = this.claim(zone, session.id);
    const agent: Agent = {
      id: session.id, session, look: lookFor(session.id, this.options.bodies), zone, spot, leaving: false, hurry: false,
      homeAt: homeTime(session), loose: false, lift: 0,
      node: spot, x: 0, y: 0, path: [], mode: "appear", t: 0, view: "front", flip: false, alpha: 0,
      phase: this.random() * 4, rest: 2 + this.random() * 6,
    };
    if (placeAtSpot || this.options.reduced) {
      this.place(agent, spot);
      agent.alpha = 1;
      this.arrive(agent, true);
    } else {
      const spawns = this.layout.hall.spawn;
      this.place(agent, spawnNode(Math.floor(this.random() * spawns.length)));
    }
    this.byId.set(agent.id, agent);
  }

  private place(agent: Agent, node: string) {
    const [x, y] = this.graph.point(node);
    agent.node = node; agent.x = x; agent.y = y; agent.path = []; agent.loose = false;
  }

  /** 구역의 빈자리 중 문에서 가까운 것부터 준다. 홀은 비어 있는 배회 지점을 고루 쓴다. */
  private claim(zone: Zone, id: string): string {
    const candidates = zone === "hall"
      ? this.shuffle(this.layout.hall.wander.map((_, index) => wanderNode(index)))
      : this.layout.zones[zone].seats.map((seat) => seatNode(seat.id));
    const free = candidates.find((node) => !this.taken.has(node)) ?? candidates[0]!;
    this.taken.set(free, id);
    return free;
  }

  private release(agent: Agent) {
    if (agent.spot && this.taken.get(agent.spot) === agent.id) this.taken.delete(agent.spot);
    agent.spot = null;
  }

  private shuffle<T>(list: T[]) {
    for (let index = list.length - 1; index > 0; index--) {
      const other = Math.floor(this.random() * (index + 1));
      [list[index], list[other]] = [list[other]!, list[index]!];
    }
    return list;
  }

  private leave(agent: Agent, kind: "out" | "home") {
    this.release(agent);
    agent.leaving = kind;
    agent.hurry = false;
    agent.homeAt = null;
    this.retarget(agent);
  }

  /** 퇴근은 로비의 출구로, 목록에서 빠진 세션은 홀 가운데로 나간다. */
  private targetOf(agent: Agent) {
    if (agent.leaving === "home") return this.layout.exit ?? HALL_CENTER;
    return agent.leaving ? HALL_CENTER : agent.spot ?? HALL_CENTER;
  }

  /** 가야 할 곳이 바뀌었다. 앉아 있으면 먼저 일어서고, 걷는 중이면 다음 노드에서 길을 다시 잡는다. 들려 있으면 내려놓을 때까지 기다린다. */
  private retarget(agent: Agent) {
    if (agent.mode === "held" || agent.mode === "land") return;
    if (this.options.reduced) {
      if (agent.leaving) { this.byId.delete(agent.id); return; }
      this.place(agent, this.targetOf(agent));
      this.arrive(agent, true);
      return;
    }
    switch (agent.mode) {
      case "seated": this.setMode(agent, "standup"); return;
      case "sitdown": agent.mode = "standup"; agent.t = Math.max(0, this.options.sitSeconds - agent.t); return;
      case "standup": case "appear": return; // 끝나면 길을 잡는다.
      case "walk": {
        const next = agent.path[0];
        if (!next) { this.go(agent); return; }
        const rest = this.graph.route(next, this.targetOf(agent));
        agent.path = rest ? [next, ...rest] : [next];
        return;
      }
      case "vanish": agent.alpha = Math.max(agent.alpha, 0.01); this.setMode(agent, "appear"); return;
      case "stand": this.go(agent); return;
    }
  }

  private setMode(agent: Agent, mode: Mode) { agent.mode = mode; agent.t = 0; }

  /** 내려놓은 자리처럼 노드가 아닌 곳에서는 가장 가까운 길 노드를 첫걸음으로 삼는다. */
  private nearestNode(x: number, y: number) {
    let best = HALL_CENTER, score = Infinity;
    for (const [id, [px, py]] of this.graph.points) {
      if (id.startsWith("seat:")) continue;
      const value = distance(x, y, px, py);
      if (value < score) { score = value; best = id; }
    }
    return best;
  }

  private go(agent: Agent) {
    const target = this.targetOf(agent);
    const from = agent.loose ? this.nearestNode(agent.x, agent.y) : agent.node;
    const route = this.graph.route(from, target);
    if (!route) { this.place(agent, target); this.arrive(agent); return; }
    const path = agent.loose && from !== target ? [from, ...route] : agent.loose ? [target] : route;
    agent.loose = false;
    if (!path.length) { this.arrive(agent); return; }
    agent.path = path;
    this.setMode(agent, "walk");
  }

  /** 목적지에 닿았다. 좌석이면 앉고, 홀이면 서서 쉬고, 떠나는 중이면 사라진다. */
  private arrive(agent: Agent, instant = false) {
    agent.path = [];
    agent.hurry = false;
    if (agent.leaving) { this.setMode(agent, "vanish"); return; }
    const stand = agent.spot ? this.seats.get(agent.spot)?.stand : undefined;
    if (stand) {
      agent.view = stand.view; agent.flip = Boolean(stand.flip); agent.rest = Infinity;
      this.setMode(agent, "stand");
      return;
    }
    if (agent.spot?.startsWith("seat:")) {
      agent.view = "back"; agent.flip = false;
      this.setMode(agent, instant ? "seated" : "sitdown");
      return;
    }
    agent.view = "front";
    agent.flip = this.random() < 0.5;
    agent.rest = 3 + this.random() * 7;
    this.setMode(agent, "stand");
  }

  /** 마우스로 등을 잡아 들어 올린다. 떠나는 중이거나 나타나는 중이면 잡지 않는다. */
  grab(id: string) {
    const agent = this.byId.get(id);
    if (!agent || agent.leaving || agent.mode === "appear" || agent.mode === "vanish") return false;
    agent.path = [];
    agent.hurry = false;
    agent.view = "front";
    this.setMode(agent, "held");
    return true;
  }

  /** 들린 캐릭터의 발밑 바닥 자리를 옮긴다(배경 좌표). */
  hold(id: string, x: number, y: number) {
    const agent = this.byId.get(id);
    if (!agent || agent.mode !== "held") return;
    if (Math.abs(x - agent.x) > 0.5) agent.flip = x < agent.x;
    agent.x = x; agent.y = y; agent.loose = true;
  }

  /** 내려놓는다. 바닥에 닿은 뒤 제자리(상태가 바뀌었으면 새 구역)로 서둘러 걸어간다. */
  drop(id: string) {
    const agent = this.byId.get(id);
    if (!agent || agent.mode !== "held") return;
    agent.hurry = true;
    this.setMode(agent, "land");
  }

  step(seconds: number) {
    const dt = Math.min(Math.max(seconds, 0), 0.1);
    const now = this.clock();
    for (const agent of [...this.byId.values()]) {
      agent.t += dt;
      // 로비에서 머무는 시간이 다 되면 스스로 출구로 나간다.
      if (agent.homeAt !== null && now >= agent.homeAt && !agent.leaving && agent.mode !== "held" && agent.mode !== "land") {
        this.leave(agent, "home");
        this.totals.home += 1;
        this.totals[agent.zone] = Math.max(0, this.totals[agent.zone] - 1);
      }
      switch (agent.mode) {
        case "appear":
          agent.alpha = Math.min(1, agent.alpha + dt / APPEAR_SECONDS);
          if (agent.alpha >= 1) this.go(agent);
          break;
        case "vanish":
          agent.alpha = Math.max(0, agent.alpha - dt / (agent.leaving === "home" ? HOME_SECONDS : VANISH_SECONDS));
          if (agent.alpha <= 0) this.byId.delete(agent.id);
          break;
        case "sitdown":
          if (agent.t >= this.options.sitSeconds) this.setMode(agent, "seated");
          break;
        case "standup":
          if (agent.t >= this.options.sitSeconds) { agent.view = "front"; this.go(agent); }
          break;
        case "stand":
          agent.rest -= dt;
          if (agent.rest <= 0 && agent.zone === "hall" && !agent.leaving && !this.options.reduced) this.wander(agent);
          break;
        case "walk":
          this.walk(agent, dt);
          break;
        case "held":
          agent.lift = Math.min(1, agent.lift + dt / LIFT_SECONDS);
          break;
        case "land":
          agent.lift = Math.max(0, agent.lift - dt / LAND_SECONDS);
          if (agent.lift <= 0) {
            if (agent.leaving) { this.go(agent); break; }
            agent.view = "front";
            this.go(agent);
          }
          break;
        case "seated":
          break;
      }
    }
  }

  private wander(agent: Agent) {
    const free = this.shuffle(this.layout.hall.wander.map((_, index) => wanderNode(index))).find((node) => !this.taken.has(node));
    if (!free) { agent.rest = 4; return; }
    this.release(agent);
    this.taken.set(free, agent.id);
    agent.spot = free;
    this.go(agent);
  }

  private walk(agent: Agent, dt: number) {
    let budget = WALK_SPEED * (agent.hurry ? HURRY : 1) * dt;
    while (budget > 0) {
      const next = agent.path[0];
      if (!next) { this.arrive(agent); return; }
      const [tx, ty] = this.graph.point(next);
      const dx = tx - agent.x, dy = ty - agent.y;
      const length = Math.hypot(dx, dy);
      if (length > 0.01) {
        if (Math.abs(dy) > 0.2) agent.view = dy > 0 ? "front" : "back";
        if (Math.abs(dx) > 0.2) agent.flip = dx < 0;
      }
      if (length <= budget) {
        agent.x = tx; agent.y = ty; agent.node = next; agent.path.shift();
        budget -= length;
        continue;
      }
      agent.x += (dx / length) * budget;
      agent.y += (dy / length) * budget;
      budget = 0;
    }
  }
}
