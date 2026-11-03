import { lookKey, recolor, REGIONS, type Look, type Region } from "./look";
import { HALL_CENTER, type Point } from "./layout";
import { HOME_SECONDS, type Agent, type OfficeSim, type Tally } from "./sim";
import type { PlannedSeat } from "./iso";
import type { Drawable, Theme, World } from "./world";

/** 잡아 올릴 때는 빠르게 솟았다 살짝 넘치고, 내려놓을 때는 툭 떨어진다. */
const liftCurve = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - (1 - t) ** 3);

export type AnimName = "front_idle" | "back_idle" | "front_walk" | "back_walk" | "sit" | "type" | "seat" | "grab" | "lounge";
/** 등을 잡혀 들렸을 때 바닥에서 떠오르는 높이(배경 픽셀) */
export const LIFT_PX = 26;
export type Rect = readonly [number, number, number, number];
export interface Anim {
  frames: Rect[];
  fps: number;
  loop: boolean;
  /** 프레임 안에서 발(앉은 자세는 의자 방석) 기준점, 스프라이트 픽셀 */
  anchor: readonly [number, number];
  /** 프레임마다 기준점이 다를 때(서 있다가 의자에 앉는 동안 발에서 엉덩이로 옮겨 간다) */
  anchors?: readonly (readonly [number, number])[];
  /** 프레임 안에서 머리 꼭대기 줄, 스프라이트 픽셀 */
  top: number;
  /** 되풀이할 칸 순서. 없으면 0부터 차례로. 대기 동작은 눈 감은 칸을 가끔만 넣는다. */
  sequence?: readonly number[];
}
export interface SpriteSheet {
  /** 배경 픽셀 하나에 그릴 스프라이트 픽셀 배율 */
  scale: number;
  /** 몸체(머리 모양)마다 애니메이션 칸. 모두 한 아틀라스에 있다. */
  bodies: Record<AnimName, Anim>[];
  /** 바꿀 수 있는 색: [0xRRGGBB, 부위 번호(REGIONS 순서)] */
  palette: readonly (readonly [number, number])[];
  /** 부위마다 가운데 색(HSL) */
  bases: Record<Region, readonly [number, number, number]>;
}
export type BadgeName = "working" | "blocked" | "handoff" | "done" | "ended";
export interface BadgeSheet { scale: number; icons: Record<BadgeName, Rect> }

export interface Camera { zoom: number; cx: number; cy: number }
export interface View { width: number; height: number; dpr: number }

export const ZONE_COLORS: Record<Tally, string> = {
  working: "#3ee6f0", blocked: "#ffb43b", handoff: "#c77dff", done: "#5ee38a", hall: "#9fb3d9", home: "#7d86a8",
};

export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`그림을 불러오지 못했습니다: ${url}`));
    image.src = url;
  });
}

/** 지금 모드와 시각으로 그릴 애니메이션 칸을 고른다. */
export function pose(agent: Agent, time: number, sheet: SpriteSheet, sitSeconds: number): { anim: AnimName; index: number } {
  const anims = sheet.bodies[agent.look.body] ?? sheet.bodies[0]!;
  const loop = (name: AnimName, speed = 1) => {
    const anim = anims[name];
    const step = Math.floor((time + agent.phase) * anim.fps * speed);
    return { anim: name, index: anim.sequence ? anim.sequence[step % anim.sequence.length]! : step % anim.frames.length };
  };
  const sit = anims.sit.frames.length;
  const progress = Math.min(sit - 1, Math.floor((agent.t / sitSeconds) * sit));
  // 소파·안락의자에는 앞을 보고 앉는다. 앉고 일어서는 동안에도 같은 칸을 쓴다.
  const sitting = agent.mode === "seated" || agent.mode === "sitdown" || agent.mode === "standup";
  if (sitting && agent.view === "front" && anims.lounge) return loop("lounge");
  switch (agent.mode) {
    case "walk": return loop(agent.view === "front" ? "front_walk" : "back_walk", agent.hurry ? 1.8 : 1);
    case "sitdown": return { anim: "sit", index: progress };
    case "standup": return { anim: "sit", index: sit - 1 - progress };
    case "seated": return loop(agent.zone === "working" && !agent.session.endedAt ? "type" : "seat");
    case "held": case "land": return loop("grab");
    default: return loop(agent.view === "front" ? "front_idle" : "back_idle");
  }
}

