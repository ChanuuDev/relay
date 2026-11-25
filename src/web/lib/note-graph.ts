import { labelOf as coreLabel, plainLine } from "@relay/core";
import type { Item, Items, Note } from "./notes";

/** 메모 지식 그래프. 메모·폴더·태그가 점(node)이고, 둘 사이의 관계가 선(edge)이다. 이 파일은 화면과 무관한 계산만 한다(단위 테스트 대상).
 *
 *  선의 종류
 *  - link: 본문의 `[[제목]]`(옵시디언식 위키 링크)이나 메모·폴더 ID 참조. 방향이 있다(쓴 메모 → 가리킨 메모).
 *  - mention: 다른 메모의 제목이 본문에 그대로 나온다(링크로 걸지 않은 언급).
 *  - similar: 두 메모가 드문 낱말을 여럿 함께 쓴다(TF-IDF 코사인 유사도). 메모마다 가장 가까운 몇 개만 잇는다.
 *  - folder: 메모·폴더와 그것을 담은 폴더.
 *  - tag: 메모와 본문의 `#태그`. */
export type GraphNodeKind = "note" | "folder" | "tag";
export type EdgeKind = "link" | "mention" | "similar" | "folder" | "tag";
export const EDGE_KINDS: readonly EdgeKind[] = ["link", "mention", "similar", "folder", "tag"];

export type GraphNode = {
  id: string; kind: GraphNodeKind; label: string;
  /** 색을 가르는 묶음: 최상위 폴더 ID, 최상위 메모는 ROOT_GROUP, 태그는 TAG_GROUP. */
  group: string;
  /** 담은 폴더(태그는 null). */
  parentId: string | null;
  /** 폴더 깊이(최상위 0). 태그는 0. */
  depth: number;
  /** 메모 본문 길이(점 크기에 조금 보탠다). */
  size: number;
  createdAt: number; updatedAt: number;
  /** 이 메모를 대표하는 낱말(드문 순). 메모가 아니면 빈 목록. */
  keywords: string[];
  /** 태그면 그 태그를 쓴 메모 수, 폴더면 하위 메모 수. */
  count: number;
};
export type GraphEdge = { id: string; source: string; target: string; kind: EdgeKind; /** 0..1, 유사도는 그 값 */ weight: number };
export type GraphGroup = { id: string; label: string; index: number };
/** 내용으로 묶은 주제. label은 대표 낱말 몇 개, members는 메모 ID(중심이 되는 메모부터). */
export type GraphCluster = { id: string; label: string; keywords: string[]; members: string[] };
export type NoteGraph = { nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[]; clusters: GraphCluster[]; byId: Map<string, GraphNode> };

export const ROOT_GROUP = "group:root";
export const TAG_GROUP = "group:tag";
export const tagId = (name: string) => `tag:${name.toLocaleLowerCase("ko-KR")}`;

