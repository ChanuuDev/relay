// 자작나무 사옥(낮) 격자 지도. 위 BLOCKED 집중실, 오른쪽 WORKING 오픈 오피스, 왼쪽 DONE 로비(EXIT 유리문),
// 아래 HANDOFF 유리 회의실, 가운데 큰 나무가 선 아트리움 홀. 칸 하나가 1m이고 x는 화면 오른쪽 아래, y는 왼쪽 아래로 뻗는다.
import { deskGroup as desk, repeatRows as rows, type MapDef } from "./iso";
import type { Theme } from "./world";

const desks = [
  desk("b-a", "blocked", 1, 1), desk("b-b", "blocked", 5, 1), desk("b-c", "blocked", 0, 5, true),
  desk("w-a", "working", 14, 1), desk("w-b", "working", 18, 1), desk("w-c", "working", 22, 1),
  desk("w-d", "working", 14, 4), desk("w-e", "working", 18, 4), desk("w-f", "working", 22, 4),
];

export const BIRCH_MAP: MapDef = {
  cols: 26, rows: 22,
  floor: rows([
    [8, "BBBBBBBBBHHHHWWWWWWWWWWWWW"],
    [5, "HHHHHHHHHHHHHHHHHHHHHHHHHH"],
    [1, "DDDDDDDDDHHHHHHHHHHHHHHHHH"],
    [7, "DDDDDDDDDHHHHHFFFFFFFFHHHH"],
    [1, "DDDDDDDDDHHHHHHHHHHHHHHHHH"],
  ]),
  legend: {
    B: { zone: "blocked", floor: "mustard" },
    W: { zone: "working", floor: "carpet" },
    H: { zone: "hall", floor: "wood" },
    D: { zone: "done", floor: "sage" },
    F: { zone: "handoff", floor: "lavender" },
  },
  walls: [
    // 바깥 뒷벽(창)과 앞쪽 낮은 난간
    { side: "n", x: 0, y: 0, pattern: "W".repeat(26) },
    { side: "w", x: 0, y: 0, pattern: `${"W".repeat(17)}EE${"W".repeat(3)}` },
    { side: "n", x: 0, y: 22, pattern: "L".repeat(26) },
    { side: "w", x: 26, y: 0, pattern: "L".repeat(22) },
    // BLOCKED 집중실: 앞쪽 두 면이 유리, 오른쪽에 출입구
    { side: "n", x: 0, y: 8, pattern: "GGGGGGGGG" },
    { side: "w", x: 9, y: 0, pattern: "GGGGdGGG" },
    // WORKING: 낮은 칸막이와 트인 통로
    { side: "w", x: 13, y: 0, pattern: "LLLoLLLL" },
    { side: "n", x: 13, y: 8, pattern: "LLLLLooLLLLLL" },
    // DONE 로비: 유리 벽과 출입구 둘
    { side: "n", x: 0, y: 13, pattern: "GGGGGGdGG" },
    { side: "w", x: 9, y: 13, pattern: "GGdGGGGGG" },
    // HANDOFF 회의실: 뒤 두 면은 흰 벽, 앞 두 면은 유리
    { side: "n", x: 14, y: 14, pattern: "WWWWWWWW" },
    { side: "w", x: 14, y: 14, pattern: "WWWDWWW" },
    { side: "n", x: 14, y: 21, pattern: "GGGGGGGG" },
    { side: "w", x: 22, y: 14, pattern: "GGGGGGG" },
  ],
  decor: [
    ...[0, 1, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25].map((x) => ({ side: "n" as const, x, y: 0, sprite: "window" })),
    ...[0, 1, 4, 6, 7, 8, 9, 11, 12].map((y) => ({ side: "w" as const, x: 0, y, sprite: "window" })),
    { side: "w", x: 0, y: 10, sprite: "art1" },
    { side: "w", x: 0, y: 2, sprite: "felt" }, { side: "w", x: 0, y: 3, sprite: "felt" },
    { side: "w", x: 0, y: 17, sprite: "exit" },
    { side: "w", x: 0, y: 16, sprite: "sconce" }, { side: "w", x: 0, y: 19, sprite: "sconce" },
    { side: "w", x: 0, y: 20, sprite: "art2" },
    { side: "n", x: 19, y: 14, sprite: "tv" },
    { side: "n", x: 21, y: 14, sprite: "clock" },
    { side: "w", x: 14, y: 15, sprite: "whiteboard" },
    { side: "w", x: 14, y: 19, sprite: "art1" },
  ],
  signs: [
    { side: "n", x: 2, y: 0, span: 5, title: "Blocked", sub: "입력 대기", zone: "blocked" },
    { side: "n", x: 16, y: 0, span: 4, title: "Working", sub: "작업 중", zone: "working" },
    { side: "w", x: 0, y: 13, span: 3, title: "Done", sub: "완료", zone: "done" },
    { side: "n", x: 14, y: 14, span: 5, title: "Handoff", sub: "인계 중", zone: "handoff" },
    { side: "w", x: 0, y: 17, span: 2, title: "Exit", sub: "", zone: "done", lift: 74, small: true },
  ],
  items: [
    ...desks.flatMap((entry) => entry.items),
    // BLOCKED
    { sprite: "fig", x: 0, y: 0 }, { sprite: "cabinet", x: 3, y: 1 }, { sprite: "plant", x: 4, y: 1 },
    { sprite: "bookshelf", x: 0, y: 2, flip: true }, { sprite: "lamp", x: 8, y: 7 }, { sprite: "plant", x: 8, y: 0 },
    // WORKING
    { sprite: "bookshelf", x: 16, y: 0 }, { sprite: "sideboard", x: 20, y: 0 }, { sprite: "printer", x: 25, y: 0 },
    { sprite: "fig", x: 13, y: 0 }, { sprite: "cooler", x: 25, y: 3 }, { sprite: "fig", x: 25, y: 7 },
    { sprite: "planter", x: 14, y: 7 }, { sprite: "planter", x: 22, y: 7 }, { sprite: "plant", x: 13, y: 7 },
    // 홀
    { sprite: "tree", x: 10, y: 9 }, { sprite: "bench", x: 14, y: 10 }, { sprite: "bench", x: 5, y: 10 },
    { sprite: "lamp", x: 9, y: 8 }, { sprite: "plant", x: 12, y: 12 }, { sprite: "fig", x: 25, y: 8 },
    { sprite: "planter", x: 23, y: 21 }, { sprite: "fig", x: 25, y: 13 }, { sprite: "bench", x: 23, y: 17, flip: true },
    { sprite: "plant", x: 13, y: 21 }, { sprite: "lamp", x: 0, y: 8 },
    // DONE 로비
    { sprite: "reception", x: 1, y: 14 }, { sprite: "coatrack", x: 0, y: 13 },
    { sprite: "sofa", x: 3, y: 16, flip: true }, { sprite: "armchair", x: 4, y: 15 }, { sprite: "coffee", x: 4, y: 16 },
    { sprite: "fig", x: 8, y: 21 }, { sprite: "plant", x: 0, y: 21 }, { sprite: "lamp", x: 8, y: 14 },
    // HANDOFF
    { sprite: "meeting", x: 16, y: 16 }, { sprite: "mchair", x: 16, y: 18 }, { sprite: "mchair", x: 17, y: 18 },
    { sprite: "mchairFront", x: 15, y: 16 }, { sprite: "mchairFront", x: 17, y: 15, flip: true },
    { sprite: "fig", x: 21, y: 14 }, { sprite: "sideboard", x: 15, y: 20 }, { sprite: "plant", x: 21, y: 20 },
  ],
  seats: [
    ...desks.flatMap((entry) => entry.seats),
    { id: "h-1", zone: "handoff", x: 16, y: 18, kind: "desk" },
    { id: "h-2", zone: "handoff", x: 17, y: 18, kind: "desk" },
    { id: "h-3", zone: "handoff", x: 15, y: 16, kind: "lounge" },
    { id: "h-4", zone: "handoff", x: 17, y: 15, kind: "lounge", flip: true },
    { id: "h-5", zone: "handoff", x: 19, y: 17, kind: "stand", view: "back", flip: true },
    { id: "d-sofa1", zone: "done", x: 3, y: 16, kind: "lounge" },
    { id: "d-sofa2", zone: "done", x: 3, y: 17, kind: "lounge" },
    { id: "d-arm", zone: "done", x: 4, y: 15, kind: "lounge", flip: true },
    { id: "d-1", zone: "done", x: 6, y: 15, kind: "stand", view: "front", flip: true },
    { id: "d-2", zone: "done", x: 6, y: 18, kind: "stand", view: "front" },
    { id: "d-3", zone: "done", x: 2, y: 19, kind: "stand", view: "front" },
    { id: "d-4", zone: "done", x: 5, y: 20, kind: "stand", view: "front", flip: true },
    { id: "d-5", zone: "done", x: 7, y: 17, kind: "stand", view: "back", flip: true },
    { id: "d-6", zone: "done", x: 3, y: 21, kind: "stand", view: "back" },
    { id: "d-7", zone: "done", x: 7, y: 20, kind: "stand", view: "front", flip: true },
  ],
  hall: {
    center: [13, 10],
    spawn: [[12, 8], [9, 11], [13, 12], [16, 9], [20, 11], [11, 15], [4, 12], [23, 10]],
    wander: [[8, 9], [12, 11], [9, 12], [16, 12], [18, 9], [21, 12], [3, 10], [11, 18], [24, 15], [7, 12], [10, 20], [19, 11]],
  },
  exit: [0, 17],
  logo: { x: 19.5, y: 10, text: "RELAY" },
};

export const BIRCH_THEME: Theme = {
  sky: ["#cfe5f2", "#f4efe3"],
  glow: "rgba(255, 255, 255, 0.55)",
  slab: ["#d8cbb3", "#bfae92"],
  grid: "rgba(70, 50, 20, 0.07)",
  shade: 0.85,
  sign: "plate",
  logo: "rgba(120, 88, 46, 0.34)",
  ghost: "rgba(70, 96, 150, 0.85)",
};