/** 상태 표시: 진행 중 작업은 말줄임, 막힘은 느낌표, 인계는 화살표, 완료는 체크, 끝난 세션은 잠. */
export function badgeFor(agent: Agent): BadgeName | null {
  if (agent.zone === "hall" || agent.mode === "walk" || agent.leaving) return null;
  if (agent.session.endedAt && agent.zone !== "done") return "ended";
  return agent.zone;
}

/** 끌어 놓을 칸 표시. swap: 놓으면 자리를 맞바꿀 동료 */
export interface DropMark { cell: readonly [number, number]; color: string; swap?: string | null }

export class OfficeRenderer {
  readonly scene: HTMLCanvasElement;
  private readonly sceneContext: CanvasRenderingContext2D;
  /** 좌석 노드 → 좌석(앉은 사람의 앞뒤를 좌석 칸으로 잰다) */
  private readonly seats: Map<string, PlannedSeat>;
  /** 벽 뒤 실루엣을 물들이는 작은 그림판 */
  private readonly silhouette = document.createElement("canvas");
  private readonly variants = new Map<string, HTMLCanvasElement>();
  private readonly palette: Map<number, Region>;
  /** 화면에 그린 캐릭터 상자(배경 좌표). 뒤에 그린 것이 위에 있으므로 거꾸로 찾는다. */
  private boxes: { id: string; x: number; y: number; w: number; h: number; head: number }[] = [];

  /** world: 격자 사무실(바닥·벽·가구). 캐릭터는 그 사이에 바닥 넓이로 앞뒤를 가려 그린다. */
  constructor(readonly world: World, private readonly atlas: HTMLImageElement,
    private readonly sheet: SpriteSheet, private readonly sitSeconds: number,
    private readonly badges?: { image: HTMLImageElement; sheet: BadgeSheet }) {
    this.scene = document.createElement("canvas");
    this.scene.width = world.width;
    this.scene.height = world.height;
    this.sceneContext = this.scene.getContext("2d")!;
    this.palette = new Map(sheet.palette.map(([color, region]) => [color, REGIONS[region]!]));
    this.seats = new Map(world.plan.seats.map((seat) => [`seat:${seat.id}`, seat]));
  }

  get theme(): Theme { return this.world.theme; }

  get width() { return this.scene.width; }
  get height() { return this.scene.height; }

