import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useGSAP } from "@gsap/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { TooltipProvider } from "./components/ui/tooltip";
import { MenuBar } from "./components/desktop/menu-bar";
import { Dock } from "./components/desktop/dock";
import { Wallpaper } from "./components/desktop/wallpaper";
import { SessionsWindow } from "./components/apps/sessions-window";
import { GuideWindow } from "./components/apps/guide-window";
import { CommandWindow } from "./components/apps/command-window";
import { SettingsWindow } from "./components/apps/settings-window";
import { resource, type BriefSession, type DetailData, type HealthData, type HistoryData, type ListData } from "./lib/queries";
import { listLocation, navigate, useUI } from "./lib/store";
import { isMobileWidth, useDesktop } from "./lib/desktop-store";
import { enter, enterToast, exit, exitToast } from "./lib/motion";
import { applyTheme, isDark, watchSystemTheme } from "./lib/theme";

const queryClient = new QueryClient();

function App() {
  const currentLocation = useUI((state) => state.location);
  const listUrl = new URL(listLocation(), location.origin);
  const params = listUrl.searchParams;
  const match = /^\/sessions\/([^/]+)$/.exec(location.pathname);
  const id = match?.[1];
  const detailParams = new URLSearchParams(location.search);
  const health = useQuery(resource<HealthData>("/api/v1/health"));
  const list = useQuery(resource<ListData>(`/api/v1/sessions?${params}`));
  const detail = useQuery(resource<DetailData>(`/api/v1/sessions/${id}`, Boolean(id)));
  const updates = useQuery(resource<HistoryData>(`/api/v1/sessions/${id}/updates?limit=50&offset=${encodeURIComponent(detailParams.get("historyOffset") ?? "0")}`, Boolean(id)));
  const children = useQuery(resource<ListData<BriefSession>>(`/api/v1/sessions/${id}/children?limit=50&offset=${encodeURIComponent(detailParams.get("childrenOffset") ?? "0")}`, Boolean(id)));
  const watched = [health, list, ...(id ? [detail, updates, children] : [])];
  const failed = watched.some((query) => query.isError);
  const pending = watched.some((query) => query.isPending);
  const successAt = Math.min(...watched.map((query) => query.dataUpdatedAt));
  const connection = failed ? "offline" : pending ? "pending" : "online";
  const theme = useUI((state) => state.theme);
  const mobile = useDesktop((state) => state.mobile);
  const [dark, setDark] = useState(() => isDark(theme));
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const [fallback, setFallback] = useState<{ value: string } | null>(null);
  const [fallbackLeaving, setFallbackLeaving] = useState(false);
  const copyRef = useRef<HTMLTextAreaElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLElement>(null);
  const copyTriggerRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setDark(isDark(theme));
    if (theme !== "system") return;
    return watchSystemTheme(() => { applyTheme("system"); setDark(isDark("system")); });
  }, [theme]);
  useEffect(() => {
    const resize = () => {
      const desktop = useDesktop.getState();
      desktop.setMobile(isMobileWidth(window.innerWidth));
      desktop.clampAll(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const pop = () => {
      useUI.getState().syncLocation();
      if (/^\/sessions\/[^/]+$/.test(location.pathname)) useDesktop.getState().open("sessions");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
        target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (event.key === "/") {
        event.preventDefault();
        useDesktop.getState().focus("sessions");
        requestAnimationFrame(() => {
          const search = document.getElementById("search");
          if (search?.getClientRects().length) search.focus();
        });
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    document.title = detail.data?.session && id ? `${detail.data.session.sessionName ?? "세션 상세"} · Relay` : "Relay";
    if (id !== selectedRef.current) {
      const previous = selectedRef.current;
      selectedRef.current = id;
      if (id) document.querySelector<HTMLElement>(".detail-panel")?.focus({ preventScroll: true });
      else if (previous) {
        const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(".session-name"))
          .find((element) => new URL(element.href).pathname === `/sessions/${previous}`);
        (link ?? document.getElementById("workspace"))?.focus({ preventScroll: true });
      }
    }
  }, [id, detail.data?.session.sessionName, currentLocation]);
  useEffect(() => { if (fallback !== null && !fallbackLeaving) { copyRef.current?.focus(); copyRef.current?.select(); } }, [fallback, fallbackLeaving]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToastLeaving(true), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  // D3 토스트: 등장은 back.out으로 튀어오르고, 3초 뒤 종료 트윈이 끝나면 언마운트한다.
  useGSAP(() => {
    const element = toastRef.current;
    if (!toast || !element) return;
    if (!toastLeaving) { enterToast(element); return; }
    const { id } = toast;
    void exitToast(element).then(() => {
      setToast((current) => (current && current.id === id ? null : current));
      setToastLeaving(false);
    });
  }, { dependencies: [toast?.id, toastLeaving] });
  // D4 복사 폴백: 오른쪽에서 들어오고, Esc 종료 트윈 뒤 언마운트한다.
  useGSAP(() => {
    const element = fallbackRef.current;
    if (!fallback || !element) return;
    if (!fallbackLeaving) { enter(element, { x: 16, y: 0 }); return; }
    void exit(element).then(() => { setFallback(null); setFallbackLeaving(false); });
  }, { dependencies: [fallback, fallbackLeaving] });

  async function copy(value: string) {
    copyTriggerRef.current = document.activeElement as HTMLElement | null;
    try {
      await navigator.clipboard.writeText(value);
      setFallback(null); setFallbackLeaving(false);
      setToastLeaving(false); setToast({ text: "복사했습니다.", id: Date.now() });
    } catch { setFallbackLeaving(false); setFallback({ value }); }
  }
  function closeFallback() {
    if (fallbackLeaving) return;
    setFallbackLeaving(true);
    // 초점은 애니메이션과 무관하게 즉시 돌려준다(§4-1).
    copyTriggerRef.current?.focus({ preventScroll: true });
  }
  function listPage(offset: number) {
    const next = new URLSearchParams(params); next.set("offset", String(offset));
    if (id) {
      const detailQuery = new URLSearchParams(location.search); detailQuery.set("back", `/?${next}`);
      navigate(`${location.pathname}?${detailQuery}`);
    } else navigate(`/?${next}`);
  }
  const activeFilters = ["q", "provider", "agent", "cwd"].filter((key) => params.has(key));

  return <div className="desktop" data-shell="desktop" data-mobile={mobile ? "" : undefined}>
    <a className="skip-link" href="#workspace">본문으로 건너뛰기</a>
    <Wallpaper dark={dark} />
    <MenuBar connection={connection} dark={dark} />
    <main id="desktop">
      <SessionsWindow list={list} detail={detail} updates={updates} relations={children} health={health.data} params={params}
        selectedId={id} activeFilters={activeFilters} copy={copy} onPage={listPage} successAt={successAt} />
      <GuideWindow />
      <CommandWindow detail={detail} health={health.data} copy={copy} />
      <SettingsWindow health={health.data} healthError={health.error} connection={connection} />
    </main>
    <Dock />
    {toast && <div id="copy-status" className="copy-toast material-toast" role="status" ref={toastRef} data-leaving={toastLeaving ? "" : undefined}><Check />{toast.text}</div>}
    {fallback !== null && <section id="copy-fallback" className="copy-fallback material-menu" aria-labelledby="copy-label" ref={fallbackRef}
      data-leaving={fallbackLeaving ? "" : undefined}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeFallback(); } }}><div><label id="copy-label" htmlFor="copy-text">자동 복사 실패 — 아래 원문을 선택하여 복사하세요.</label><Button variant="ghost" size="icon-sm" aria-label="복사 원문 닫기" onClick={closeFallback}><X /></Button></div><Textarea id="copy-text" ref={copyRef} value={fallback.value} readOnly /></section>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><TooltipProvider delayDuration={250}><App /></TooltipProvider></QueryClientProvider></StrictMode>);
