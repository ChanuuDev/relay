import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "radix-ui";
import {
  ArrowUpRight, CalendarRange, ChevronLeft, Crosshair, FolderTree, Hash, Maximize2, Minus, Plus, RotateCcw, Search, Shapes, Share2, SlidersHorizontal, X, type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildGraph, ROOT_GROUP, TAG_GROUP, type EdgeKind, type GraphNode } from "../../lib/note-graph";
import { focusOf, GRAPH_VIEWS, type GraphView } from "../../lib/graph-layout";
import { useNoteGraph, type GraphLinkKind } from "../../lib/note-graph-prefs";
import { pathOf, previewOf, search, type Items } from "../../lib/notes";
import { GraphScene, type SceneData } from "./notes-graph-scene";

/** 메모 지식 그래프. 메모 창의 내용 자리에 들어가 메모·폴더·태그를 점으로, 링크·언급·비슷한 내용·폴더·태그 관계를 선으로 보인다.
 *  다섯 가지 보기(관계망·집중·구조·주제·시간)를 오가면 점들이 새 자리로 흘러가고, 선은 모양을 바꾸며 따라간다. */

const VIEWS: Record<GraphView, { label: string; icon: LucideIcon; hint: string }> = {
  network: { label: "관계망", icon: Share2, hint: "연결된 메모끼리 당기고 나머지는 밀어 낸 모양" },
  focus: { label: "집중", icon: Crosshair, hint: "고른 메모를 가운데 두고 1·2단계 이웃을 둘러놓음" },
  structure: { label: "구조", icon: FolderTree, hint: "폴더 트리를 방사형으로 펼침" },
  topics: { label: "주제", icon: Shapes, hint: "내용이 비슷한 메모끼리 묶음" },
  timeline: { label: "시간", icon: CalendarRange, hint: "고친 날짜 순서, 폴더별 줄" },
};
const KIND_LABEL: Record<EdgeKind, string> = { link: "링크", mention: "언급", similar: "비슷한 내용", folder: "폴더", tag: "태그" };
const LINKS: Array<{ kind: GraphLinkKind; label: string; hint: string }> = [
  { kind: "link", label: "링크", hint: "[[제목]]이나 메모 ID로 가리킴" },
  { kind: "mention", label: "언급", hint: "다른 메모의 제목이 본문에 나옴" },
  { kind: "similar", label: "비슷한 내용", hint: "드문 낱말을 여럿 함께 씀" },
];
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const optionId = (id: string) => `graph-node-${id.replace(/[^\w-]/g, "_")}`;
const kindName = (node: GraphNode) => (node.kind === "folder" ? "폴더" : node.kind === "tag" ? "태그" : "메모");

/** 그래프 위에서 고른 점이 어디서 왔는지: 그래프 안에서 고르면 카메라를 움직이지 않고, 바깥(트리·연결 목록·검색)에서 고르면 그 점으로 날아간다. */
type Origin = "graph" | "outside";

