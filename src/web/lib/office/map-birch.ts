// 자작나무 사옥(낮) 격자 지도: 요정 숲 위에 떠 있는 숲속 사옥. 위 BLOCKED 판벽 서재, 오른쪽 WORKING 헤링본 오픈 오피스,
// 왼쪽 DONE 로비(EXIT 유리문), 아래 HANDOFF 유리 회의실, 가운데 요정 조명이 걸린 나무 아트리움과 카페 코너·독서 구석.
// 섬 가장자리가 들쭉날쭉해 이끼·흙·뿌리 옆면이 드러난다. 칸 하나가 1m이고 x는 화면 오른쪽 아래, y는 왼쪽 아래로 뻗는다.
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
    [2, "HHHHHHHHHHHHHHHHHHHHHHHHHH"],
    [3, "HHHHHHHHHHHHHHHHHHHHHHHH  "],
    [1, "DDDDDDDDDHHHHHHHHHHHHHHH  "],
    [7, "DDDDDDDDDHHHHHFFFFFFFHHH  "],
    [1, "  DDDDDDDHHHHHHHHHHHH     "],
  ]),
  legend: {
    B: { zone: "blocked", floor: "mustard" },
    W: { zone: "working", floor: "herringbone" },
    H: { zone: "hall", floor: "wood" },
    D: { zone: "done", floor: "sage" },
    F: { zone: "handoff", floor: "lavender" },
  },
  walls: [
    // 바깥 뒷벽: 위는 아치 창이 난 흰 벽, 왼쪽은 서재 판벽·홀·로비(EXIT 유리문)
    { side: "n", x: 0, y: 0, pattern: "W".repeat(26) },
    { side: "w", x: 0, y: 0, pattern: "YYYYYYYYWWWWWWWWWEEWW" },
    // 들쭉날쭉한 섬 가장자리의 낮은 난간
    { side: "w", x: 26, y: 0, pattern: "L".repeat(10) },
    { side: "n", x: 24, y: 10, pattern: "LL" },
    { side: "w", x: 24, y: 10, pattern: "L".repeat(11) },
    { side: "n", x: 21, y: 21, pattern: "LLL" },
    { side: "w", x: 21, y: 21, pattern: "L" },
    { side: "n", x: 2, y: 22, pattern: "L".repeat(19) },
    { side: "n", x: 0, y: 21, pattern: "LL" },
    { side: "w", x: 2, y: 21, pattern: "L" },
    // BLOCKED 서재: 앞쪽 두 면이 유리, 오른쪽에 출입구
    { side: "n", x: 0, y: 8, pattern: "GGGGGGGGG" },
    { side: "w", x: 9, y: 0, pattern: "GGGGdGGG" },
    // WORKING: 낮은 칸막이와 트인 통로
    { side: "w", x: 13, y: 0, pattern: "LLLoLLLL" },
    { side: "n", x: 13, y: 8, pattern: "LLLLLooLLLLLL" },
    // DONE 로비: 유리 벽과 출입구 둘
    { side: "n", x: 0, y: 13, pattern: "GGGGGGdGG" },
    { side: "w", x: 9, y: 13, pattern: "GGdGGGGGG" },
    // HANDOFF 회의실: 뒤 두 면은 나무 판벽, 앞 두 면은 유리
    { side: "n", x: 14, y: 14, pattern: "YYYYYYY" },
    { side: "w", x: 14, y: 14, pattern: "YYYBYYY" },
    { side: "n", x: 14, y: 21, pattern: "GGGGGGG" },
    { side: "w", x: 21, y: 14, pattern: "GGGGGGG" },
  ],
  decor: [
    ...[0, 1, 7, 8, 9, 10, 11, 12, 13, 14, 15, 22, 23, 24, 25].map((x) => ({ side: "n" as const, x, y: 0, sprite: "archWindow" })),
    { side: "n", x: 20, y: 0, sprite: "moss" },
    { side: "w", x: 0, y: 1, sprite: "fern" }, { side: "w", x: 0, y: 3, sprite: "shelf" },
    { side: "w", x: 0, y: 6, sprite: "archWindow" }, { side: "w", x: 0, y: 7, sprite: "archWindow" },
    ...[8, 9, 11, 12].map((y) => ({ side: "w" as const, x: 0, y, sprite: "archWindow" })),
    { side: "w", x: 0, y: 10, sprite: "lantern" },
    { side: "w", x: 0, y: 16, sprite: "lantern" }, { side: "w", x: 0, y: 17, sprite: "exit" },
    { side: "w", x: 0, y: 19, sprite: "lantern" }, { side: "w", x: 0, y: 20, sprite: "macrame" },
    { side: "n", x: 19, y: 14, sprite: "tv" },
    { side: "w", x: 14, y: 15, sprite: "pinboard" }, { side: "w", x: 14, y: 19, sprite: "forestArt" },
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
    // BLOCKED 서재: 아치 책장과 레몬 나무, 둥근 짚 러그 위 푸프
    { sprite: "monstera", x: 0, y: 0 }, { sprite: "archshelf", x: 3, y: 1 }, { sprite: "lemon", x: 4, y: 1 },
    { sprite: "ladder", x: 8, y: 0 }, { sprite: "rugJute", x: 3, y: 4 }, { sprite: "poufs", x: 4, y: 5 },
    { sprite: "lamp", x: 8, y: 7 }, { sprite: "plant", x: 0, y: 7 },
    // WORKING: 헤링본 바닥, 창가 책장·사이드보드, 앞쪽 화단
    { sprite: "monstera", x: 13, y: 0 }, { sprite: "archshelf", x: 16, y: 0 }, { sprite: "archshelf", x: 17, y: 0 },
    { sprite: "sideboard", x: 20, y: 0 }, { sprite: "ladder", x: 24, y: 0 }, { sprite: "printer", x: 25, y: 0 },
    { sprite: "cooler", x: 25, y: 3 }, { sprite: "lemon", x: 25, y: 7 },
    { sprite: "planter", x: 14, y: 7 }, { sprite: "planter", x: 22, y: 7 }, { sprite: "plant", x: 13, y: 7 },
    // 홀: 요정 조명 나무 아트리움, 독서 구석, 카페 코너
    { sprite: "fairytree", x: 10, y: 9 },
    { sprite: "rugMoss", x: 4, y: 10 }, { sprite: "boucle", x: 4, y: 10 }, { sprite: "poufs", x: 5, y: 11 },
    { sprite: "ladder", x: 2, y: 8 }, { sprite: "lamp", x: 0, y: 8 },
    { sprite: "rugLeaf", x: 14, y: 10 }, { sprite: "bench", x: 15, y: 11 }, { sprite: "monstera", x: 23, y: 9 },
    { sprite: "planter", x: 19, y: 12 },
    { sprite: "coffeebar", x: 22, y: 13 }, { sprite: "communal", x: 22, y: 15, flip: true },
    { sprite: "poufs", x: 23, y: 19 }, { sprite: "lemon", x: 23, y: 20 },
    { sprite: "bench", x: 9, y: 18, flip: true }, { sprite: "monstera", x: 13, y: 20 }, { sprite: "planter", x: 17, y: 21 },
    // DONE 로비: 둥근 짚 러그 위 소파·부클레 의자·탁자, 안내 데스크와 코트걸이
    { sprite: "reception", x: 1, y: 14 }, { sprite: "coatrack", x: 0, y: 13 },
    { sprite: "rugJute", x: 3, y: 16 }, { sprite: "sofa", x: 3, y: 17, flip: true }, { sprite: "boucle", x: 4, y: 16 },
    { sprite: "coffee", x: 4, y: 17 }, { sprite: "monstera", x: 8, y: 13 }, { sprite: "lamp", x: 8, y: 21 },
    { sprite: "lemon", x: 2, y: 21 },
    // HANDOFF: 둥근 러그 위 회의 탁자
    { sprite: "rugJute", x: 16, y: 15 }, { sprite: "meeting", x: 16, y: 16 },
    { sprite: "mchair", x: 16, y: 18 }, { sprite: "mchair", x: 17, y: 18 },
    { sprite: "mchairFront", x: 15, y: 16 }, { sprite: "mchairFront", x: 17, y: 15, flip: true },
    { sprite: "monstera", x: 20, y: 14 }, { sprite: "sideboard", x: 15, y: 20 }, { sprite: "plant", x: 20, y: 20 },
  ],
  seats: [
    ...desks.flatMap((entry) => entry.seats),
    { id: "h-1", zone: "handoff", x: 16, y: 18, kind: "desk" },
    { id: "h-2", zone: "handoff", x: 17, y: 18, kind: "desk" },
    { id: "h-3", zone: "handoff", x: 15, y: 16, kind: "lounge" },
    { id: "h-4", zone: "handoff", x: 17, y: 15, kind: "lounge", flip: true },
    { id: "h-5", zone: "handoff", x: 19, y: 17, kind: "stand", view: "back", flip: true },
    { id: "d-sofa1", zone: "done", x: 3, y: 17, kind: "lounge" },
    { id: "d-sofa2", zone: "done", x: 3, y: 18, kind: "lounge" },
    { id: "d-arm", zone: "done", x: 4, y: 16, kind: "lounge", flip: true },
    { id: "d-1", zone: "done", x: 6, y: 15, kind: "stand", view: "front", flip: true },
    { id: "d-2", zone: "done", x: 6, y: 18, kind: "stand", view: "front" },
    { id: "d-3", zone: "done", x: 2, y: 19, kind: "stand", view: "front" },
    { id: "d-4", zone: "done", x: 5, y: 20, kind: "stand", view: "front", flip: true },
    { id: "d-5", zone: "done", x: 7, y: 17, kind: "stand", view: "back", flip: true },
    { id: "d-6", zone: "done", x: 4, y: 21, kind: "stand", view: "back" },
    { id: "d-7", zone: "done", x: 7, y: 20, kind: "stand", view: "front", flip: true },
  ],
  hall: {
    center: [13, 10],
    spawn: [[13, 8], [9, 10], [14, 12], [16, 9], [20, 11], [11, 17], [3, 12], [21, 16]],
    wander: [[8, 9], [13, 9], [9, 12], [17, 12], [19, 9], [21, 11], [2, 10], [11, 15], [11, 19], [21, 18], [15, 21], [7, 12]],
  },
  exit: [0, 17],
  logo: { x: 19, y: 10, text: "RELAY" },
};

export const BIRCH_THEME: Theme = {
  sky: ["#dcefd6", "#f4f0de"],
  glow: "rgba(255, 248, 214, 0.2)",
  slab: ["#7a5a3a", "#5f452c"],
  grid: "rgba(70, 50, 20, 0.07)",
  shade: 0.85,
  sign: "plate",
  logo: "rgba(120, 88, 46, 0.2)",
  ghost: "rgba(70, 110, 80, 0.85)",
  backdrop: "/office/backdrop-birch.webp?v=2",
  drop: "rgba(40, 64, 24, 0.38)",
};
