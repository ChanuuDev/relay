// 사무실을 어느 사옥으로 보일지. 사옥마다 격자 지도(바닥·벽·가구 자리)와 그림 묶음(kit), 색(theme)이 다르다.
import type { OfficeLayout } from "./layout";
import { planWorld, type Kit, type MapDef, type WorldPlan } from "./iso";
import type { Theme } from "./world";
import { BIRCH_MAP, BIRCH_THEME } from "./map-birch";
import { NIGHT_MAP, NIGHT_THEME } from "./map-night";
import { OAK_MAP, OAK_THEME } from "./map-oak";
import { BIRCH_KIT } from "./kit-birch";
import { NIGHT_KIT } from "./kit-night";
import { OAK_KIT } from "./kit-oak";

export type BuildingId = "night" | "birch" | "oak";
export interface Building {
  id: BuildingId;
  /** 고르는 단추와 화면 읽기 프로그램이 읽는 이름 */
  name: string;
  /** 단추에 마우스를 올리면 보이는 한 줄 설명 */
  hint: string;
  /** 그림 묶음(가구·벽 조각·장식이 든 아틀라스) 주소 */
  url: string;
  map: MapDef;
  kit: Kit;
  theme: Theme;
  /** 지도를 풀어 놓은 것(그리기용) */
  plan: WorldPlan;
  /** 좌석·걷는 길·구역(시뮬레이션용) */
  layout: OfficeLayout;
}

function building(id: BuildingId, name: string, hint: string, map: MapDef, kit: Kit, theme: Theme): Building {
  const plan = planWorld(map, kit);
  return { id, name, hint, url: kit.atlas, map, kit, theme, plan, layout: plan.layout };
}

export const BUILDINGS: readonly Building[] = [
  building("night", "야간 본사", "불 켜진 밤의 Relay 본사", NIGHT_MAP, NIGHT_KIT, NIGHT_THEME),
  building("birch", "자작나무 사옥", "햇살 드는 낮, 화이트·자작나무 가구의 사옥", BIRCH_MAP, BIRCH_KIT, BIRCH_THEME),
  building("oak", "오크 사옥", "노을 지는 저녁, 오크·블랙 스틸 가구의 사옥", OAK_MAP, OAK_KIT, OAK_THEME),
];

export const BUILDING_KEY = "relay-office-building";
export const DEFAULT_BUILDING: BuildingId = "night";

export const isBuilding = (value: unknown): value is BuildingId => BUILDINGS.some((entry) => entry.id === value);
export const buildingOf = (id: BuildingId) => BUILDINGS.find((entry) => entry.id === id) ?? BUILDINGS[0]!;

/** 이 브라우저에서 마지막으로 고른 사옥. 저장소를 못 쓰거나 모르는 값이면 기본 사옥이다. */
export function storedBuilding(): BuildingId {
  try {
    const value = localStorage.getItem(BUILDING_KEY);
    return isBuilding(value) ? value : DEFAULT_BUILDING;
  } catch { return DEFAULT_BUILDING; }
}

export function storeBuilding(id: BuildingId) {
  try { localStorage.setItem(BUILDING_KEY, id); } catch { /* 저장하지 못해도 지금 화면에서는 바뀐다. */ }
}

/** 끌어 놓아 고른 좌석(세션 → 좌석 노드)을 사옥마다 이 브라우저에 남긴다. */
export const seatsKey = (id: BuildingId) => `relay-office-seats:${id}`;
export function storedSeats(id: BuildingId): Map<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(seatsKey(id)) ?? "{}") as unknown;
    if (!value || typeof value !== "object") return new Map();
    return new Map(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return new Map(); }
}
export function storeSeats(id: BuildingId, seats: ReadonlyMap<string, string>) {
  try {
    // 오래된 세션이 쌓이지 않게 최근 200개만 남긴다.
    localStorage.setItem(seatsKey(id), JSON.stringify(Object.fromEntries([...seats].slice(-200))));
  } catch { /* 남기지 못해도 지금 화면에서는 옮겨 앉는다. */ }
}