export function NotesGraph({ items, selected, leaving, onSelect, onOpen, onBack }: {
  items: Items; selected: string | null; leaving: boolean;
  onSelect: (id: string) => void; onOpen: (id: string) => void; onBack: () => void;
}) {
  const prefs = useNoteGraph();
  const { view } = prefs;
  const graph = useMemo(() => buildGraph(items), [items]);
  const data = useMemo<SceneData>(() => {
    const nodes = graph.nodes.filter((node) => node.kind === "note" || (node.kind === "folder" ? prefs.folders : prefs.tags));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)
      && (edge.kind === "folder" ? prefs.folders : edge.kind === "tag" ? prefs.tags : prefs.links[edge.kind]));
    const degree = new Map<string, number>();
    for (const edge of edges) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const shown = prefs.orphans ? nodes : nodes.filter((node) => degree.get(node.id));
    return { nodes: shown, edges, degree, groups: graph.groups, clusters: graph.clusters };
  }, [graph, prefs.folders, prefs.tags, prefs.orphans, prefs.links]);
  const visible = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data]);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [scene, setScene] = useState<GraphScene | null>(null);
  const [active, setActive] = useState<string | null>(() => (selected && graph.byId.has(selected) ? selected : null));
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, setThemeTick] = useState(0);
  const origin = useRef<Origin>("outside");
  const fromGraph = useRef<string | null>(null);

  // 바깥(트리)에서 고른 메모를 따라간다. 그래프가 고른 것이 돌아온 경우는 건너뛴다.
  useEffect(() => {
    if (selected === fromGraph.current) return;
    fromGraph.current = null;
    if (selected && graph.byId.has(selected)) { origin.current = "outside"; setActive(selected); }
  }, [selected, graph]);
  // 보이지 않게 된 점은 고른 상태에서 뺀다.
  useEffect(() => { if (active && !visible.has(active)) setActive(null); }, [active, visible]);

  /** 집중 보기의 가운데. 고른 점이 없으면 연결이 가장 많은 메모. */
  const center = view === "focus" ? focusOf({ nodes: data.nodes, degree: data.degree, focus: active }) : null;
  useEffect(() => { if (view === "focus" && center && !active) { origin.current = "graph"; setActive(center); } }, [view, center, active]);

  const handlers = useRef({ hover: (_id: string | null) => {}, select: (_id: string | null) => {}, open: (_id: string) => {} });
  handlers.current = {
    hover: (id) => setHovered(id),
    select: (id) => choose(id, "graph"),
    open: (id) => void openNode(id),
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current!, root = rootRef.current!, stage = stageRef.current!;
    const next = new GraphScene(canvas, root, { hover: (id) => handlers.current.hover(id), select: (id) => handlers.current.select(id), open: (id) => handlers.current.open(id) });
    (root as HTMLDivElement & { relayGraph?: GraphScene }).relayGraph = next;
    const resize = new ResizeObserver(([entry]) => { if (entry) next.resize(entry.contentRect.width, entry.contentRect.height); });
    resize.observe(stage);
    // 테마·글자 크기가 바뀌면 색과 글꼴을 다시 읽는다.
    const theme = new MutationObserver(() => { next.refreshTheme(); setThemeTick((tick) => tick + 1); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    const wheel = (event: WheelEvent) => next.wheel(event);
    stage.addEventListener("wheel", wheel, { passive: false });
    void document.fonts?.ready.then(() => next.refreshTheme());
    setScene(next);
    return () => { next.destroy(); resize.disconnect(); theme.disconnect(); stage.removeEventListener("wheel", wheel); };
  }, []);

  // 오른쪽 카드·위 막대·아래 범례에 가리지 않는 자리에 맞춘다(배치를 바꾸기 전에 알려 둔다).
  const cardOpen = Boolean(active && visible.has(active));
  useEffect(() => { if (scene) scene.card = cardOpen; }, [scene, cardOpen]);
  useEffect(() => { scene?.update(data, view, view === "focus" ? center : null); }, [scene, data, view, center]);
  // 처음(그래프를 연 순간)에는 전체에 맞추므로 고른 점으로 날지 않는다.
  const revealed = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!scene) return;
    scene.setSelected(active);
    if (active !== revealed.current && active && origin.current === "outside" && useNoteGraph.getState().view !== "focus" && revealed.current !== undefined) scene.reveal(active);
    revealed.current = active;
    origin.current = "outside";
  }, [scene, active]);
  useEffect(() => { scene?.setLabelsAlways(prefs.labels); }, [scene, prefs.labels]);

  const matches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return null;
    const hits = new Set<string>();
    const tagNeedle = needle.replace(/^#/, "").toLocaleLowerCase("ko-KR");
    if (!needle.startsWith("#")) for (const item of search(items, needle)) if (visible.has(item.id)) hits.add(item.id);
    for (const node of data.nodes) if (node.kind === "tag" && node.label.slice(1).toLocaleLowerCase("ko-KR").includes(tagNeedle)) {
      hits.add(node.id);
      // 태그로 찾으면 그 태그를 쓴 메모도 함께 밝힌다.
      for (const edge of data.edges) if (edge.target === node.id) hits.add(edge.source);
    }
    return hits;
  }, [query, items, visible, data]);
  useEffect(() => { scene?.setMatches(matches); }, [scene, matches]);

  function choose(id: string | null, from: Origin) {
    origin.current = from;
    if (id === null) { if (view !== "focus") setActive(null); return; }
    setActive(id);
    const node = graph.byId.get(id);
    if (node && node.kind !== "tag") { fromGraph.current = id; onSelect(id); }
  }

  async function openNode(id: string) {
    const node = graph.byId.get(id);
    if (!node) return;
    if (node.kind === "tag") { setQuery(node.label); return; }
    rootRef.current?.setAttribute("data-diving", "");
    await scene?.dive(id);
    onOpen(id);
  }

  function setView(next: GraphView) {
    if (next === view) return;
    prefs.setView(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!scene || event.altKey || event.ctrlKey || event.metaKey) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = arrows[event.key];
    if (direction) {
      event.preventDefault();
      const next = scene.nearestIn(active, direction[0], direction[1]);
      if (next) { choose(next, "graph"); scene.ensureVisible(next); }
      return;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= GRAPH_VIEWS.length) { event.preventDefault(); setView(GRAPH_VIEWS[digit - 1]!); return; }
    if (event.key === "Enter" && active) { event.preventDefault(); void openNode(active); return; }
    if (event.key === "Escape" && (active || query)) { event.preventDefault(); event.stopPropagation(); if (query) setQuery(""); else choose(null, "graph"); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); scene.zoomBy(1.3); return; }
    if (event.key === "-" || event.key === "_") { event.preventDefault(); scene.zoomBy(1 / 1.3); return; }
    if (event.key === "0") { event.preventDefault(); scene.fit(); return; }
    if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return; }
    if ((event.key === "f" || event.key === "F") && active) { event.preventDefault(); setView("focus"); }
  }

  const counts = useMemo(() => {
    let notes = 0;
    for (const node of data.nodes) if (node.kind === "note") notes++;
    return { notes, edges: data.edges.length };
  }, [data]);
  const legend = useMemo(() => {
    const tally = new Map<string, number>();
    for (const node of data.nodes) tally.set(node.group, (tally.get(node.group) ?? 0) + 1);
    return data.groups.filter((group) => tally.has(group.id)).map((group) => ({ ...group, count: tally.get(group.id)! }));
  }, [data]);

  const hoverNode = hovered && hovered !== active ? visible.get(hovered) : undefined;
  const empty = graph.nodes.every((node) => node.kind !== "note");
  const colorOf = (node: GraphNode) => scene?.groupColor(node.group) ?? "var(--notes-accent)";

  return <div ref={rootRef} className="notes-graph" data-view={view} data-active={active ?? undefined} data-leaving={leaving ? "" : undefined}
    data-nodes={data.nodes.length} data-edges={data.edges.length}>
    <div ref={stageRef} className="graph-stage" tabIndex={0} role="listbox"
      aria-label={`메모 그래프: ${VIEWS[view].label} 보기, 메모 ${counts.notes}개, 연결 ${counts.edges}개. 화살표로 옮겨 가고 Enter로 엽니다.`}
      aria-activedescendant={active && visible.has(active) ? optionId(active) : undefined}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scene?.pointerDown(event.nativeEvent); }}
      onPointerMove={(event) => scene?.pointerMove(event.nativeEvent)}
      onPointerUp={(event) => scene?.pointerUp(event.nativeEvent)}
      onPointerCancel={(event) => scene?.pointerUp(event.nativeEvent)}
      onPointerLeave={() => scene?.pointerLeave()}
      onDoubleClick={(event) => scene?.doubleClick(event.nativeEvent)}
      onKeyDown={onKeyDown}>
      <canvas ref={canvasRef} className="graph-canvas" aria-hidden="true" />
      {data.nodes.map((node) => <div key={node.id} id={optionId(node.id)} role="option" aria-selected={node.id === active} className="graph-sr"
        onClick={() => choose(node.id, "outside")}>
        {`${node.label} · ${kindName(node)} · 연결 ${data.degree.get(node.id) ?? 0}개`}
      </div>)}
    </div>

    <header className="graph-bar">
      <Button type="button" variant="ghost" size="icon-sm" className="graph-back" aria-label="목록" title="목록" onClick={onBack}><ChevronLeft aria-hidden="true" /></Button>
      <ViewSwitch view={view} onChange={setView} />
      <div className="graph-bar-end">
        <label className="graph-search" data-filled={query ? "" : undefined}>
          <Search aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="그래프에서 찾기" aria-label="그래프에서 찾기"
            spellCheck={false} autoComplete="off" maxLength={200}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.stopPropagation(); if (query) setQuery(""); else stageRef.current?.focus(); }
              if (event.key === "Enter" && matches?.size) {
                event.preventDefault();
                const first = [...matches].sort((a, b) => (data.degree.get(b) ?? 0) - (data.degree.get(a) ?? 0))[0]!;
                choose(first, "outside");
              }
            }} />
          {matches && <span className="graph-search-count" aria-live="polite">{matches.size}</span>}
          {query && <button type="button" className="graph-search-clear" aria-label="검색어 지우기" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X aria-hidden="true" /></button>}
        </label>
        <FilterMenu />
      </div>
    </header>

    {hoverNode && <div className="graph-tip" role="tooltip" key={hoverNode.id}>
      <span className="graph-tip-dot" style={{ "--dot": colorOf(hoverNode) } as CSSProperties} data-kind={hoverNode.kind} />
      <span className="graph-tip-label">{hoverNode.label}</span>
      <span className="graph-tip-meta">{kindName(hoverNode)} · 연결 {data.degree.get(hoverNode.id) ?? 0}</span>
    </div>}

    <NodeCard key={active ?? "none"} node={active ? visible.get(active) ?? null : null} items={items} data={data} view={view} colorOf={colorOf}
      onClose={() => choose(null, "graph")} onPick={(id) => choose(id, "outside")} onOpen={(id) => void openNode(id)}
      onFocusView={() => setView("focus")} />

    <footer className="graph-legend" aria-label="색 구분">
      <span className="graph-stats">메모 {counts.notes} · 연결 {counts.edges}</span>
      {legend.map((group, index) => <button type="button" key={group.id} className="graph-chip" style={{ "--dot": scene?.groupColor(group.id), "--i": index + 1 } as CSSProperties}
        data-kind={group.id === TAG_GROUP ? "tag" : group.id === ROOT_GROUP ? "root" : "folder"}
        title={`${group.label}: 점 ${group.count}개 · 누르면 이 묶음으로 갑니다`}
        onPointerEnter={() => scene?.setGroupLit(group.id)} onPointerLeave={() => scene?.setGroupLit(null)}
        onFocus={() => scene?.setGroupLit(group.id)} onBlur={() => scene?.setGroupLit(null)}
        onClick={() => scene?.fit(800, false, data.nodes.filter((node) => node.group === group.id).map((node) => node.id))}>
        <span className="graph-chip-dot" aria-hidden="true" /><span className="graph-chip-label">{group.label}</span><span className="graph-chip-count">{group.count}</span>
      </button>)}
    </footer>

    <div className="graph-zoom" role="group" aria-label="확대">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="확대" title="확대 (+)" onClick={() => scene?.zoomBy(1.35)}><Plus aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="축소" title="축소 (−)" onClick={() => scene?.zoomBy(1 / 1.35)}><Minus aria-hidden="true" /></Button>
      <span className="graph-zoom-sep" aria-hidden="true" />
      <Button type="button" variant="ghost" size="icon-sm" aria-label="화면에 맞추기" title="화면에 맞추기 (0)" onClick={() => scene?.fit()}><Maximize2 aria-hidden="true" /></Button>
    </div>

    {empty && <div className="graph-empty" role="status">
      <div className="graph-empty-orbit" aria-hidden="true"><span /><span /><span /></div>
      <strong>아직 그릴 메모가 없습니다</strong>
      <p>메모를 쓰고 본문에 <code>[[다른 메모 제목]]</code>이나 <code>#태그</code>를 넣으면 메모 사이에 선이 생깁니다. 제목을 그대로 적거나 비슷한 낱말을 함께 써도 이어집니다.</p>
    </div>}
  </div>;
}

