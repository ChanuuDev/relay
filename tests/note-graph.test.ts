import { describe, expect, test } from "bun:test";
import { buildGraph, mentions, neighbors, similarities, tagsOf, tokenize, wikiTargets, type GraphEdge } from "../src/web/lib/note-graph";
import {
  Simulation, boundsOf, focusLayout, radiusOf, structureLayout, ticksOf, timelineLayout, topicsLayout, type LayoutInput,
} from "../src/web/lib/graph-layout";
import type { Items } from "../src/web/lib/notes";

const base = Date.parse("2026-10-22T09:30:00+09:00");
function items(list: Array<{ id: string; kind?: "folder" | "note"; parentId?: string | null; name?: string; title?: string; body?: string; at?: number }>): Items {
  const out: Items = {};
  list.forEach((entry, index) => {
    const createdAt = base + index, updatedAt = entry.at ?? base + index * 3_600_000;
    out[entry.id] = entry.kind === "folder"
      ? { id: entry.id, kind: "folder", parentId: entry.parentId ?? null, name: entry.name ?? entry.id, position: null, createdAt }
      : { id: entry.id, kind: "note", parentId: entry.parentId ?? null, title: entry.title ?? "", body: entry.body ?? "", position: null, createdAt, updatedAt };
  });
  return out;
}
const SAMPLE = items([
  { id: "f-work", kind: "folder", name: "업무" },
  { id: "f-meet", kind: "folder", parentId: "f-work", name: "회의" },
  { id: "f-life", kind: "folder", name: "생활" },
  { id: "n-plan", parentId: "f-work", title: "출시 계획", body: "[[주간 회의]]에서 정한 일정 #출시 서버 배포 설치 파일" },
  { id: "n-weekly", parentId: "f-meet", title: "주간 회의", body: "서버 배포 순서와 설치 파일 점검 #회의" },
  { id: "n-retro", parentId: "f-meet", title: "회고", body: "주간 회의에서 나온 이야기 #회의" },
  { id: "n-ts", parentId: "f-work", title: "타입스크립트", body: "제네릭 타입 검사 테스트 작성" },
  { id: "n-test", parentId: "f-work", title: "테스트 전략", body: "화면 테스트와 타입 검사 비율, 제네릭" },
  { id: "n-shop", parentId: "f-life", title: "장보기", body: "우유, 달걀" },
  { id: "n-lone", title: "", body: "받은 편지함 정리\n이번 주 안에" },
]);
const edgeOf = (edges: GraphEdge[], kind: GraphEdge["kind"], a: string, b: string) =>
  edges.find((edge) => edge.kind === kind && ((edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)));

describe("메모 그래프: 본문 읽기", () => {
  test("[[제목]]은 별칭·절 표시를 떼고 읽으며 코드 안의 것은 링크가 아니다", () => {
    expect(wikiTargets("[[주간 회의]] 그리고 [[ 회고 |지난 회고]] · [[출시 계획#일정]] [[주간 회의]]")).toEqual(["주간 회의", "회고", "출시 계획"]);
    expect(wikiTargets("`[[코드]]`\n```\n[[블록]]\n```\n[[진짜]]")).toEqual(["진짜"]);
    // 서식 편집기가 저장한 모양(대괄호 이스케이프)도 같은 링크다.
    expect(wikiTargets("앞 \\[\\[주간 회의\\]\\] 뒤 \\[\\[회고|지난 회고\\]\\] \\[\\[snake\\_case\\]\\]")).toEqual(["주간 회의", "회고", "snake_case"]);
  });

  test("#태그는 제목 줄·색 값·숫자·코드를 빼고 처음 쓴 모양으로 한 번씩 읽는다", () => {
    expect(tagsOf("# 제목\n## 둘째 제목\n본문 #출시 준비, (#회의) #Relay #relay #fff #12 #a1b2c3 a#b `#코드` #여행/부산")).toEqual(["출시", "회의", "Relay", "여행/부산"]);
  });

  test("제목 언급은 낱말 처음에서만 찾고, 한국어는 조사가 붙어도 찾는다", () => {
    expect(mentions("주간 회고를 했다", "회고")).toBe(true);
    expect(mentions("주간회고를 했다", "회고")).toBe(false);
    expect(mentions("use the api today", "api")).toBe(true);
    expect(mentions("rapid apis", "api")).toBe(false);
  });

  test("낱말은 조사를 떼고, 주소·ID·비밀번호처럼 숫자와 섞인 덩어리는 버린다", () => {
    const words = tokenize("서버를 배포에서 회의의 회의 https://example.test/x Qwer1234! user@example.test 550e8400-e29b-41d4-a716-446655440000 The Relay app's notes");
    expect(words).toEqual(["서버", "배포", "회의", "회의", "relay", "app"]);
    expect(tokenize("그리고 있는 것 수 메모")).toEqual([]);
  });

  test("유사도는 함께 쓴 낱말이 둘 이상인 쌍만 낸다", () => {
    const vectors = new Map([
      ["a", new Map([["서버", 0.6], ["배포", 0.8]])],
      ["b", new Map([["서버", 0.6], ["배포", 0.8]])],
      ["c", new Map([["서버", 1]])],
    ]);
    const pairs = similarities(vectors);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a", b: "b", shared: 2 });
    expect(pairs[0]!.score).toBeCloseTo(1, 5);
  });
});

