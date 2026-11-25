import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftRight, Check, Copy, FileText, History, Lightbulb, Link2, Plus, Route, Sparkles, Terminal, X, type LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import type { GraphEdge, GraphNode, NoteGraph } from "../../lib/note-graph";
import type { GraphPath, Insight, Suggestion } from "../../lib/graph-insight";
import { contextText, graphCommand, graphReference, type ContextResult } from "../../lib/graph-context";

/** 메모 그래프의 도구: 왼쪽 레일에서 고르는 세 패널.
 *  - 발견: 그래프를 읽어 낸 것(중심 메모·다리 메모·주제 사이의 틈·제안 연결·연결 없는 메모). 줄에 마우스를 올리면 그래프에서 그 점들이 밝아진다.
 *  - 에이전트 맥락: 질의나 중심 메모에서 그래프를 따라 고른 묶음을 미리 보고, AI 에이전트에 붙여 넣을 한 줄·명령·내용을 복사한다(`relay graph context`와 같은 계산).
 *  - 경로: 두 점이 어떤 메모를 거쳐 이어지는지. */

export type GraphTool = "insight" | "context" | "path";
export const TOOLS: Array<{ id: GraphTool; label: string; icon: LucideIcon; hint: string; key: string }> = [
  { id: "insight", label: "발견", icon: Lightbulb, hint: "중심 메모·다리 메모·주제 사이의 틈·제안 연결", key: "I" },
  { id: "context", label: "에이전트 맥락", icon: Sparkles, hint: "AI 에이전트에 건넬 관련 메모 묶음을 고르고 복사", key: "C" },
  { id: "path", label: "경로", icon: Route, hint: "두 점이 어떤 메모를 거쳐 이어지는지", key: "P" },
];
export const BUDGETS = [2000, 4000, 8000, 12000] as const;
const budgetLabel = (value: number) => (value >= 10000 ? `${value / 10000}만` : `${value / 1000}천`);
const EDGE_WORD: Record<GraphEdge["kind"], string> = { link: "링크", mention: "언급", similar: "비슷함", tag: "태그", folder: "폴더", chain: "이어받음" };

export function ToolRail({ tool, onTool, replaying, onReplay, badge }: {
  tool: GraphTool | null; onTool: (tool: GraphTool | null) => void; replaying: boolean; onReplay: () => void; badge: number;
}) {
  return <nav className="graph-rail" aria-label="그래프 도구">
    {TOOLS.map(({ id, label, icon: Icon, hint, key }) => <button key={id} type="button" className="graph-rail-button" data-tool={id} aria-pressed={tool === id}
      aria-label={label} title={`${label} (${key}): ${hint}`} onClick={() => onTool(tool === id ? null : id)}>
      <Icon aria-hidden="true" />
      {id === "insight" && badge > 0 && tool !== "insight" && <span className="graph-rail-badge" aria-hidden="true">{badge > 9 ? "9+" : badge}</span>}
    </button>)}
    <span className="graph-rail-sep" aria-hidden="true" />
    <button type="button" className="graph-rail-button" data-tool="replay" aria-pressed={replaying} aria-label="시간 흐름 재생"
      title="시간 흐름 재생 (R): 만든 순서대로 메모가 하나씩 나타납니다" onClick={onReplay} disabled={replaying}>
      <History aria-hidden="true" />
    </button>
  </nav>;
}

function Panel({ tool, title, hint, onClose, children, footer }: { tool: GraphTool; title: string; hint: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <aside className="graph-panel material-chrome" data-tool={tool} aria-label={title}>
    <header className="graph-panel-head">
      <div><h3>{title}</h3><p>{hint}</p></div>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`${title} 닫기`} onClick={onClose}><X aria-hidden="true" /></Button>
    </header>
    <div className="graph-panel-body">{children}</div>
    {footer && <footer className="graph-panel-foot">{footer}</footer>}
  </aside>;
}

function Dot({ node, colorOf }: { node: GraphNode | undefined; colorOf: (node: GraphNode) => string }) {
  return <span className="graph-card-dot" data-kind={node?.kind} style={node ? { "--dot": colorOf(node) } as CSSProperties : undefined} aria-hidden="true" />;
}

