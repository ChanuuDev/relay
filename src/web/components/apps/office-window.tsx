import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Maximize2, Minus, Plus, TriangleAlert } from "lucide-react";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { Button } from "../ui/button";
import { useDesktop } from "../../lib/desktop-store";
import { resource, type HistoryData, type ListData } from "../../lib/queries";
import { navigate, sessionUrl } from "../../lib/store";
import { reduced } from "../../lib/motion";
import { STATUS_LABELS, type Session } from "../../../session/session.types";
import { BADGE_URL, BACKGROUND_URL, BADGES, LAYOUT, SIT_SECONDS, SPRITES, WORKER_URL } from "../../lib/office/office-data";
import { OfficeSim, type OfficeSession } from "../../lib/office/sim";
import { blit, clampCamera, loadImage, OfficeRenderer, toScene, toScreen, ZONE_COLORS, type Camera, type View } from "../../lib/office/render";
import { bubbleLines, shortId, zoneLabel } from "../../lib/office/bubble";
import { WORK_ZONES, type Zone } from "../../lib/office/layout";

const LIST_URL = "/api/v1/sessions?limit=100";
const LEGEND: readonly Zone[] = [...WORK_ZONES, "hall"];
type Counts = Record<Zone, { shown: number; total: number }>;
const EMPTY_COUNTS: Counts = { hall: { shown: 0, total: 0 }, working: { shown: 0, total: 0 }, blocked: { shown: 0, total: 0 }, handoff: { shown: 0, total: 0 }, done: { shown: 0, total: 0 } };
const sameCounts = (a: Counts, b: Counts) => LEGEND.every((zone) => a[zone].shown === b[zone].shown && a[zone].total === b[zone].total);

const toOffice = (session: Session): OfficeSession => ({
  id: session.id, provider: session.provider, agent: session.agent, providerSessionId: session.providerSessionId,
  sessionName: session.sessionName, summary: session.summary, status: session.status,
  createdAt: session.createdAt, updatedAt: session.updatedAt, endedAt: session.endedAt,
});

function openSession(id: string) {
  navigate(sessionUrl(id));
  useDesktop.getState().open("sessions");
}