describe("메모 그래프: 점과 선", () => {
  const graph = buildGraph(SAMPLE);

  test("메모·폴더·태그가 점이 되고 색 묶음은 최상위 폴더다", () => {
    expect(graph.nodes.filter((node) => node.kind === "note")).toHaveLength(7);
    expect(graph.nodes.filter((node) => node.kind === "folder").map((node) => node.id).sort()).toEqual(["f-life", "f-meet", "f-work"]);
    expect(graph.nodes.filter((node) => node.kind === "tag").map((node) => node.label)).toEqual(["#회의", "#출시"]);
    expect(graph.byId.get("n-retro")!.group).toBe("f-work");
    expect(graph.byId.get("n-lone")!.group).toBe("group:root");
    expect(graph.byId.get("n-lone")!.label).toBe("받은 편지함 정리");
    expect(graph.byId.get("f-work")!.count).toBe(5);
    expect(graph.groups.map((group) => group.label)).toEqual(["생활", "업무", "최상위", "태그"]);
  });

  test("링크·언급·태그·폴더·비슷한 내용으로 잇고, 같은 쌍은 더 강한 관계 하나만 남긴다", () => {
    const { edges } = graph;
    const link = edgeOf(edges, "link", "n-plan", "n-weekly")!;
    expect(link).toMatchObject({ source: "n-plan", target: "n-weekly" });
    expect(edgeOf(edges, "mention", "n-retro", "n-weekly")).toBeTruthy();
    expect(edgeOf(edges, "tag", "n-retro", "tag:회의")).toBeTruthy();
    expect(edgeOf(edges, "folder", "f-meet", "n-weekly")).toBeTruthy();
    expect(edgeOf(edges, "folder", "f-work", "f-meet")).toBeTruthy();
    expect(edgeOf(edges, "similar", "n-ts", "n-test")).toBeTruthy();
    // 출시 계획과 주간 회의는 내용도 비슷하지만 이미 링크로 이어져 있다.
    expect(edgeOf(edges, "similar", "n-plan", "n-weekly")).toBeUndefined();
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
    expect(neighbors(graph).get("n-lone")).toBeUndefined();
  });

  test("메모·폴더 ID를 본문에 적어도 링크가 된다", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const graph = buildGraph(items([{ id, title: "대상" }, { id: "n-ref", title: "참조", body: `Relay 메모를 참조해 주세요. 메모 ID: ${id}` }]));
    expect(edgeOf(graph.edges, "link", "n-ref", id)).toMatchObject({ source: "n-ref", target: id });
  });

  test("주제 묶음은 내용이 이어진 메모끼리 모이고, 홀로 남은 메모는 따로 모이며, 늘 같은 결과다", () => {
    const clusters = graph.clusters;
    const of = (id: string) => clusters.find((cluster) => cluster.members.includes(id))!.id;
    expect(of("n-ts")).toBe(of("n-test"));
    expect(of("n-weekly")).toBe(of("n-retro"));
    expect(of("n-ts")).not.toBe(of("n-weekly"));
    expect(clusters[clusters.length - 1]).toMatchObject({ id: "cluster:lonely", label: "연결 없는 메모" });
    expect(clusters[clusters.length - 1]!.members).toContain("n-lone");
    expect(buildGraph(SAMPLE).clusters).toEqual(clusters);
  });

  test("메모가 없으면 빈 그래프다", () => {
    expect(buildGraph({})).toMatchObject({ nodes: [], edges: [], groups: [], clusters: [] });
  });
});

