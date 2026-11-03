// 격자 사무실을 그린다. 바닥(재질·그림자·글자)은 한 번 그려 두고, 벽 조각·장식·가구와 캐릭터는
// 매 프레임 바닥 넓이(격자 상자)로 앞뒤를 가려 뒤에서 앞으로 그린다.
import { cellCenter, gridToScene, sceneToGrid, type Point, type Zone } from "./layout";
import { HALF_H, HALF_W, SLAB_H, WALL_H, type KitSprite, type PlannedItem, type Sign, type WorldPlan } from "./iso";

/** 사옥마다 다른 색. 하늘(장면 바깥), 바닥 판 옆면, 칸 선, 벽 아래 그늘, 간판 */
export interface Theme {
  /** 장면 바깥을 채우는 위·아래 색 */
  sky: readonly [string, string];
  /** 하늘에 은은히 비치는 빛(가운데 원형 그러데이션) */
  glow: string;
  /** 바닥 판 옆면: 왼쪽 아래 면, 오른쪽 아래 면 */
  slab: readonly [string, string];
  /** 바닥 칸 선 */
  grid: string;
  /** 벽·가구 둘레 그늘 세기(0–1) */
  shade: number;
  /** 간판: 네온 글자(밤·노을) 또는 색 판(낮) */
  sign: "neon" | "plate";
  /** 바닥 글자 색 */
  logo: string;
  /** 벽 뒤에 가린 캐릭터 실루엣 색 */
  ghost: string;
}

/** 구역 색(간판·끌어 놓을 칸 표시) */
export const SIGN_COLORS: Record<Zone, string> = {
  working: "#2fd3df", blocked: "#f2a93b", handoff: "#b57cf0", done: "#4fcf7f", hall: "#9fb3d9",
};

/** 앞뒤를 가릴 것 하나. box는 바닥 넓이(격자: x0, x1, y0, y1), rect는 화면 상자(왼, 위, 오른, 아래). */
export interface Drawable {
  box: readonly [number, number, number, number];
  rect: readonly [number, number, number, number];
  /** 0 벽·장식, 1 가구, 2 캐릭터 */
  layer: 0 | 1 | 2;
  /** 가구: 앉은 사람보다 앞에 그린다(책상 의자) */
  cover?: boolean;
  /** 사람 키보다 높은 불투명 벽(뒤에 선 캐릭터를 실루엣으로 보인다) */
  solid?: boolean;
  paint: (context: CanvasRenderingContext2D, time: number) => void;
  /** 캐릭터: 단단한 벽에 가렸을 때 그 위에 그리는 실루엣 */
  ghost?: (context: CanvasRenderingContext2D) => void;
}

const EPS = 1e-3;
/** 벽·기둥·장식의 정렬용 두께(격자). 그림의 두께와 달리 아주 얇게 잡아 옆 칸의 가구·사람과 겹치지 않게 한다. */
const THIN = 0.01;
/** 벽 앞면이 벽 중심선에서 떨어진 거리(격자). 파이썬 빌드의 벽 두께 절반과 같다. */
export const FACE = 0.07;