  /** 모습마다 색을 바꾼 스프라이트 그림을 한 번 만들어 둔다. */
  private variant(look: Look) {
    const key = lookKey(look);
    let canvas = this.variants.get(key);
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.width = this.atlas.naturalWidth;
    canvas.height = this.atlas.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(this.atlas, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    recolor(image.data, this.palette, this.sheet.bases as Record<Region, [number, number, number]>, look);
    context.putImageData(image, 0, 0);
    this.variants.set(key, canvas);
    return canvas;
  }

  /** 앞뒤를 가릴 바닥 자리(격자). 앉았거나 앉으러 가는 중이면 그 좌석 칸, 아니면 발밑을 격자로 되돌린다. */
  private groundOf(agent: Agent): Point {
    const seat = this.seats.get(agent.node) ?? (agent.path[0] ? this.seats.get(agent.path[0]) : undefined);
    if (seat && Math.hypot(agent.x - seat.point[0], agent.y - seat.point[1]) < 24) return [seat.x + 0.5, seat.y + 0.5];
    return this.world.toGrid(agent.x, agent.y);
  }

  /** 장면을 그린다: 바닥 → 끌어 놓을 칸 → 발밑 그림자 → 벽·가구·캐릭터(앞뒤 순) → 들린 캐릭터 → 머리 위 배지.
   *  talking: 머리 위에 말풍선이 떠 있는 캐릭터. 말풍선이 작업 중 표시를 대신하므로 배지를 그리지 않는다. */
  draw(sim: OfficeSim, time: number, hovered: string | null, selected: string | null, talking: ReadonlySet<string> = new Set(), target: DropMark | null = null) {
    const context = this.sceneContext;
    const { scale } = this.sheet;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.globalAlpha = 1;
    const raised = (agent: Agent) => agent.mode === "held" || agent.mode === "land";
    const agents = sim.agents();
    const near = (point: Point, radius: number) => agents.some((agent) => Math.hypot(agent.x - point[0], agent.y - point[1]) < radius);
    // 바닥과 벽·가구를 한 번에 깐다. 장면 바깥(하늘)은 비워 둔다.
    context.clearRect(0, 0, this.scene.width, this.scene.height);
    this.world.drawBase(context, near);
    if (target) this.world.drawTarget(context, target.cell, target.color, time);
    this.boxes = [];
    const frames = agents.map((agent) => {
      const { anim, index } = pose(agent, time, this.sheet, this.sitSeconds);
      const meta = (this.sheet.bodies[agent.look.body] ?? this.sheet.bodies[0]!)[anim];
      const [sx, sy, sw, sh] = meta.frames[index]!;
      const [ax, ay] = meta.anchors?.[index] ?? meta.anchor;
      const w = sw * scale, h = sh * scale;
      const left = agent.flip ? agent.x - (sw - ax) * scale : agent.x - ax * scale;
      const lifted = Math.round(liftCurve(agent.lift) * LIFT_PX);
      // 신나서 말할 때는 제자리에서 콩콩 뛴다. 그림자는 바닥에 남는다.
      const raise = lifted + Math.round(sim.chatHop(agent.id));
      const top = agent.y - ay * scale - raise;
      const head = agent.y - (ay - meta.top) * scale - raise;
      return { agent, sx, sy, sw, sh, w, h, left, top, head, lifted };
    });
    // 발밑 그림자·고리는 바닥에 먼저 깐다. 앞에 선 가구·벽이 자연스럽게 가린다.
    for (const { agent, lifted } of frames) {
      context.globalAlpha = agent.alpha;
      const seated = agent.mode === "seated" || agent.mode === "sitdown" || agent.mode === "standup";
      if (lifted > 0) this.shadow(agent, 1 - agent.lift * 0.45);
      else if (agent.id === selected || agent.id === hovered) this.ring(agent, agent.id === selected);
      else if (!seated) this.shadow(agent);
    }
    context.globalAlpha = 1;
    const paint = (frame: (typeof frames)[number]) => {
      const { agent, sx, sy, sw, sh, w, h, left, top, head } = frame;
      context.globalAlpha = agent.alpha;
      if (agent.mode === "appear") this.beam(agent, head, agent.t / 0.6);
      else if (agent.mode === "vanish" && agent.leaving === "home" && agent.node === HALL_CENTER) this.beam(agent, head, agent.t / HOME_SECONDS);
      if (agent.flip) {
        context.setTransform(-1, 0, 0, 1, left + w, top);
        context.drawImage(this.variant(agent.look), sx, sy, sw, sh, 0, 0, w, h);
        context.setTransform(1, 0, 0, 1, 0, 0);
      } else context.drawImage(this.variant(agent.look), sx, sy, sw, sh, left, top, w, h);
      context.globalAlpha = 1;
    };
    const standing: Drawable[] = [];
    const lifted: (typeof frames)[number][] = [];
    for (const frame of frames) {
      if (raised(frame.agent)) { lifted.push(frame); continue; }
      const [gx, gy] = this.groundOf(frame.agent);
      const r = 0.2;
      standing.push({ box: [gx - r, gx + r, gy - r, gy + r], rect: [frame.left, frame.head - 4, frame.left + frame.w, frame.top + frame.h], layer: 2,
        paint: () => paint(frame), ghost: () => this.ghost(frame, frame.agent.id === selected || frame.agent.id === hovered || frame.agent.id === target?.swap) });
    }
    this.world.drawFront(context, standing, time, target ? [this.world.cellMark(target.cell)] : []);
    for (const frame of lifted) paint(frame);
    // 상자(고르기용)와 배지는 그린 순서와 상관없이 맨 위에 둔다. 앞에 그린 것이 위이므로 들린 캐릭터를 맨 끝에 둔다.
    for (const frame of [...frames.filter((entry) => !raised(entry.agent)).sort((a, b) => a.agent.y - b.agent.y), ...lifted]) {
      const { agent, left, top, w, h, head } = frame;
      this.boxes.push({ id: agent.id, x: left, y: top, w, h, head });
      if (agent.id === target?.swap) { this.swapBadge(agent.x, head, target.color, time); continue; }
      const badge = talking.has(agent.id) ? null : badgeFor(agent);
      if (badge && this.badges) { context.globalAlpha = agent.alpha; this.badge(badge, agent, head, time); context.globalAlpha = 1; }
    }
    context.globalAlpha = 1;
  }

  /** 벽 뒤에 가린 캐릭터의 실루엣. 게임처럼 벽 너머에서도 누가 어디 있는지 보이고, 고른 캐릭터는 더 진하다. */
  private ghost(frame: { agent: Agent; sx: number; sy: number; sw: number; sh: number; w: number; h: number; left: number; top: number }, strong: boolean) {
    const { agent, sx, sy, sw, sh, w, h, left, top } = frame;
    const canvas = this.silhouette;
    if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, Math.ceil(w)); canvas.height = Math.max(canvas.height, Math.ceil(h)); }
    const scratch = canvas.getContext("2d")!;
    scratch.globalCompositeOperation = "source-over";
    scratch.clearRect(0, 0, canvas.width, canvas.height);
    scratch.imageSmoothingEnabled = false;
    if (agent.flip) { scratch.setTransform(-1, 0, 0, 1, w, 0); scratch.drawImage(this.variant(agent.look), sx, sy, sw, sh, 0, 0, w, h); scratch.setTransform(1, 0, 0, 1, 0, 0); }
    else scratch.drawImage(this.variant(agent.look), sx, sy, sw, sh, 0, 0, w, h);
    // 원래 색을 옅게 남기고 사옥 빛깔로 물들인다.
    scratch.globalCompositeOperation = "source-atop";
    scratch.fillStyle = this.world.theme.ghost;
    scratch.fillRect(0, 0, w, h);
    const context = this.sceneContext;
    context.globalAlpha = agent.alpha * (strong ? 0.7 : 0.42);
    context.drawImage(canvas, 0, 0, w, h, left, top, w, h);
    context.globalAlpha = 1;
  }

  /** 발밑 그림자. 들린 동안에는 작고 옅어져 높이를 알려 준다. */
  private shadow(agent: Agent, size = 1) {
    const context = this.sceneContext;
    context.fillStyle = `rgba(4, 8, 20, ${0.32 * size})`;
    context.beginPath();
    context.ellipse(agent.x, agent.y, 9 * size, 3.5 * size, 0, 0, Math.PI * 2);
    context.fill();
  }

  /** 놓으면 자리를 맞바꿀 동료 머리 위의 구역 색 맞바꾸기(⇄) 표시. 살짝 통통 뛰어 눈에 띈다. */
  private swapBadge(x: number, head: number, color: string, time: number) {
    const context = this.sceneContext;
    const r = 8;
    const cx = Math.round(x), cy = Math.round(head - r - 5 - Math.abs(Math.sin(time * 5)) * 2);
    context.save();
    context.shadowColor = color;
    context.shadowBlur = 8;
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    // 위 화살표는 오른쪽, 아래 화살표는 왼쪽
    context.moveTo(cx - 4, cy - 2.5); context.lineTo(cx + 4, cy - 2.5); context.lineTo(cx + 1.5, cy - 5);
    context.moveTo(cx + 4, cy + 2.5); context.lineTo(cx - 4, cy + 2.5); context.lineTo(cx - 1.5, cy + 5);
    context.stroke();
    context.restore();
  }

  /** 고른 캐릭터는 컨셉처럼 발밑에 빛나는 청록 고리, 올려 둔 캐릭터는 옅은 흰 고리. */
  private ring(agent: Agent, selected: boolean) {
    const context = this.sceneContext;
    context.save();
    context.lineWidth = selected ? 2.5 : 2;
    context.strokeStyle = selected ? "rgba(62, 230, 240, 0.95)" : "rgba(255, 255, 255, 0.7)";
    context.shadowColor = selected ? "rgba(62, 230, 240, 0.9)" : "rgba(255, 255, 255, 0.5)";
    context.shadowBlur = selected ? 8 : 5;
    context.fillStyle = selected ? "rgba(62, 230, 240, 0.16)" : "rgba(255, 255, 255, 0.1)";
    context.beginPath();
    context.ellipse(agent.x, agent.y - 1, 15, 6.5, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  /** 홀에 새 세션이 나타날 때, 퇴근하는 세션이 사라질 때 바닥에서 솟는 빛기둥. progress는 0→1. */
  private beam(agent: Agent, head: number, progress: number) {
    const context = this.sceneContext;
    const strength = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
    context.save();
    context.globalAlpha = strength * 0.85;
    const gradient = context.createLinearGradient(0, head - 18, 0, agent.y);
    gradient.addColorStop(0, "rgba(62, 230, 240, 0)");
    gradient.addColorStop(1, "rgba(62, 230, 240, 0.65)");
    context.fillStyle = gradient;
    context.fillRect(agent.x - 11, head - 18, 22, agent.y - head + 18);
    context.strokeStyle = "rgba(160, 250, 255, 0.95)";
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(agent.x, agent.y, 12 + strength * 6, 5 + strength * 2, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  private badge(name: BadgeName, agent: Agent, head: number, time: number) {
    const { image, sheet } = this.badges!;
    const [sx, sy, sw, sh] = sheet.icons[name];
    const w = sw * sheet.scale, h = sh * sheet.scale;
    const bob = name === "blocked" ? Math.round(Math.sin((time + agent.phase) * 5) * 1.5) : Math.round(Math.sin((time + agent.phase) * 2) * 1);
    this.sceneContext.drawImage(image, sx, sy, sw, sh, Math.round(agent.x - w / 2 + 4), Math.round(head - h - 3 + bob), w, h);
  }

  /** 배경 좌표에서 맨 위 캐릭터를 찾는다. 상자 가장자리 투명 여백은 조금 깎는다. */
  hit(x: number, y: number) {
    for (let index = this.boxes.length - 1; index >= 0; index--) {
      const box = this.boxes[index]!;
      const inset = box.w * 0.18;
      if (x >= box.x + inset && x <= box.x + box.w - inset && y >= box.head - 2 && y <= box.y + box.h) return box.id;
    }
    return null;
  }

  /** 캐릭터 머리 위와 발밑(배경 좌표). 말풍선을 머리 위에 달고, 위에 자리가 없으면 발밑에 단다. */
  headOf(id: string) {
    const box = this.boxes.find((entry) => entry.id === id);
    return box ? { x: box.x + box.w / 2, y: box.head, foot: box.y + box.h } : null;
  }
}

export const fitScale = (view: View, width: number, height: number) => Math.min(view.width / width, view.height / height);

/** 확대 배율과 화면 가운데(배경 좌표)를 화면 밖으로 넘지 않게 맞춘다. */
export function clampCamera(camera: Camera, view: View, width: number, height: number): Camera {
  const zoom = Math.min(4, Math.max(1, camera.zoom));
  const scale = fitScale(view, width, height) * zoom;
  const halfW = view.width / scale / 2, halfH = view.height / scale / 2;
  const cx = halfW * 2 >= width ? width / 2 : Math.min(width - halfW, Math.max(halfW, camera.cx));
  const cy = halfH * 2 >= height ? height / 2 : Math.min(height - halfH, Math.max(halfH, camera.cy));
  return { zoom, cx, cy };
}

/** 배경 좌표 ↔ 화면(CSS 픽셀) 좌표 */
export function toScreen(camera: Camera, view: View, width: number, height: number, x: number, y: number) {
  const scale = fitScale(view, width, height) * camera.zoom;
  return { x: (x - camera.cx) * scale + view.width / 2, y: (y - camera.cy) * scale + view.height / 2, scale };
}
export function toScene(camera: Camera, view: View, width: number, height: number, x: number, y: number) {
  const scale = fitScale(view, width, height) * camera.zoom;
  return { x: (x - view.width / 2) / scale + camera.cx, y: (y - view.height / 2) / scale + camera.cy };
}

/** 장면을 화면 캔버스에 옮긴다. 바깥은 사옥의 하늘색으로 채우고, 줄일 때는 부드럽게, 두 배 넘게 키울 때는 도트를 그대로 키운다. */
export function blit(context: CanvasRenderingContext2D, scene: HTMLCanvasElement, camera: Camera, view: View, theme?: Theme) {
  const { width, height } = scene;
  const scale = fitScale(view, width, height) * camera.zoom;
  const device = scale * view.dpr;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (theme) {
    const sky = context.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(1, theme.sky[1]);
    context.fillStyle = sky;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    const glow = context.createRadialGradient(canvasWidth / 2, canvasHeight * 0.45, 0, canvasWidth / 2, canvasHeight * 0.45, Math.max(canvasWidth, canvasHeight) * 0.6);
    glow.addColorStop(0, theme.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  } else {
    context.fillStyle = "#0b1020";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  context.imageSmoothingEnabled = device < 1.75;
  context.imageSmoothingQuality = "high";
  const dx = (view.width / 2 - camera.cx * scale) * view.dpr;
  const dy = (view.height / 2 - camera.cy * scale) * view.dpr;
  context.drawImage(scene, 0, 0, width, height, dx, dy, width * device, height * device);
}