/** 패널의 한 줄. 마우스를 올리거나 초점을 주면 그래프에서 그 점들이 밝아지고, 누르면 그 점으로 간다. */
function Row({ ids, onSpot, onClick, children, index = 0, className }: {
  ids: string[]; onSpot: (ids: string[] | null) => void; onClick?: () => void; children: ReactNode; index?: number; className?: string;
}) {
  return <li className={className} style={{ "--i": index } as CSSProperties}>
    <button type="button" className="graph-row" onClick={onClick} onPointerEnter={() => onSpot(ids)} onPointerLeave={() => onSpot(null)}
      onFocus={() => onSpot(ids)} onBlur={() => onSpot(null)}>{children}</button>
  </li>;
}

type Common = { graph: NoteGraph; colorOf: (node: GraphNode) => string; onPick: (id: string) => void; onSpot: (ids: string[] | null) => void; onClose: () => void };

export function InsightPanel({ graph, insight, suggestions, colorOf, onPick, onSpot, onClose, onLink, visible }: Common & {
  insight: Insight; suggestions: Suggestion[]; visible: ReadonlyMap<string, GraphNode>;
  /** from 메모에 to로 가는 링크를 적는다. */
  onLink: (from: string, to: string) => void;
}) {
  const [gapAt, setGapAt] = useState(0);
  const label = (id: string) => graph.byId.get(id)?.label ?? id;
  const topic = useMemo(() => new Map(graph.clusters.map((cluster) => [cluster.id, cluster])), [graph]);
  const hubs = insight.hubs.filter((hub) => visible.has(hub.id)).slice(0, 6);
  const bridges = insight.bridges.filter((bridge) => visible.has(bridge.id)).slice(0, 5);
  const gaps = insight.gaps.filter((gap) => topic.has(gap.a) && topic.has(gap.b));
  const gap = gaps.length ? gaps[gapAt % gaps.length]! : null;
  const orphans = insight.orphans.filter((id) => visible.has(id));
  const shown = suggestions.filter((entry) => visible.has(entry.from) && visible.has(entry.to)).slice(0, 8);
  const nothing = !hubs.length && !shown.length && !orphans.length;
  return <Panel tool="insight" title="발견" hint="그래프를 읽어 낸 것. 줄에 마우스를 올리면 그 점이 밝아집니다." onClose={onClose}>
    {nothing && <p className="graph-panel-empty">아직 읽어 낼 연결이 없습니다. 메모를 더 쓰고 <code>[[제목]]</code>으로 이어 보세요.</p>}
    {shown.length > 0 && <section>
      <h4>제안 연결<span>{shown.length}</span></h4>
      <p className="graph-panel-note">아직 링크로 잇지 않았지만 이으면 좋을 메모입니다. 「잇기」를 누르면 앞 메모 본문 끝에 링크 한 줄을 적습니다.</p>
      <ul className="graph-suggest">
        {shown.map((entry, index) => <li key={`${entry.from}-${entry.to}`} style={{ "--i": index } as CSSProperties}
          onPointerEnter={() => onSpot([entry.from, entry.to])} onPointerLeave={() => onSpot(null)}>
          <div className="graph-suggest-pair">
            <button type="button" onClick={() => onPick(entry.from)} title={`${label(entry.from)}로 가기`}><Dot node={graph.byId.get(entry.from)} colorOf={colorOf} /><span>{label(entry.from)}</span></button>
            <span className="graph-suggest-arrow" aria-hidden="true">→</span>
            <button type="button" onClick={() => onPick(entry.to)} title={`${label(entry.to)}로 가기`}><Dot node={graph.byId.get(entry.to)} colorOf={colorOf} /><span>{label(entry.to)}</span></button>
          </div>
          <p>{entry.reasons[0]!.text}{entry.reasons.length > 1 ? ` 외 ${entry.reasons.length - 1}가지` : ""}</p>
          <Button type="button" size="xs" variant="outline" className="graph-suggest-link" onClick={() => onLink(entry.from, entry.to)}
            aria-label={`${label(entry.from)}에서 ${label(entry.to)}로 잇기`}><Link2 aria-hidden="true" />잇기</Button>
        </li>)}
      </ul>
    </section>}
    {gap && <section>
      <h4>주제 사이의 틈<span>{gaps.length}</span></h4>
      <div className="graph-gap" onPointerEnter={() => onSpot([...topic.get(gap.a)!.members, ...topic.get(gap.b)!.members])} onPointerLeave={() => onSpot(null)}>
        <p><strong>{topic.get(gap.a)!.label}</strong><span aria-hidden="true"> ↔ </span><strong>{topic.get(gap.b)!.label}</strong></p>
        <p className="graph-panel-note">{gap.shared.length ? `${gap.shared.join(" · ")}을(를) 함께 다루지만 ` : "내용이 가깝지만 "}{gap.cross ? "선 하나로만 이어져 있습니다." : "서로 이어져 있지 않습니다."} 두 주제는 어떤 관계인가요?</p>
        <div className="graph-gap-actions">
          {gap.pair && visible.has(gap.pair.from) && visible.has(gap.pair.to) && <Button type="button" size="xs" variant="outline" onClick={() => onLink(gap.pair!.from, gap.pair!.to)}
            title={`${label(gap.pair.from)} → ${label(gap.pair.to)}`}><Link2 aria-hidden="true" />다리 놓기</Button>}
          {gaps.length > 1 && <Button type="button" size="xs" variant="ghost" onClick={() => setGapAt((at) => at + 1)}>다음 틈</Button>}
        </div>
      </div>
    </section>}
    {hubs.length > 0 && <section>
      <h4>중심 메모<span>{hubs.length}</span></h4>
      <ul>{hubs.map((hub, index) => <Row key={hub.id} ids={[hub.id]} onSpot={onSpot} onClick={() => onPick(hub.id)} index={index}>
        <Dot node={graph.byId.get(hub.id)} colorOf={colorOf} /><span className="graph-row-label">{label(hub.id)}</span><span className="graph-row-meta">선 {hub.degree}</span>
      </Row>)}</ul>
    </section>}
    {bridges.length > 0 && <section>
      <h4>다리 메모<span>{bridges.length}</span></h4>
      <p className="graph-panel-note">서로 다른 주제를 잇는 메모입니다.</p>
      <ul>{bridges.map((bridge, index) => <Row key={bridge.id} ids={[bridge.id]} onSpot={onSpot} onClick={() => onPick(bridge.id)} index={index}>
        <Dot node={graph.byId.get(bridge.id)} colorOf={colorOf} /><span className="graph-row-label">{label(bridge.id)}</span><span className="graph-row-meta">주제 {bridge.clusters.length}</span>
      </Row>)}</ul>
    </section>}
    {orphans.length > 0 && <section>
      <h4>연결 없는 메모<span>{orphans.length}</span></h4>
      <ul>{orphans.slice(0, 6).map((id, index) => <Row key={id} ids={[id]} onSpot={onSpot} onClick={() => onPick(id)} index={index}>
        <Dot node={graph.byId.get(id)} colorOf={colorOf} /><span className="graph-row-label">{label(id)}</span>
      </Row>)}
      {orphans.length > 6 && <Row ids={orphans} onSpot={onSpot} className="graph-row-more">외 {orphans.length - 6}개 모두 비추기</Row>}</ul>
    </section>}
  </Panel>;
}

