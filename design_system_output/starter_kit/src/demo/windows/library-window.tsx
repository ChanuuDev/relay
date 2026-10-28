import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGSAP } from "@gsap/react";
import {
  ArrowDown, ArrowLeft, ArrowRight, Clock3, Copy, Folder, GitBranch, Inbox, Layers, ListFilter, Pin, RefreshCw, Search, Tag, User, X,
} from "lucide-react";
import { Window } from "@/components/desktop/window";
import { WindowTitleBar } from "@/components/desktop/window-title-bar";
import { SplitView } from "@/components/desktop/split-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Placeholder } from "@/components/patterns/empty-state";
import { GlassTabs } from "@/components/patterns/glass-tabs";
import { Reveal } from "@/components/patterns/reveal";
import { QuietBadge, StaleBadge, StatusBadge } from "@/components/patterns/status-badge";
import { CopyButton, Tip } from "@/components/patterns/tip";
import { Crossfade, FlipList } from "@/components/patterns/transitions";
import { useDesktop } from "@/lib/desktop-store";
import { growAccent, popIn, pulse, staggerIn } from "@/lib/motion";
import { copyText } from "@/lib/toast";
import { ENTRIES, OWNERS, ago, fullTime, type Entry } from "../data";

/** 목록-상세 창: 상단바 툴바(검색·필터) · 펼치는 상세 필터 · 칩 · 유리 목록 패널 | 불투명 상세 · 유리 상태바.
 *  보여 주는 것: SplitView, FlipList 재정렬 + 펄스, 선택 강조선, Crossfade 상세 교체, GlassTabs, 상태 배지, Reveal, 컨테이너 쿼리. */
