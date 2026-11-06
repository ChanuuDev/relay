/* ```stl 코드 블록(ASCII STL)을 캔버스에 3D로 그린다. 면을 깊이 순으로 칠하고(화가 알고리즘) 빛을 받은 정도로 명암을 넣는다.
   끌어서 돌리고, 휠로 확대한다. 외부 라이브러리 없이 그려 묶음이 커지지 않는다. */

type Vec = [number, number, number];
type Triangle = [Vec, Vec, Vec];

const MAX_TRIANGLES = 60_000;

/** ASCII STL의 facet·vertex를 읽는다. 바이너리 STL은 코드 블록에 담을 수 없으므로 받지 않는다. */
export function parseStl(code: string): Triangle[] {
  if (!/^\s*solid\b/i.test(code)) throw new Error("ASCII STL은 solid로 시작해야 합니다.");
  const triangles: Triangle[] = [];
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let corner: Vec[] = [];
  for (let match = vertex.exec(code); match; match = vertex.exec(code)) {
    const point = [Number(match[1]), Number(match[2]), Number(match[3])] as Vec;
    if (point.some((value) => !Number.isFinite(value))) throw new Error("vertex 좌표가 숫자가 아닙니다.");
    corner.push(point);
    if (corner.length === 3) { triangles.push(corner as Triangle); corner = []; if (triangles.length > MAX_TRIANGLES) throw new Error(`면이 너무 많습니다(최대 ${MAX_TRIANGLES.toLocaleString("ko-KR")}개).`); }
  }
  if (!triangles.length) throw new Error("면(facet)이 없습니다.");
  return triangles;
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec): Vec => { const length = Math.hypot(...v) || 1; return [v[0] / length, v[1] / length, v[2] / length]; };
const hex = (color: string) => { const value = Number.parseInt(color.replace("#", ""), 16); return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const; };

export type StlPalette = { body: string; edge: string; background: string };

/** STL을 그리는 캔버스. 크기는 화면 배율에 맞추고, 끌기·휠로 돌리고 확대한다. 정리할 때 destroy를 부른다. */
export function renderStl(code: string, palette: StlPalette) {
  const triangles = parseStl(code);
  // 가운데를 원점에 두고 가장 긴 변을 1로 맞춘다.
  let min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) for (const p of triangle) { min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])]; max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])]; }
  const center: Vec = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const model = triangles.map((triangle) => triangle.map((p) => [(p[0] - center[0]) / size, (p[1] - center[1]) / size, (p[2] - center[2]) / size] as Vec) as Triangle);
  // 어느 쪽으로 돌려도 캔버스에 들어가도록 가운데에서 가장 먼 꼭짓점까지를 반지름으로 삼는다.
  const radius = Math.max(...model.flatMap((triangle) => triangle.map((p) => Math.hypot(...p)))) || 1;
  const width = 720, height = 380;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  canvas.className = "md-stl";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `3D 모델 · 면 ${triangles.length.toLocaleString("ko-KR")}개 · 끌어서 돌리기`);
  const context = canvas.getContext("2d")!;
  const body = hex(palette.body);
  // STL은 보통 Z가 위다. 앞쪽 조금 위에서 비스듬히 내려다보는 각도로 시작한다.
  let yaw = -0.6, tilt = 0.45, zoom = 1;
  // 빛은 왼쪽 위 앞에서 온다(카메라 좌표: x 오른쪽, y 위, z 먼 쪽).
  const light = normalize([-0.45, 0.6, -0.65]);
  const draw = () => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const [cy, sy, ct, st] = [Math.cos(yaw), Math.sin(yaw), Math.cos(tilt), Math.sin(tilt)];
    // 모델 좌표(Z 위)를 카메라 좌표로: 가로는 그대로, 위쪽은 z와 깊이(y)를 기울인 만큼 섞는다.
    const toCamera = ([x, y, z]: Vec): Vec => { const x1 = x * cy - y * sy, y1 = x * sy + y * cy; return [x1, z * ct + y1 * st, y1 * ct - z * st]; };
    const scale = (Math.min(width, height) * 0.46 * zoom) / radius;
    const faces = model.map((triangle) => {
      const r = triangle.map(toCamera) as Triangle;
      const normal = normalize(cross(sub(r[1], r[0]), sub(r[2], r[0])));
      const depth = (r[0][2] + r[1][2] + r[2][2]) / 3;
      return { r, normal, depth };
    }).sort((a, b) => b.depth - a.depth);
    context.lineWidth = 0.5;
    for (const { r, normal } of faces) {
      // 법선 방향이 제각각인 파일도 있어 양면을 같은 세기로 칠한다.
      const shade = 0.3 + 0.7 * Math.abs(normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
      const color = `rgb(${Math.round(body[0] * shade)}, ${Math.round(body[1] * shade)}, ${Math.round(body[2] * shade)})`;
      context.beginPath();
      r.forEach(([x, y], at) => { const sx = width / 2 + x * scale, sy2 = height / 2 - y * scale; if (at) context.lineTo(sx, sy2); else context.moveTo(sx, sy2); });
      context.closePath();
      context.fillStyle = color;
      context.strokeStyle = triangles.length > 4000 ? color : palette.edge;
      context.fill();
      context.stroke();
    }
  };
  let drag: { x: number; y: number; yaw: number; tilt: number } | null = null;
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
  canvas.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, y: event.clientY, yaw, tilt }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    yaw = drag.yaw + (event.clientX - drag.x) * 0.01;
    tilt = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, drag.tilt + (event.clientY - drag.y) * 0.01));
    schedule();
  });
  const end = () => { drag = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); zoom = Math.max(0.3, Math.min(4, zoom * Math.exp(-event.deltaY * 0.0015))); schedule(); }, { passive: false });
  draw();
  return { canvas, caption: `STL · 면 ${triangles.length.toLocaleString("ko-KR")}개 · 끌어서 돌리고 휠로 확대합니다`, destroy: () => cancelAnimationFrame(frame) };
}