type Copied = "reference" | "command" | "text" | "failed" | null;

export function ContextPanel({ graph, colorOf, onPick, onSpot, onClose, active, query, onQuery, seeds, onSeeds, budget, onBudget, result }: Common & {
  active: GraphNode | null; query: string; onQuery: (query: string) => void; seeds: string[]; onSeeds: (seeds: string[]) => void;
  budget: number; onBudget: (budget: number) => void; result: ContextResult | null;
}) {
  const [copied, setCopied] = useState<Copied>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  const pack = result?.pack ?? null;
  const ids = seeds.map((id) => graph.sessions.get(id)?.providerSessionId ?? id);
  async function copy(kind: Exclude<Copied, "failed" | null>) {
    const text = kind === "reference" ? graphReference(ids, query) : kind === "command" ? graphCommand(ids, query, budget) : pack ? contextText(pack) : "";
    let next: Copied = kind;
    try { await navigator.clipboard.writeText(text); } catch { next = "failed"; }
    setCopied(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2200);
  }
  const canAdd = active && !seeds.includes(active.id);
  const ready = Boolean(pack && !pack.empty);
  const share = pack ? Math.min(1, pack.tokens / pack.budget) : 0;
  return <Panel tool="context" title="에이전트 맥락" hint="하려는 일을 적거나 중심 메모를 더하면, 그래프를 따라 관련 메모를 골라 AI 에이전트에 건넬 묶음을 만듭니다." onClose={onClose}
    footer={<>
      <div className="graph-context-copy">
        <Button type="button" size="xs" disabled={!ready} onClick={() => void copy("reference")} title="AI 에이전트에 붙여 넣을 한 줄. 에이전트가 relay-graph 스킬로 이 묶음을 읽습니다">
          {copied === "reference" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}참조 줄 복사</Button>
        <Button type="button" size="xs" variant="outline" disabled={!ready} onClick={() => void copy("command")} title="같은 묶음을 내는 relay graph context 명령">
          {copied === "command" ? <Check aria-hidden="true" /> : <Terminal aria-hidden="true" />}명령</Button>
        <Button type="button" size="xs" variant="outline" disabled={!ready} onClick={() => void copy("text")} title="묶음 내용 전체(Markdown). CLI가 없는 대화창에 그대로 붙여 넣을 수 있습니다">
          {copied === "text" ? <Check aria-hidden="true" /> : <FileText aria-hidden="true" />}내용</Button>
      </div>
      <p className="graph-context-status" role="status" aria-live="polite">
        {copied === "failed" ? "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요."
          : copied === "reference" ? "참조 줄을 복사했습니다. AI 에이전트에 붙여 넣으세요."
            : copied === "command" ? "명령을 복사했습니다." : copied === "text" ? "묶음 내용을 복사했습니다." : pack?.redacted ? `비밀번호·토큰처럼 보이는 값 ${pack.redacted}개는 가려서 건넵니다.` : "메모는 이 PC에서만 읽습니다."}
      </p>
    </>}>
    <label className="graph-context-query">
      <span className="sr-only">하려는 일</span>
      <textarea ref={inputRef} value={query} onChange={(event) => onQuery(event.target.value)} rows={2} maxLength={300} spellCheck={false}
        placeholder="하려는 일을 낱말로 적어 보세요 (예: 서버 배포 순서)" aria-label="하려는 일" />
    </label>
    <div className="graph-context-seeds">
      {seeds.map((id) => {
        const node = graph.byId.get(id);
        return <span key={id} className="graph-seed" onPointerEnter={() => onSpot([id])} onPointerLeave={() => onSpot(null)}>
          <Dot node={node} colorOf={colorOf} /><button type="button" className="graph-seed-label" onClick={() => onPick(id)}>{node?.label ?? id}</button>
          <button type="button" className="graph-seed-remove" aria-label={`${node?.label ?? id} 빼기`} onClick={() => onSeeds(seeds.filter((seed) => seed !== id))}><X aria-hidden="true" /></button>
        </span>;
      })}
      {canAdd && <button type="button" className="graph-seed-add" onClick={() => onSeeds([...seeds, active.id])}><Plus aria-hidden="true" />‘{active.label}’ 중심에 더하기</button>}
      {!seeds.length && !canAdd && <span className="graph-seed-hint">그래프에서 점을 고르면 중심으로 더할 수 있습니다.</span>}
    </div>
    <div className="graph-budget" role="radiogroup" aria-label="토큰 한도">
      <span>한도</span>
      {BUDGETS.map((value) => <button key={value} type="button" role="radio" aria-checked={budget === value} onClick={() => onBudget(value)}>{budgetLabel(value)}</button>)}
    </div>
    {!pack && <p className="graph-panel-empty">낱말을 적거나 점을 중심에 더하면 여기에 묶음이 보입니다. 그래프에서는 관련이 큰 점일수록 밝게 빛납니다.</p>}
    {pack?.empty && <p className="graph-panel-empty">맞는 메모가 없습니다. 낱말을 줄이거나 바꿔 보세요.</p>}
    {pack && !pack.empty && <>
      <div className="graph-meter" role="img" aria-label={`약 ${pack.tokens.toLocaleString("ko-KR")}토큰, 한도 ${pack.budget.toLocaleString("ko-KR")}토큰`}>
        <span className="graph-meter-bar"><span style={{ "--share": share } as CSSProperties} /></span>
        <span className="graph-meter-text">약 {pack.tokens.toLocaleString("ko-KR")} / {pack.budget.toLocaleString("ko-KR")} 토큰</span>
      </div>
      {pack.core.length > 0 && <section>
        <h4>핵심 메모<span>{pack.core.length}</span></h4>
        <p className="graph-panel-note">본문을 싣습니다.</p>
        <ul>{pack.core.map((note, index) => <Row key={note.id} ids={[note.id]} onSpot={onSpot} onClick={() => onPick(note.id)} index={index} className="graph-row-tall">
          <Dot node={graph.byId.get(note.id)} colorOf={colorOf} />
          <span className="graph-row-text"><span className="graph-row-label">{note.label}</span><small>{note.why}{note.clipped ? " · 일부만" : ""}</small></span>
          <span className="graph-row-meta">{note.tokens.toLocaleString("ko-KR")}</span>
        </Row>)}</ul>
      </section>}
      {pack.related.length > 0 && <section>
        <h4>주변 메모<span>{pack.related.length}</span></h4>
        <p className="graph-panel-note">제목과 한 줄만 싣습니다.</p>
        <ul>{pack.related.map((note, index) => <Row key={note.id} ids={[note.id]} onSpot={onSpot} onClick={() => onPick(note.id)} index={index} className="graph-row-tall">
          <Dot node={graph.byId.get(note.id)} colorOf={colorOf} />
          <span className="graph-row-text"><span className="graph-row-label">{note.label}</span><small>{note.why}</small></span>
        </Row>)}</ul>
      </section>}
      {pack.sessions.length > 0 && <section>
        <h4>이어진 작업 세션<span>{pack.sessions.length}</span></h4>
        <ul>{pack.sessions.map((session, index) => <Row key={session.id} ids={[session.id]} onSpot={onSpot} onClick={() => onPick(session.id)} index={index} className="graph-row-tall">
          <Dot node={graph.byId.get(session.id)} colorOf={colorOf} />
          <span className="graph-row-text"><span className="graph-row-label">{session.label}</span><small>{session.agent} · {session.why}</small></span>
        </Row>)}</ul>
      </section>}
    </>}
  </Panel>;
}

