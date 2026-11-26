import { JOSA, labelOf as coreLabel, plainLine, prose, tagsOf, tokenize, type LinkItem } from "@relay/core";
import type { Item, Items, Note } from "./notes";

/** 메모 지식 그래프. 메모·폴더·태그가 점(node)이고, 둘 사이의 관계가 선(edge)이다. 이 파일은 화면과 무관한 계산만 한다(단위 테스트 대상).
 *  화면(메모 그래프)과 CLI(`relay graph`)가 같은 계산을 쓴다.
 *
 *  선의 종류
 *  - link: 본문의 `[[제목]]`(옵시디언식 위키 링크)이나 메모·폴더 ID 참조. 방향이 있다(쓴 메모 → 가리킨 메모).
 *  - mention: 다른 메모의 제목이 본문에 그대로 나온다(링크로 걸지 않은 언급).
 *  - similar: 두 메모가 드문 낱말을 여럿 함께 쓴다(TF-IDF 코사인 유사도). 메모마다 가장 가까운 몇 개만 잇는다.
 *  - folder: 메모·폴더와 그것을 담은 폴더. 작업 세션과 그 세션이 돈 프로젝트(작업 폴더)도 이 선으로 잇는다.
 *  - tag: 메모와 본문의 `#태그`.
 *  - chain: 이어받은 작업 세션과 그 앞 세션(relay continue).
 *  - semantic: 임베딩으로 잰 뜻의 가까움. 낱말이 달라도 같은 이야기를 하는 메모를 잇는다(의미 색인이 있을 때만).
 *
 *  작업 세션(에이전트가 Relay에 남긴 기록)은 둘째 층이다. 세션 요약이 메모 ID·`[[제목]]`을 적었거나 메모가 세션 ID를 적었으면 link,
 *  메모 제목이 요약에 나오면 mention, 드문 낱말을 함께 쓰면 similar로 메모 층과 이어진다. 이 선들이 두 층의 접점이다. */
export type GraphNodeKind = "note" | "folder" | "tag" | "session" | "project";
export type EdgeKind = "link" | "mention" | "similar" | "folder" | "tag" | "chain" | "semantic";
export const EDGE_KINDS: readonly EdgeKind[] = ["link", "mention", "similar", "folder", "tag", "chain", "semantic"];
/** 글이 있는 점(메모·작업 세션). 주제 묶음·맥락 고르기의 대상이다. */
export const isDoc = (node: Pick<GraphNode, "kind">) => node.kind === "note" || node.kind === "session";
/** 다른 점을 담는 점(폴더·프로젝트). */
export const isContainer = (node: Pick<GraphNode, "kind">) => node.kind === "folder" || node.kind === "project";

export type GraphNode = {
  id: string; kind: GraphNodeKind; label: string;
  /** 색을 가르는 묶음: 최상위 폴더 ID, 최상위 메모는 ROOT_GROUP, 태그는 TAG_GROUP, 작업 세션과 프로젝트는 SESSION_GROUP. */
  group: string;
  /** 담은 폴더(태그는 null). 작업 세션은 프로젝트 점. */
  parentId: string | null;
  /** 폴더 깊이(최상위 0). 태그는 0. */
  depth: number;
  /** 메모 본문 길이(점 크기에 조금 보탠다). */
  size: number;
  createdAt: number; updatedAt: number;
  /** 이 메모를 대표하는 낱말(드문 순). 메모가 아니면 빈 목록. */
  keywords: string[];
  /** 태그면 그 태그를 쓴 메모 수, 폴더면 하위 메모 수, 프로젝트면 그래프에 든 세션 수. */
  count: number;
};
export type GraphEdge = { id: string; source: string; target: string; kind: EdgeKind; /** 0..1, 유사도는 그 값 */ weight: number };
export type GraphGroup = { id: string; label: string; index: number };
/** 내용으로 묶은 주제. label은 대표 낱말 몇 개, members는 메모 ID(중심이 되는 메모부터). */
export type GraphCluster = { id: string; label: string; keywords: string[]; members: string[] };
/** 낱말 무게(TF-IDF, 크기 1). 유사도 계산에 쓴다. */
export type Vector = Map<string, number>;
/** 그래프에 넣을 작업 세션(Relay 세션 기록에서 필요한 것만). 시각은 밀리초 epoch다. */
export type GraphSession = {
  id: string; provider: string; agent: string; providerSessionId: string; name: string | null; summary: string; cwd: string;
  status: string | null; createdAt: number; updatedAt: number; parentId: string | null;
};
export type NoteGraph = {
  nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[]; clusters: GraphCluster[]; byId: Map<string, GraphNode>;
  /** 글이 있는 점(메모·세션)의 낱말 무게. */
  vectors: Map<string, Vector>;
  /** 세션 점 ID → 세션 기록. */
  sessions: Map<string, GraphSession>;
  /** 의미 선의 근거: 두 메모에서 가장 가까운 절. 키는 `작은 ID\n큰 ID`. */
  semantic: Map<string, LinkItem>;
};