const depth = (item: Drawable) => (item.box[0] + item.box[1] + item.box[2] + item.box[3]) / 2;
const overlaps = (a: Drawable["rect"], b: Drawable["rect"]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** a를 b보다 먼저(뒤에) 그려야 하면 true, 나중이면 false, 상관없으면 null. 바닥 넓이가 한 축으로 떨어져 있으면 그 축의 앞쪽이 앞이다. */
export function drawBefore(a: Drawable, b: Drawable): boolean | null {
  const ab = a.box[1] <= b.box[0] + EPS || a.box[3] <= b.box[2] + EPS;
  const ba = b.box[1] <= a.box[0] + EPS || b.box[3] <= a.box[2] + EPS;
  if (ab !== ba) return ab;
  if (ab) return null; // 대각선으로 떨어져 화면에서 겹치지 않는다.
  // 바닥이 겹친다: 앉은 자리의 의자·소파, 출입구를 지나는 사람
  if (a.layer === 2 && b.layer === 1) return Boolean(b.cover);
  if (b.layer === 2 && a.layer === 1) return !a.cover;
  const da = depth(a), db = depth(b);
  if (Math.abs(da - db) > EPS) return da < db;
  return a.layer < b.layer ? true : a.layer > b.layer ? false : null;
}

/** 깊이 순 최소 힙(위상 정렬에서 그릴 수 있는 것 중 가장 뒤의 것부터 꺼낸다) */
class DepthHeap {
  private readonly items: number[] = [];
  constructor(private readonly key: Float64Array) {}
  get size() { return this.items.length; }
  private less(a: number, b: number) { return this.key[a]! < this.key[b]! || (this.key[a] === this.key[b] && a < b); }
  push(value: number) {
    const items = this.items;
    items.push(value);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.less(value, items[parent]!)) break;
      items[at] = items[parent]!; at = parent;
    }
    items[at] = value;
  }
  pop() {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      let at = 0;
      for (;;) {
        const left = at * 2 + 1, right = left + 1;
        let next = -1;
        if (left < items.length && this.less(items[left]!, last)) next = left;
        if (right < items.length && this.less(items[right]!, next < 0 ? last : items[left]!)) next = right;
        if (next < 0) break;
        items[at] = items[next]!; at = next;
      }
      items[at] = last;
    }
    return top;
  }
}

/** 바닥 넓이로 앞뒤를 가려 뒤에서 앞으로 늘어놓는다(위상 정렬). 순환이 생기면 남은 것은 깊이 순으로 붙인다. */
export function sortDrawables(items: readonly Drawable[], base?: { outs: readonly (readonly number[])[]; count: number }): Drawable[] {
  const n = items.length;
  const outs: number[][] = items.map((_, index) => (base && index < base.count ? [...base.outs[index]!] : []));
  const indegree = new Int32Array(n);
  if (base) for (let a = 0; a < base.count; a++) for (const b of base.outs[a]!) indegree[b]! += 1;
  const start = base ? base.count : 0;
  for (let a = 0; a < n; a++) {
    for (let b = Math.max(a + 1, start); b < n; b++) {
      if (a < start && b < start) continue;
      if (!overlaps(items[a]!.rect, items[b]!.rect)) continue;
      const order = drawBefore(items[a]!, items[b]!);
      if (order === null) continue;
      if (order) { outs[a]!.push(b); indegree[b]! += 1; } else { outs[b]!.push(a); indegree[a]! += 1; }
    }
  }
  const key = new Float64Array(n);
  items.forEach((item, index) => { key[index] = depth(item) + item.layer * 1e-4; });
  const heap = new DepthHeap(key);
  for (let index = 0; index < n; index++) if (!indegree[index]) heap.push(index);
  const order: Drawable[] = [];
  const placed = new Uint8Array(n);
  while (heap.size) {
    const index = heap.pop();
    placed[index] = 1;
    order.push(items[index]!);
    for (const next of outs[index]!) if (--indegree[next]! === 0) heap.push(next);
  }
  if (order.length < n) {
    const rest = items.map((item, index) => ({ item, index })).filter(({ index }) => !placed[index]).sort((a, b) => key[a.index]! - key[b.index]!);
    for (const { item } of rest) order.push(item);
  }
  return order;
}

/**
 * 캐릭터마다 다시 그려야 할 정적인 것: 캐릭터와 화면에서 겹치고 그보다 앞인 것, 그리고 그것보다 앞에서 겹치는 것(이어서).
 * 정적인 층을 통째로 깔고 캐릭터를 그린 뒤 이것들만 다시 그리면, 전부를 매 프레임 앞뒤 순서로 그린 것과 같은 그림이 된다.
 */
