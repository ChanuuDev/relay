import { useEffect, useState, type CSSProperties } from "react";
import { BarChart3, Download, FileText, Folder, Inbox, LayoutDashboard, LayoutGrid, List, Monitor, Plus, Search, Settings, Users } from "lucide-react";
import { Wallpaper } from "@/components/desktop/wallpaper";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Tip } from "@/components/patterns/tip";
import { Toaster } from "@/components/patterns/toaster";
import { isMobileWidth } from "@/lib/layout";
import { toast } from "@/lib/toast";
import { useIsDark, useUI } from "@/lib/ui-store";
import { ENTRIES, ago } from "./data";

const NAV = [
  { id: "home", label: "개요", icon: LayoutDashboard, count: undefined },
  { id: "inbox", label: "받은 항목", icon: Inbox, count: 12 },
  { id: "docs", label: "문서", icon: FileText, count: 48 },
  { id: "team", label: "팀", icon: Users, count: undefined },
  { id: "reports", label: "보고서", icon: BarChart3, count: undefined },
] as const;

/** 페이지형 견본: 창·Dock 없이 같은 재질을 쓰는 일반 웹앱.
 *  바탕화면 위에 12px 띄운 유리 사이드바 + 불투명 본문 패널(유리 상단바). 좁은 화면에서는 사이드바 대신 아래 탭바. */
export function PageDemo() {
  const dark = useIsDark();
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const [mobile, setMobile] = useState(() => isMobileWidth(window.innerWidth));
  const [active, setActive] = useState("home");
  const [view, setView] = useState<"list" | "grid">("list");
  useEffect(() => {
    const resize = () => setMobile(isMobileWidth(window.innerWidth));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return <div className="page-shell" data-mobile={mobile ? "" : undefined}>
    <Wallpaper dark={dark} />
    <div className="page-layout">
      <aside className="page-panel page-sidebar" aria-label="탐색">
        <div className="page-brand"><span className="app-tile" style={{ "--tile-from": "#5ab0ff", "--tile-to": "#0a6fe0" } as CSSProperties}><LayoutGrid /></span>Glass Starter</div>
        <nav className="page-nav">
          <span className="page-nav-label">작업 공간</span>
          {NAV.map(({ id, label, icon: Icon, count }) => <a key={id} href={`#page/${id}`} className="page-nav-item" aria-current={active === id ? "page" : undefined}
            onClick={(event) => { event.preventDefault(); setActive(id); }}><Icon />{label}{count ? <span className="tree-count">{count}</span> : null}</a>)}
          <span className="page-nav-label">폴더</span>
          {["디자인", "프런트엔드", "운영"].map((name) => <a key={name} href="#page" className="page-nav-item" onClick={(event) => event.preventDefault()}><Folder />{name}</a>)}
        </nav>
        <div className="sidebar-footer"><span className="sync-state"><span className="status-dot" />동기화됨</span>
          <button type="button" className="crumb" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{dark ? "라이트로" : "다크로"}</button></div>
      </aside>
      <section className="page-panel page-main" aria-label="본문">
        <header className="page-header">
          <h1>개요</h1>
          <div className="toolbar flex min-w-0 flex-1 items-center gap-2">
            <InputGroup className="search-field max-w-80"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput placeholder="검색" aria-label="검색" /></InputGroup>
            <div className="segmented" data-variant="icon" role="radiogroup" aria-label="보기">
              <button type="button" role="radio" aria-checked={view === "list"} aria-label="목록" onClick={() => setView("list")}><List /></button>
              <button type="button" role="radio" aria-checked={view === "grid"} aria-label="카드" onClick={() => setView("grid")}><LayoutGrid /></button>
            </div>
          </div>
          <div className="toolbar-icons">
            <Tip text="데스크톱형 보기"><Button variant="ghost" size="icon-sm" aria-label="데스크톱형 보기" onClick={() => { location.hash = ""; }}><Monitor /></Button></Tip>
            <Tip text="설정"><Button variant="ghost" size="icon-sm" aria-label="설정"><Settings /></Button></Tip>
          </div>
          <Button size="sm" onClick={() => toast("새 항목을 만들었습니다")}><Plus />새 항목</Button>
        </header>
        <div className="page-content page-glow">
          <div className="page-section">
            <h2>이번 주 흐름</h2>
            <p>페이지형에서도 유리는 크롬(사이드바·상단바)에만, 읽는 내용은 불투명 바탕에 둡니다.</p>
            <div className="stat-grid">
              <div className="stat-card"><span>진행 중</span><strong>12</strong><small>어제보다 2 늘어남</small></div>
              <div className="stat-card"><span>인계 대기</span><strong>4</strong><small>평균 18분</small></div>
              <div className="stat-card"><span>완료</span><strong>37</strong><small>이번 주</small></div>
              <div className="stat-card"><span>막힘</span><strong>1</strong><small>권한 요청 중</small></div>
            </div>
          </div>
          <div className="page-section">
            <h3>최근 항목</h3>
            {view === "list" ? <ul className="list-rows overflow-hidden rounded-xl border" style={{ background: "var(--background)", padding: "4px 0" }}>
              {ENTRIES.slice(0, 5).map((item) => <li key={item.id} className="list-row">
                <span className="avatar" aria-hidden="true">{item.initial}</span>
                <div className="row-main">
                  <div className="row-title-line"><span className="row-title">{item.title}</span>{item.status ? <StatusBadge status={item.status} /> : null}</div>
                  <p className="row-summary">{item.summary}</p>
                  <div className="row-meta"><span>{item.owner}</span><span>·</span><span>{ago(item.updated)}</span></div>
                </div>
              </li>)}
            </ul> : <ul className="card-grid">
              {ENTRIES.slice(0, 6).map((item) => <li key={item.id}><button type="button" className="tile-card"><span className="tile-card-title">{item.title}</span>
                <span className="tile-card-preview">{item.summary}</span><span className="tile-card-meta">{ago(item.updated)}</span></button></li>)}
            </ul>}
            <div className="mt-4 flex gap-2"><Button size="sm" variant="outline"><Download />내보내기</Button><Button size="sm" variant="ghost">모두 보기</Button></div>
          </div>
        </div>
      </section>
    </div>
    <nav className="dock page-tabbar" aria-label="탭">
      <div className="dock-row"><div className="dock-bar material-dock">
        {NAV.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} type="button" className="dock-item" data-active={active === id ? "" : undefined} onClick={() => setActive(id)}>
          <span className="app-tile" style={{ width: 32, height: 32, "--tile-from": active === id ? "#5ab0ff" : "#9a9aa0", "--tile-to": active === id ? "#0a6fe0" : "#6e6e73" } as CSSProperties}><Icon /></span>
          <span className="dock-label">{label}</span></button>)}
      </div></div>
    </nav>
    <Toaster />
  </div>;
}