/** 에이전트 세션을 도트 사무실로 보여 준다. 상태마다 구역 책상에 앉고, 상태가 바뀌면 걸어서 옮긴다. */
export function OfficeWindow() {
  const win = useDesktop((state) => state.windows.office);
  const active = win.open && !win.minimized;
  const list = useQuery(resource<ListData>(LIST_URL, active));
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const engine = useRef<{ sim: OfficeSim; renderer: OfficeRenderer } | null>(null);
  const camera = useRef<Camera>({ zoom: 1, cx: LAYOUT.image.width / 2, cy: LAYOUT.image.height / 2 });
  const view = useRef<View>({ width: 1, height: 1, dpr: 1 });
  const pointer = useRef<{ x: number; y: number; id: number; panned: boolean; cx: number; cy: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [roster, setRoster] = useState<OfficeSession[]>([]);
  const marks = useRef({ hovered, selected });
  marks.current = { hovered: hovered ?? focused, selected };
  const shown = hovered ?? focused ?? selected;
  const shownSession = roster.find((session) => session.id === shown) ?? null;
  const history = useQuery(resource<HistoryData>(`/api/v1/sessions/${encodeURIComponent(shown ?? "")}/updates?limit=3`, Boolean(shown) && active));

  // 그림을 모두 받은 뒤 시뮬레이션과 그리기 준비를 한다.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadImage(BACKGROUND_URL), loadImage(WORKER_URL), loadImage(BADGE_URL)]).then(([background, atlas, badges]) => {
      if (cancelled) return;
      engine.current = {
        sim: new OfficeSim(LAYOUT, { sitSeconds: SIT_SECONDS, reduced: reduced(), bodies: SPRITES.bodies.length }),
        renderer: new OfficeRenderer(background, atlas, SPRITES, SIT_SECONDS, { image: badges, sheet: BADGES }),
      };
      setReady(true);
    }).catch((error: unknown) => { if (!cancelled) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  // 목록이 바뀔 때마다 누가 어디로 가야 하는지 다시 정한다.
  useEffect(() => {
    const current = engine.current;
    if (!ready || !current || !list.data) return;
    current.sim.sync(list.data.items.map(toOffice));
    const next = current.sim.counts();
    setCounts((previous) => (sameCounts(previous, next) ? previous : next));
    const visible = new Set(current.sim.agents().filter((agent) => !agent.leaving).map((agent) => agent.id));
    setRoster(list.data.items.filter((session) => visible.has(session.id)).map(toOffice));
  }, [ready, list.data]);

  // 창 크기를 따라 캔버스 해상도를 맞춘다.
  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const resize = () => {
      // 여는 애니메이션의 transform에 흔들리지 않도록 배치 크기(clientWidth)를 쓴다.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.current = { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight), dpr };
      canvas.width = Math.round(view.current.width * dpr);
      canvas.height = Math.round(view.current.height * dpr);
      camera.current = clampCamera(camera.current, view.current, LAYOUT.image.width, LAYOUT.image.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [active]);

  // 창이 보이는 동안만 매 프레임 걷고 그린다. 탭이 가려지면 브라우저가 프레임을 멈춘다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !active || !canvas) return;
    const context = canvas.getContext("2d")!;
    let frame = 0, last = performance.now(), time = 0;
    const tick = (now: number) => {
      const current = engine.current!;
      const dt = (now - last) / 1000;
      last = now;
      time += Math.min(dt, 0.1);
      current.sim.step(dt);
      current.renderer.draw(current.sim, time, marks.current.hovered, marks.current.selected);
      blit(context, current.renderer.scene, camera.current, view.current, current.renderer.backdrop);
      const bubble = bubbleRef.current;
      const target = bubble?.dataset.agent;
      if (bubble && target) {
        const head = current.renderer.headOf(target);
        if (head) placeBubble(bubble, head);
        else bubble.style.visibility = "hidden";
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, active]);

  // 휠로 커서 자리를 중심으로 확대·축소한다. React의 wheel은 passive라 직접 단다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(camera.current.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [active]);

  // 움직임 줄이기 설정을 따른다.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { if (engine.current) engine.current.sim.reduced = query.matches; };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  /** 말풍선 꼬리가 머리를 가리키게 두되, 창 밖으로 나가지 않게 좌우를 당기고 위에 자리가 없으면 발밑으로 내린다. */
  function placeBubble(bubble: HTMLDivElement, head: { x: number; y: number; foot: number }) {
    const { width, height } = LAYOUT.image;
    const top = toScreen(camera.current, view.current, width, height, head.x, head.y);
    const foot = toScreen(camera.current, view.current, width, height, head.x, head.foot);
    const w = bubble.offsetWidth, h = bubble.offsetHeight, gap = 12, edge = 8;
    const below = top.y - gap - h < edge;
    const left = Math.min(Math.max(top.x - w / 2, edge), Math.max(edge, view.current.width - w - edge));
    const y = below ? foot.y + gap : top.y - gap - h;
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
    bubble.style.setProperty("--tail-x", `${Math.round(Math.min(Math.max(top.x - left, 14), w - 14))}px`);
    if (below) bubble.dataset.below = ""; else delete bubble.dataset.below;
    bubble.style.visibility = "visible";
  }

  function zoomAt(zoom: number, x = view.current.width / 2, y = view.current.height / 2) {
    const { width, height } = LAYOUT.image;
    const before = toScene(camera.current, view.current, width, height, x, y);
    const next = clampCamera({ ...camera.current, zoom }, view.current, width, height);
    const after = toScene(next, view.current, width, height, x, y);
    camera.current = clampCamera({ zoom: next.zoom, cx: next.cx + before.x - after.x, cy: next.cy + before.y - after.y }, view.current, width, height);
    setZoomed(camera.current.zoom > 1.01);
  }

  const scenePoint = (event: ReactPointerEvent) => {
    const stage = stageRef.current!;
    const rect = stage.getBoundingClientRect();
    const ratio = stage.clientWidth / Math.max(1, rect.width);
    return toScene(camera.current, view.current, LAYOUT.image.width, LAYOUT.image.height, (event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio);
  };
  const hit = (event: ReactPointerEvent) => {
    const point = scenePoint(event);
    return engine.current?.renderer.hit(point.x, point.y) ?? null;
  };

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointer.current;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.panned && Math.hypot(dx, dy) > 4 && camera.current.zoom > 1.01) drag.panned = true;
      if (drag.panned) {
        const scale = toScreen(camera.current, view.current, LAYOUT.image.width, LAYOUT.image.height, 0, 0).scale;
        camera.current = clampCamera({ zoom: camera.current.zoom, cx: drag.cx - dx / scale, cy: drag.cy - dy / scale }, view.current, LAYOUT.image.width, LAYOUT.image.height);
        return;
      }
    }
    const id = hit(event);
    if (id !== hovered) setHovered(id);
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId, panned: false, cx: camera.current.cx, cy: camera.current.cy };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointer.current;
    pointer.current = null;
    if (!drag || drag.id !== event.pointerId || drag.panned) return;
    const id = hit(event);
    setSelected((current) => (id && current !== id ? id : null));
  }

  const legend = <div className="office-legend" aria-label="구역별 세션 수">
    {LEGEND.map((zone) => <span key={zone} className="office-legend-item" title={counts[zone].total > counts[zone].shown ? `최근 ${counts[zone].shown}개만 자리에 있습니다` : undefined}>
      <i style={{ background: ZONE_COLORS[zone], boxShadow: `0 0 6px ${ZONE_COLORS[zone]}` }} aria-hidden="true" /><span className="office-legend-label">{zoneLabel(zone)}</span><b>{counts[zone].total}</b>
    </span>)}
  </div>;
  const empty = ready && list.data && list.data.items.length === 0;
  const lines = useMemo(() => (shownSession ? bubbleLines(shownSession, history.data?.items) : []), [shownSession, history.data]);

  return <Window id="office" bodyClassName="office-body" header={<WindowTitleBar id="office" right={legend} />}>
    <div ref={stageRef} className="office-stage" data-ready={ready ? "" : undefined} data-hovering={hovered ? "" : undefined}
      onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
      onPointerLeave={() => { if (!pointer.current) setHovered(null); }}
      onDoubleClick={(event) => { const id = hit(event as unknown as ReactPointerEvent); if (id) openSession(id); }}>
      <canvas ref={canvasRef} className="office-canvas" role="img"
        aria-label={`도트 사무실: ${LEGEND.map((zone) => `${zoneLabel(zone)} ${counts[zone].total}`).join(", ")}`} />
      {shownSession ? <div ref={bubbleRef} className="office-bubble" data-agent={shownSession.id} role="status" aria-live="polite" style={{ visibility: "hidden" }}>
        <div className="office-bubble-title">{shownSession.sessionName ?? "이름 없는 세션"}</div>
        <div className="office-bubble-meta">
          <i style={{ background: ZONE_COLORS[shownSession.status ?? "hall"] }} aria-hidden="true" />
          {shownSession.agent} · 세션 {shortId(shownSession)} · {shownSession.status ? STATUS_LABELS[shownSession.status] : "상태 없음"}{shownSession.endedAt ? " · 종료됨" : ""}
        </div>
        <ol className="office-bubble-lines">{lines.map((line, index) => <li key={index}><time>{line.time}</time><span>{line.text}</span></li>)}</ol>
      </div> : null}
      <div className="office-zoom" onPointerDown={(event) => event.stopPropagation()}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="축소" disabled={!zoomed} onClick={() => zoomAt(camera.current.zoom / 1.4)}><Minus /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="전체 보기" disabled={!zoomed} onClick={() => zoomAt(1)}><Maximize2 /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="확대" onClick={() => zoomAt(camera.current.zoom * 1.4)}><Plus /></Button>
      </div>
      {!ready && !failed ? <div className="office-overlay" role="status"><LoaderCircle className="office-spin" aria-hidden="true" />사무실 문을 여는 중…</div> : null}
      {failed || list.error ? <div className="office-overlay" role="alert"><TriangleAlert aria-hidden="true" />{failed ?? list.error?.message}</div> : null}
      {empty ? <div className="office-overlay" role="status">아직 출근한 세션이 없습니다. <code>relay record</code>로 세션을 기록하면 홀에 나타납니다.</div> : null}
      <ul className="sr-only" aria-label="사무실에 있는 세션">
        {roster.map((session) => <li key={session.id}>
          <button type="button" data-office-agent={session.id} onFocus={() => setFocused(session.id)} onBlur={() => setFocused(null)} onClick={() => openSession(session.id)}>
            {session.sessionName ?? "이름 없는 세션"}, {zoneLabel(session.status ?? "hall")}{session.endedAt ? ", 종료됨" : ""}
          </button>
        </li>)}
      </ul>
    </div>
  </Window>;
}
