import { useState, type ReactNode } from "react";
import {
  AlertTriangle, Bell, Check, ChevronRight, CircleAlert, Copy, Download, FileCode, FileImage, FileSpreadsheet, FileText, Film, Folder, Globe, HardDrive, Home, Image,
  LayoutGrid, List, LoaderCircle, Music, Plus, RotateCw, Search, Settings, Star, Trash, X,
} from "lucide-react";
import { Window } from "@/components/desktop/window";
import { WindowTitleBar } from "@/components/desktop/window-title-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { GlassTabs } from "@/components/patterns/glass-tabs";
import { QuietBadge, StaleBadge, StatusBadge } from "@/components/patterns/status-badge";
import { Tip } from "@/components/patterns/tip";
import { toast } from "@/lib/toast";
import { presetUrl } from "@/lib/wallpaper";

/** 컴포넌트 견본 창: 모든 프리미티브와 패턴을 한 화면에서 본다. 새 화면을 만들 때 여기서 골라 쓴다. */
export function GalleryWindow() {
  const [tab, setTab] = useState("a");
  const [view, setView] = useState<"list" | "grid">("list");
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [row, setRow] = useState("r2");
  return <Window id="gallery" bodyClassName="gallery"
    header={<WindowTitleBar id="gallery" right={<div className="toolbar-icons">
      <Tip text="뒤로"><Button variant="ghost" size="icon-sm" aria-label="뒤로" disabled><ChevronRight className="rotate-180" /></Button></Tip>
      <Tip text="새로 고침"><Button variant="ghost" size="icon-sm" aria-label="새로 고침"><RotateCw /></Button></Tip>
    </div>}>
      <InputGroup className="address-field"><InputGroupAddon><Globe /></InputGroupAddon><InputGroupInput defaultValue="app://gallery/components" aria-label="주소" /></InputGroup>
    </WindowTitleBar>}>

    <Section title="버튼" note="파란 채움(default)은 화면에 하나. 나머지는 유리 알약(outline)·유령(ghost). 높이는 1em + 18/15/12px.">
      <Row>
        <Button>주요 행동</Button><Button variant="secondary">보조</Button><Button variant="outline">유리 알약</Button>
        <Button variant="ghost">유령</Button><Button variant="link">링크</Button><Button variant="destructive">삭제</Button>
      </Row>
      <Row>
        <Button size="sm"><Plus />sm 아이콘</Button><Button size="sm" variant="outline"><Download />내려받기</Button><Button size="xs" variant="outline">xs</Button>
        <Button size="sm" variant="outline" disabled>비활성</Button>
        <Tip text="복사"><Button variant="ghost" size="icon-sm" aria-label="복사"><Copy /></Button></Tip>
        <Tip text="설정"><Button variant="outline" size="icon-sm" aria-label="설정"><Settings /></Button></Tip>
        <Tip text="삭제"><Button variant="ghost" size="icon-xs" aria-label="삭제"><Trash /></Button></Tip>
      </Row>
      <Row label="상단바 안"><div className="toolbar flex items-center gap-2">
        <Button size="sm"><Search />검색</Button><Button size="sm" variant="secondary">켜 둔 필터</Button><Button size="sm" variant="outline">꺼진 필터</Button>
      </div></Row>
    </Section>

    <Section title="입력" note="모든 유리 컨트롤은 알약형 · 유리 채움 · 머리카락 테두리. 초점을 받으면 불투명 바탕.">
      <Row>
        <InputGroup className="max-w-72"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput placeholder="검색" aria-label="검색" /><InputGroupAddon align="inline-end"><kbd className="kbd">/</kbd></InputGroupAddon></InputGroup>
        <Input className="max-w-56" placeholder="일반 입력" aria-label="일반 입력" />
        <NativeSelect size="sm" aria-label="기본 선택"><NativeSelectOption>PowerShell</NativeSelectOption><NativeSelectOption>Bash</NativeSelectOption></NativeSelect>
        <Select defaultValue="13"><SelectTrigger size="sm" aria-label="글자 크기"><SelectValue /></SelectTrigger>
          <SelectContent>{["12", "13", "14", "16"].map((size) => <SelectItem key={size} value={size}>{size}px{size === "13" ? " (기본)" : ""}</SelectItem>)}</SelectContent></Select>
      </Row>
      <Row>
        <nav className="path-pill max-w-xl" aria-label="위치">
          <span className="crumb-wrap"><button type="button" className="crumb"><Home /></button></span>
          <span className="crumb-wrap"><ChevronRight /><button type="button" className="crumb"><HardDrive /><span>로컬 디스크 (C:)</span></button></span>
          <span className="crumb-wrap"><ChevronRight /><button type="button" className="crumb"><span>work</span></button></span>
          <span className="crumb-wrap"><ChevronRight /><button type="button" className="crumb" aria-current="page"><span>checkout-web</span></button></span>
        </nav>
      </Row>
      <Row><Textarea className="max-w-xl" placeholder="여러 줄 입력은 알약이 아니라 6px 모서리" aria-label="여러 줄 입력" /></Row>
    </Section>

    <Section title="세그먼트 · 탭" note="바깥 알약 안에서 켜진 칸만 불투명 바탕 + 이중 그림자. 탭은 thumb가 Flip으로 미끄러진다.">
      <Row>
        <div className="segmented" role="group" aria-label="보기 모드">
          <button type="button" aria-pressed={mode === "rich"} onClick={() => setMode("rich")}>서식</button>
          <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>Markdown</button>
        </div>
        <div className="segmented" data-variant="icon" role="radiogroup" aria-label="목록 모양">
          <button type="button" role="radio" aria-checked={view === "list"} aria-label="목록" onClick={() => setView("list")}><List /></button>
          <button type="button" role="radio" aria-checked={view === "grid"} aria-label="아이콘" onClick={() => setView("grid")}><LayoutGrid /></button>
        </div>
      </Row>
      <div className="mt-3 max-w-md">
        <GlassTabs value={tab} onValueChange={setTab} tabs={[
          { value: "a", label: "개요", content: <p className="hint">개요 탭 내용</p> },
          { value: "b", label: "기록 이력", count: 12, content: <p className="hint">기록 이력 탭 내용</p> },
          { value: "c", label: "연결", count: 3, content: <p className="hint">연결 탭 내용</p> },
        ]} />
      </div>
    </Section>

    <Section title="배지 · 칩 · 점" note="강조색을 늘리지 않는다. 상태는 색 글자 + 같은 색 45% 테두리, 칩은 회색 유리 캡슐.">
      <Row>
        <Badge>기본</Badge><Badge variant="secondary">보조</Badge><Badge variant="outline">외곽선</Badge>
        <StatusBadge status="working" /><StatusBadge status="blocked" /><StatusBadge status="handoff" /><StatusBadge status="done" />
        <StaleBadge /><QuietBadge>종료</QuietBadge>
      </Row>
      <Row>
        <div className="filter-chips" style={{ padding: 0, border: 0 }}>
          <Badge variant="secondary">담당: 디자인<button type="button" aria-label="지우기"><X /></button></Badge>
          <Badge variant="secondary">경로: C:/work<button type="button" aria-label="지우기"><X /></button></Badge>
        </div>
        <kbd className="kbd">Ctrl</kbd><kbd className="kbd">K</kbd>
        {(["online", "pending", "warning", "offline"] as const).map((state) => <span key={state} className="inline-flex items-center gap-1.5 text-xs"><span className="status-dot" data-state={state} />{state}</span>)}
      </Row>
      <Row>
        <span className="meter w-40"><span style={{ width: "42%" }} /></span>
        <span className="meter w-40" data-full=""><span style={{ width: "93%" }} /></span>
        <LoaderCircle className="spin size-5 text-muted-foreground" aria-label="불러오는 중" />
        <div className="flex w-56 flex-col gap-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
      </Row>
    </Section>

    <Section title="카드" note="쉼은 얕은 그림자, hover는 2px 떠오름 + 큰 그림자. 클램프 상자에는 padding을 두지 않는다.">
      <ul className="card-grid">
        <li><button type="button" className="tile-card" data-kind="folder"><Folder /><span className="tile-card-title">디자인 시스템</span><span className="tile-card-meta">문서 4개</span></button></li>
        <li><button type="button" className="tile-card"><span className="tile-card-title">유리 재질 규칙</span>
          <span className="tile-card-preview">크롬만 유리이고 내용은 불투명하다. 유리는 뒤에 비칠 바탕화면이 있어야 보인다. 보조 글자는 유리 위에서 62–68% 전경색을 쓴다.</span>
          <span className="tile-card-meta">10월 28일 15:47</span></button></li>
        <li><button type="button" className="tile-card"><span className="tile-card-title">모션 토큰</span>
          <span className="tile-card-preview">120 · 160 · 220 · 260ms. 진입 power3.out, 종료 power2.in.</span><span className="tile-card-meta">어제</span></button></li>
      </ul>
      <ul className="place-grid mt-4">
        {([["문서", "teal", FileText], ["다운로드", "green", Download], ["사진", "orange", Image], ["음악", "pink", Music], ["동영상", "violet", Film], ["즐겨찾기", "yellow", Star]] as const).map(([name, tone, Icon]) =>
          <li key={name}><button type="button" className="place-card"><span className="place-icon" data-tone={tone}><Icon /></span>
            <span className="card-text"><strong>{name}</strong><small>C:\Users\me\{name}</small></span></button></li>)}
      </ul>
      <ul className="drive-grid mt-4">
        <li><button type="button" className="drive-card"><span className="drive-icon"><HardDrive /></span>
          <span className="card-text" style={{ gap: 6 }}><strong>로컬 디스크 (C:)</strong><span className="meter"><span style={{ width: "64%" }} /></span><small>476GB 중 171GB 사용 가능</small></span></button></li>
      </ul>
      <ul className="media-grid mt-4">
        {(["aurora", "waves", "forest"] as const).map((id) => <li key={id} className="removable">
          <button type="button" className="media-card"><img className="media-thumb" src={presetUrl(id)} alt="" loading="lazy" /><span className="media-caption">{id} — 16:9 섬네일과 두 줄 캡션</span></button>
          <button type="button" className="corner-remove" aria-label={`${id} 지우기`}><X /></button>
        </li>)}
      </ul>
    </Section>

    <Section title="데이터 목록 · 아이콘 격자" note="27px 행, 짝수 줄무늬 3%, 종류별 아이콘 색. 목록에 초점이 있으면 고른 행은 시스템 블루 채움.">
      <div className="data-view overflow-hidden rounded-[10px] border">
        <div className="data-columns"><button type="button" aria-sort="ascending">이름</button><button type="button" data-column="modified">수정한 날짜</button>
          <button type="button" data-column="kind">종류</button><button type="button" data-align="end">크기</button></div>
        <div className="data-list" tabIndex={0} role="listbox" aria-label="파일">
          {([["r1", "folder", Folder, "assets", "오늘 09:12", "파일 폴더", ""], ["r2", "image", FileImage, "hero.png", "오늘 09:40", "PNG 이미지", "1.2MB"],
            ["r3", "sheet", FileSpreadsheet, "budget.xlsx", "어제 18:03", "Excel 워크시트", "84KB"], ["r4", "code", FileCode, "main.tsx", "어제 11:20", "TSX 파일", "3KB"],
            ["r5", "doc", FileText, "README.md", "10월 20일", "Markdown 문서", "12KB"]] as const).map(([id, tone, Icon, name, date, kind, size]) =>
            <div key={id} className="data-row" role="option" aria-selected={row === id} onClick={() => setRow(id)}>
              <span className="data-cell-name"><Icon className="item-icon" data-tone={tone} /><span>{name}</span></span>
              <span className="data-cell" data-column="modified">{date}</span><span className="data-cell" data-column="kind">{kind}</span><span className="data-cell" data-align="end">{size}</span>
            </div>)}
        </div>
        <div className="data-status"><span>항목 5개</span><span>hero.png · 1.2MB</span></div>
      </div>
      <div className="icon-grid mt-3 rounded-[10px] border" style={{ background: "var(--background)" }}>
        {([["g1", "folder", Folder, "assets"], ["g2", "image", FileImage, "hero.png"], ["g3", "code", FileCode, "main.tsx"], ["g4", "doc", FileText, "README.md"]] as const).map(([id, tone, Icon, name]) =>
          <div key={id} className="icon-tile" aria-selected={id === "g2"}><span className="icon-tile-art"><Icon className="item-icon" data-tone={tone} /></span><span className="icon-tile-name">{name}</span></div>)}
      </div>
    </Section>

    <Section title="알림 · 빈 상태 · 토스트" note="경고는 노란 아이콘 + 14% 틴트 줄. 토스트는 화면 아래 가운데 유리 알약, 3초.">
      <div className="notice-bar rounded-lg border"><AlertTriangle /><span>연결이 끊겼습니다. 변경은 이 브라우저에 보관하고 다시 연결되면 보냅니다.</span>
        <Button size="xs" variant="outline">다시 시도</Button></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Alert style={{ margin: 0 }}><Bell /><AlertTitle>새 버전이 있습니다</AlertTitle><AlertDescription>입력 중이 아닐 때 새로 고칩니다.</AlertDescription></Alert>
        <Alert variant="destructive" style={{ margin: 0 }}><CircleAlert /><AlertTitle>불러오지 못했습니다</AlertTitle><AlertDescription>서버 응답이 없습니다.</AlertDescription></Alert>
      </div>
      <div className="empty-card mt-3">이 폴더는 비어 있습니다. 위쪽의 새 문서 단추로 시작하세요.</div>
      <Row>
        <Button size="sm" variant="outline" onClick={() => toast("복사했습니다")}><Check />성공 토스트</Button>
        <Button size="sm" variant="outline" onClick={() => toast("새 버전으로 바뀌었습니다", "info")}><Bell />안내 토스트</Button>
        <Button size="sm" variant="outline" onClick={() => toast("저장하지 못했습니다", "error")}><CircleAlert />오류 토스트</Button>
      </Row>
    </Section>
  </Window>;
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <section className="gallery-section"><h3>{title}</h3><p className="hint" style={{ marginTop: 4 }}>{note}</p>{children}</section>;
}
function Row({ label, children }: { label?: string; children: ReactNode }) {
  return <div className="gallery-row">{label ? <span className="gallery-row-label">{label}</span> : null}{children}</div>;
}