export function frontStatics(statics: readonly Drawable[], outs: readonly (readonly number[])[], agents: readonly Drawable[]) {
  const picked = new Set<number>();
  const queue: number[] = [];
  for (const agent of agents) {
    statics.forEach((item, index) => {
      if (picked.has(index) || !overlaps(agent.rect, item.rect) || drawBefore(agent, item) !== true) return;
      picked.add(index);
      queue.push(index);
    });
  }
  while (queue.length) for (const next of outs[queue.pop()!]!) if (!picked.has(next)) { picked.add(next); queue.push(next); }
  return [...picked].sort((a, b) => a - b);
}

/** 캐릭터가 앞에 선 단단한 벽에 몸의 절반 넘게 가렸는지(화면 상자 기준) */
export function hidden(agent: Drawable, statics: readonly Drawable[]) {
  const [left, top, right, bottom] = agent.rect;
  const area = Math.max(1, (right - left) * (bottom - top));
  let covered = 0;
  for (const item of statics) {
    if (!item.solid || !overlaps(agent.rect, item.rect) || drawBefore(agent, item) !== true) continue;
    const w = Math.min(right, item.rect[2]) - Math.max(left, item.rect[0]);
    const h = Math.min(bottom, item.rect[3]) - Math.max(top, item.rect[1]);
    covered += Math.max(0, w) * Math.max(0, h);
  }
  return covered / area > 0.5;
}

/** 정적인 것끼리의 앞뒤(한 번만 잰다) */
function staticOrder(items: readonly Drawable[]) {
  const outs: number[][] = items.map(() => []);
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    if (!overlaps(items[a]!.rect, items[b]!.rect)) continue;
    const order = drawBefore(items[a]!, items[b]!);
    if (order === true) outs[a]!.push(b); else if (order === false) outs[b]!.push(a);
  }
  return { outs, count: items.length };
}

export class World {
  readonly width: number;
  readonly height: number;
  /** 바닥 층(재질·칸 선·그늘·바닥 글자) */
  readonly floor: HTMLCanvasElement;
  private readonly statics: Drawable[];
  private readonly base: ReturnType<typeof staticOrder>;
  /** 바닥 위에 벽·장식·가구를 앞뒤 순서로 한 번 그려 둔 층. 출구 유리문이 열리고 닫힐 때만 다시 그린다. */
  private readonly layer: HTMLCanvasElement;
  private layerOpen: boolean | null = null;
  /** 출구 유리문이 열려 있는지(누가 가까이 오면 열린다) */
  private exitOpen = false;

  constructor(readonly plan: WorldPlan, private readonly atlas: HTMLImageElement, floors: HTMLImageElement, readonly theme: Theme) {
    this.width = plan.width;
    this.height = plan.height;
    this.floor = this.paintFloor(floors);
    this.statics = this.buildStatics();
    this.base = staticOrder(this.statics);
    this.layer = document.createElement("canvas");
    this.layer.width = this.width;
    this.layer.height = this.height;
  }

