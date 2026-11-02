import { lookKey, recolor, REGIONS, type Look, type Region } from "./look";
import { HALL_CENTER } from "./layout";
import { HOME_SECONDS, type Agent, type OfficeSim, type Tally } from "./sim";

/** 잡아 올릴 때는 빠르게 솟았다 살짝 넘치고, 내려놓을 때는 툭 떨어진다. */
const liftCurve = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - (1 - t) ** 3);

export type AnimName = "front_idle" | "back_idle" | "front_walk" | "back_walk" | "sit" | "type" | "seat" | "grab";
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

export class OfficeRenderer {
  readonly scene: HTMLCanvasElement;
  /** 화면 비율이 그림과 다를 때 남는 가장자리를 채우는, 배경을 아주 작게 줄인 그림. 키우면 저절로 흐려진다. */
  readonly backdrop: HTMLCanvasElement;
  private readonly sceneContext: CanvasRenderingContext2D;
  private readonly variants = new Map<string, HTMLCanvasElement>();
  private readonly palette: Map<number, Region>;
  /** 화면에 그린 캐릭터 상자(배경 좌표). 뒤에 그린 것이 위에 있으므로 거꾸로 찾는다. */
  private boxes: { id: string; x: number; y: number; w: number; h: number; head: number }[] = [];

  constructor(private readonly background: HTMLImageElement, private readonly atlas: HTMLImageElement,
    private readonly sheet: SpriteSheet, private readonly sitSeconds: number,
    private readonly badges?: { image: HTMLImageElement; sheet: BadgeSheet }) {
    this.scene = document.createElement("canvas");
    this.scene.width = background.naturalWidth;
    this.scene.height = background.naturalHeight;
    this.sceneContext = this.scene.getContext("2d")!;
    this.backdrop = document.createElement("canvas");
    this.backdrop.width = 48;
    this.backdrop.height = Math.max(1, Math.round((48 * background.naturalHeight) / background.naturalWidth));
    const backdrop = this.backdrop.getContext("2d")!;
    backdrop.imageSmoothingQuality = "high";
    backdrop.drawImage(background, 0, 0, this.backdrop.width, this.backdrop.height);
    this.palette = new Map(sheet.palette.map(([color, region]) => [color, REGIONS[region]!]));
  }

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

  /** 배경 크기 그대로 장면을 그린다. 화면에 맞춘 확대·축소는 blit이 한 번에 한다. */
  /** talking: 머리 위에 말풍선이 떠 있는 캐릭터. 말풍선이 작업 중 표시를 대신하므로 배지를 그리지 않는다. */
  draw(sim: OfficeSim, time: number, hovered: string | null, selected: string | null, talking: ReadonlySet<string> = new Set()) {
    const context = this.sceneContext;
    const { scale } = this.sheet;
    context.imageSmoothingEnabled = false;
    context.globalAlpha = 1;
    context.drawImage(this.background, 0, 0);
    // 들린 캐릭터는 다른 모든 것보다 앞에 그린다.
    const raised = (agent: Agent) => (agent.mode === "held" || agent.mode === "land" ? 1 : 0);
    const agents = sim.agents().sort((a, b) => raised(a) - raised(b) || a.y - b.y || a.x - b.x);
    this.boxes = [];
    for (const agent of agents) {
      const { anim, index } = pose(agent, time, this.sheet, this.sitSeconds);
      const meta = (this.sheet.bodies[agent.look.body] ?? this.sheet.bodies[0]!)[anim];
      const [sx, sy, sw, sh] = meta.frames[index]!;
      const [ax, ay] = meta.anchors?.[index] ?? meta.anchor;
      const w = sw * scale, h = sh * scale;
      const left = agent.flip ? agent.x - (sw - ax) * scale : agent.x - ax * scale;
      const lifted = Math.round(liftCurve(agent.lift) * LIFT_PX);
      const top = agent.y - ay * scale - lifted;
      const head = agent.y - (ay - meta.top) * scale - lifted;
      context.globalAlpha = agent.alpha;
      const seated = agent.mode === "seated" || agent.mode === "sitdown" || agent.mode === "standup";
      if (lifted > 0) this.shadow(agent, 1 - agent.lift * 0.45);
      else if (agent.id === selected || agent.id === hovered) this.ring(agent, agent.id === selected);
      else if (!seated) this.shadow(agent);
      if (agent.mode === "appear") this.beam(agent, head, agent.t / 0.6);
      else if (agent.mode === "vanish" && agent.leaving === "home" && agent.node === HALL_CENTER) this.beam(agent, head, agent.t / HOME_SECONDS);
      context.save();
      if (agent.flip) { context.translate(left + w, top); context.scale(-1, 1); context.drawImage(this.variant(agent.look), sx, sy, sw, sh, 0, 0, w, h); }
      else context.drawImage(this.variant(agent.look), sx, sy, sw, sh, left, top, w, h);
      context.restore();
      this.boxes.push({ id: agent.id, x: left, y: top, w, h, head });
      const badge = talking.has(agent.id) ? null : badgeFor(agent);
      if (badge && this.badges) this.badge(badge, agent, head, time);
    }
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

/** 장면을 화면 캔버스에 옮긴다. 줄일 때는 부드럽게, 두 배 넘게 키울 때는 도트를 그대로 키운다. */
export function blit(context: CanvasRenderingContext2D, scene: HTMLCanvasElement, camera: Camera, view: View, backdrop?: HTMLCanvasElement) {
  const { width, height } = scene;
  const scale = fitScale(view, width, height) * camera.zoom;
  const device = scale * view.dpr;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#0b1020";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  if (backdrop && (width * device < canvasWidth - 1 || height * device < canvasHeight - 1)) {
    // 남는 가장자리는 배경을 흐리게 늘려 채우고 어둡게 눌러, 그림 테두리가 끊겨 보이지 않게 한다.
    const cover = Math.max(canvasWidth / backdrop.width, canvasHeight / backdrop.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(backdrop, (canvasWidth - backdrop.width * cover) / 2, (canvasHeight - backdrop.height * cover) / 2, backdrop.width * cover, backdrop.height * cover);
    context.fillStyle = "rgba(6, 10, 24, 0.55)";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  context.imageSmoothingEnabled = device < 1.75;
  context.imageSmoothingQuality = "high";
  const dx = (view.width / 2 - camera.cx * scale) * view.dpr;
  const dy = (view.height / 2 - camera.cy * scale) * view.dpr;
  context.drawImage(scene, 0, 0, width, height, dx, dy, width * device, height * device);
}
