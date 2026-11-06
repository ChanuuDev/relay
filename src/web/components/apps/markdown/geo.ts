/* ```geojson·```topojson 코드 블록을 SVG 지도로 그린다. GitHub처럼 바깥 지도 타일을 받지 않고(CSP·개인 정보),
   도형을 웹 메르카토르로 펴서 경위선 위에 그린다. 색은 SVG 표현 속성(fill·stroke)으로 줘 인라인 style을 쓰지 않는다. */

type Position = [number, number];
type Geometry =
  | { type: "Point"; coordinates: Position } | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] } | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };
type Shape = { kind: "point" | "line" | "area"; rings: Position[][]; label: string | null };

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 720;
const HEIGHT = 380;
const PAD = 28;
const MAX_LAT = 85.05112878;

const mercator = ([lon, lat]: Position): Position => {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [lon, (Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) * 180) / Math.PI];
};
const isPosition = (value: unknown): value is Position => Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

function shapesOf(geometry: Geometry | null | undefined, label: string | null, out: Shape[]) {
  if (!geometry || typeof geometry !== "object") return;
  const c = (geometry as { coordinates?: unknown }).coordinates;
  switch (geometry.type) {
    case "Point": if (isPosition(c)) out.push({ kind: "point", rings: [[c]], label }); break;
    case "MultiPoint": if (Array.isArray(c)) for (const point of c) if (isPosition(point)) out.push({ kind: "point", rings: [[point]], label }); break;
    case "LineString": if (Array.isArray(c)) out.push({ kind: "line", rings: [c.filter(isPosition)], label }); break;
    case "MultiLineString": if (Array.isArray(c)) out.push({ kind: "line", rings: c.map((line) => (Array.isArray(line) ? line.filter(isPosition) : [])), label }); break;
    case "Polygon": if (Array.isArray(c)) out.push({ kind: "area", rings: c.map((ring) => (Array.isArray(ring) ? ring.filter(isPosition) : [])), label }); break;
    case "MultiPolygon": if (Array.isArray(c)) for (const polygon of c) if (Array.isArray(polygon)) out.push({ kind: "area", rings: polygon.map((ring) => (Array.isArray(ring) ? ring.filter(isPosition) : [])), label }); break;
    case "GeometryCollection": for (const child of geometry.geometries ?? []) shapesOf(child, label, out); break;
  }
}

const nameOf = (properties: unknown) => {
  if (!properties || typeof properties !== "object") return null;
  const value = (properties as Record<string, unknown>).name ?? (properties as Record<string, unknown>).title;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

/** GeoJSON(FeatureCollection·Feature·도형)을 도형 목록으로 편다. */
function fromGeoJson(data: unknown): Shape[] {
  const shapes: Shape[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const item = value as { type?: string; features?: unknown[]; geometry?: Geometry; properties?: unknown };
    if (item.type === "FeatureCollection" && Array.isArray(item.features)) item.features.forEach(visit);
    else if (item.type === "Feature") shapesOf(item.geometry, nameOf(item.properties), shapes);
    else shapesOf(item as Geometry, null, shapes);
  };
  visit(data);
  return shapes;
}

/** TopoJSON을 GeoJSON 도형으로 푼다(양자화된 호는 변위를 더해 되돌린다). */
function fromTopoJson(data: unknown): Shape[] {
  const topology = data as { type?: string; arcs?: number[][][]; transform?: { scale: [number, number]; translate: [number, number] }; objects?: Record<string, unknown> };
  if (topology?.type !== "Topology" || !Array.isArray(topology.arcs) || !topology.objects) throw new Error("TopoJSON의 type은 Topology여야 합니다.");
  const { scale = [1, 1], translate = [0, 0] } = topology.transform ?? {};
  const decoded = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx = 0, dy = 0]) => {
      if (topology.transform) { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Position; }
      return [dx, dy] as Position;
    });
  });
  const arcAt = (index: number) => (index >= 0 ? decoded[index] ?? [] : [...(decoded[~index] ?? [])].reverse());
  const line = (indexes: number[]) => {
    const points: Position[] = [];
    indexes.forEach((index, at) => { const arc = arcAt(index); points.push(...(at ? arc.slice(1) : arc)); });
    return points;
  };
  const point = (p: number[]): Position => (topology.transform ? [p[0]! * scale[0] + translate[0], p[1]! * scale[1] + translate[1]] : [p[0]!, p[1]!]);
  const geometryOf = (object: Record<string, unknown>): Geometry | null => {
    const arcs = object.arcs as never;
    switch (object.type) {
      case "Point": return { type: "Point", coordinates: point(object.coordinates as number[]) };
      case "MultiPoint": return { type: "MultiPoint", coordinates: (object.coordinates as number[][]).map(point) };
      case "LineString": return { type: "LineString", coordinates: line(arcs) };
      case "MultiLineString": return { type: "MultiLineString", coordinates: (arcs as number[][]).map(line) };
      case "Polygon": return { type: "Polygon", coordinates: (arcs as number[][]).map(line) };
      case "MultiPolygon": return { type: "MultiPolygon", coordinates: (arcs as number[][][]).map((polygon) => polygon.map(line)) };
      case "GeometryCollection": return { type: "GeometryCollection", geometries: ((object.geometries as Record<string, unknown>[]) ?? []).map(geometryOf).filter((g): g is Geometry => g !== null) };
      default: return null;
    }
  };
  const shapes: Shape[] = [];
  for (const object of Object.values(topology.objects)) {
    const value = object as Record<string, unknown>;
    if (value.type === "GeometryCollection") for (const child of (value.geometries as Record<string, unknown>[]) ?? []) shapesOf(geometryOf(child), nameOf(child.properties), shapes);
    else shapesOf(geometryOf(value), nameOf(value.properties), shapes);
  }
  return shapes;
}