export function LibraryWindow() {
  const [items, setItems] = useState(ENTRIES);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<string>(OWNERS[0]);
  const [project, setProject] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [bumped, setBumped] = useState<{ id: string; at: number } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => items.filter((item) =>
    (owner === OWNERS[0] || item.owner === owner)
    && (!project || item.project.toLowerCase().includes(project.toLowerCase()))
    && (!query || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()))), [items, owner, project, query]);
  const current = items.find((item) => item.id === selected) ?? null;
  const chips = [owner !== OWNERS[0] ? { key: "owner", text: `담당: ${owner}`, clear: () => setOwner(OWNERS[0]) } : null,
    project ? { key: "project", text: `경로: ${project}`, clear: () => setProject("") } : null].filter((chip) => chip !== null);

  // 첫 표시: 행이 30ms 간격(총 300ms 상한)으로 올라온다.
  useGSAP(() => { staggerIn(listRef.current?.querySelectorAll(".list-row") ?? []); }, { dependencies: [] });
  // 갱신된 행만 배경 펄스
  useEffect(() => {
    if (!bumped) return;
    pulse(listRef.current?.querySelector<HTMLElement>(`[data-flip-id="${bumped.id}"]`));
  }, [bumped, items]);
  // "/"로 검색에 초점(입력 중·IME 조합 중 제외)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.isComposing || (event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      useDesktop.getState().focus("library");
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 폴링으로 한 항목이 갱신된 상황을 흉내 낸다: 맨 위로 올리고(Flip) 배경을 펄스한다. */
  function simulateUpdate() {
    const candidates = items.slice(1);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (!target) return;
    const next = { ...target, updated: Date.now(), history: [{ status: target.status, text: "새 진행 요약이 기록되었습니다.", at: Date.now() }, ...target.history] };
    setItems([next, ...items.filter((item) => item.id !== target.id)]);
    setBumped({ id: target.id, at: Date.now() });
  }

  const header = <WindowTitleBar id="library" count={visible.length}
    right={<Tip text="새 갱신 흉내 내기(Flip + 펄스)"><Button variant="ghost" size="icon-sm" aria-label="갱신 흉내 내기" onClick={simulateUpdate}><RefreshCw /></Button></Tip>}>
    <InputGroup className="search-field">
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput ref={searchRef} placeholder="제목, 요약으로 검색" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="검색" />
      <InputGroupAddon align="inline-end"><kbd className="kbd">/</kbd></InputGroupAddon>
    </InputGroup>
    <NativeSelect size="sm" value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="담당">
      {OWNERS.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
    </NativeSelect>
    <Button size="sm" variant={filtersOpen ? "secondary" : "outline"} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
      <ListFilter />상세 필터{chips.length ? <span className="filter-indicator" aria-hidden="true" /> : null}
    </Button>
  </WindowTitleBar>;

  return <Window id="library" header={header} detail={Boolean(current)}>
    <Reveal open={filtersOpen}>
      <div className="filter-row material-chrome">
        <Field className="filter-grow"><FieldLabel htmlFor="filter-project">프로젝트 경로</FieldLabel>
          <Input id="filter-project" placeholder="예: C:/work/orders" value={project} onChange={(event) => setProject(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="filter-owner">담당</FieldLabel>
          <NativeSelect id="filter-owner" size="sm" value={owner} onChange={(event) => setOwner(event.target.value)} className="w-full">
            {OWNERS.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
          </NativeSelect></Field>
      </div>
    </Reveal>
    {chips.length ? <div className="filter-chips material-chrome">
      {chips.map((chip) => <Chip key={chip.key} text={chip.text} onClear={chip.clear} />)}
    </div> : null}
    <SplitView name="library" label="목록" collapse defaultWidth={340} minWidth={260} maxWidth={640} minMain={360}
      side={<div className="list-panel material-chrome" ref={listRef}>
        <div className="list-toolbar"><span><Layers />전체 기록</span><span><ArrowDown />최근 갱신순</span></div>
        <FlipList items={visible} className="list-rows">
          {visible.map((item) => <Row key={item.id} item={item} selected={item.id === selected} onSelect={() => setSelected(item.id)} />)}
        </FlipList>
        <div className="pager"><span>총 <strong>{visible.length}</strong>건 · 1–{visible.length}건</span>
          <span className="flex items-center gap-1"><Button variant="ghost" size="icon-xs" aria-label="이전 페이지" disabled><ArrowLeft /></Button>
            <span className="tabular">1 / 1</span><Button variant="ghost" size="icon-xs" aria-label="다음 페이지" disabled><ArrowRight /></Button></span></div>
      </div>}
      main={<div className="detail-slot" ref={detailRef}>
        <Crossfade swapKey={current?.id ?? "none"} container={detailRef} select=".detail-panel, .placeholder">
          {current ? <Detail item={current} tab={tab} onTab={setTab} onBack={() => setSelected(null)} />
            : <Placeholder icon={Inbox} hint={<><kbd className="kbd">/</kbd> 키로 바로 검색할 수 있습니다.</>}>항목을 선택하면 요약과 기록 이력이 여기에 표시됩니다.</Placeholder>}
        </Crossfade>
      </div>} />
    <div className="statusbar material-chrome">
      <span>총 {items.length}건 · 최근 갱신순</span>
      <span className="statusbar-path">C:\Users\me\.app\data.db</span>
      <span className="version">APP v1.0.0</span>
      <span>마지막 조회 {fullTime.format(new Date())}</span>
    </div>
  </Window>;
}

function Chip({ text, onClear }: { text: string; onClear: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => { popIn(ref.current); }, { dependencies: [] });
  return <Badge ref={ref} variant="secondary">{text}<button type="button" aria-label={`${text} 지우기`} onClick={onClear}><X /></button></Badge>;
}

function Row({ item, selected, onSelect }: { item: Entry; selected: boolean; onSelect: () => void }) {
  const accent = useRef<HTMLSpanElement>(null);
  useGSAP(() => { if (selected) growAccent(accent.current); }, { dependencies: [selected] });
  return <li className="list-row" data-flip-id={item.id} aria-selected={selected} tabIndex={0} onClick={onSelect}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>
    <span className="row-accent" ref={accent} aria-hidden="true" />
    <span className="avatar" aria-hidden="true">{item.initial}</span>
    <div className="row-main">
      <div className="row-title-line">
        <span className="row-title">{item.title}</span>
        {item.pinned ? <Pin className="pin-mark" aria-label="고정" /> : null}
        {item.status ? <StatusBadge status={item.status} /> : null}
        {item.stale ? <StaleBadge /> : null}
        {item.ended ? <QuietBadge>종료</QuietBadge> : null}
      </div>
      <p className="row-summary">{item.summary}</p>
      <div className="row-meta"><span>{item.owner}</span><span>·</span><span>{ago(item.updated)}</span><span>·</span><span>{item.project}</span></div>
    </div>
    <div className="row-action"><CopyButton value={item.summary} label="요약 복사" /></div>
  </li>;
}

function Detail({ item, tab, onTab, onBack }: { item: Entry; tab: string; onTab: (tab: string) => void; onBack: () => void }) {
  return <div className="detail-panel" tabIndex={-1}>
    <div className="detail-topline">
      <button type="button" className="back-link" onClick={onBack}><ArrowLeft />목록으로</button>
      <span>최근 갱신 {fullTime.format(new Date(item.updated))}</span>
      <span>{item.owner}</span>
    </div>
    <div className="detail-header">
      <h2>{item.title}</h2>
      <p className="detail-meta"><Folder />{item.project}</p>
    </div>
    <div className="detail-actions">
      <Button size="sm" onClick={() => void copyText(item.summary, "맥락을 복사했습니다")}><Copy />맥락 복사</Button>
      <Button size="sm" variant="outline" onClick={() => void copyText(item.project, "경로를 복사했습니다")}><Folder />경로 복사</Button>
      <Button size="sm" variant="outline" onClick={() => void copyText(item.id)}><Tag />ID 복사</Button>
    </div>
    <p className="detail-hint">파란 채움 단추는 화면에 하나(주요 행동)만 둔다. 나머지는 유리 알약(outline)이다.</p>
    <div className="detail-tabs-wrap">
      <GlassTabs value={tab} onValueChange={onTab} tabs={[
        { value: "overview", label: "개요", content: <Overview item={item} /> },
        { value: "history", label: "기록 이력", count: item.history.length, content: <History item={item} /> },
        { value: "links", label: "연결", count: 2, content: <Links item={item} /> },
      ]} />
    </div>
  </div>;
}

function Overview({ item }: { item: Entry }) {
  return <>
    <div className="detail-section"><h3>최근 요약</h3><div className="summary">{item.summary}</div>
      <p className="hint">요약은 다음 작업에 필요한 사실만 짧게 남긴다.</p></div>
    <Separator />
    <div className="detail-section">
      <h3>정보</h3>
      <div className="identity-grid">
        <div><span><User />담당</span><strong>{item.owner}</strong></div>
        <div><span><Tag />상태</span><strong>{item.status ? <StatusBadge status={item.status} /> : "미기록"}</strong></div>
        <div><span><GitBranch />브랜치</span><strong>main · a1b2c3d · 수정 2개</strong></div>
      </div>
      <div className="path-block"><span><Folder />작업 경로</span><code>{item.project}</code></div>
      <div className="time-grid">
        <div><Clock3 /><span>마지막 갱신</span><time>{fullTime.format(new Date(item.updated))}</time></div>
        <div><Clock3 /><span>처음 기록</span><time>{fullTime.format(new Date(item.history.at(-1)?.at ?? item.updated))}</time></div>
      </div>
      <details className="technical-details"><summary>기술 정보</summary>
        <dl><dt>내부 ID</dt><dd>{item.id}-7f3c2a90-41d8</dd><dt>저장 위치</dt><dd>C:\Users\me\.app\data.db</dd></dl></details>
    </div>
  </>;
}

function History({ item }: { item: Entry }) {
  return <div className="detail-section">
    <ol className="timeline">
      {item.history.map((entry, index) => <li key={index}>
        <span className="timeline-dot" aria-hidden="true" />
        <div className="timeline-meta">{entry.status ? <StatusBadge status={entry.status} /> : <span>상태 없음</span>}<time>{ago(entry.at)}</time></div>
        <p>{entry.text}</p>
      </li>)}
    </ol>
  </div>;
}

function Links({ item }: { item: Entry }) {
  return <div className="detail-section">
    <div className="section-title"><h3>흐름</h3><span className="muted">처음부터 지금까지</span></div>
    <ol className="chain">
      <li className="chain-node" style={{ "--depth": 0 } as CSSProperties}><span className="chain-dot" />
        <div className="chain-head"><strong>기획 메모</strong><time>어제</time></div><p>요구사항과 화면 목록을 정리했다.</p></li>
      <li className="chain-node chain-current" style={{ "--depth": 1 } as CSSProperties}><span className="chain-dot" />
        <div className="chain-head"><strong>{item.title}</strong><span className="chain-here">현재</span><time>{ago(item.updated)}</time></div><p>{item.summary}</p></li>
    </ol>
  </div>;
}