/** Relay 세션 기록에서 그래프에 쓸 것만 고른다. */
export const toGraphSession = (session: {
  id: string; provider: string; agent: string; providerSessionId: string; sessionName: string | null; summary: string; workingDirectory: string;
  status: string | null; createdAt: string; updatedAt: string; parentSessionId: string | null;
}): GraphSession => ({
  id: session.id, provider: session.provider, agent: session.agent, providerSessionId: session.providerSessionId, name: session.sessionName, summary: session.summary,
  cwd: session.workingDirectory, status: session.status, createdAt: Date.parse(session.createdAt) || 0, updatedAt: Date.parse(session.updatedAt) || 0, parentId: session.parentSessionId,
});

export const ROOT_GROUP = "group:root";
export const TAG_GROUP = "group:tag";
export const SESSION_GROUP = "group:session";
export const tagId = (name: string) => `tag:${name.toLocaleLowerCase("ko-KR")}`;
export const sessionNodeId = (id: string) => `session:${id}`;
const cleanPath = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "");
export const projectNodeId = (cwd: string) => `project:${cleanPath(cwd).toLocaleLowerCase("en-US")}`;
/** 작업 폴더의 마지막 이름. */
export const projectLabel = (cwd: string) => cleanPath(cwd).split("/").pop() || cwd || "프로젝트";