const labelOf = (item: Item) => coreLabel(item);
/** 그래프에 쓸 짧은 이름. 제목이 없으면 본문 첫 줄을 쓰고 길면 줄인다. */
export function shortLabel(item: Item, max = 28) {
  const label = labelOf(item).trim() || (item.kind === "folder" ? "폴더" : "빈 메모");
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

// ── 본문 읽기 ─────────────────────────────────────────────

const FENCE = /^(\s*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\S\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
const IMAGE_PATH = /\/api\/v1\/notes\/images\/[0-9a-f]{64}/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** `[[제목]]`, `[[제목|보일 이름]]`, `[[제목#절]]`. 서식 편집기는 대괄호를 `\[\[제목\]\]`로 저장하므로 앞의 역슬래시도 받는다. */
const WIKI = /\\?\[\\?\[((?:\\[^[\]]|[^[\]|#\n\\])+)(?:#[^\]|\n]*?)?(?:\|[^\]\n]*?)?\\?\]\\?\]/g;
/** Markdown 이스케이프(`\_`, `\*` 등)를 푼다. */
const unescapeMarkdown = (text: string) => text.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1");
/** 줄 처음이나 빈칸·여는 괄호 뒤의 #낱말. 제목(# 제목)·색 값(#fff)·숫자(#12)는 태그가 아니다. */
const TAG = /(^|[\s(（[{,，])#([\p{L}_][\p{L}\p{N}_/-]{0,39})/gmu;
const HEX_COLOR = /^[0-9a-f]{3,8}$/i;

/** 코드 블록·인라인 코드를 뺀 본문(링크·태그를 코드에서 찾지 않는다). */
const prose = (body: string) => body.replace(FENCE, "\n").replace(INLINE_CODE, " ");

/** 본문의 `[[…]]` 대상 이름들(앞뒤 빈칸 정리, 중복 제거). */
export function wikiTargets(body: string): string[] {
  const found = new Set<string>();
  for (const match of prose(body).matchAll(WIKI)) { const name = unescapeMarkdown(match[1]!).trim(); if (name) found.add(name); }
  return [...found];
}

/** 본문의 #태그들(소문자 기준 중복 제거, 처음 쓴 모양을 남긴다). 마크다운 제목 줄의 #은 태그가 아니다. */
export function tagsOf(body: string): string[] {
  const found = new Map<string, string>();
  const text = prose(body).split("\n").filter((line) => !/^\s{0,3}#{1,6}\s/.test(line)).join("\n");
  for (const match of text.matchAll(TAG)) {
    const name = match[2]!.replace(/[/-]+$/, "");
    if (!name || HEX_COLOR.test(name)) continue;
    const key = name.toLocaleLowerCase("ko-KR");
    if (!found.has(key)) found.set(key, name);
  }
  return [...found.values()];
}

const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
const isWordChar = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));

/** title이 text에 낱말 처음부터 나오는가. 한국어는 조사가 붙으므로 뒤쪽 경계는 보지 않고 앞쪽만 본다(「회고」가 「회고를」에는 걸리고 「주간회고」에는 안 걸린다). */
export function mentions(text: string, title: string) {
  if (!title) return false;
  for (let at = text.indexOf(title); at !== -1; at = text.indexOf(title, at + 1)) {
    if (!isWordChar(text[at - 1])) {
      // 영문·숫자 제목은 뒤도 낱말 경계여야 한다(「api」가 「apis」에 걸리지 않게).
      const last = title[title.length - 1]!;
      if (!/[a-z0-9]/i.test(last) || !/[a-z0-9]/i.test(text[at + title.length] ?? "")) return true;
    }
  }
  return false;
}

// ── 낱말과 유사도 ─────────────────────────────────────────

/** 한 글자 조사는 남는 말이 두 글자 이상일 때만 뗀다(「회의」의 「의」는 떼지 않는다). 긴 것부터 본다. */
const JOSA = [
  "에서부터", "으로부터", "이라고는", "에게서", "이라고", "이라는", "에서는", "으로는", "까지는", "부터는", "에서도", "으로도", "이었다", "였다",
  "입니다", "합니다", "됩니다", "습니다", "에서", "에게", "한테", "께서", "으로", "까지", "부터", "처럼", "보다", "마다", "조차", "밖에", "이나", "이란", "이랑",
  "하고", "라고", "라는", "이며", "이고", "이다", "했다", "한다", "하는", "하기", "하여", "해서", "하면", "했던", "되는", "된다", "되어", "되면", "에는", "에도",
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만", "랑", "요",
].sort((a, b) => b.length - a.length);
const STOP_KO = new Set([
  "그리고", "그러나", "하지만", "그래서", "또한", "그런데", "따라서", "그러면", "있는", "없는", "있다", "없다", "하다", "했다", "한다", "있습니다", "없습니다",
  "같은", "같다", "이런", "저런", "그런", "이것", "그것", "저것", "여기", "거기", "우리", "저희", "너무", "매우", "정말", "아주", "조금", "많이", "가장", "모든",
  "각각", "다른", "통해", "위해", "대한", "대해", "관련", "경우", "때문", "정도", "이후", "이전", "다음", "지금", "오늘", "내일", "어제", "부분", "내용",
  "해당", "기준", "현재", "이상", "이하", "하나", "그냥", "모두", "어떤", "무엇", "어떻게", "언제", "어디", "누가", "왜냐하면", "만약", "혹은", "또는",
  "메모", "정리", "이번", "저번", "다시", "아직", "이미", "계속", "바로", "먼저", "나중", "때문에", "있음", "없음", "함", "됨", "것", "수", "등", "및", "중", "후", "전",
]);
const STOP_EN = new Set(("the and for with that this from are was were you your not but have has had can will would should could into onto about over under "
  + "than then them they their there here what when where which while who whom why how all any each few more most other some such only own same too very "
  + "just also been being does did doing done its it's our ours out off again once both between through during before after above below further "
  + "http https www com org net html htm png jpg jpeg gif svg pdf api notes images true false null undefined").split(" "));
/** 낱말로 보지 않는 덩어리: 글자와 숫자가 섞인 것(비밀번호·ID·버전)이나 기호가 여럿 들어간 것. 키워드로 드러나지 않게 미리 거른다. */
const NOT_WORDISH = /(?=.*\p{L})(?=.*\p{N})|[!@#$%^&*=+~|\\<>{}]{2,}|[@:]\S/u;

/** 본문에서 낱말을 뽑는다. 한글은 조사를 떼고 두 글자 이상, 영문은 세 글자 이상(소문자). 주소·코드 주소·ID·비밀번호 같은 덩어리는 버린다. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const clean = text.replace(IMAGE_PATH, " ").replace(URL_LIKE, " ").replace(UUID, " ").replace(/\S+@\S+\.\S+/g, " ");
  for (const raw of clean.split(/\s+/)) {
    if (!raw || raw.length > 60 || NOT_WORDISH.test(raw)) continue;
    for (const match of raw.matchAll(/\p{Script=Hangul}+|\p{Script=Han}+|[A-Za-z][A-Za-z'’-]*[A-Za-z]/gu)) {
      let word = match[0];
      if (/\p{Script=Hangul}/u.test(word)) {
        for (const josa of JOSA) if (word.length - josa.length >= 2 && word.endsWith(josa)) { word = word.slice(0, -josa.length); break; }
        if (word.length < 2 || word.length > 12 || STOP_KO.has(word)) continue;
        out.push(word);
      } else if (/\p{Script=Han}/u.test(word)) {
        if (word.length >= 2 && word.length <= 8) out.push(word);
      } else {
        word = word.toLowerCase().replace(/['’]s$/, "");
        if (word.length < 3 || word.length > 24 || STOP_EN.has(word)) continue;
        out.push(word);
      }
    }
  }
  return out;
}

type Vector = Map<string, number>;
/** 메모마다 낱말 가중치(TF-IDF, 크기 1로 맞춤)와 대표 낱말. 제목 낱말은 세 배로 센다. 너무 흔한 낱말(메모 절반 넘게)은 뺀다. */
function weigh(notes: Note[]): { vectors: Map<string, Vector>; keywords: Map<string, string[]> } {
  const counts = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const note of notes) {
    const terms = new Map<string, number>();
    const add = (word: string, by: number) => terms.set(word, (terms.get(word) ?? 0) + by);
    for (const word of tokenize(note.title)) add(word, 3);
    for (const word of tokenize(prose(note.body).split("\n").map(plainLine).join("\n"))) add(word, 1);
    counts.set(note.id, terms);
    for (const word of terms.keys()) df.set(word, (df.get(word) ?? 0) + 1);
  }
  const total = notes.length;
  const common = Math.max(2, total * 0.5);
  const vectors = new Map<string, Vector>();
  const keywords = new Map<string, string[]>();
  for (const [id, terms] of counts) {
    const scored: Array<[string, number]> = [];
    for (const [word, count] of terms) {
      const seen = df.get(word)!;
      if (total > 3 && seen > common) continue;
      scored.push([word, (1 + Math.log(count)) * (Math.log((1 + total) / (1 + seen)) + 1)]);
    }
    scored.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    keywords.set(id, scored.slice(0, 6).map(([word]) => word));
    // 유사도에는 둘 이상이 함께 쓴 낱말만 쓰고, 메모마다 무게가 큰 32개까지만 본다(긴 메모가 모두와 닮아 보이지 않게).
    const shared = scored.filter(([word]) => (df.get(word) ?? 0) >= 2).slice(0, 32);
    const norm = Math.hypot(...shared.map(([, value]) => value)) || 1;
    vectors.set(id, new Map(shared.map(([word, value]) => [word, value / norm])));
  }
  return { vectors, keywords };
}

/** 메모 쌍의 코사인 유사도. 낱말별 목록(역색인)으로 함께 쓴 낱말이 있는 쌍만 본다. 함께 쓴 낱말이 minShared개 미만이면 뺀다. */
export function similarities(vectors: Map<string, Vector>, minShared = 2) {
  const postings = new Map<string, Array<[string, number]>>();
  for (const [id, vector] of vectors) for (const [word, value] of vector) {
    const list = postings.get(word);
    if (list) list.push([id, value]); else postings.set(word, [[id, value]]);
  }
  const pairs = new Map<string, { a: string; b: string; score: number; shared: number }>();
  for (const list of postings.values()) {
    if (list.length > 80) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, va] = list[i]!, [b, vb] = list[j]!;
      const [x, y] = a < b ? [a, b] : [b, a];
      const key = `${x}\n${y}`;
      const pair = pairs.get(key);
      if (pair) { pair.score += va * vb; pair.shared++; } else pairs.set(key, { a: x, b: y, score: va * vb, shared: 1 });
    }
  }
  return [...pairs.values()].filter((pair) => pair.shared >= minShared);
}

// ── 그래프 만들기 ─────────────────────────────────────────

export type BuildOptions = { /** 메모마다 잇는 비슷한 메모 수 */ similarPerNote?: number; /** 이보다 낮은 유사도는 잇지 않는다 */ minSimilarity?: number };

export function buildGraph(items: Items, options: BuildOptions = {}): NoteGraph {
  const { similarPerNote = 3, minSimilarity = 0.16 } = options;
  const all = Object.values(items);
  const notes = all.filter((item): item is Note => item.kind === "note").sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const folders = all.filter((item) => item.kind === "folder").sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  // 최상위 폴더가 색 묶음이 된다(트리에 보이는 순서와 같게 position, 이름 순).
  const topOf = (item: Item) => {
    let current: Item = item;
    for (let guard = 0; current.parentId && guard < 1000; guard++) {
      const parent = items[current.parentId];
      if (parent?.kind !== "folder") break;
      current = parent;
    }
    return current.kind === "folder" ? current.id : ROOT_GROUP;
  };
  const depthOf = (item: Item) => { let depth = 0; for (let id = item.parentId; id && items[id] && depth < 1000; id = items[id]!.parentId) depth++; return depth; };
  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  const tops = folders.filter((folder) => folder.parentId === null || items[folder.parentId]?.kind !== "folder")
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || collator.compare(labelOf(a), labelOf(b)));
  const groups: GraphGroup[] = tops.map((folder, index) => ({ id: folder.id, label: labelOf(folder), index }));
  if (notes.some((note) => topOf(note) === ROOT_GROUP)) groups.push({ id: ROOT_GROUP, label: "최상위", index: groups.length });

  const { vectors, keywords } = weigh(notes);
  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();
  const push = (node: GraphNode) => { nodes.push(node); byId.set(node.id, node); };
  const folderNotes = new Map<string, number>();
  for (const note of notes) for (let id = note.parentId; id && items[id]?.kind === "folder"; id = items[id]!.parentId) folderNotes.set(id, (folderNotes.get(id) ?? 0) + 1);
  for (const folder of folders) push({
    id: folder.id, kind: "folder", label: shortLabel(folder), group: topOf(folder), parentId: folder.parentId && items[folder.parentId]?.kind === "folder" ? folder.parentId : null,
    depth: depthOf(folder), size: 0, createdAt: folder.createdAt, updatedAt: folder.createdAt, keywords: [], count: folderNotes.get(folder.id) ?? 0,
  });
  for (const note of notes) push({
    id: note.id, kind: "note", label: shortLabel(note), group: topOf(note), parentId: note.parentId && items[note.parentId]?.kind === "folder" ? note.parentId : null,
    depth: depthOf(note), size: note.body.length, createdAt: note.createdAt, updatedAt: note.updatedAt, keywords: keywords.get(note.id) ?? [], count: 0,
  });

  const edges: GraphEdge[] = [];
  const linked = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const addEdge = (source: string, target: string, kind: EdgeKind, weight = 1) => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    const id = `${kind}:${source}:${target}`;
    if (kind !== "folder" && kind !== "tag") {
      const key = pairKey(source, target);
      if (linked.has(key)) return;
      linked.add(key);
    }
    edges.push({ id, source, target, kind, weight });
  };

  // 폴더 구조.
  for (const node of nodes) if (node.parentId && byId.get(node.parentId)?.kind === "folder") addEdge(node.parentId, node.id, "folder");

  // 위키 링크와 ID 참조(가장 강한 연결이라 먼저 단다).
  const titleIndex = new Map<string, string>();
  for (const note of notes) {
    for (const name of [note.title, labelOf(note)]) {
      const key = normalize(name);
      if (key && !titleIndex.has(key)) titleIndex.set(key, note.id);
    }
  }
  for (const folder of folders) { const key = normalize(labelOf(folder)); if (key && !titleIndex.has(key)) titleIndex.set(key, folder.id); }
  for (const note of notes) {
    for (const name of wikiTargets(note.body)) { const target = titleIndex.get(normalize(name)); if (target) addEdge(note.id, target, "link"); }
    for (const match of note.body.matchAll(UUID)) { const target = match[0].toLowerCase(); const hit = byId.has(target) ? target : byId.has(match[0]) ? match[0] : null; if (hit) addEdge(note.id, hit, "link"); }
  }

  // 제목 언급. 두 글자 이상 제목만, 같은 제목이 여럿이면 쓰지 않는다(어느 메모인지 모른다).
  const titles = new Map<string, string[]>();
  for (const note of notes) {
    const title = normalize(note.title);
    if (title.length < 2 || /^\d+$/.test(title)) continue;
    titles.set(title, [...(titles.get(title) ?? []), note.id]);
  }
  const plain = new Map(notes.map((note) => [note.id, normalize(prose(note.body))]));
  for (const note of notes) {
    const text = plain.get(note.id)!;
    for (const [title, ids] of titles) if (ids.length === 1 && ids[0] !== note.id && mentions(text, title)) addEdge(note.id, ids[0]!, "mention", 0.8);
  }

  // 태그.
  const tagNotes = new Map<string, { name: string; notes: string[] }>();
  for (const note of notes) for (const name of tagsOf(note.body)) {
    const id = tagId(name);
    const entry = tagNotes.get(id);
    if (entry) entry.notes.push(note.id); else tagNotes.set(id, { name, notes: [note.id] });
  }
  for (const [id, { name, notes: members }] of [...tagNotes].sort((a, b) => b[1].notes.length - a[1].notes.length || collator.compare(a[1].name, b[1].name))) {
    push({ id, kind: "tag", label: `#${name}`, group: TAG_GROUP, parentId: null, depth: 0, size: 0, createdAt: 0, updatedAt: 0, keywords: [], count: members.length });
    for (const member of members) addEdge(member, id, "tag", 0.6);
  }
  if (tagNotes.size) groups.push({ id: TAG_GROUP, label: "태그", index: groups.length });

  // 비슷한 내용: 메모마다 가장 가까운 몇 개(서로 이미 이어졌으면 건너뛴다).
  const best = new Map<string, Array<{ other: string; score: number }>>();
  for (const pair of similarities(vectors)) {
    if (pair.score < minSimilarity) continue;
    best.set(pair.a, [...(best.get(pair.a) ?? []), { other: pair.b, score: pair.score }]);
    best.set(pair.b, [...(best.get(pair.b) ?? []), { other: pair.a, score: pair.score }]);
  }
  const chosen: Array<{ a: string; b: string; score: number }> = [];
  for (const [id, list] of best) {
    list.sort((x, y) => y.score - x.score || (x.other < y.other ? -1 : 1));
    for (const { other, score } of list.slice(0, similarPerNote)) if (id < other || !best.get(other)?.slice(0, similarPerNote).some((entry) => entry.other === id)) chosen.push({ a: id, b: other, score });
  }
  chosen.sort((x, y) => y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1));
  for (const { a, b, score } of chosen) addEdge(a, b, "similar", Math.min(1, score));

  const graph: NoteGraph = { nodes, edges, groups, clusters: [], byId };
  graph.clusters = clustersOf(graph, keywords);
  return graph;
}

/** 이웃(방향 무시). kinds를 주면 그 종류의 선만 본다. */
export function neighbors(graph: Pick<NoteGraph, "edges">, kinds?: ReadonlySet<EdgeKind>) {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { const set = map.get(a); if (set) set.add(b); else map.set(a, new Set([b])); };
  for (const edge of graph.edges) if (!kinds || kinds.has(edge.kind)) { add(edge.source, edge.target); add(edge.target, edge.source); }
  return map;
}

/** 주제 묶음: 메모끼리의 선(링크·언급·비슷함, 같은 태그)에 무게를 주어 이웃의 묶음을 따라가는 방식(label propagation)으로 나눈다.
 *  홀로 남은 메모는 「연결 없는 메모」 한 묶음이 된다. 결과는 항상 같다(정렬된 순서로만 돈다). */
export function clustersOf(graph: Pick<NoteGraph, "nodes" | "edges">, keywords: Map<string, string[]>): GraphCluster[] {
  const notes = graph.nodes.filter((node) => node.kind === "note").map((node) => node.id).sort();
  if (!notes.length) return [];
  const isNote = new Set(notes);
  const weights = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, weight: number) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const map = weights.get(x) ?? new Map<string, number>();
      map.set(y, (map.get(y) ?? 0) + weight);
      weights.set(x, map);
    }
  };
  const tagMembers = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === "tag") { tagMembers.set(edge.target, [...(tagMembers.get(edge.target) ?? []), edge.source]); continue; }
    if (edge.kind === "folder" || !isNote.has(edge.source) || !isNote.has(edge.target)) continue;
    link(edge.source, edge.target, edge.kind === "link" ? 1 : edge.kind === "mention" ? 0.8 : 0.5 + edge.weight);
  }
  for (const members of tagMembers.values()) if (members.length <= 12) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) link(members[i]!, members[j]!, 0.6);

  const label = new Map(notes.map((id) => [id, id]));
  for (let round = 0; round < 20; round++) {
    let changed = false;
    for (const id of notes) {
      const around = weights.get(id);
      if (!around) continue;
      const score = new Map<string, number>();
      for (const [other, weight] of around) score.set(label.get(other)!, (score.get(label.get(other)!) ?? 0) + weight);
      // 자기 묶음에도 조금 머무르려는 힘을 주어 두 묶음 사이를 오가지 않게 한다.
      score.set(label.get(id)!, (score.get(label.get(id)!) ?? 0) + 0.05);
      let pick = label.get(id)!, top = -1;
      for (const [candidate, value] of [...score].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (value > top + 1e-9) { top = value; pick = candidate; }
      if (pick !== label.get(id)) { label.set(id, pick); changed = true; }
    }
    if (!changed) break;
  }

  const groups = new Map<string, string[]>();
  for (const id of notes) groups.set(label.get(id)!, [...(groups.get(label.get(id)!) ?? []), id]);
  const degree = (id: string) => [...(weights.get(id)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const lonely: string[] = [];
  const clusters: GraphCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) { lonely.push(...members); continue; }
    members.sort((a, b) => degree(b) - degree(a) || (a < b ? -1 : 1));
    const tally = new Map<string, number>();
    for (const id of members) (keywords.get(id) ?? []).forEach((word, rank) => tally.set(word, (tally.get(word) ?? 0) + (6 - rank)));
    // 묶음의 여러 메모가 함께 쓰는 낱말을 앞세운다.
    const shared = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([word]) => word);
    const words = shared.slice(0, 3);
    clusters.push({ id: `cluster:${members[0]}`, label: words.length ? words.join(" · ") : "주제", keywords: words, members });
  }
  clusters.sort((a, b) => b.members.length - a.members.length || (a.id < b.id ? -1 : 1));
  if (lonely.length) clusters.push({ id: "cluster:lonely", label: "연결 없는 메모", keywords: [], members: lonely.sort() });
  return clusters;
}
