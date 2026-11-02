// 사무실을 어느 사옥으로 보일지. 사옥마다 평면이 달라서 그림과 함께 좌석·길·구역 좌표(OfficeLayout)를 따로 둔다.
import type { OfficeLayout } from "./layout";
import { LAYOUT } from "./office-data";
import { BIRCH_LAYOUT } from "./hq-birch";
import { OAK_LAYOUT } from "./hq-oak";

export type BuildingId = "night" | "birch" | "oak";
export interface Building {
  id: BuildingId;
  /** 고르는 단추와 화면 읽기 프로그램이 읽는 이름 */
  name: string;
  /** 단추에 마우스를 올리면 보이는 한 줄 설명 */
  hint: string;
  url: string;
  layout: OfficeLayout;
}

export const BUILDINGS: readonly Building[] = [
  { id: "night", name: "야간 본사", hint: "불 켜진 밤의 Relay 본사", url: "/office/background.webp?v=3", layout: LAYOUT },
  { id: "birch", name: "자작나무 사옥", hint: "햇살 드는 낮, 화이트·자작나무 가구의 사옥", url: "/office/hq-birch.webp?v=1", layout: BIRCH_LAYOUT },
  { id: "oak", name: "오크 사옥", hint: "노을 지는 저녁, 오크·블랙 스틸 가구의 사옥", url: "/office/hq-oak.webp?v=1", layout: OAK_LAYOUT },
];

export const BUILDING_KEY = "relay-office-building";
export const DEFAULT_BUILDING: BuildingId = "night";

export const isBuilding = (value: unknown): value is BuildingId => BUILDINGS.some((building) => building.id === value);
export const buildingOf = (id: BuildingId) => BUILDINGS.find((building) => building.id === id) ?? BUILDINGS[0]!;

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