const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/** 보기 좋은 경위선 간격(도). */
const step = (span: number) => [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45].find((value) => span / value <= 8) ?? 60;

export type GeoPalette = { area: string; areaStroke: string; line: string; point: string; grid: string; label: string; halo: string };

/** 지도 SVG를 만든다. 도형이 없거나 JSON이 틀리면 오류를 던진다. */
export function renderGeo(code: string, topo: boolean, palette: GeoPalette): { svg: SVGSVGElement; caption: string } {
  let data: unknown;
  try { data = JSON.parse(code); } catch (error) { throw new Error(`JSON을 읽지 못했습니다: ${(error as Error).message}`); }
  const shapes = topo ? fromTopoJson(data) : fromGeoJson(data);
  const points = shapes.flatMap((shape) => shape.rings.flat());
  if (!points.length) throw new Error("그릴 도형이 없습니다.");
  const projected = points.map(mercator);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of projected) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  // 점 하나·직선처럼 폭이 없으면 둘레를 조금 넓힌다.
  const spanX = Math.max(maxX - minX, 0.02), spanY = Math.max(maxY - minY, 0.02);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);
  const toScreen = (position: Position): Position => { const [x, y] = mercator(position); return [WIDTH / 2 + (x - cx) * scale, HEIGHT / 2 - (y - cy) * scale]; };
  const svg = el("svg", { xmlns: SVG, viewBox: `0 0 ${WIDTH} ${HEIGHT}`, width: WIDTH, height: HEIGHT, role: "img" });
  // 경위선: 보이는 범위의 경도·위도를 일정한 간격으로 긋는다.
  const inverseY = (y: number) => ((2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI;
  const lonMin = cx - WIDTH / 2 / scale, lonMax = cx + WIDTH / 2 / scale;
  const latMin = inverseY(cy - HEIGHT / 2 / scale), latMax = inverseY(cy + HEIGHT / 2 / scale);
  const grid = el("g", { stroke: palette.grid, "stroke-width": 1, fill: "none" });
  const lonStep = step(lonMax - lonMin), latStep = step(latMax - latMin);
  for (let lon = Math.ceil(lonMin / lonStep) * lonStep; lon <= lonMax; lon += lonStep) { const [x] = toScreen([lon, 0]); grid.append(el("line", { x1: x, y1: 0, x2: x, y2: HEIGHT })); }
  for (let lat = Math.ceil(latMin / latStep) * latStep; lat <= latMax; lat += latStep) { const [, y] = toScreen([0, lat]); grid.append(el("line", { x1: 0, y1: y, x2: WIDTH, y2: y })); }
  svg.append(grid);
  const path = (rings: Position[][], close: boolean) => rings.filter((ring) => ring.length).map((ring) => ring.map((position, at) => `${at ? "L" : "M"}${toScreen(position).map((v) => v.toFixed(1)).join(" ")}`).join("") + (close ? "Z" : "")).join("");
  const layer = el("g", {});
  for (const shape of shapes.filter((item) => item.kind === "area")) layer.append(el("path", { d: path(shape.rings, true), fill: palette.area, "fill-rule": "evenodd", stroke: palette.areaStroke, "stroke-width": 1.5, "stroke-linejoin": "round" }));
  for (const shape of shapes.filter((item) => item.kind === "line")) layer.append(el("path", { d: path(shape.rings, false), fill: "none", stroke: palette.line, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  for (const shape of shapes.filter((item) => item.kind === "point")) {
    const [x, y] = toScreen(shape.rings[0]![0]!);
    layer.append(el("circle", { cx: x, cy: y, r: 6, fill: palette.point, stroke: palette.halo, "stroke-width": 2.5 }));
    if (shape.label) {
      const text = el("text", { x: x + 10, y: y + 4, "font-size": 13, "font-family": "Segoe UI, Malgun Gothic, sans-serif", fill: palette.label, stroke: palette.halo, "stroke-width": 3, "paint-order": "stroke" });
      text.textContent = shape.label;
      layer.append(text);
    }
  }
  svg.append(layer);
  const counts = { area: 0, line: 0, point: 0 };
  for (const shape of shapes) counts[shape.kind]++;
  const parts = [counts.area && `영역 ${counts.area}`, counts.line && `선 ${counts.line}`, counts.point && `점 ${counts.point}`].filter(Boolean);
  return { svg, caption: `${topo ? "TopoJSON" : "GeoJSON"} · ${parts.join(" · ")} · 배경 지도 없이 도형만 그립니다` };
}
