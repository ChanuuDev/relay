// 야간 본사 격자 지도. 위 WORKING(두 면이 창), 오른쪽 HANDOFF 회의실, 왼쪽 BLOCKED, 아래 DONE 로비(EXIT 유리문),
// 가운데 십자 홀. 오른쪽 아래가 파여 로비 뒤가 바깥벽이 된다. 칸 하나가 1m이고 x는 화면 오른쪽 아래, y는 왼쪽 아래로 뻗는다.
import { deskGroup as desk, repeatRows as rows, type MapDef } from "./iso";
import type { Theme } from "./world";

const desks = [
  desk("w-a", "working", 1, 1), desk("w-b", "working", 4, 1), desk("w-c", "working", 7, 1),
  desk("w-d", "working", 1, 5), desk("w-e", "working", 4, 5), desk("w-f", "working", 7, 5),
  desk("b-a", "blocked", 1, 16), desk("b-b", "blocked", 4, 16), desk("b-c", "blocked", 0, 20, true),
];

export const NIGHT_MAP: MapDef = {
  cols: 24, rows: 24,
  floor: rows([
    [8, "WWWWWWWWWWWHHHHFFFFFFFFF"],
    [3, "WWWWWWWWWWWHHHHHHHHH    "],
    [2, "HHHHHHHHHHHHHHHHHHHH    "],
    [2, "HHHHHHHHHHHHHDDDDDDDDDDD"],
    [9, "BBBBBBBBHHHHHDDDDDDDDDDD"],
  ]),
  legend: {
    W: { zone: "working", floor: "carpet" },
    H: { zone: "hall", floor: "stone" },
    F: { zone: "handoff", floor: "violet" },
    B: { zone: "blocked", floor: "orange" },
    D: { zone: "done", floor: "green" },
  },
  walls: [
    // 바깥 뒷벽(창)과 앞쪽 낮은 난간. 오른쪽 아래 파인 곳 둘레도 난간이다.
    { side: "n", x: 0, y: 0, pattern: "W".repeat(24) },
    { side: "w", x: 0, y: 0, pattern: "W".repeat(24) },
    { side: "n", x: 0, y: 24, pattern: "L".repeat(24) },
    { side: "w", x: 24, y: 0, pattern: "L".repeat(8) },
    { side: "w", x: 24, y: 13, pattern: "L".repeat(11) },
    { side: "w", x: 20, y: 8, pattern: "LLLLL" },
    // WORKING: 앞쪽 두 면이 유리, 출입구 둘
    { side: "w", x: 11, y: 0, pattern: "GGGGGGdGGGG" },
    { side: "n", x: 0, y: 11, pattern: "GGGGGGGGdGG" },
    // HANDOFF: 뒤 벽(화이트보드)과 앞 유리, 파인 곳 쪽은 난간
    { side: "w", x: 15, y: 0, pattern: "WWWWWDWW" },
    { side: "n", x: 15, y: 8, pattern: "GGGGGLLLL" },
    // BLOCKED
    { side: "n", x: 0, y: 15, pattern: "GGGGGGGd" },
    { side: "w", x: 8, y: 15, pattern: "GGGGGGGGG" },
    // DONE 로비: 홀 쪽은 유리, 파인 곳 쪽은 바깥벽과 EXIT 유리문
    { side: "n", x: 13, y: 13, pattern: "GGGddGGWEEW" },
    { side: "w", x: 13, y: 13, pattern: "GGGGdGGGGGG" },
  ],
  decor: [
    ...[0, 1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((x) => ({ side: "n" as const, x, y: 0, sprite: "window" })),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 22, 23].map((y) => ({ side: "w" as const, x: 0, y, sprite: "window" })),
    { side: "n", x: 23, y: 13, sprite: "window" },
    { side: "n", x: 21, y: 13, sprite: "exit" },
    { side: "n", x: 20, y: 13, sprite: "sconce" },
    { side: "w", x: 15, y: 1, sprite: "whiteboard" },
    { side: "w", x: 15, y: 3, sprite: "art1" },
    { side: "n", x: 22, y: 0, sprite: "tv" },
  ],
  signs: [
    { side: "n", x: 3, y: 0, span: 4, title: "Working", sub: "작업 중", zone: "working" },
    { side: "n", x: 17, y: 0, span: 5, title: "Handoff", sub: "인계 중", zone: "handoff" },
    { side: "w", x: 0, y: 15, span: 5, title: "Blocked", sub: "입력 대기", zone: "blocked" },
    { side: "w", x: 13, y: 19, span: 3, title: "Done", sub: "완료", zone: "done" },
    { side: "n", x: 21, y: 13, span: 2, title: "Exit", sub: "", zone: "done", lift: 74, small: true },
  ],
  items: [
    ...desks.flatMap((entry) => entry.items),
    // WORKING
    { sprite: "bookshelf", x: 3, y: 0 }, { sprite: "cabinet", x: 6, y: 0 }, { sprite: "printer", x: 10, y: 0 },
    { sprite: "fig", x: 0, y: 0 }, { sprite: "cooler", x: 10, y: 3 }, { sprite: "plant", x: 0, y: 10 },
    { sprite: "bookshelf", x: 0, y: 8, flip: true }, { sprite: "lamp", x: 10, y: 10 }, { sprite: "plant", x: 9, y: 0 },
    // HANDOFF
    { sprite: "meeting", x: 18, y: 3 }, { sprite: "mchair", x: 18, y: 5 }, { sprite: "mchair", x: 19, y: 5 },
    { sprite: "mchairFront", x: 17, y: 3 }, { sprite: "mchairFront", x: 19, y: 2, flip: true },
    { sprite: "sideboard", x: 16, y: 0 }, { sprite: "fig", x: 23, y: 0 }, { sprite: "plant", x: 23, y: 7 },
    // BLOCKED
    { sprite: "bookshelf", x: 0, y: 17, flip: true }, { sprite: "plant", x: 3, y: 16 }, { sprite: "lamp", x: 7, y: 23 },
    { sprite: "cabinet", x: 6, y: 16 }, { sprite: "fig", x: 0, y: 23 },
    // 홀
    { sprite: "tree", x: 11, y: 11 }, { sprite: "bench", x: 5, y: 13 }, { sprite: "bench", x: 16, y: 11 },
    { sprite: "plant", x: 14, y: 0 }, { sprite: "lamp", x: 11, y: 0 }, { sprite: "planter", x: 9, y: 23 },
    { sprite: "fig", x: 12, y: 15 }, { sprite: "plant", x: 19, y: 12 },
    // DONE 로비
    { sprite: "reception", x: 19, y: 14 }, { sprite: "coatrack", x: 13, y: 13 },
    { sprite: "sofa", x: 17, y: 17, flip: true }, { sprite: "armchair", x: 18, y: 16 }, { sprite: "coffee", x: 18, y: 17 },
    { sprite: "fig", x: 23, y: 13 }, { sprite: "plant", x: 20, y: 13 }, { sprite: "lamp", x: 23, y: 23 }, { sprite: "planter", x: 14, y: 23 },
  ],
  seats: [
    ...desks.flatMap((entry) => entry.seats),
    { id: "h-1", zone: "handoff", x: 18, y: 5, kind: "desk" },
    { id: "h-2", zone: "handoff", x: 19, y: 5, kind: "desk" },
    { id: "h-3", zone: "handoff", x: 17, y: 3, kind: "lounge" },
    { id: "h-4", zone: "handoff", x: 19, y: 2, kind: "lounge", flip: true },
    { id: "h-5", zone: "handoff", x: 21, y: 4, kind: "stand", view: "back", flip: true },
    { id: "d-sofa1", zone: "done", x: 17, y: 17, kind: "lounge" },
    { id: "d-sofa2", zone: "done", x: 17, y: 18, kind: "lounge" },
    { id: "d-arm", zone: "done", x: 18, y: 16, kind: "lounge", flip: true },
    { id: "d-1", zone: "done", x: 20, y: 16, kind: "stand", view: "front", flip: true },
    { id: "d-2", zone: "done", x: 16, y: 20, kind: "stand", view: "front" },
    { id: "d-3", zone: "done", x: 20, y: 20, kind: "stand", view: "back", flip: true },
    { id: "d-4", zone: "done", x: 22, y: 18, kind: "stand", view: "front", flip: true },
    { id: "d-5", zone: "done", x: 14, y: 19, kind: "stand", view: "front" },
    { id: "d-6", zone: "done", x: 21, y: 22, kind: "stand", view: "back" },
    { id: "d-7", zone: "done", x: 18, y: 22, kind: "stand", view: "front", flip: true },
  ],
  hall: {
    center: [13, 10],
    spawn: [[13, 9], [10, 13], [14, 8], [12, 6], [17, 9], [8, 12], [10, 19], [4, 12]],
    wander: [[13, 7], [14, 4], [12, 2], [16, 10], [19, 11], [9, 12], [3, 13], [6, 11], [10, 17], [9, 21], [14, 12], [11, 14]],
  },
  exit: [21, 13],
  logo: { x: 7, y: 12, text: "RELAY" },
};

export const NIGHT_THEME: Theme = {
  sky: ["#070b1a", "#161b38"],
  glow: "rgba(70, 100, 220, 0.28)",
  slab: ["#222a4c", "#181e3c"],
  grid: "rgba(150, 175, 255, 0.07)",
  shade: 1,
  sign: "neon",
  logo: "rgba(140, 170, 255, 0.3)",
};
