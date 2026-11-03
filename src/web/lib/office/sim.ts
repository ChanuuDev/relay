import { WEB_END_REASON, type SessionStatus } from "../../../session/session.types";
import { agentName, pickScript, resolveLines, ROLES, SCRIPTS, speaks, taskName, timeline, type ChatContext, type ChatKind, type Line } from "./chat";
import { cellAt, cellCenter, cellNode, HALL_CENTER, nearestOpenCell, seatNode, spawnNode, WalkGraph, wanderNode, WORK_ZONES, zoneAt, type OfficeLayout, type Point, type Seat, type Zone } from "./layout";
import { lookFor, type Look } from "./look";

/** 사무실이 쓰는 세션 정보. 목록 API의 세션에서 이것만 읽는다. */
export interface OfficeSession {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null;
  summary: string; status: SessionStatus | null; createdAt: string; updatedAt: string; endedAt: string | null; endReason: string | null;
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
  /** 완료해 로비에 머무는 세션이 스스로 퇴근할 시각(ms). 아니면 null. */
  homeAt: number | null;
  /** 노드가 아닌 곳에 서 있다(내려놓은 자리). 다음 걸음은 가장 가까운 노드부터 잡는다. */
  loose: boolean;
  /** 들린 높이 0–1. 잡으면 올라가고 내려놓으면 내려온다. */
  lift: number;
  /** 길 노드가 아닌 목적지(대화하러 상대 옆으로 갈 때). 경로의 GOAL 자리에 쓴다. */
  goal: readonly [number, number] | null;
  /** 홀·로비에서 나누는 대화. 참여한 세션들이 같은 대화를 나눠 가진다. pending이면 상대에게 다가가는 중이다. */
  chat: Talk | null;
  /** 이 시각(시뮬레이션 초)까지는 지나가며 인사하지 않는다. 막 이야기를 마쳤거나 방금 인사를 건넸다. */
  hush: number;
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

/** 홀·로비에서 나누는 대화 하나 */
export interface Talk {
  kind: ChatKind;
  /** 들어온 순서가 곧 역할: 0 먼저 다가간(지나가는) 쪽 a, 1 상대 b, 2 셋째 c */
  members: string[];
  lines: readonly Line[];
  /** 줄마다 시작 시각(대화 시작부터 초)과 띄우는 초 */
  at: readonly number[];
  seconds: readonly number[];
  /** 대화 전체 길이(초) */
  length: number;
  /** 걸어오는 사람이 모두 닿기를 기다리는 중 */
  pending: boolean;
  waiting: Set<string>;
  start: number;
  until: number;
}

export const zoneOf = (status: SessionStatus | null): Zone => status ?? "hall";
/** 가만히 있지 않고 가끔 돌아다니며 서로 대화하는 구역: 홀(대기)과 완료 로비 */
export const ROAMING: readonly Zone[] = ["hall", "done"];
const roams = (zone: Zone) => ROAMING.includes(zone);
/** 경로 끝의 임시 목적지 표시 */
const GOAL = "@goal";
/** 쉬던 세션이 동료에게 다가가 이야기할 확률(아니면 빈자리로 옮긴다) */
export const CHAT_CHANCE = 0.45;
/** 다가가 이야기할 때 근처에 쉬는 동료가 하나 더 있으면 셋이 모일 확률 */
export const GROUP_CHANCE = 0.35;
/** 걷다가 쉬는 동료 곁(이 거리 안)을 지나면 인사를 건넬 확률. 퇴근하는 세션은 로비의 동료가 더 자주 배웅한다. */
export const PASS_RADIUS = 60;
export const PASS_CHANCE = 0.5;
export const SENDOFF_CHANCE = 0.75;
/** 대화하는 사람 사이 거리(배경 픽셀) */
export const CHAT_GAP = 24;
/** 이야기를 마친 뒤 또는 인사를 건넬지 정한 뒤 다시 지나가며 인사하기까지 쉬는 초 */
const HUSH_SECONDS = 8;
/** 최근에 나온 대본은 이만큼 다시 고르지 않는다. */
const RECENT_SCRIPTS = 12;
/** 신나서 말할 때 콩콩 뛰는 시간과 높이 */
const HOP_SECONDS = 0.5;
const HOP_PX = 4;
/** 완료하고 세션도 끝난 뒤 로비에 머무는 시간. 그 뒤에는 스스로 퇴근해 보이지 않는다. 다른 방에서 로비로 옮겨 온 세션도 적어도 이만큼은 머문다. */
export const LINGER_MS = 60 * 1000;
/** 완료했지만 세션은 열려 있을 때, 마지막 기록부터 로비에서 쉬는 시간. 그동안 새 기록이 없으면 퇴근한다. */
export const IDLE_HOME_MS = 10 * 60 * 1000;
/**
 * 로비에서 스스로 퇴근할 시각. 완료가 아니면 null.
 * 세션이 끝났으면 종료 1분 뒤(웹 화면에서 끝냈으면 곧바로), 열려 있으면 마지막 기록 10분 뒤다.
 */
export function homeTime(session: Pick<OfficeSession, "status" | "updatedAt" | "endedAt" | "endReason">) {
  if (session.status !== "done") return null;
  if (!session.endedAt) return Date.parse(session.updatedAt) + IDLE_HOME_MS;
  return Date.parse(session.endedAt) + (session.endReason === WEB_END_REASON ? 0 : LINGER_MS);
}
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
  /** 세션마다 끌어 놓아 고른 좌석 노드. 그 좌석이 비어 있고 같은 구역이면 먼저 준다. */
  pins?: Map<string, string>;
  /** 끌어 놓아 좌석을 고르면 알린다(이 브라우저에 남긴다). */
  onPin?: (id: string, seat: string) => void;
  /** 스프라이트 몸체(머리 모양) 수 */
  bodies?: number;
  random?: () => number;
  /** 지금 시각(ms). 로비에 머무는 시간을 잰다. */
  clock?: () => number;
}

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class OfficeSim {
  readonly graph: WalkGraph;
  private readonly byId = new Map<string, Agent>();
  /** 자리 노드 → 차지한 에이전트 ID */
  private readonly taken = new Map<string, string>();
  private readonly capacity: Record<Zone, number>;
  private readonly seats = new Map<string, Seat>();
  /** 좌석 노드 → 구역 */
  private readonly seatZone = new Map<string, Zone>();
  /** 세션 → 끌어 놓아 고른 좌석 노드 */
  private readonly pins: Map<string, string>;
  private readonly random: () => number;
  private readonly clock: () => number;
  private synced = false;
  /** 시뮬레이션이 흐른 초. 대화 차례를 잰다. */
  private time = 0;
  /** 지금 오가는 대화들 */
  private readonly talks = new Set<Talk>();
  /** 두 세션이 이야기한 횟수(“또 만났네요”) */
  private readonly met = new Map<string, number>();
  /** 최근에 나온 대본 ID(새것부터) */
  private recent: string[] = [];
  /**
   * 메뉴에서 퇴근시킨 세션 → 그때의 마지막 기록 시각. 서버가 완료·종료를 받기 전에도 곧바로 나가며,
   * 세션이 새 기록을 남기거나 완료가 아니게 되기 전까지는 다시 들어오지 않는다. confirmed: 목록에서 완료로 한 번 보였다.
   */
  private readonly dismissed = new Map<string, { updatedAt: string; confirmed: boolean }>();
  /** 보는 동안 다른 방에서 로비로 옮겨 온 세션 → 들어온 시각(ms). 오래 쉬던 세션도 로비에 와서 잠시 머문 뒤 나간다. */
  private readonly entered = new Map<string, number>();
  /** 반려동물을 보고 하는 한마디: 세션 → 말과 끝 시각(시뮬레이션 초) */
  private readonly remarks = new Map<string, { text: string; until: number }>();
  private totals: Record<Tally, number> = { hall: 0, working: 0, blocked: 0, handoff: 0, done: 0, home: 0 };

  constructor(readonly layout: OfficeLayout, private readonly options: SimOptions) {
    this.graph = new WalkGraph(layout);
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? Date.now;
    for (const [zone, entry] of Object.entries(layout.zones)) for (const seat of entry.seats) { this.seats.set(seatNode(seat.id), seat); this.seatZone.set(seatNode(seat.id), zone as Zone); }
    this.pins = options.pins ?? new Map();
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
    const listed = new Set(sessions.map((session) => session.id));
    for (const id of [...this.dismissed.keys(), ...this.entered.keys()]) if (!listed.has(id)) { this.dismissed.delete(id); this.entered.delete(id); }
    for (const session of sessions) {
      const agent = this.byId.get(session.id);
      if (session.status !== "done") this.entered.delete(session.id);
      else if (this.synced && agent && !agent.leaving && agent.zone !== "done" && !this.entered.has(session.id)) this.entered.set(session.id, now);
      if (this.wentHome(session, now)) { totals.home += 1; home.set(session.id, session); continue; }
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
      agent.homeAt = this.homeAt(next.session);
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

  /** 로비에서 스스로 퇴근할 시각. 보는 동안 로비로 옮겨 온 세션은 들어온 뒤 적어도 1분은 머문다(웹에서 끝낸 세션은 곧바로 나간다). */
  private homeAt(session: OfficeSession) {
    const due = homeTime(session);
    const entered = this.entered.get(session.id);
    return due === null || entered === undefined || session.endReason === WEB_END_REASON ? due : Math.max(due, entered + LINGER_MS);
  }

  /** 이미 퇴근했는가: 메뉴에서 퇴근시켰거나 로비에 머무는 시간이 지났다. 퇴근시킨 세션이 새 기록을 남기거나 완료가 아니게 되면 다시 출근한다. */
  private wentHome(session: OfficeSession, now: number) {
    const dismissal = this.dismissed.get(session.id);
    if (dismissal) {
      // 서버가 아직 완료를 받기 전의 목록은 기다리고, 완료로 한 번 보인 뒤 다른 상태가 되면 사용자가 다시 일을 맡긴 것이다.
      if (dismissal.updatedAt !== session.updatedAt || (dismissal.confirmed && session.status !== "done")) this.dismissed.delete(session.id);
      else { if (session.status === "done") dismissal.confirmed = true; return true; }
    }
    const due = this.homeAt(session);
    return due !== null && now >= due;
  }

  /** 메뉴에서 퇴근시킨다. 로비에서 머물지 않고 지금 자리에서 곧바로 EXIT 문으로 서둘러 나간다. */
  sendHome(id: string) {
    const agent = this.byId.get(id);
    if (agent) this.dismissed.set(id, { updatedAt: agent.session.updatedAt, confirmed: false });
    if (agent && !agent.leaving) this.goHome(agent);
    if (agent?.leaving === "home") agent.hurry = true;
  }

  /** 퇴근을 서버에 보내지 못했다. 다음 동기화에서 원래 구역으로 돌아온다. */
  recall(id: string) { this.dismissed.delete(id); }

  private goHome(agent: Agent) {
    this.leave(agent, "home");
    this.totals.home += 1;
    this.totals[agent.zone] = Math.max(0, this.totals[agent.zone] - 1);
  }

  private add(session: OfficeSession, zone: Zone, placeAtSpot: boolean) {
    const spot = this.claim(zone, session.id);
    const agent: Agent = {
      id: session.id, session, look: lookFor(session.id, this.options.bodies), zone, spot, leaving: false, hurry: false,
      homeAt: this.homeAt(session), loose: false, lift: 0, goal: null, chat: null, hush: 0,
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

  /** 구역의 빈자리 중 문에서 가까운 것부터 준다. 홀은 비어 있는 배회 지점을 고루 쓴다. 끌어 놓아 고른 좌석이 비어 있으면 그 자리를 먼저 준다. */
  private claim(zone: Zone, id: string): string {
    const candidates = zone === "hall"
      ? this.shuffle(this.layout.hall.wander.map((_, index) => wanderNode(index)))
      : this.layout.zones[zone].seats.map((seat) => seatNode(seat.id));
    const pinned = this.pins.get(id);
    const free = (pinned && candidates.includes(pinned) && !this.taken.has(pinned) ? pinned : undefined)
      ?? candidates.find((node) => !this.taken.has(node)) ?? candidates[0]!;
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

  /** 내려놓은 자리처럼 노드가 아닌 곳에서는 가장 가까운 길 노드를 첫걸음으로 삼는다. 격자 사무실은 벽 너머가 아닌 그 칸(가장 가까운 걷는 칸)이다. */
  private nearestNode(x: number, y: number) {
    const grid = this.layout.grid;
    if (grid) {
      const cell = nearestOpenCell(grid, x, y);
      if (cell && this.graph.points.has(cellNode(cell[0], cell[1]))) return cellNode(cell[0], cell[1]);
    }
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
    const seat = this.seats.get(agent.spot);
    const stand = seat?.stand;
    if (stand) {
      agent.view = stand.view; agent.flip = Boolean(stand.flip);
      // 로비에 선 세션은 잠시 뒤 다른 자리로 옮기거나 누군가와 이야기한다. 인계 방은 그 자리에 머문다.
      agent.rest = roams(agent.zone) && !instant ? 4 + this.random() * 8 : roams(agent.zone) ? 2 + this.random() * 10 : Infinity;
      this.setMode(agent, "stand");
      return;
    }
    if (agent.spot?.startsWith("seat:")) {
      // 앉으면 등을 보이고 책상을 본다. 모니터가 왼쪽 위에 있는 자리는 좌우를 뒤집는다. 소파·안락의자는 앞을 보고 앉는다.
      if (seat?.lounge) { agent.view = "front"; agent.flip = Boolean(seat.lounge.flip); }
      else { agent.view = "back"; agent.flip = Boolean(seat?.flip); }
      // 로비 소파에 앉은 세션은 한참 쉬다가 다른 자리로 옮긴다.
      agent.rest = roams(agent.zone) ? (instant ? 3 : 8) + this.random() * 12 : Infinity;
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

  /** 내려놓는다. 바닥에 닿은 뒤 제자리(상태가 바뀌었으면 새 구역)로 서둘러 걸어간다.
   *  격자 사무실이면 놓은 칸(벽·가구면 가장 가까운 걷는 칸)에 내려앉는다. 놓은 칸이 좌석이거나 같은 구역의 빈 좌석 곁이면
   *  그 좌석으로 자리를 옮기고(차지한 사람이 있으면 서로 맞바꾼다), 홀·로비의 빈 바닥이면 그 자리에 머문다.
   *  다른 구역이면 그 구역으로 상태가 바뀐 뒤 그 좌석을 먼저 받는다. */
  drop(id: string) {
    const agent = this.byId.get(id);
    if (!agent || agent.mode !== "held") return;
    agent.hurry = true;
    this.setMode(agent, "land");
    const grid = this.layout.grid;
    const target = this.dropTarget(id, agent.x, agent.y);
    if (!grid || !target) return;
    [agent.x, agent.y] = cellCenter(grid, target.land[0], target.land[1]);
    agent.node = cellNode(target.land[0], target.land[1]);
    agent.loose = false;
    if (agent.leaving) return;
    if (target.seat) { this.pin(agent, target.seat); return; }
    // 홀·로비의 빈 바닥에 놓으면 그 칸에 머문다.
    if (target.stay) {
      this.release(agent);
      this.taken.set(target.stay, agent.id);
      agent.spot = target.stay;
    }
  }

  /**
   * 들고 있는 캐릭터를 (x, y) 바닥에 놓으면 어떻게 되는지. 끄는 동안 보여 주는 표시와 실제로 놓을 때 같은 답을 쓴다.
   * land: 내려앉을 걷는 칸, seat: 고를 좌석(좌석 칸 위이거나 같은 구역의 빈 좌석 곁), cell: 빛낼 칸(좌석이면 좌석 칸),
   * zone: 그 칸의 구역, swap: 그 좌석에 앉아 있어 자리를 맞바꿀 동료, stay: 홀·로비에서 머물 칸 노드.
   */
  dropTarget(id: string, x: number, y: number) {
    const grid = this.layout.grid;
    const agent = this.byId.get(id);
    if (!grid || !agent) return null;
    const land = nearestOpenCell(grid, x, y);
    if (!land) return null;
    const seat = this.seatNear([x, y]);
    const seatCell = seat ? this.seats.get(seat)?.cell : undefined;
    const cell = seatCell ?? land;
    const zone = grid.zones[cell[1] * grid.cols + cell[0]] ?? null;
    const holder = seat ? this.taken.get(seat) : undefined;
    const swap = holder && holder !== id && this.seatZone.get(seat!) === agent.zone ? holder : null;
    const node = cellNode(land[0], land[1]);
    const stay = !seat && zone === agent.zone && roams(agent.zone) && !this.taken.has(node)
      && !this.agents().some((other) => other !== agent && other.spot === node) ? node : null;
    return { land, cell, seat, zone, swap, stay };
  }

  /** 놓은 자리가 가리키는 좌석: 좌석 칸 위이거나, 그 구역의 빈 좌석이 한 칸 반 안에 있으면 가장 가까운 것 */
  private seatNear(at: Point): string | null {
    const grid = this.layout.grid!;
    const cell = cellAt(grid, at[0], at[1]);
    const zone = zoneAt(this.layout, at[0], at[1]);
    let best: string | null = null, score = Infinity;
    for (const [node, seat] of this.seats) {
      if (!seat.cell) continue;
      const [cx, cy] = seat.cell;
      const center = cellCenter(grid, cx, cy);
      if (cell && cell[0] === cx && cell[1] === cy) return node;
      const value = Math.hypot(center[0] - at[0], center[1] - at[1]);
      if (zone !== this.seatZone.get(node) || this.taken.has(node)) continue;
      if (value < score && value < grid.halfW * 1.7) { score = value; best = node; }
    }
    return best;
  }

  /** 끌어 놓아 좌석을 고른다. 같은 구역이면 바로 옮기고(앉은 사람이 있으면 맞바꾼다), 다른 구역이면 상태가 바뀐 뒤 받는다. */
  private pin(agent: Agent, seat: string) {
    this.pins.set(agent.id, seat);
    this.options.onPin?.(agent.id, seat);
    if (this.seatZone.get(seat) !== agent.zone || agent.spot === seat) return;
    const holder = this.taken.get(seat);
    const other = holder ? this.byId.get(holder) : undefined;
    const previous = agent.spot;
    this.release(agent);
    if (other && other !== agent) {
      // 맞바꾸기: 앉아 있던 사람은 옮긴 사람의 옛 자리로 간다.
      this.release(other);
      if (previous && this.seatZone.get(previous) === other.zone) { this.taken.set(previous, other.id); other.spot = previous; }
      else other.spot = this.claim(other.zone, other.id);
      this.pins.set(other.id, other.spot);
      this.options.onPin?.(other.id, other.spot);
      this.dropChat(other);
      this.retarget(other);
    }
    this.taken.set(seat, agent.id);
    agent.spot = seat;
  }

  step(seconds: number) {
    const dt = Math.min(Math.max(seconds, 0), 0.1);
    const now = this.clock();
    this.time += dt;
    for (const talk of [...this.talks]) if (!talk.pending && this.time >= talk.until) this.finish(talk);
    for (const agent of [...this.byId.values()]) {
      agent.t += dt;
      // 로비에서 머무는 시간이 다 되면 스스로 출구로 나간다.
      if (agent.homeAt !== null && now >= agent.homeAt && !agent.leaving && agent.mode !== "held" && agent.mode !== "land") this.goHome(agent);
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
          if (agent.chat) { if (!agent.chat.pending) this.face(agent, agent.chat); break; }
          agent.rest -= dt;
          if (agent.rest <= 0 && roams(agent.zone) && !agent.leaving && !this.options.reduced) this.idle(agent);
          break;
        case "walk":
          this.walk(agent, dt);
          if (agent.mode === "walk") this.passBy(agent);
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
          if (!roams(agent.zone) || agent.leaving || this.options.reduced) break;
          agent.rest -= dt;
          if (agent.rest <= 0) this.wander(agent);
          break;
      }
    }
  }

  /** 홀·로비에서 쉬던 세션이 할 일을 고른다: 가끔 가까운 동료에게 가서 이야기하고, 아니면 다른 빈자리로 옮긴다. */
  private idle(agent: Agent) {
    if (this.random() < CHAT_CHANCE && this.startChat(agent)) return;
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
    // 소파에 앉아 있었으면 먼저 일어선다. 다 일어서면 길을 잡는다.
    if (agent.mode === "seated") this.setMode(agent, "standup");
    else this.go(agent);
  }

  /**
   * 쉬고 있는 동료 하나를 골라 그 옆으로 걸어간다. 그 곁에 쉬는 동료가 하나 더 있으면 가끔 그도 불러 셋이 나란히 선다.
   * 다가간 쪽과 셋째는 상대의 양옆에 서고, 모두 닿으면 대화를 시작한다.
   */
  private startChat(agent: Agent) {
    const partners = this.agents().filter((other) => other !== agent && other.zone === agent.zone && other.mode === "stand"
      && !other.chat && !other.leaving && distance(other.x, other.y, agent.x, agent.y) < 320);
    if (!partners.length) return false;
    const partner = partners[Math.floor(this.random() * partners.length)]!;
    const thirds = partners.filter((other) => other !== partner && distance(other.x, other.y, partner.x, partner.y) < 260);
    const third = thirds.length && this.random() < GROUP_CHANCE ? thirds[Math.floor(this.random() * thirds.length)]! : null;
    const side = agent.x < partner.x ? -1 : 1;
    const spot = this.besides(partner, side, [agent]);
    if (!spot) return false;
    const other = third ? this.besides(partner, -side, [agent, third], spot) : null;
    if (!this.begin(third && other ? [agent, partner, third] : [agent, partner], third && other ? "group" : "pair")) return false;
    this.approach(agent, spot);
    if (third && other) this.approach(third, other);
    return true;
  }

  /** 상대 곁에 설 자리. 격자 사무실이면 상대 칸 둘레의 빈 걷는 칸 중 side쪽(화면 왼쪽 -1, 오른쪽 1)을 먼저 고른다. */
  private besides(partner: Agent, side: number, movers: readonly Agent[], taken?: Point): Point | null {
    const grid = this.layout.grid;
    if (!grid) return [partner.x + side * CHAT_GAP, partner.y + side * 2];
    const cell = cellAt(grid, partner.x, partner.y);
    if (!cell) return null;
    const busy = (point: Point) => (taken && Math.hypot(taken[0] - point[0], taken[1] - point[1]) < 4)
      || this.agents().some((other) => other !== partner && !movers.includes(other) && Math.hypot(other.x - point[0], other.y - point[1]) < 12);
    const options = [[1, 0], [0, -1], [-1, 0], [0, 1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => [cell[0] + dx!, cell[1] + dy!] as const)
      .filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows && grid.open[cy * grid.cols + cx]
        && zoneAt(this.layout, ...cellCenter(grid, cx, cy)) === partner.zone)
      .map(([cx, cy]) => cellCenter(grid, cx, cy))
      .filter((point) => !busy(point))
      .sort((a, b) => (Math.sign(b[0] - partner.x) === side ? 1 : 0) - (Math.sign(a[0] - partner.x) === side ? 1 : 0)
        || Math.abs(a[1] - partner.y) - Math.abs(b[1] - partner.y));
    return options[0] ?? null;
  }

  /** 대화할 자리(길 노드가 아닌 곳)로 걸어간다. 자리는 비워 두고, 대화가 끝나면 빈자리를 다시 찾는다. */
  private approach(agent: Agent, goal: Point) {
    agent.goal = goal;
    this.release(agent);
    const from = agent.loose ? this.nearestNode(agent.x, agent.y) : agent.node;
    const near = this.nearestNode(goal[0], goal[1]);
    const route = this.graph.route(from, near) ?? [];
    agent.path = [...(agent.loose && from !== near ? [from] : []), ...route, GOAL];
    agent.loose = false;
    this.setMode(agent, "walk");
  }

  /** 대본을 골라 대화를 연다. 다가가는 대화(pair·group)는 걸어오는 사람이 모두 닿을 때까지 기다린다. */
  private begin(members: Agent[], kind: ChatKind): Talk | null {
    const context = this.context(members);
    const script = pickScript(SCRIPTS[members[0]!.zone === "done" ? "done" : "hall"][kind], context, this.random, this.recent);
    if (!script) return null;
    this.recent = [script.id, ...this.recent.filter((id) => id !== script.id)].slice(0, RECENT_SCRIPTS);
    const lines = resolveLines(script, context);
    const walkers = kind === "pair" || kind === "group" ? members.filter((_, index) => index !== ROLES.b) : [];
    const talk: Talk = {
      kind, members: members.map((member) => member.id), lines, ...timeline(lines),
      pending: walkers.length > 0, waiting: new Set(walkers.map((member) => member.id)), start: 0, until: 0,
    };
    this.talks.add(talk);
    for (const member of members) member.chat = talk;
    if (!talk.pending) this.open(talk);
    return talk;
  }

  private context(members: readonly Agent[]): ChatContext {
    const date = new Date(this.clock());
    const [a, b] = members as [Agent, Agent];
    // 곧 퇴근: 세션이 끝나 1분 안에 나가거나 이미 나가는 중. 열린 채 로비에서 쉬는 세션은 아직 아니다.
    const ending = (agent: Agent) => (agent.homeAt !== null && Boolean(agent.session.endedAt)) || agent.leaving === "home";
    return {
      hour: date.getHours(), day: date.getDay(),
      met: (this.met.get(pairKey(a.id, b.id)) ?? 0) > 0,
      same: a.session.agent === b.session.agent,
      leaving: [ending(a), ending(b)],
      people: members.map((member) => ({ name: agentName(member.session.agent), task: taskName(member.session.sessionName) })),
    };
  }

  /** 모두 모였다. 시계를 맞추고 서로를 본다. */
  private open(talk: Talk) {
    talk.pending = false;
    talk.start = this.time;
    talk.until = this.time + talk.length;
    if (talk.kind === "pair" || talk.kind === "group") {
      for (const [index, one] of talk.members.entries()) {
        for (const other of talk.members.slice(index + 1)) this.met.set(pairKey(one, other), (this.met.get(pairKey(one, other)) ?? 0) + 1);
      }
    }
    for (const id of talk.members) {
      const member = this.byId.get(id);
      if (member?.mode === "stand") this.face(member, talk);
    }
  }

  /** 대화하러 간 자리에 닿았다. 상대가 기다리고 있으면 그쪽을 보고 서고, 모두 닿으면 이야기를 시작한다. 대화가 사라졌으면 빈자리를 찾아간다. */
  private meet(agent: Agent) {
    agent.goal = null;
    agent.loose = true;
    const talk = agent.chat;
    if (!talk?.pending || !talk.waiting.has(agent.id)) {
      agent.chat = null;
      agent.spot = this.claim(agent.zone, agent.id);
      this.go(agent);
      return;
    }
    talk.waiting.delete(agent.id);
    this.setMode(agent, "stand");
    const host = this.byId.get(talk.members[ROLES.b]!);
    if (host) {
      agent.view = "front"; agent.flip = host.x < agent.x;
      if (host.mode === "stand") { host.view = "front"; host.flip = agent.x < host.x; }
    }
    if (!talk.waiting.size) this.open(talk);
  }

  /** 대화 중에는 지금 말하는 사람을 본다. 자기 차례거나 다 함께 말할 때는 나머지 사람들 쪽을 본다. */
  private face(agent: Agent, talk: Talk) {
    const line = talk.lines[this.lineIndex(talk)];
    const speaker = line && line.by !== "all" ? this.byId.get(talk.members[ROLES[line.by]]!) : undefined;
    let x: number;
    if (speaker && speaker !== agent) x = speaker.x;
    else {
      const others = talk.members.filter((id) => id !== agent.id).map((id) => this.byId.get(id)).filter((other) => other !== undefined);
      if (!others.length) return;
      x = others.reduce((sum, other) => sum + other.x, 0) / others.length;
    }
    agent.view = "front";
    if (Math.abs(x - agent.x) > 3) agent.flip = x < agent.x;
  }

  /** 지금 띄울 줄. 말 사이 쉬는 틈이거나 대화 밖이면 -1. */
  private lineIndex(talk: Talk) {
    if (talk.pending) return -1;
    const elapsed = this.time - talk.start;
    for (let index = 0; index < talk.lines.length; index++) {
      if (elapsed >= talk.at[index]! && elapsed < talk.at[index]! + talk.seconds[index]!) return index;
    }
    return -1;
  }

  /** 대화를 마쳤다. 모두 잠시 쉬고, 자리 없이 다가갔던 쪽은 빈자리로 돌아간다. */
  private finish(talk: Talk) {
    this.talks.delete(talk);
    for (const id of talk.members) {
      const member = this.byId.get(id);
      if (member?.chat === talk) this.free(member, 3 + this.random() * 6);
    }
  }

  /** 대화를 끊는다(구역이 바뀌거나 잡혀 들리거나 떠날 때). 나머지 사람도 모두 풀어 준다. 끊은 쪽의 길은 부른 쪽이 다시 잡는다. */
  private dropChat(agent: Agent) {
    const talk = agent.chat;
    if (!talk) return;
    agent.chat = null;
    agent.goal = null;
    this.talks.delete(talk);
    for (const id of talk.members) {
      const member = this.byId.get(id);
      if (member && member !== agent && member.chat === talk) this.free(member, 2 + this.random() * 3);
    }
  }

  /** 대화에서 풀려났다. 자리 없이 다가가던(다가갔던) 쪽은 빈자리를 얻어 그리로 간다. 들려 있으면 내려놓은 뒤 간다. */
  private free(agent: Agent, rest: number) {
    agent.chat = null;
    agent.rest = rest;
    agent.hush = this.time + HUSH_SECONDS;
    if (agent.spot || agent.leaving) return;
    agent.spot = this.claim(agent.zone, agent.id);
    if (agent.mode === "stand") this.go(agent);
    else if (agent.mode === "walk") {
      this.retarget(agent);
      if (!agent.path.includes(GOAL)) agent.goal = null;
    }
  }

  /** 걷다가 쉬는 동료 곁을 지나면 가끔 걸음을 멈추지 않고 인사를 주고받는다. 로비에서 퇴근하는 세션은 남은 동료가 배웅한다. */
  private passBy(agent: Agent) {
    if (agent.chat || agent.hurry || this.time < agent.hush || this.options.reduced || !roams(agent.zone) || agent.path.includes(GOAL)) return;
    const sendoff = agent.leaving === "home";
    if (agent.leaving && !sendoff) return;
    const near = this.agents().find((other) => other !== agent && other.zone === agent.zone && other.mode === "stand" && !other.chat
      && !other.leaving && this.time >= other.hush && distance(other.x, other.y, agent.x, agent.y) < PASS_RADIUS);
    if (!near) return;
    agent.hush = this.time + HUSH_SECONDS;
    if (this.random() < (sendoff ? SENDOFF_CHANCE : PASS_CHANCE)) this.begin([agent, near], sendoff ? "sendoff" : "pass");
  }

  /**
   * 반려동물이 곁에 와서 반기면 그 동물을 보고 한마디 한다. 대화 중이거나 떠나는 중이면 하지 않는다.
   * x: 동물이 있는 곳. 서 있는 사람은 그쪽을 돌아보고, 말하는 동안은 자리를 뜨지 않는다.
   */
  remark(id: string, text: string, seconds = 2.6, x?: number) {
    const agent = this.byId.get(id);
    if (!agent || agent.leaving || agent.chat) return false;
    this.remarks.set(id, { text, until: this.time + seconds });
    if (agent.mode === "stand") {
      agent.rest = Math.max(agent.rest, seconds + 1);
      if (x !== undefined && Math.abs(x - agent.x) > 2) { agent.view = "front"; agent.flip = x < agent.x; }
    }
    return true;
  }

  /** 지금 이 세션이 말하는 한마디. 대화 중 자기 차례(또는 다 함께 말하는 줄)일 때, 대화 밖이면 반려동물에게 하는 말을 준다. */
  chatLine(id: string) {
    const talk = this.byId.get(id)?.chat;
    if (!talk) {
      const remark = this.remarks.get(id);
      if (remark && this.time >= remark.until) this.remarks.delete(id);
      return remark && this.time < remark.until ? remark.text : null;
    }
    if (talk.pending || this.time >= talk.until) return null;
    const line = talk.lines[this.lineIndex(talk)];
    return line && speaks(line, talk.members.indexOf(id)) ? line.text : null;
  }

  /** 신나서 말하는 줄의 처음에 제자리에서 두 번 콩콩 뛰는 높이(배경 픽셀). */
  chatHop(id: string) {
    const talk = this.byId.get(id)?.chat;
    if (!talk || talk.pending) return 0;
    const index = this.lineIndex(talk);
    const line = talk.lines[index];
    if (!line?.hop || !speaks(line, talk.members.indexOf(id))) return 0;
    const progress = (this.time - talk.start - talk.at[index]!) / HOP_SECONDS;
    return progress < 1 ? Math.abs(Math.sin(progress * Math.PI * 2)) * HOP_PX : 0;
  }

  /** 지금 오가는 대화(시험·점검용) */
  conversations(): readonly Talk[] { return [...this.talks]; }

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
