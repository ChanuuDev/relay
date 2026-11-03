// 오크 사옥(노을) 격자 지도. 왼쪽 위 WORKING, 위 HANDOFF 원탁 회의실, 오른쪽 BLOCKED, 오른쪽 아래 DONE 로비(엘리베이터),
// 왼쪽 아래 라운지 홀. 왼쪽 아래와 로비 뒤가 파여 바깥벽(통유리)이 된다. 칸 하나가 1m이고 x는 화면 오른쪽 아래, y는 왼쪽 아래로 뻗는다.
import { deskGroup as desk, repeatRows as rows, type MapDef } from "./iso";
import type { Theme } from "./world";

const desks = [
  desk("w-a", "working", 1, 1), desk("w-b", "working", 5, 1),
  desk("w-c", "working", 1, 4), desk("w-d", "working", 5, 4),
  desk("w-e", "working", 1, 7), desk("w-f", "working", 5, 7),
  desk("b-a", "blocked", 21, 1), desk("b-b", "blocked", 24, 1), desk("b-c", "blocked", 20, 4, true),
];

export const OAK_MAP: MapDef = {
  cols: 26, rows: 22,
  floor: rows([
    [7, "WWWWWWWWWHHHFFFFFFFFBBBBBB"],
    [2, "WWWWWWWWWHHHHHHHHHHHBBBBBB"],
    [3, "WWWWWWWWWHHHHHHHHHHHHHHHHH"],
    [2, "HHHHHHHHHHHHHHHHHHHHHH    "],
    [8, "    HHHHHHHHHDDDDDDDDDDDDD"],
  ]),
  legend: {
    W: { zone: "working", floor: "teal" },
    H: { zone: "hall", floor: "concrete" },
    F: { zone: "handoff", floor: "plum" },
    B: { zone: "blocked", floor: "rust" },
    D: { zone: "done", floor: "olive" },
  },
  walls: [
    // 바깥 뒷벽(통유리)과 앞쪽 낮은 난간. 파인 곳 둘레도 바깥이다.
    { side: "n", x: 0, y: 0, pattern: "W".repeat(26) },
    { side: "w", x: 0, y: 0, pattern: "W".repeat(14) },
    { side: "w", x: 4, y: 14, pattern: "W".repeat(8) },
    { side: "n", x: 0, y: 14, pattern: "LLLL" },
    { side: "n", x: 4, y: 22, pattern: "L".repeat(22) },
    { side: "w", x: 26, y: 0, pattern: "L".repeat(12) },
    { side: "w", x: 22, y: 12, pattern: "LL" },
    { side: "w", x: 26, y: 14, pattern: "L".repeat(8) },
    // WORKING: 앞쪽 두 면이 유리
    { side: "w", x: 9, y: 0, pattern: "GGGGGGGdGGGG" },
    { side: "n", x: 0, y: 12, pattern: "GGGGdGGGG" },
    // HANDOFF: 뒤 벽(화이트보드)과 앞 유리
    { side: "w", x: 12, y: 0, pattern: "WWWWDWW" },
    { side: "n", x: 12, y: 7, pattern: "GGGGGGGG" },
    // BLOCKED
    { side: "w", x: 20, y: 0, pattern: "WWWWWWWDW" },
    { side: "n", x: 20, y: 9, pattern: "GGGGGG" },
    // DONE 로비: 홀 쪽은 유리, 파인 곳 쪽은 바깥벽과 엘리베이터
    { side: "n", x: 13, y: 14, pattern: "GGGddGGGGWEEW" },
    { side: "w", x: 13, y: 14, pattern: "GGdGGGGG" },
  ],
  decor: [
    ...[0, 1, 6, 7, 8, 9, 10, 11, 12, 13, 19, 20].map((x) => ({ side: "n" as const, x, y: 0, sprite: "window" })),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((y) => ({ side: "w" as const, x: 0, y, sprite: "window" })),
    ...[14, 15, 16, 17, 18, 19, 20, 21].map((y) => ({ side: "w" as const, x: 4, y, sprite: "window" })),
    { side: "n", x: 22, y: 14, sprite: "sconce" }, { side: "n", x: 25, y: 14, sprite: "sconce" },
    { side: "n", x: 23, y: 14, sprite: "exit" },
    { side: "w", x: 12, y: 1, sprite: "whiteboard" },
    { side: "w", x: 12, y: 5, sprite: "art1" },
    { side: "w", x: 20, y: 5, sprite: "cork" },
  ],
  signs: [
    { side: "n", x: 2, y: 0, span: 4, title: "Working", sub: "작업 중", zone: "working" },
    { side: "n", x: 14, y: 0, span: 5, title: "Handoff", sub: "인계 중", zone: "handoff" },
    { side: "n", x: 21, y: 0, span: 5, title: "Blocked", sub: "입력 대기", zone: "blocked" },
    { side: "n", x: 18, y: 14, span: 3, title: "Done", sub: "완료", zone: "done" },
  ],
  items: [
    ...desks.flatMap((entry) => entry.items),
    // WORKING
    { sprite: "bookshelf", x: 3, y: 0 }, { sprite: "fig", x: 0, y: 0 }, { sprite: "printer", x: 8, y: 0 },
    { sprite: "cooler", x: 8, y: 4 }, { sprite: "bookshelf", x: 0, y: 10, flip: true }, { sprite: "lamp", x: 8, y: 11 },
    { sprite: "plant", x: 7, y: 0 },
    // HANDOFF
    { sprite: "meeting", x: 15, y: 2 }, { sprite: "mchair", x: 15, y: 4 }, { sprite: "mchair", x: 16, y: 4 },
    { sprite: "mchairFront", x: 14, y: 3 }, { sprite: "mchairFront", x: 16, y: 1, flip: true },
    { sprite: "sideboard", x: 17, y: 0 }, { sprite: "fig", x: 19, y: 0 }, { sprite: "plant", x: 19, y: 6 },
    // BLOCKED
    { sprite: "fig", x: 25, y: 8 }, { sprite: "cabinet", x: 23, y: 1 }, { sprite: "lamp", x: 20, y: 8 }, { sprite: "plant", x: 20, y: 0 },
    // 홀
    { sprite: "tree", x: 7, y: 16 }, { sprite: "bench", x: 5, y: 19 }, { sprite: "bench", x: 9, y: 13 },
    { sprite: "planter", x: 15, y: 12 }, { sprite: "lamp", x: 9, y: 0 }, { sprite: "plant", x: 11, y: 0 },
    { sprite: "fig", x: 4, y: 14 }, { sprite: "fig", x: 21, y: 13 }, { sprite: "planter", x: 10, y: 21 }, { sprite: "plant", x: 0, y: 13 },
    { sprite: "bench", x: 25, y: 10, flip: true },
    // DONE 로비
    { sprite: "reception", x: 19, y: 15 }, { sprite: "coatrack", x: 13, y: 14 },
    { sprite: "sofa", x: 15, y: 18, flip: true }, { sprite: "armchair", x: 16, y: 17 }, { sprite: "coffee", x: 16, y: 18 },
    { sprite: "fig", x: 25, y: 15 }, { sprite: "plant", x: 22, y: 15 }, { sprite: "lamp", x: 13, y: 21 }, { sprite: "planter", x: 23, y: 21 },
  ],
  seats: [
    ...desks.flatMap((entry) => entry.seats),
    { id: "h-1", zone: "handoff", x: 15, y: 4, kind: "desk" },
    { id: "h-2", zone: "handoff", x: 16, y: 4, kind: "desk" },
    { id: "h-3", zone: "handoff", x: 14, y: 3, kind: "lounge" },
    { id: "h-4", zone: "handoff", x: 16, y: 1, kind: "lounge", flip: true },
    { id: "h-5", zone: "handoff", x: 18, y: 2, kind: "stand", view: "back", flip: true },
    { id: "d-sofa1", zone: "done", x: 15, y: 18, kind: "lounge" },
    { id: "d-sofa2", zone: "done", x: 15, y: 19, kind: "lounge" },
    { id: "d-arm", zone: "done", x: 16, y: 17, kind: "lounge", flip: true },
    { id: "d-1", zone: "done", x: 18, y: 19, kind: "stand", view: "front", flip: true },
    { id: "d-2", zone: "done", x: 20, y: 18, kind: "stand", view: "back", flip: true },
    { id: "d-3", zone: "done", x: 22, y: 17, kind: "stand", view: "front" },
    { id: "d-4", zone: "done", x: 23, y: 20, kind: "stand", view: "front", flip: true },
    { id: "d-5", zone: "done", x: 17, y: 21, kind: "stand", view: "back" },
    { id: "d-6", zone: "done", x: 14, y: 20, kind: "stand", view: "front" },
    { id: "d-7", zone: "done", x: 21, y: 21, kind: "stand", view: "front", flip: true },
  ],
  hall: {
    center: [11, 12],
    spawn: [[10, 5], [12, 10], [16, 11], [9, 15], [5, 16], [10, 18], [20, 11], [3, 13]],
    wander: [[10, 2], [10, 8], [14, 8], [18, 8], [23, 10], [12, 13], [6, 13], [2, 12], [8, 15], [6, 21], [11, 20], [19, 12]],
  },
  exit: [23, 14],
  logo: { x: 15.5, y: 10, text: "RELAY" },
};

export const OAK_THEME: Theme = {
  sky: ["#f2a46b", "#3b2a4a"],
  glow: "rgba(255, 196, 120, 0.35)",
  slab: ["#3a3038", "#2c242c"],
  grid: "rgba(40, 20, 0, 0.08)",
  shade: 1,
  sign: "neon",
  logo: "rgba(176, 120, 52, 0.32)",
  ghost: "rgba(255, 196, 140, 0.85)",
};
