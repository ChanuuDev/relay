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
  /** 길 노드가 아닌 목적지(대화하러 상대 옆으로 갈 때). 경로의 GOAL 자리에 쓴다. */
  goal: readonly [number, number] | null;
  /** 홀·로비에서 마주 보고 나누는 대화. pending이면 상대에게 다가가는 중이다. */
  chat: Chat | null;
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

export interface Chat { partner: string; lead: boolean; pending: boolean; start: number; until: number; lines: readonly string[] }

export const zoneOf = (status: SessionStatus | null): Zone => status ?? "hall";
/** 가만히 있지 않고 가끔 돌아다니며 서로 대화하는 구역: 홀(대기)과 완료 로비 */
export const ROAMING: readonly Zone[] = ["hall", "done"];
const roams = (zone: Zone) => ROAMING.includes(zone);
/** 경로 끝의 임시 목적지 표시 */
const GOAL = "@goal";
/** 대화 한 줄을 띄우는 초 */
export const CHAT_LINE_SECONDS = 2.2;
/** 대화 한 번에 주고받는 말(질문·대답 짝). 홀은 대기 중 잡담, 로비는 퇴근 인사. */
export const CHAT_LINES: Record<"hall" | "done", readonly (readonly [string, string])[]> = {
  hall: [["어떤 작업 맡으셨어요?", "아직 배정 전이에요"], ["커피 한잔 할래요?", "좋아요, 가요!"], ["어제 그 버그 봤어요?", "봤어요, 고쳤대요"],
    ["오늘 리뷰 많네요", "같이 힘내요!"], ["로그 확인해 봤어요?", "지금 보는 중이에요"], ["다음 작업 뭐예요?", "곧 알려 준대요"]],
  done: [["오늘 고생 많았어요", "수고하셨어요!"], ["그 작업 끝났어요?", "방금 끝냈어요"], ["퇴근하세요?", "네, 먼저 갈게요"],
    ["내일 봐요!", "들어가세요~"], ["테스트 다 통과했죠?", "네, 깔끔해요"], ["저녁 뭐 먹어요?", "치킨이요!"]],
};
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
  /** 시뮬레이션이 흐른 초. 대화 차례를 잰다. */
  private time = 0;
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
        this.dropChat(agent);
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
      homeAt: homeTime(session), loose: false, lift: 0, goal: null, chat: null,
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
    this.dropChat(agent);
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
        if (!next || next === GOAL) { agent.goal = null; agent.loose = true; this.go(agent); return; }
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
    if (!agent.spot) { this.meet(agent); return; }
    const stand = this.seats.get(agent.spot)?.stand;
    if (stand) {
      agent.view = stand.view; agent.flip = Boolean(stand.flip);
      // 로비에 선 세션은 잠시 뒤 다른 자리로 옮기거나 누군가와 이야기한다. 인계 방은 그 자리에 머문다.
      agent.rest = roams(agent.zone) && !instant ? 4 + this.random() * 8 : roams(agent.zone) ? 2 + this.random() * 10 : Infinity;
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
    this.dropChat(agent);
    agent.path = [];
    agent.goal = null;
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
    this.time += dt;
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
          if (agent.chat && !agent.chat.pending) {
            if (this.time >= agent.chat.until && agent.chat.lead) this.endChat(agent);
            break;
          }
          if (agent.chat) break;
          agent.rest -= dt;
          if (agent.rest <= 0 && roams(agent.zone) && !agent.leaving && !this.options.reduced) this.idle(agent);
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

  /** 홀·로비에서 쉬던 세션이 할 일을 고른다: 가끔 가까운 동료에게 가서 이야기하고, 아니면 다른 빈자리로 옮긴다. */
  private idle(agent: Agent) {
    if (this.random() < 0.45 && this.startChat(agent)) return;
    this.wander(agent);
  }

  /** 같은 구역의 빈자리(홀은 배회 지점, 로비는 서 있는 자리)로 옮긴다. */
  private wander(agent: Agent) {
    const candidates = agent.zone === "hall"
      ? this.layout.hall.wander.map((_, index) => wanderNode(index))
      : agent.zone === "done" ? this.layout.zones.done.seats.map((seat) => seatNode(seat.id)) : [];
    const free = this.shuffle(candidates).find((node) => !this.taken.has(node));
    if (!free) { agent.rest = 4; return; }
    this.release(agent);
    this.taken.set(free, agent.id);
    agent.spot = free;
    this.go(agent);
  }

  /** 쉬고 있는 동료 하나를 골라 그 옆으로 걸어간다. 도착하면 마주 보고 대화한다. */
  private startChat(agent: Agent) {
    const partners = [...this.byId.values()].filter((other) => other !== agent && other.zone === agent.zone && other.mode === "stand"
      && !other.chat && !other.leaving && Math.hypot(other.x - agent.x, other.y - agent.y) < 320);
    if (!partners.length) return false;
    const partner = partners[Math.floor(this.random() * partners.length)]!;
    const side = agent.x < partner.x ? -1 : 1;
    agent.goal = [partner.x + side * 24, partner.y + 2];
    const lines = CHAT_LINES[agent.zone === "done" ? "done" : "hall"];
    const pair = lines[Math.floor(this.random() * lines.length)]!;
    agent.chat = { partner: partner.id, lead: true, pending: true, start: 0, until: 0, lines: pair };
    partner.chat = { partner: agent.id, lead: false, pending: true, start: 0, until: 0, lines: pair };
    partner.rest = Infinity;
    this.release(agent);
    const from = agent.loose ? this.nearestNode(agent.x, agent.y) : agent.node;
    const near = this.nearestNode(agent.goal[0], agent.goal[1]);
    const route = this.graph.route(from, near) ?? [];
    agent.path = [...(agent.loose && from !== near ? [from] : []), ...route, GOAL];
    agent.loose = false;
    this.setMode(agent, "walk");
    return true;
  }

  /** 대화하러 간 자리에 닿았다. 상대가 그대로 있으면 마주 보고 이야기를 시작하고, 아니면 빈자리를 찾아간다. */
  private meet(agent: Agent) {
    agent.goal = null;
    agent.loose = true;
    const partner = agent.chat ? this.byId.get(agent.chat.partner) : undefined;
    if (!agent.chat || !partner || partner.chat?.partner !== agent.id) {
      agent.chat = null;
      agent.spot = this.claim(agent.zone, agent.id);
      this.go(agent);
      return;
    }
    const until = this.time + agent.chat.lines.length * CHAT_LINE_SECONDS + 0.8;
    for (const [one, other] of [[agent, partner], [partner, agent]] as const) {
      one.view = "front";
      one.flip = one.x > other.x;
      one.chat = { ...one.chat!, pending: false, start: this.time, until };
    }
    this.setMode(agent, "stand");
  }

  /** 대화를 마치면 각자 잠시 쉬고, 자리 없이 다가갔던 쪽은 빈자리로 돌아간다. */
  private endChat(agent: Agent) {
    const partner = agent.chat ? this.byId.get(agent.chat.partner) : undefined;
    for (const one of [agent, partner]) {
      if (!one) continue;
      one.chat = null;
      one.rest = 3 + this.random() * 6;
      if (!one.spot && !one.leaving) { one.spot = this.claim(one.zone, one.id); this.go(one); }
    }
  }

  /** 대화를 끊는다(구역이 바뀌거나 잡혀 들리거나 떠날 때). 상대도 풀어 준다. */
  private dropChat(agent: Agent) {
    if (!agent.chat) return;
    const partner = this.byId.get(agent.chat.partner);
    agent.chat = null;
    agent.goal = null;
    if (partner?.chat?.partner === agent.id) {
      partner.chat = null;
      partner.rest = 2 + this.random() * 3;
      if (!partner.spot && !partner.leaving && partner.mode === "stand") { partner.spot = this.claim(partner.zone, partner.id); this.go(partner); }
    }
  }

  /** 지금 이 세션이 말하는 한마디. 대화 중 자기 차례일 때만 준다(먼저 다가간 쪽이 묻고 상대가 답한다). */
  chatLine(id: string) {
    const chat = this.byId.get(id)?.chat;
    if (!chat || chat.pending || this.time >= chat.until) return null;
    const turn = Math.floor((this.time - chat.start) / CHAT_LINE_SECONDS);
    if (turn >= chat.lines.length) return null;
    return (turn % 2 === 0) === chat.lead ? chat.lines[turn]! : null;
  }

  private walk(agent: Agent, dt: number) {
    let budget = WALK_SPEED * (agent.hurry ? HURRY : 1) * dt;
    while (budget > 0) {
      const next = agent.path[0];
      if (!next) { this.arrive(agent); return; }
      const [tx, ty] = next === GOAL && agent.goal ? agent.goal : this.graph.point(next);
      const dx = tx - agent.x, dy = ty - agent.y;
      const length = Math.hypot(dx, dy);
      if (length > 0.01) {
        if (Math.abs(dy) > 0.2) agent.view = dy > 0 ? "front" : "back";
        if (Math.abs(dx) > 0.2) agent.flip = dx < 0;
      }
      if (length <= budget) {
        agent.x = tx; agent.y = ty; if (next !== GOAL) agent.node = next; agent.path.shift();
        budget -= length;
        continue;
      }
      agent.x += (dx / length) * budget;
      agent.y += (dy / length) * budget;
      budget = 0;
    }
  }
}