  /** 정적인 층(바닥 + 벽·장식·가구)을 (다시) 그린다. */
  private paintLayer() {
    const context = this.layer.getContext("2d")!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.floor, 0, 0);
    for (const item of sortDrawables(this.statics, this.base)) item.paint(context, 0);
    this.layerOpen = this.exitOpen;
  }

  /** 격자 좌표 → 장면 픽셀 */
  point(gx: number, gy: number) { return gridToScene(this.plan.grid, gx, gy); }

  /** 스프라이트 하나를 기준점에 맞춰 그린다. flip이면 기준점을 지나는 세로선으로 뒤집는다. */
  private blitSprite(context: CanvasRenderingContext2D, sprite: KitSprite, x: number, y: number, flip = false) {
    const [sx, sy, sw, sh] = sprite.r;
    const [ax, ay] = sprite.a;
    if (!flip) { context.drawImage(this.atlas, sx, sy, sw, sh, Math.round(x - ax), Math.round(y - ay), sw, sh); return; }
    // save/restore는 프레임마다 쌓이면 비싸다. 뒤집기 변환만 걸었다가 되돌린다.
    context.setTransform(-1, 0, 0, 1, Math.round(x + ax), Math.round(y - ay));
    context.drawImage(this.atlas, sx, sy, sw, sh, 0, 0, sw, sh);
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  private spriteRect(sprite: KitSprite, x: number, y: number, flip = false): Drawable["rect"] {
    const [, , sw, sh] = sprite.r;
    const [ax, ay] = sprite.a;
    const left = flip ? x + ax - sw : x - ax;
    return [left, y - ay, left + sw, y - ay + sh];
  }

  private buildStatics(): Drawable[] {
    const { plan } = this;
    const { kit } = plan;
    const list: Drawable[] = [];
    for (const wall of plan.walls) {
      const sprite = kit.walls[wall.kind]![wall.side];
      const [x, y] = this.point(wall.x, wall.y);
      const box: Drawable["box"] = wall.side === "n" ? [wall.x, wall.x + 1, wall.y - THIN, wall.y + THIN] : [wall.x - THIN, wall.x + THIN, wall.y, wall.y + 1];
      list.push({ box, layer: 0, solid: wall.kind === "wall" || wall.kind === "header", rect: this.spriteRect(sprite, x, y), paint: (context) => this.blitSprite(context, sprite, x, y) });
    }
    for (const post of plan.posts) {
      const sprite = kit.posts[post.kind];
      if (!sprite) continue;
      const [x, y] = this.point(post.x, post.y);
      list.push({ box: [post.x - THIN, post.x + THIN, post.y - THIN, post.y + THIN], layer: 0, solid: post.kind === "wall", rect: this.spriteRect(sprite, x, y), paint: (context) => this.blitSprite(context, sprite, x, y) });
    }
    for (const decor of plan.map.decor ?? []) {
      const entry = kit.decor[decor.sprite];
      if (!entry) throw new Error(`그림 묶음에 벽 장식이 없습니다: ${decor.sprite}`);
      const sprite = entry[decor.side];
      const [x, y] = this.point(decor.x, decor.y);
      const box: Drawable["box"] = decor.side === "n" ? [decor.x, decor.x + entry.span, decor.y + 1.5 * THIN, decor.y + 2 * THIN] : [decor.x + 1.5 * THIN, decor.x + 2 * THIN, decor.y, decor.y + entry.span];
      // 출구 유리문은 누가 가까이 오면 열린 그림으로 바꾼다.
      const open = decor.sprite === "exit" ? kit.decor.exitOpen?.[decor.side] : undefined;
      list.push({ box, layer: 0, rect: this.spriteRect(sprite, x, y), paint: (context) => this.blitSprite(context, open && this.exitOpen ? open : sprite, x, y) });
    }
    for (const sign of plan.map.signs ?? []) list.push(this.signDrawable(sign));
    for (const item of plan.items) list.push(this.itemDrawable(item));
    return list;
  }

  private itemDrawable(item: PlannedItem): Drawable {
    const [x, y] = this.point(item.x, item.y);
    const inset = 0.04;
    return {
      box: [item.x + inset, item.x + item.w - inset, item.y + inset, item.y + item.h - inset],
      layer: item.item.floor ? 0 : 1, cover: item.item.cover,
      rect: this.spriteRect(item.item, x, y, item.flip),
      paint: (context) => this.blitSprite(context, item.item, x, y, item.flip),
    };
  }

  /** 구역 간판: 벽 앞면에 글자를 눕혀 붙인다. 밤·노을 사옥은 네온, 낮 사옥은 색 판이다. */
  private signDrawable(sign: Sign): Drawable {
    const color = SIGN_COLORS[sign.zone];
    const span = sign.span * HALF_W; // 벽을 따라 잰 화면 가로 길이
    const canvas = document.createElement("canvas");
    const pad = 14;
    const lift = sign.lift ?? 56; // 바닥에서 간판 아래까지
    const plateH = sign.small ? 18 : 26;
    canvas.width = Math.ceil(span + pad * 2);
    canvas.height = Math.ceil(span / 2 + plateH + pad * 2);
    const context = canvas.getContext("2d")!;
    // n 벽은 오른쪽 아래로, w 벽은 오른쪽 위로 기운다. 글자는 늘 왼쪽에서 오른쪽으로 읽힌다.
    const slope = sign.side === "n" ? 0.5 : -0.5;
    const originY = pad + plateH + (slope < 0 ? span / 2 : 0);
    context.setTransform(1, slope, 0, 1, pad, originY);
    const inset = 6, w = span - inset * 2;
    context.font = `700 ${sign.small ? 10 : 12}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
    const title = sign.title.toUpperCase();
    const text = sign.sub ? `${title}  ${sign.sub}` : title;
    if (this.theme.sign === "plate") {
      context.shadowColor = `${color}88`;
      context.shadowBlur = 10;
      context.fillStyle = color;
      roundRect(context, inset, -plateH, w, plateH - 4, 5);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "rgba(255, 255, 255, 0.22)";
      roundRect(context, inset, -plateH, w, (plateH - 4) / 2, 5);
      context.fill();
      context.fillStyle = "#ffffff";
    } else {
      context.fillStyle = "rgba(8, 10, 22, 0.78)";
      roundRect(context, inset, -plateH, w, plateH - 4, 5);
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.shadowColor = color;
      context.shadowBlur = 8;
      roundRect(context, inset + 1, -plateH + 1, w - 2, plateH - 6, 4);
      context.stroke();
      context.fillStyle = color;
    }
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, inset + w / 2, -plateH + (plateH - 4) / 2 + 0.5, w - 10);
    if (this.theme.sign === "neon") { context.shadowBlur = 0; context.fillStyle = "rgba(255,255,255,0.85)"; context.fillText(text, inset + w / 2, -plateH + (plateH - 4) / 2 + 0.5, w - 10); }

    // 벽 앞면의 간판 왼쪽 아래 자리
    const startX = sign.side === "n" ? sign.x : sign.x + FACE;
    const startY = sign.side === "n" ? sign.y + FACE : sign.y + sign.span;
    const [fx, fy] = this.point(startX, startY);
    const left = Math.round(fx - pad), top = Math.round(fy - lift - originY);
    const box: Drawable["box"] = sign.side === "n" ? [sign.x, sign.x + sign.span, sign.y + 2.5 * THIN, sign.y + 3 * THIN] : [sign.x + 2.5 * THIN, sign.x + 3 * THIN, sign.y, sign.y + sign.span];
    return { box, layer: 0, rect: [left, top, left + canvas.width, top + canvas.height], paint: (target) => target.drawImage(canvas, left, top) };
  }

  /** 바닥 층을 한 번 그린다: 바닥 판 옆면 → 재질 → 칸 선 → 벽·가구 그늘 → 바닥 글자 */
  private paintFloor(floors: HTMLImageElement) {
    const { plan, theme } = this;
    const { grid, kit } = plan;
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext("2d")!;
    const [ox, oy] = grid.origin;
    const iso = () => context.setTransform(HALF_W, HALF_H, -HALF_W, HALF_H, ox, oy);
    const cellOf = (x: number, y: number) => (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows ? plan.floors[y * grid.cols + x] : null);

    // 바닥 판 옆면: 아래쪽(+y)과 오른쪽(+x)이 바깥인 칸의 모서리를 판 두께만큼 내려 그린다.
    context.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) {
      if (!cellOf(x, y)) continue;
      if (!cellOf(x, y + 1)) this.slabFace(context, this.point(x, y + 1), this.point(x + 1, y + 1), theme.slab[0]);
      if (!cellOf(x + 1, y)) this.slabFace(context, this.point(x + 1, y + 1), this.point(x + 1, y), theme.slab[1]);
    }

    // 재질마다 칸을 한 경로로 모아 이음매 없이 채운다.
    const materials = new Map<string, Path2D>();
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) {
      const material = cellOf(x, y);
      if (!material) continue;
      if (!materials.has(material)) materials.set(material, new Path2D());
      materials.get(material)!.rect(x, y, 1, 1);
    }
    iso();
    for (const [material, path] of materials) {
      const tile = kit.floorTiles[material];
      if (!tile) throw new Error(`그림 묶음에 바닥 재질이 없습니다: ${material}`);
      const swatch = document.createElement("canvas");
      swatch.width = tile[2]; swatch.height = tile[2];
      swatch.getContext("2d")!.drawImage(floors, tile[0], tile[1], tile[2], tile[2], 0, 0, tile[2], tile[2]);
      const pattern = context.createPattern(swatch, "repeat")!;
      pattern.setTransform(new DOMMatrix().scaleSelf(tile[3] / tile[2], tile[3] / tile[2]));
      context.fillStyle = pattern;
      // 이웃 칸과 틈이 보이지 않게 아주 조금 넓혀 칠한다.
      context.lineWidth = 0.02;
      context.strokeStyle = pattern;
      context.fill(path);
      context.stroke(path);
    }

    // 칸 선: 아주 옅게. 쿼터뷰 게임판처럼 칸이 읽힌다.
    context.strokeStyle = theme.grid;
    context.lineWidth = 1 / HALF_H;
    context.beginPath();
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) {
      if (!cellOf(x, y)) continue;
      if (cellOf(x + 1, y)) { context.moveTo(x + 1, y); context.lineTo(x + 1, y + 1); }
      if (cellOf(x, y + 1)) { context.moveTo(x, y + 1); context.lineTo(x + 1, y + 1); }
    }
    context.stroke();
    // 재질이 바뀌는 경계는 조금 더 진하게
    context.strokeStyle = `rgba(0, 0, 0, ${0.1 * theme.shade + 0.04})`;
    context.lineWidth = 1.4 / HALF_H;
    context.beginPath();
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) {
      const here = cellOf(x, y);
      if (!here) continue;
      const right = cellOf(x + 1, y), down = cellOf(x, y + 1);
      if (right && right !== here) { context.moveTo(x + 1, y); context.lineTo(x + 1, y + 1); }
      if (down && down !== here) { context.moveTo(x, y + 1); context.lineTo(x + 1, y + 1); }
    }
    context.stroke();

    // 벽 아래 그늘: 벽 양쪽 바닥으로 번지는 그러데이션. 바닥이 있는 칸 밖으로는 새지 않게 자른다.
    const clip = this.floorClip();
    for (const wall of plan.walls) {
      const strength = (wall.kind === "low" ? 0.6 : wall.kind.startsWith("glass") ? 0.45 : 1) * theme.shade;
      for (const sideSign of [1, -1]) {
        const reach = sideSign > 0 ? 0.55 : 0.3;
        const gradient = wall.side === "n"
          ? context.createLinearGradient(0, wall.y, 0, wall.y + reach * sideSign)
          : context.createLinearGradient(wall.x, 0, wall.x + reach * sideSign, 0);
        gradient.addColorStop(0, `rgba(0, 0, 0, ${0.22 * strength})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        if (wall.side === "n") context.rect(wall.x, Math.min(wall.y, wall.y + reach * sideSign), 1, reach);
        else context.rect(Math.min(wall.x, wall.x + reach * sideSign), wall.y, reach, 1);
        context.save();
        context.clip(clip);
        context.fill();
        context.restore();
      }
    }

    // 가구 그늘: 바닥 넓이를 흐리게 어둡힌다.
    context.save();
    context.filter = "blur(3px)";
    for (const item of plan.items) {
      if (item.item.floor) continue;
      context.fillStyle = `rgba(0, 0, 0, ${0.16 * theme.shade})`;
      context.fillRect(item.x + 0.08, item.y + 0.08, item.w - 0.16, item.h - 0.16);
    }
    context.restore();

    // 홀 바닥 글자
    const logo = plan.map.logo;
    if (logo) {
      iso();
      context.save();
      // 글자는 격자 x축(화면 오른쪽 아래)을 따라 바닥에 눕힌다. 홀의 띠를 따라 읽힌다.
      context.translate(logo.x, logo.y);
      context.scale(1 / 24, 1 / 24);
      context.font = `800 40px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
      context.letterSpacing = "6px";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = theme.logo;
      context.fillText(logo.text, 0, 0);
      context.restore();
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  /** 바닥이 있는 칸만 덮는 경로(격자 좌표). 벽 그늘이 바깥으로 새지 않게 자른다. */
  private floorClip() {
    const { grid } = this.plan;
    const path = new Path2D();
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) if (this.plan.floors[y * grid.cols + x]) path.rect(x, y, 1, 1);
    return path;
  }

  private slabFace(context: CanvasRenderingContext2D, a: Point, b: Point, color: string) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.lineTo(b[0], b[1] + SLAB_H);
    context.lineTo(a[0], a[1] + SLAB_H);
    context.closePath();
    context.fill();
    // 이웃 면과 틈이 생기지 않게 같은 색으로 테두리를 덧칠한다.
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.stroke();
  }

  /** 끌어 놓을 칸 표시: 칸 테두리를 구역 색으로 빛낸다. */
  drawTarget(context: CanvasRenderingContext2D, cell: readonly [number, number], color: string, time: number) {
    const [x, y] = cell;
    const pulse = 0.6 + 0.4 * Math.sin(time * 6);
    const corners = [this.point(x, y), this.point(x + 1, y), this.point(x + 1, y + 1), this.point(x, y + 1)];
    context.save();
    context.beginPath();
    corners.forEach(([px, py], index) => (index ? context.lineTo(px, py) : context.moveTo(px, py)));
    context.closePath();
    context.globalAlpha = 0.34 + 0.16 * pulse;
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 14 * pulse;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.shadowBlur = 10;
    context.stroke();
    context.restore();
  }

  /** 정적인 층(바닥과 벽·장식·가구)을 깐다. 프레임마다 장면 크기 그림을 한 번만 옮긴다. near: 출구 유리문 근처에 누가 있는지 */
  drawBase(context: CanvasRenderingContext2D, near: (point: Point, radius: number) => boolean) {
    const exit = this.plan.layout.exit ? this.plan.layout.nodes[this.plan.layout.exit] : null;
    this.exitOpen = Boolean(exit && near(exit, HALF_W * 2.4));
    if (this.layerOpen !== this.exitOpen) this.paintLayer();
    context.drawImage(this.layer, 0, 0);
  }

  /** 캐릭터와, 그보다 앞에 와야 할 정적인 것만 앞뒤 순서로 다시 그린다. marks: 바닥에 이미 그린 표시(놓을 칸)처럼
   *  앞의 가구가 덮어야 하는 것. 그리지는 않고 앞의 가구를 다시 그리게만 한다. */
  drawFront(context: CanvasRenderingContext2D, agents: readonly Drawable[], time: number, marks: readonly Drawable[] = []) {
    if (!agents.length && !marks.length) return;
    const front = frontStatics(this.statics, this.base.outs, [...agents, ...marks]).map((index) => this.statics[index]!);
    for (const item of sortDrawables([...front, ...agents])) item.paint(context, time);
    // 단단한 벽 뒤에 가린 캐릭터는 실루엣을 덧그린다.
    for (const agent of agents) {
      if (agent.ghost && hidden(agent, front)) agent.ghost(context);
    }
  }

  /** 칸 하나를 바닥 표시로 본 앞뒤 가리기용 상자(그리지 않는다) */
  cellMark(cell: readonly [number, number]): Drawable {
    const [x, y] = cell;
    const corners = [this.point(x, y), this.point(x + 1, y), this.point(x + 1, y + 1), this.point(x, y + 1)];
    return {
      box: [x + 0.05, x + 0.95, y + 0.05, y + 0.95], layer: 2, paint: () => {},
      rect: [corners[3]![0] - 8, corners[0]![1] - 8, corners[1]![0] + 8, corners[2]![1] + 8],
    };
  }

  /** 장면 픽셀 → 격자 좌표 */
  toGrid(x: number, y: number) { return sceneToGrid(this.plan.grid, x, y); }
  /** 칸 가운데 장면 픽셀 */
  center(x: number, y: number) { return cellCenter(this.plan.grid, x, y); }
  /** 벽 높이 */
  static readonly wallHeight = WALL_H;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