export type PathSlot = "from" | "to";

export function PathPanel({ graph, colorOf, onPick, onSpot, onClose, from, to, picking, onPicking, onSwap, onClear, path }: Common & {
  from: string | null; to: string | null; picking: PathSlot | null; onPicking: (slot: PathSlot | null) => void; onSwap: () => void; onClear: (slot: PathSlot) => void;
  /** undefined: 아직 두 점을 다 고르지 않음. null: 이어져 있지 않음. */
  path: GraphPath | null | undefined;
}) {
  const slot = (which: PathSlot, id: string | null, name: string) => {
    const node = id ? graph.byId.get(id) : undefined;
    return <div className="graph-path-slot" data-picking={picking === which ? "" : undefined} data-filled={node ? "" : undefined}>
      <span className="graph-path-slot-name">{name}</span>
      <button type="button" className="graph-path-slot-pick" aria-pressed={picking === which} onClick={() => onPicking(picking === which ? null : which)}
        title="누른 뒤 그래프에서 점을 고릅니다">
        {node ? <><Dot node={node} colorOf={colorOf} /><span>{node.label}</span></> : <span className="graph-path-slot-empty">{picking === which ? "그래프에서 점을 누르세요" : "점 고르기"}</span>}
      </button>
      {node && <button type="button" className="graph-seed-remove" aria-label={`${name} 지우기`} onClick={() => onClear(which)}><X aria-hidden="true" /></button>}
    </div>;
  };
  return <Panel tool="path" title="경로" hint="두 점이 어떤 메모를 거쳐 이어지는지 가장 가까운 길을 찾습니다. 링크처럼 강한 관계일수록 가깝습니다." onClose={onClose}>
    <div className="graph-path-slots">
      {slot("from", from, "처음")}
      <Button type="button" variant="ghost" size="icon-xs" className="graph-path-swap" aria-label="처음과 끝 바꾸기" title="처음과 끝 바꾸기" disabled={!from && !to} onClick={onSwap}><ArrowLeftRight aria-hidden="true" /></Button>
      {slot("to", to, "끝")}
    </div>
    {path === undefined && <p className="graph-panel-empty">처음과 끝을 고르면 그 사이의 길이 그래프 위에 그어집니다.</p>}
    {path === null && <p className="graph-panel-empty" role="status">두 점은 지금 보이는 선으로는 이어져 있지 않습니다. 「발견」의 제안 연결에서 이을 만한 메모를 찾아보세요.</p>}
    {path && <section>
      <h4>{path.nodes.length - 1}걸음<span>{path.nodes.length}</span></h4>
      <ol className="graph-path-steps">
        {path.nodes.map((id, index) => {
          const node = graph.byId.get(id);
          const edge = index ? path.edges[index - 1]! : null;
          return <li key={id} style={{ "--i": index } as CSSProperties}>
            {edge && <span className="graph-path-edge">{edge.kind === "similar" ? `비슷함 ${edge.weight.toFixed(2)}` : edge.kind === "link" ? (edge.source === path.nodes[index - 1] ? "링크" : "링크 받음") : EDGE_WORD[edge.kind]}</span>}
            <button type="button" className="graph-row" onClick={() => onPick(id)} onPointerEnter={() => onSpot([id])} onPointerLeave={() => onSpot(null)}>
              <Dot node={node} colorOf={colorOf} /><span className="graph-row-label">{node?.label ?? id}</span>
            </button>
          </li>;
        })}
      </ol>
    </section>}
  </Panel>;
}