/** 보기 고르기. 고른 칸 아래 밝은 판이 미끄러져 옮겨 간다. */
function ViewSwitch({ view, onChange }: { view: GraphView; onChange: (view: GraphView) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const measure = () => {
      const button = group.querySelector<HTMLElement>(`[data-view="${view}"]`);
      if (button) setThumb({ left: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [view]);
  return <div ref={ref} className="graph-views" role="radiogroup" aria-label="그래프 보기"
    style={thumb ? { "--thumb-x": `${thumb.left}px`, "--thumb-w": `${thumb.width}px` } as CSSProperties : undefined} data-ready={thumb ? "" : undefined}
    onKeyDown={(event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = GRAPH_VIEWS[(GRAPH_VIEWS.indexOf(view) + step + GRAPH_VIEWS.length) % GRAPH_VIEWS.length]!;
      onChange(next);
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus());
    }}>
    <span className="graph-views-thumb" aria-hidden="true" />
    {GRAPH_VIEWS.map((key, index) => {
      const { label, icon: Icon, hint } = VIEWS[key];
      return <button key={key} type="button" role="radio" aria-checked={key === view} tabIndex={key === view ? 0 : -1} data-view={key}
        title={`${label} (${index + 1}): ${hint}`} onClick={() => onChange(key)}>
        <Icon aria-hidden="true" /><span>{label}</span>
      </button>;
    })}
  </div>;
}

/** 보일 연결과 점을 고르는 메뉴. */
function FilterMenu() {
  const prefs = useNoteGraph();
  const changed = !prefs.links.link || !prefs.links.mention || !prefs.links.similar || !prefs.folders || !prefs.tags || !prefs.orphans || prefs.labels;
  return <Popover.Root>
    <Popover.Trigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" className="graph-filter-button" aria-label="보일 연결과 점" title="보일 연결과 점" data-changed={changed ? "" : undefined}>
        <SlidersHorizontal aria-hidden="true" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="graph-filters material-menu" side="bottom" align="end" sideOffset={8} collisionPadding={12}>
        <section>
          <h4>연결</h4>
          {LINKS.map(({ kind, label, hint }) => <Toggle key={kind} on={prefs.links[kind]} onChange={(on) => prefs.setLink(kind, on)} label={label} hint={hint}
            sample={<LineSample kind={kind} />} />)}
        </section>
        <section>
          <h4>점</h4>
          <Toggle on={prefs.folders} onChange={(on) => prefs.set({ folders: on })} label="폴더" hint="폴더와 그 안의 메모를 잇는 선" sample={<span className="graph-sample-folder" />} />
          <Toggle on={prefs.tags} onChange={(on) => prefs.set({ tags: on })} label="태그" hint="본문의 #태그와 그 태그를 쓴 메모" sample={<Hash className="graph-sample-icon" aria-hidden="true" />} />
          <Toggle on={prefs.orphans} onChange={(on) => prefs.set({ orphans: on })} label="연결 없는 메모" hint="어떤 선에도 닿지 않은 메모" sample={<span className="graph-sample-dot" />} />
        </section>
        <section>
          <h4>표시</h4>
          <Toggle on={prefs.labels} onChange={(on) => prefs.set({ labels: on })} label="이름 늘 보이기" hint="꺼 두면 확대할수록 이름이 더 보입니다" />
        </section>
        <footer>
          <Button type="button" variant="ghost" size="xs" disabled={!changed} onClick={prefs.reset}><RotateCcw aria-hidden="true" />기본값으로</Button>
        </footer>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

function LineSample({ kind }: { kind: GraphLinkKind }) {
  return <svg className="graph-sample" data-kind={kind} viewBox="0 0 28 10" aria-hidden="true">
    <path d="M2 7 Q 14 1 26 5" />
    {kind === "link" && <path className="graph-sample-head" d="M22.5 2.6 L26 5 L22 6.4" />}
  </svg>;
}

function Toggle({ on, onChange, label, hint, sample }: { on: boolean; onChange: (on: boolean) => void; label: string; hint: string; sample?: ReactNode }) {
  return <button type="button" role="switch" aria-checked={on} className="graph-toggle" onClick={() => onChange(!on)}>
    {sample && <span className="graph-toggle-sample">{sample}</span>}
    <span className="graph-toggle-text"><span>{label}</span><small>{hint}</small></span>
    <span className="graph-switch" aria-hidden="true"><span /></span>
  </button>;
}

/** 고른 점의 카드: 이름·위치·고친 때·미리 보기·대표 낱말과 연결 목록. 연결을 누르면 그 점으로 날아간다. */
function NodeCard({ node, items, data, view, colorOf, onClose, onPick, onOpen, onFocusView }: {
  node: GraphNode | null; items: Items; data: SceneData; view: GraphView; colorOf: (node: GraphNode) => string;
  onClose: () => void; onPick: (id: string) => void; onOpen: (id: string) => void; onFocusView: () => void;
}) {
  const links = useMemo(() => {
    if (!node) return [];
    const byKind = new Map<EdgeKind, Array<{ other: GraphNode; incoming: boolean }>>();
    const index = new Map(data.nodes.map((entry) => [entry.id, entry]));
    for (const edge of data.edges) {
      const incoming = edge.target === node.id;
      if (!incoming && edge.source !== node.id) continue;
      const other = index.get(incoming ? edge.source : edge.target);
      if (!other) continue;
      byKind.set(edge.kind, [...(byKind.get(edge.kind) ?? []), { other, incoming }]);
    }
    const order: EdgeKind[] = ["link", "mention", "tag", "similar", "folder"];
    return order.filter((kind) => byKind.has(kind)).map((kind) => ({ kind, list: byKind.get(kind)! }));
  }, [node, data]);
  if (!node) return null;
  const item = items[node.id];
  const path = node.kind === "tag" ? "" : pathOf(items, item?.parentId ?? null).map((folder) => folder.name).join(" › ") || "최상위";
  const preview = item?.kind === "note" ? previewOf(item) : "";
  const total = links.reduce((sum, entry) => sum + entry.list.length, 0);
  return <aside className="graph-card material-chrome" aria-label={`${kindName(node)} 정보`} style={{ "--dot": colorOf(node) } as CSSProperties}>
    <header>
      <span className="graph-card-kind" data-kind={node.kind}><span className="graph-card-dot" aria-hidden="true" />{kindName(node)}</span>
      {view !== "focus" && <Button type="button" variant="ghost" size="icon-xs" aria-label="카드 닫기" onClick={onClose}><X aria-hidden="true" /></Button>}
    </header>
    <h3 className="graph-card-title">{node.kind === "tag" ? node.label : item ? (item.kind === "folder" ? item.name : node.label) : node.label}</h3>
    <p className="graph-card-meta">
      {node.kind === "note" && <>{path} · <time dateTime={new Date(node.updatedAt).toISOString()}>{dateFormat.format(node.updatedAt)}</time></>}
      {node.kind === "folder" && <>{path} · 메모 {node.count}개</>}
      {node.kind === "tag" && <>메모 {node.count}개가 씀</>}
    </p>
    {preview && <p className="graph-card-preview">{preview}</p>}
    {node.keywords.length > 0 && <ul className="graph-card-words" aria-label="대표 낱말">{node.keywords.slice(0, 5).map((word) => <li key={word}>{word}</li>)}</ul>}
    <div className="graph-card-actions">
      <Button type="button" size="xs" onClick={() => onOpen(node.id)}>
        {node.kind === "tag" ? <><Search aria-hidden="true" />이 태그로 찾기</> : <><ArrowUpRight aria-hidden="true" />{node.kind === "folder" ? "폴더 열기" : "메모 열기"}</>}
      </Button>
      {view !== "focus" && <Button type="button" size="xs" variant="outline" onClick={onFocusView}><Crosshair aria-hidden="true" />집중 보기</Button>}
    </div>
    <div className="graph-card-links">
      <h4>연결 {total}개</h4>
      {total === 0 && <p className="graph-card-none">이 점에 닿은 선이 없습니다. 본문에 <code>[[제목]]</code>을 적어 다른 메모와 이어 보세요.</p>}
      {links.map(({ kind, list }, group) => <section key={kind} style={{ "--stagger": group } as CSSProperties}>
        <h5><LineKind kind={kind} />{KIND_LABEL[kind]}<span>{list.length}</span></h5>
        <ul>
          {list.slice(0, 12).map(({ other, incoming }, index) => <li key={`${other.id}-${incoming}`} style={{ "--i": index } as CSSProperties}>
            <button type="button" onClick={() => onPick(other.id)} title={`${other.label}로 가기`}>
              <span className="graph-card-dot" style={{ "--dot": colorOf(other) } as CSSProperties} data-kind={other.kind} aria-hidden="true" />
              <span className="graph-card-link-label">{other.label}</span>
              {kind === "link" && <span className="graph-card-dir">{incoming ? "가리킴 받음" : "가리킴"}</span>}
            </button>
          </li>)}
          {list.length > 12 && <li className="graph-card-more">외 {list.length - 12}개</li>}
        </ul>
      </section>)}
    </div>
  </aside>;
}

function LineKind({ kind }: { kind: EdgeKind }) {
  return <svg className="graph-sample" data-kind={kind} viewBox="0 0 18 8" aria-hidden="true"><path d="M1 5.5 Q 9 1 17 4" /></svg>;
}