describe("메모 그래프: 배치", () => {
  const graph = buildGraph(SAMPLE);
  const degree = new Map<string, number>();
  for (const edge of graph.edges) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const input: LayoutInput = { nodes: graph.nodes, edges: graph.edges, degree, groups: graph.groups, clusters: graph.clusters, timeZone: "Asia/Seoul" };
  const finite = (positions: Map<string, { x: number; y: number }>) => [...positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  test("힘 시뮬레이션은 NaN 없이 가라앉고, 이어진 점은 서로 가깝다", () => {
    const sim = Simulation.from(graph.nodes, graph.edges, degree, new Map()).run(0.01, 600);
    expect(sim.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    const at = (id: string) => sim.index.get(id)!;
    const d = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    expect(d("n-retro", "f-meet")).toBeLessThan(d("n-retro", "n-shop"));
    // 많은 점은 Barnes–Hut 근사로 민다.
    const many = buildGraph(items(Array.from({ length: 320 }, (_, index) => ({ id: `n${index}`, title: `메모 ${index}`, body: index % 2 ? "서버 배포 설치" : "디자인 색 대비" }))));
    const big = Simulation.from(many.nodes, many.edges, new Map(), new Map()).run(0.05, 120);
    expect(big.nodes.every((node) => Number.isFinite(node.x))).toBe(true);
  });

  test("집중: 가운데 메모가 (0,0)이고 이웃은 1단계, 이웃의 이웃은 2단계 고리에 놓인다", () => {
    const layout = focusLayout({ ...input, focus: "n-weekly" });
    expect(layout.center).toBe("n-weekly");
    expect(layout.positions.get("n-weekly")).toEqual({ x: 0, y: 0 });
    const r = (id: string) => Math.hypot(layout.positions.get(id)!.x, layout.positions.get(id)!.y);
    expect(r("n-plan")).toBeCloseTo(r("n-retro"), 5);
    if (layout.decor.kind !== "rings") throw new Error("rings");
    expect(r("n-plan")).toBeCloseTo(layout.decor.rings[0]!.r, 5);
    expect(layout.hidden.has("n-lone")).toBe(true);
    expect(focusLayout({ ...input, focus: null }).center).toBeTruthy();
  });

  test("구조: 메모는 모두 바깥 고리, 하위가 있는 폴더는 안쪽 고리에 놓이고 태그는 숨는다", () => {
    const layout = structureLayout(input);
    if (layout.decor.kind !== "tree") throw new Error("tree");
    const outer = layout.decor.outer;
    for (const node of graph.nodes.filter((entry) => entry.kind === "note")) {
      const p = layout.positions.get(node.id)!;
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(outer, 5);
      expect(layout.labelAngle.has(node.id)).toBe(true);
    }
    const work = layout.positions.get("f-work")!;
    expect(Math.hypot(work.x, work.y)).toBeLessThan(outer);
    expect(layout.hidden.has("tag:회의")).toBe(true);
    expect(layout.decor.sectors.map((sector) => sector.label)).toEqual(["생활", "업무", "최상위"]);
  });

  test("주제: 거품끼리 겹치지 않고 메모는 제 거품 안에 놓인다", () => {
    const layout = topicsLayout(input);
    if (layout.decor.kind !== "bubbles") throw new Error("bubbles");
    const bubbles = layout.decor.bubbles;
    for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
      expect(Math.hypot(bubbles[i]!.x - bubbles[j]!.x, bubbles[i]!.y - bubbles[j]!.y)).toBeGreaterThanOrEqual(bubbles[i]!.r + bubbles[j]!.r);
    }
    for (const cluster of graph.clusters) {
      const bubble = bubbles.find((entry) => entry.id === cluster.id)!;
      for (const id of cluster.members) {
        const p = layout.positions.get(id)!;
        expect(Math.hypot(p.x - bubble.x, p.y - bubble.y)).toBeLessThan(bubble.r);
      }
    }
    expect(layout.hidden.has("f-work")).toBe(true);
    expect(finite(layout.positions)).toBe(true);
  });

  test("시간: 고친 순서대로 왼쪽에서 오른쪽, 최상위 폴더마다 한 줄이고 눈금은 날짜다", () => {
    const layout = timelineLayout(input);
    if (layout.decor.kind !== "lanes") throw new Error("lanes");
    const notes = graph.nodes.filter((node) => node.kind === "note").sort((a, b) => a.updatedAt - b.updatedAt);
    const xs = notes.map((note) => layout.positions.get(note.id)!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(layout.decor.lanes.map((lane) => lane.label)).toEqual(["생활", "업무", "최상위"]);
    const lane = layout.decor.lanes.find((entry) => entry.group === "f-work")!;
    expect(Math.abs(layout.positions.get("n-retro")!.y - lane.y)).toBeLessThanOrEqual(lane.height / 2);
    expect(layout.decor.ticks.length).toBeGreaterThan(0);
    expect(layout.decor.ticks[0]!.label).toMatch(/시|일|월/);
  });

  test("눈금은 기간에 따라 단위를 고르고 서로 84px 넘게 떨어진다", () => {
    const day = 86_400_000;
    const linear = (t0: number, t1: number) => (t: number) => ((t - t0) / (t1 - t0)) * 1000;
    const days = ticksOf(base, base + 10 * day, linear(base, base + 10 * day), "Asia/Seoul");
    expect(days.every((tick) => /\d+월 \d+일/.test(tick.label))).toBe(true);
    for (let i = 1; i < days.length; i++) expect(days[i]!.x - days[i - 1]!.x).toBeGreaterThanOrEqual(84);
    const months = ticksOf(base, base + 300 * day, linear(base, base + 300 * day), "Asia/Seoul");
    expect(months.some((tick) => /월/.test(tick.label))).toBe(true);
    expect(ticksOf(base, base, () => 0, "Asia/Seoul")).toHaveLength(1);
  });

  test("점 크기는 연결이 많을수록 크고, 맞출 범위는 점과 장식을 모두 담는다", () => {
    const note = graph.byId.get("n-weekly")!;
    expect(radiusOf(note, 6)).toBeGreaterThan(radiusOf(note, 0));
    const layout = structureLayout(input);
    const bounds = boundsOf(layout);
    if (layout.decor.kind !== "tree") throw new Error("tree");
    expect(bounds.x1 - bounds.x0).toBeGreaterThan(layout.decor.outer * 2);
  });
});