const labelOf = (item: Item) => coreLabel(item);
/** 그래프에 쓸 짧은 이름. 제목이 없으면 본문 첫 줄을 쓰고 길면 줄인다. */
export function shortLabel(item: Item, max = 28) {
  const label = labelOf(item).trim() || (item.kind === "folder" ? "폴더" : "빈 메모");
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

// ── 본문 읽기 ─────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// 낱말 뽑기와 태그 읽기는 서버의 검색과 같은 규칙을 쓰도록 공용 코어에 있다.
export { tagsOf, tokenize };

/** `[[제목]]`, `[[제목|보일 이름]]`, `[[제목#절]]`. 서식 편집기는 대괄호를 `\[\[제목\]\]`로 저장하므로 앞의 역슬래시도 받는다. */
const WIKI = /\\?\[\\?\[((?:\\[^[\]]|[^[\]|#\n\\])+)(?:#[^\]|\n]*?)?(?:\|[^\]\n]*?)?\\?\]\\?\]/g;
/** Markdown 이스케이프(`\_`, `\*` 등)를 푼다. */
const unescapeMarkdown = (text: string) => text.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1");
/** 본문의 `[[…]]` 대상 이름들(앞뒤 빈칸 정리, 중복 제거). */
export function wikiTargets(body: string): string[] {
  const found = new Set<string>();
  for (const match of prose(body).matchAll(WIKI)) { const name = unescapeMarkdown(match[1]!).trim(); if (name) found.add(name); }
  return [...found];
}

const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
const isWordChar = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));

/** title이 text에 낱말 처음부터 나오는가. 한국어는 조사가 붙으므로 뒤에 한글이 이어지면 그것이 조사일 때만 같은 낱말로 본다
 *  (「회고」가 「회고를」·「회고에서는」에는 걸리고 「주간회고」·「회고집」에는 안 걸린다). */
export function mentions(text: string, title: string) {
  if (!title) return false;
  const last = title[title.length - 1]!;
  for (let at = text.indexOf(title); at !== -1; at = text.indexOf(title, at + 1)) {
    if (isWordChar(text[at - 1])) continue;
    const end = at + title.length;
    // 영문·숫자 제목은 뒤도 낱말 경계여야 한다(「api」가 「apis」에 걸리지 않게).
    if (/[a-z0-9]/i.test(last)) { if (!/[a-z0-9]/i.test(text[end] ?? "")) return true; continue; }
    if (!HANGUL.test(last) || !HANGUL.test(text[end] ?? "")) return true;
    let tail = "";
    for (let i = end; i < text.length && tail.length <= 6 && HANGUL.test(text[i]!); i++) tail += text[i];
    const rest = tail.startsWith("들") ? tail.slice(1) : tail;
    if (!rest || JOSA_SET.has(rest)) return true;
  }
  return false;
}

// ── 낱말과 유사도 ─────────────────────────────────────────

const JOSA_SET = new Set([...JOSA, "이었고", "였고", "이고", "이며", "이면", "인데", "이지만", "이라", "이라서", "으로써", "로써", "로서", "으로서", "에서의", "에의", "과의", "와의",
  "이나", "나", "든", "이든", "야", "이야", "께", "께서는", "에게는", "한테는", "만의", "만은", "만을", "도록", "같이", "뿐", "뿐만", "대로", "이라도", "라도", "란", "으로의", "로의", "에서만",
  "였다", "이었다", "입니다", "임", "일", "인", "임을", "에선", "에겐", "엔", "론", "으론", "은요", "는요"]);
const HANGUL = /\p{Script=Hangul}/u;
/** 메모마다 낱말 가중치(TF-IDF, 크기 1로 맞춤)와 대표 낱말. 제목 낱말은 세 배로 센다. 너무 흔한 낱말(메모 절반 넘게)은 뺀다. */
function weigh(notes: Note[]): { vectors: Map<string, Vector>; keywords: Map<string, string[]>; df: Map<string, number> } {
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
  return { vectors, keywords, df };
}

/** 세션 글을 메모의 낱말 공간에 놓는다. 메모의 낱말 빈도(df)를 그대로 써서, 세션을 넣어도 메모끼리의 유사도와 대표 낱말이 바뀌지 않는다. */
function weighSessions(sessions: GraphSession[], df: Map<string, number>, total: number) {
  const vectors = new Map<string, Vector>();
  const keywords = new Map<string, string[]>();
  const common = Math.max(2, total * 0.5);
  for (const session of sessions) {
    const terms = new Map<string, number>();
    const add = (word: string, by: number) => terms.set(word, (terms.get(word) ?? 0) + by);
    for (const word of tokenize(session.name ?? "")) add(word, 3);
    for (const word of tokenize(prose(session.summary).split("\n").map(plainLine).join("\n"))) add(word, 1);
    const scored: Array<[string, number]> = [];
    for (const [word, count] of terms) {
      const seen = df.get(word) ?? 0;
      if (total > 3 && seen > common) continue;
      scored.push([word, (1 + Math.log(count)) * (Math.log((1 + total) / (1 + seen)) + 1)]);
    }
    scored.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const id = sessionNodeId(session.id);
    keywords.set(id, scored.slice(0, 6).map(([word]) => word));
    const shared = scored.filter(([word]) => (df.get(word) ?? 0) >= 1).slice(0, 32);
    const norm = Math.hypot(...scored.slice(0, 32).map(([, value]) => value)) || 1;
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

export type BuildOptions = {
  /** 메모마다 잇는 비슷한 메모 수 */ similarPerNote?: number;
  /** 이보다 낮은 유사도는 잇지 않는다 */ minSimilarity?: number;
  /** 함께 놓을 작업 세션. */
  sessions?: GraphSession[];
  /** linked(기본): 메모와 이어진 세션만 넣는다. all: 모두 넣는다. */
  sessionScope?: "linked" | "all";
  /** 의미 색인이 미리 계산해 둔 메모 쌍(GET /api/v1/notes/semantic-links). */
  semantic?: LinkItem[];
};

export function buildGraph(items: Items, options: BuildOptions = {}): NoteGraph {
  const { similarPerNote = 3, minSimilarity = 0.16, sessions = [], sessionScope = "linked" } = options;
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

  const { vectors, keywords, df } = weigh(notes);
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

  // 의미 연결: 임베딩으로 잰 가까움. 링크·언급이 없는 쌍에만 달고, 메모마다 센 것부터 넷까지 단다.
  // 이 선이 달린 쌍에는 낱말 유사도 선을 따로 달지 않는다(같은 쌍은 더 강한 근거 하나만 남긴다).
  const semantic = new Map<string, LinkItem>();
  const semanticCount = new Map<string, number>();
  for (const item of [...(options.semantic ?? [])].sort((x, y) => y.strength - x.strength || y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1))) {
    if (byId.get(item.a)?.kind !== "note" || byId.get(item.b)?.kind !== "note" || linked.has(pairKey(item.a, item.b))) continue;
    if ((semanticCount.get(item.a) ?? 0) >= 4 || (semanticCount.get(item.b) ?? 0) >= 4) continue;
    addEdge(item.a, item.b, "semantic", Math.max(0.05, Math.min(1, item.strength)));
    semantic.set(pairKey(item.a, item.b), item);
    for (const id of [item.a, item.b]) semanticCount.set(id, (semanticCount.get(id) ?? 0) + 1);
  }

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

  // 작업 세션 층. 메모와 닿는 선(접점)을 먼저 찾고, 범위에 든 세션만 점으로 만든다.
  const sessionIndex = new Map<string, GraphSession>();
  if (sessions.length) {
    const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const weighed = weighSessions(ordered, df, notes.length);
    const postings = new Map<string, Array<[string, number]>>();
    for (const [id, vector] of vectors) for (const [word, value] of vector) {
      const list = postings.get(word);
      if (list) list.push([id, value]); else postings.set(word, [[id, value]]);
    }
    type Contact = { source: string; target: string; kind: EdgeKind; weight: number };
    const contacts = new Map<string, Contact[]>();
    const touch = (session: string, contact: Contact) => contacts.set(session, [...(contacts.get(session) ?? []), contact]);
    // 메모가 적어 둔 세션 ID(Agent 세션 ID나 Relay 내부 ID).
    const byToken = new Map<string, string>();
    for (const session of ordered) {
      const id = sessionNodeId(session.id);
      for (const token of [session.providerSessionId, session.id.replace(/^ses_/, "")]) if (token.length >= 8) byToken.set(token.toLowerCase(), id);
    }
    for (const note of notes) for (const match of note.body.matchAll(UUID)) {
      const session = byToken.get(match[0].toLowerCase());
      if (session) touch(session, { source: note.id, target: session, kind: "link", weight: 1 });
    }
    for (const session of ordered) {
      const id = sessionNodeId(session.id);
      const raw = `${session.name ?? ""}\n${session.summary}`;
      for (const match of raw.matchAll(UUID)) { const hit = byId.get(match[0].toLowerCase()) ?? byId.get(match[0]); if (hit && hit.kind !== "tag") touch(id, { source: id, target: hit.id, kind: "link", weight: 1 }); }
      for (const name of wikiTargets(raw)) { const target = titleIndex.get(normalize(name)); if (target) touch(id, { source: id, target, kind: "link", weight: 1 }); }
      const text = normalize(prose(raw));
      for (const [title, ids] of titles) if (ids.length === 1 && title.length >= 3 && mentions(text, title)) touch(id, { source: id, target: ids[0]!, kind: "mention", weight: 0.8 });
      const scores = new Map<string, { score: number; shared: number }>();
      for (const [word, value] of weighed.vectors.get(id) ?? []) for (const [note, other] of postings.get(word) ?? []) {
        const entry = scores.get(note);
        if (entry) { entry.score += value * other; entry.shared++; } else scores.set(note, { score: value * other, shared: 1 });
      }
      // 세션 요약은 길고 낱말이 많아 메모와 쉽게 겹친다. 셋 이상의 드문 낱말을 함께 쓰는 가장 가까운 메모 하나만 잇는다.
      const near = [...scores].filter(([, entry]) => entry.shared >= 3 && entry.score >= Math.max(minSimilarity, 0.26))
        .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1)).slice(0, 1);
      for (const [note, entry] of near) touch(id, { source: id, target: note, kind: "similar", weight: Math.min(1, entry.score) });
    }
    // 느슨한 단서(언급·비슷함)는 추린다. 직접 가리킨 것(ID·[[제목]])은 모두 남긴다.
    // 1) 여러 세션이 입에 올리는 제목(프로젝트 이름 같은 것)은 단서가 못 된다. 2) 메모 하나에 붙는 세션은 셋까지. 3) 느슨한 단서로만 들어오는 세션 수에도 한도를 둔다.
    const updated = new Map(ordered.map((session) => [sessionNodeId(session.id), session.updatedAt]));
    const mentioned = new Map<string, number>();
    for (const list of contacts.values()) for (const contact of list) if (contact.kind === "mention") mentioned.set(contact.target, (mentioned.get(contact.target) ?? 0) + 1);
    const generic = Math.max(3, Math.ceil(ordered.length * 0.08));
    const loose: Array<Contact & { session: string }> = [];
    for (const [session, list] of contacts) {
      const firm = list.filter((contact) => contact.kind === "link");
      for (const contact of list) if (contact.kind !== "link" && !(contact.kind === "mention" && mentioned.get(contact.target)! > generic)) loose.push({ ...contact, session });
      if (firm.length) contacts.set(session, firm); else contacts.delete(session);
    }
    loose.sort((a, b) => b.weight - a.weight || updated.get(b.session)! - updated.get(a.session)! || (a.session + a.target < b.session + b.target ? -1 : 1));
    const perNote = new Map<string, number>();
    const looseSessions = new Set<string>();
    const room = Math.max(6, Math.round(notes.length * 0.4));
    for (const contact of loose) {
      if ((perNote.get(contact.target) ?? 0) >= 3) continue;
      if (!contacts.has(contact.session) && !looseSessions.has(contact.session)) { if (looseSessions.size >= room) continue; looseSessions.add(contact.session); }
      perNote.set(contact.target, (perNote.get(contact.target) ?? 0) + 1);
      touch(contact.session, { source: contact.source, target: contact.target, kind: contact.kind, weight: contact.weight });
    }
    const included = ordered.filter((session) => sessionScope === "all" || contacts.has(sessionNodeId(session.id)));
    if (included.length) {
      const projects = new Map<string, GraphSession[]>();
      for (const session of included) if (session.cwd) projects.set(projectNodeId(session.cwd), [...(projects.get(projectNodeId(session.cwd)) ?? []), session]);
      // 세션이 하나뿐인 프로젝트는 점으로 만들지 않는다(메모와 이어진 세션만 볼 때 잎사귀만 늘어난다).
      for (const [id, members] of projects) {
        if (members.length < (sessionScope === "all" ? 1 : 2)) { projects.delete(id); continue; }
        push({ id, kind: "project", label: projectLabel(members[0]!.cwd), group: SESSION_GROUP, parentId: null, depth: 0, size: 0,
          createdAt: Math.min(...members.map((member) => member.createdAt)), updatedAt: Math.max(...members.map((member) => member.updatedAt)), keywords: [], count: members.length });
      }
      for (const session of included) {
        const id = sessionNodeId(session.id);
        const project = session.cwd && projects.has(projectNodeId(session.cwd)) ? projectNodeId(session.cwd) : null;
        const label = (session.name ?? "").trim() || plainLine(session.summary.split("\n").find((line) => line.trim()) ?? "") || "작업 세션";
        push({ id, kind: "session", label: label.length > 28 ? `${label.slice(0, 27).trimEnd()}…` : label, group: SESSION_GROUP, parentId: project, depth: project ? 1 : 0,
          size: session.summary.length, createdAt: session.createdAt, updatedAt: session.updatedAt, keywords: weighed.keywords.get(id) ?? [], count: 0 });
        sessionIndex.set(id, session);
        const vector = weighed.vectors.get(id);
        if (vector) vectors.set(id, vector);
        if (project) addEdge(project, id, "folder");
      }
      const order: Record<string, number> = { link: 0, mention: 1, similar: 2 };
      const all = [...contacts.values()].flat().sort((a, b) => order[a.kind]! - order[b.kind]! || b.weight - a.weight || (a.source + a.target < b.source + b.target ? -1 : 1));
      for (const contact of all) addEdge(contact.source, contact.target, contact.kind, contact.weight);
      for (const session of included) if (session.parentId) addEdge(sessionNodeId(session.id), sessionNodeId(session.parentId), "chain", 0.9);
      groups.push({ id: SESSION_GROUP, label: "작업 세션", index: groups.length });
    }
  }

  const words = new Map(keywords);
  for (const node of nodes) if (node.kind === "session") words.set(node.id, node.keywords);
  const graph: NoteGraph = { nodes, edges, groups, clusters: [], byId, vectors, sessions: sessionIndex, semantic };
  graph.clusters = clustersOf(graph, words);
  return graph;
}

/** 링크로 가리킬 메모의 이름과, 그 이름을 `[[…]]`에 적으면 그 메모만 가리키는지. */
export function linkTarget(items: Items, id: string): { id: string; title: string; unique: boolean } {
  const item = items[id];
  const title = item ? (item.kind === "note" ? item.title.trim() || labelOf(item) : labelOf(item)).trim() : "";
  const key = normalize(title);
  let same = 0;
  for (const other of Object.values(items)) {
    const names = other.kind === "note" ? [other.title, labelOf(other)] : [labelOf(other)];
    if (names.some((name) => normalize(name) === key)) same++;
  }
  return { id, title, unique: Boolean(key) && same === 1 && !/[[\]|#\n]/.test(title) };
}

/** 앞서 덧붙인 연결 줄 바로 아래에 이어 적어 목록 하나로 모은다. */
function appendLine(body: string, line: string) {
  const trimmed = body.replace(/\s+$/, "");
  const tail = /(?:^|\n)- (?:\\?\[\\?\[|「|작업 세션 「)[^\n]*$/.test(trimmed);
  return trimmed ? `${trimmed}${tail ? "\n" : "\n\n"}${line}\n` : `${line}\n`;
}
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** 메모 본문 끝에 다른 메모로 가는 링크 한 줄을 덧붙인다. 제목이 하나뿐이면 `[[제목]]`, 겹치거나 없으면 ID를 적는다(ID 참조도 링크가 된다).
 *  이미 같은 링크가 있으면 본문을 그대로 돌려준다. */
export function appendLink(body: string, target: { id: string; title: string; unique: boolean }, why = ""): string {
  const title = oneLine(target.title.replace(/[[\]|#]/g, " "));
  if (target.unique && title && wikiTargets(body).some((name) => normalize(name) === normalize(title))) return body;
  if (body.toLowerCase().includes(target.id.toLowerCase())) return body;
  const link = target.unique && title ? `[[${title}]]` : `「${title || "메모"}」 (메모 ID: ${target.id})`;
  return appendLine(body, `- ${link}${oneLine(why) ? ` — ${oneLine(why)}` : ""}`);
}

/** 메모 본문 끝에 작업 세션을 가리키는 한 줄을 덧붙인다. 세션 ID가 본문에 있으면 메모와 세션이 링크로 이어진다. */
export function appendSessionLink(body: string, session: Pick<GraphSession, "providerSessionId" | "name">, why = ""): string {
  if (body.toLowerCase().includes(session.providerSessionId.toLowerCase())) return body;
  const name = oneLine((session.name ?? "").replace(/[「」]/g, " ")) || "작업 세션";
  return appendLine(body, `- 작업 세션 「${name}」 (세션 ID: ${session.providerSessionId})${oneLine(why) ? ` — ${oneLine(why)}` : ""}`);
}

/** 이웃(방향 무시). kinds를 주면 그 종류의 선만 본다. */
export function neighbors(graph: Pick<NoteGraph, "edges">, kinds?: ReadonlySet<EdgeKind>) {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { const set = map.get(a); if (set) set.add(b); else map.set(a, new Set([b])); };
  for (const edge of graph.edges) if (!kinds || kinds.has(edge.kind)) { add(edge.source, edge.target); add(edge.target, edge.source); }
  return map;
}

/** 무게 있는 그래프를 모듈성(묶음 안의 선이 우연보다 얼마나 많은가)이 커지도록 나눈다(Louvain: Blondel 외 2008).
 *  점을 하나씩 이웃 묶음으로 옮겨 보다가 더 나아지지 않으면 묶음을 한 점으로 접어 같은 일을 되풀이한다. 정렬된 순서로만 돌아 결과가 항상 같다.
 *  weights는 양쪽 방향이 모두 든 이웃 무게다. 돌려주는 것은 점 → 묶음 대표(그 묶음에서 ID가 가장 앞선 점). */
export function louvain(ids: string[], weights: Map<string, Map<string, number>>, resolution = 1): Map<string, string> {
  let nodes = [...ids].sort();
  let adjacency = new Map(nodes.map((id) => [id, new Map(weights.get(id) ?? [])]));
  let members = new Map(nodes.map((id) => [id, [id]]));
  let total = 0;
  for (const row of adjacency.values()) for (const weight of row.values()) total += weight;
  if (total > 0) for (let level = 0; level < 12; level++) {
    const community = new Map(nodes.map((id) => [id, id]));
    const degree = new Map(nodes.map((id) => [id, [...adjacency.get(id)!.values()].reduce((sum, weight) => sum + weight, 0)]));
    const mass = new Map(degree);
    let movedAny = false;
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (const id of nodes) {
        const own = community.get(id)!, k = degree.get(id)!;
        if (!k) continue;
        const toward = new Map<string, number>();
        for (const [other, weight] of adjacency.get(id)!) if (other !== id) toward.set(community.get(other)!, (toward.get(community.get(other)!) ?? 0) + weight);
        mass.set(own, mass.get(own)! - k);
        let best = own, gain = (toward.get(own) ?? 0) - (resolution * mass.get(own)! * k) / total;
        for (const [candidate, weight] of [...toward].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
          const value = weight - (resolution * mass.get(candidate)! * k) / total;
          if (value > gain + 1e-10) { gain = value; best = candidate; }
        }
        mass.set(best, mass.get(best)! + k);
        if (best !== own) { community.set(id, best); moved = true; }
      }
      if (!moved) break;
      movedAny = true;
    }
    if (!movedAny) break;
    // 묶음을 한 점으로 접는다. 묶음 안의 선은 제 자신으로 가는 선이 되어 다음 단계에서도 무게에 남는다.
    const folded = new Map<string, Map<string, number>>(), merged = new Map<string, string[]>();
    for (const id of nodes) {
      const to = community.get(id)!;
      merged.set(to, [...(merged.get(to) ?? []), ...members.get(id)!]);
      const row = folded.get(to) ?? new Map<string, number>();
      for (const [other, weight] of adjacency.get(id)!) row.set(community.get(other)!, (row.get(community.get(other)!) ?? 0) + weight);
      folded.set(to, row);
    }
    nodes = [...folded.keys()].sort(); adjacency = folded; members = merged;
  }
  const out = new Map<string, string>();
  for (const list of members.values()) { const lead = [...list].sort()[0]!; for (const id of list) out.set(id, lead); }
  return out;
}

/** 주제 묶음: 메모끼리의 선(링크·언급·비슷함, 같은 태그)에 무게를 주어 모듈성이 커지도록 나눈다(louvain).
 *  홀로 남은 메모는 「연결 없는 메모」 한 묶음이 된다. 결과는 항상 같다(정렬된 순서로만 돈다). */
export function clustersOf(graph: Pick<NoteGraph, "nodes" | "edges">, keywords: Map<string, string[]>): GraphCluster[] {
  const notes = graph.nodes.filter(isDoc).map((node) => node.id).sort();
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
    link(edge.source, edge.target, edge.kind === "link" ? 1 : edge.kind === "mention" ? 0.8 : edge.kind === "chain" ? 0.7 : 0.5 + edge.weight);
  }
  for (const members of tagMembers.values()) if (members.length <= 12) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) link(members[i]!, members[j]!, 0.6);

  const label = louvain(notes, weights);

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
