import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Maximize2, Minus, Moon, Plus, Sun, Sunset, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { DesktopMenu, type MenuEntry } from "../desktop/menu";
import { Button } from "../ui/button";
import { useDesktop } from "../../lib/desktop-store";
import { resource, type HistoryData, type ListData } from "../../lib/queries";
import { navigate, sessionUrl } from "../../lib/store";
import { reduced } from "../../lib/motion";
import { sendAction, STATUS_TO } from "../../lib/session-actions";
import { SESSION_STATUSES, STATUS_LABELS, type Session, type SessionAction } from "../../../session/session.types";
import { BADGE_URL, BADGES, SIT_SECONDS, SPRITES, WORKER_URL } from "../../lib/office/office-data";
import { BUILDINGS, buildingOf, storeBuilding, storedBuilding, type BuildingId } from "../../lib/office/buildings";
import { OfficeSim, TALLIES, type Agent, type OfficeSession, type Tally } from "../../lib/office/sim";
import { blit, clampCamera, LIFT_PX, loadImage, OfficeRenderer, toScene, toScreen, ZONE_COLORS, type Camera, type View } from "../../lib/office/render";
import { zoneAt, type OfficeLayout } from "../../lib/office/layout";
import { bubbleLines, clip, shortId, stamp, talkLine, zoneLabel } from "../../lib/office/bubble";
import { hash } from "../../lib/office/look";

const LIST_URL = "/api/v1/sessions?limit=100";
type Counts = Record<Tally, { shown: number; total: number }>;
const EMPTY_COUNTS = Object.fromEntries(TALLIES.map((tally) => [tally, { shown: 0, total: 0 }])) as Counts;
const sameCounts = (a: Counts, b: Counts) => TALLIES.every((tally) => a[tally].shown === b[tally].shown && a[tally].total === b[tally].total);
const nameOf = (session: Pick<OfficeSession, "sessionName">) => session.sessionName ?? "이름 없는 세션";
const isSessionQuery = (key: readonly unknown[]) => typeof key[1] === "string" && key[1].startsWith("/api/v1/sessions");
/** 머리 위 한마디 말풍선을 띄우는 순간: 작업 중인 세션은 책상에 앉아 있을 때, 퇴근하는 세션은 나가는 동안. */
const talking = (agent: Agent | undefined, kind: "work" | "home") => Boolean(agent) && (kind === "home"
  ? agent!.leaving === "home"
  : !agent!.leaving && agent!.zone === "working" && !agent!.session.endedAt && (agent!.mode === "seated" || agent!.mode === "sitdown"));
/** 잡은 손(포인터)에서 발밑 바닥까지: 옷깃에서 발까지 30px에 들린 높이를 더한다. */
const HOLD_OFFSET = 30 + LIFT_PX;
/** 말풍선마다 숨쉬기 박자를 어긋나게 한다. */
const floatDelay = (id: string) => `${-(hash(id) % 2800)}ms`;
/** 사옥 단추 아이콘: 밤·낮·노을 */
const BUILDING_ICONS: Record<BuildingId, LucideIcon> = { night: Moon, birch: Sun, oak: Sunset };

const toOffice = (session: Session): OfficeSession => ({
  id: session.id, provider: session.provider, agent: session.agent, providerSessionId: session.providerSessionId,
  sessionName: session.sessionName, summary: session.summary, status: session.status,
  createdAt: session.createdAt, updatedAt: session.updatedAt, endedAt: session.endedAt,
});

function openSession(id: string) {
  navigate(sessionUrl(id));
  useDesktop.getState().open("sessions");
}

/** 메뉴가 화면 아래로 넘치지 않게 올린다(항목 26px, 머리 24px, 구분선 9px). */
const menuTop = (top: number, entries: MenuEntry[]) => {
  const height = entries.reduce((sum, entry) => sum + (entry.kind === "separator" ? 9 : entry.kind === "label" ? 24 : 26), 8);
  return Math.max(8, Math.min(top, window.innerHeight - height - 8));
};

type Menu = { id: number; sessionId: string; left: number; top: number; keyboard: boolean };
type Notice = { tone: "done" | "error"; text: string; id: number };
type Rect = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** 에이전트 세션을 도트 사무실로 보여 준다. 상태마다 구역 책상에 앉고, 상태가 바뀌면 걸어서 옮기며, 일을 마치고 세션이 끝나면 퇴근한다. */
export function OfficeWindow() {
  const win = useDesktop((state) => state.windows.office);
  const active = win.open && !win.minimized;
  const queryClient = useQueryClient();
  const list = useQuery(resource<ListData>(LIST_URL, active));
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const talkRefs = useRef(new Map<string, HTMLDivElement>());
  const talkingNow = useRef<ReadonlySet<string>>(new Set());
  const engine = useRef<{ sim: OfficeSim; renderer: OfficeRenderer } | null>(null);
  const [building, setBuilding] = useState<BuildingId>(storedBuilding);
  /** 그리고 있는 사옥의 좌석·길. 사옥 그림을 다 받기 전에는 고르기 전 사옥 그대로다. */
  const layoutOf = (): OfficeLayout => engine.current?.sim.layout ?? buildingOf(building).layout;
  const camera = useRef<Camera>({ zoom: 1, cx: buildingOf(building).layout.image.width / 2, cy: buildingOf(building).layout.image.height / 2 });
  const view = useRef<View>({ width: 1, height: 1, dpr: 1 });
  const pointer = useRef<{ x: number; y: number; id: number; panned: boolean; cx: number; cy: number; agent: string | null; dragging: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [roster, setRoster] = useState<OfficeSession[]>([]);
  const [farewells, setFarewells] = useState<OfficeSession[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  const menuLeavingRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 사옥 그림을 받아 엔진을 새로 만들 때마다 오른다. 새 시뮬레이션에 목록을 다시 넣고 캔버스를 한 번 떠오르게 한다. */
  const [generation, setGeneration] = useState(0);
  const selected = menu && !menuLeaving ? menu.sessionId : null;
  const marks = useRef({ hovered: hovered as string | null, selected });
  marks.current = { hovered: hovered ?? focused, selected };
  // 메뉴를 연 동안에는 기록 말풍선을 접는다(메뉴가 같은 자리에 뜬다).
  const shown = menu || dragging ? null : hovered ?? focused;
  const shownSession = roster.find((session) => session.id === shown) ?? null;
  const history = useQuery(resource<HistoryData>(`/api/v1/sessions/${encodeURIComponent(shown ?? "")}/updates?limit=3`, Boolean(shown) && active));
  const talkers = useMemo(() => roster.filter((session) => session.status === "working" && !session.endedAt), [roster]);
  // 홀(대기)과 로비(완료)의 세션은 가끔 마주 보고 이야기한다. 말은 시뮬레이션이 정하고 여기서는 자리만 둔다.
  const chatters = useMemo(() => roster.filter((session) => session.status === null || session.status === "done"), [roster]);

  // 사옥 그림과 캐릭터 그림을 모두 받은 뒤 그 사옥의 좌석·길로 시뮬레이션과 그리기 준비를 한다.
  // 사옥을 바꾸면 새 사옥 그림을 다 받을 때까지 지금 사옥을 그대로 그리다가, 모두를 새 사옥 제자리에 앉힌다.
  useEffect(() => {
    let cancelled = false;
    const plan = buildingOf(building);
    // 책상 의자 그림을 받지 못해도 사무실은 연다(의자 없이 앉아 있을 뿐이다).
    const chair = plan.chair ? loadImage(plan.chair.url).catch(() => null) : Promise.resolve(null);
    Promise.all([loadImage(plan.url), loadImage(WORKER_URL), loadImage(BADGE_URL), chair]).then(([background, atlas, badges, chairImage]) => {
      if (cancelled) return;
      engine.current = {
        sim: new OfficeSim(plan.layout, { sitSeconds: SIT_SECONDS, reduced: reduced(), bodies: SPRITES.bodies.length }),
        renderer: new OfficeRenderer(background, atlas, SPRITES, SIT_SECONDS, { image: badges, sheet: BADGES },
          chairImage && plan.chair ? { image: chairImage, anchor: plan.chair.anchor, offset: plan.chair.offset } : null),
      };
      const { width, height } = plan.layout.image;
      camera.current = clampCamera({ zoom: 1, cx: width / 2, cy: height / 2 }, view.current, width, height);
      pointer.current = null;
      setDragging(null);
      setHovered(null);
      setZoomed(false);
      setGeneration((value) => value + 1);
      setReady(true);
    }).catch((error: unknown) => { if (!cancelled) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [building]);

  // 목록이 바뀔 때마다 누가 어디로 가야 하는지 다시 정한다.
  useEffect(() => {
    const current = engine.current;
    if (!ready || !current || !list.data) return;
    const sessions = list.data.items.map(toOffice);
    current.sim.sync(sessions);
    const next = current.sim.counts();
    setCounts((previous) => (sameCounts(previous, next) ? previous : next));
    const agents = current.sim.agents();
    const visible = new Set(agents.filter((agent) => !agent.leaving).map((agent) => agent.id));
    setRoster(sessions.filter((session) => visible.has(session.id)));
    // 로비에 머무는 완료+종료 세션과 지금 퇴근하는 세션은 나갈 때 인사 말풍선을 띄운다.
    setFarewells(agents.filter((agent) => agent.leaving === "home" || agent.homeAt !== null).map((agent) => agent.session));
  }, [ready, list.data, generation]);

  // 메뉴를 연 캐릭터가 사무실을 떠나면(퇴근·목록에서 빠짐) 메뉴도 닫는다.
  useEffect(() => {
    if (menu && !menuLeaving && !roster.some((session) => session.id === menu.sessionId)) { setMenu(null); menuLeavingRef.current = false; }
  }, [menu, menuLeaving, roster]);

  useEffect(() => {
    if (notice?.tone !== "done") return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

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
      camera.current = clampCamera(camera.current, view.current, layoutOf().image.width, layoutOf().image.height);
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
      current.renderer.draw(current.sim, time, marks.current.hovered, marks.current.selected, talkingNow.current);
      blit(context, current.renderer.scene, camera.current, view.current, current.renderer.backdrop);
      placeBubbles(current);
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

  const screenOf = (x: number, y: number) => toScreen(camera.current, view.current, layoutOf().image.width, layoutOf().image.height, x, y);

  /** 기록 말풍선을 먼저 달고, 작업 중·퇴근 한마디 말풍선은 서로·기록 말풍선과 겹치지 않는 자리에만 단다(겹치면 한 칸 위로, 그래도 겹치면 숨긴다). */
  function placeBubbles(current: { sim: OfficeSim; renderer: OfficeRenderer }) {
    const edge = 6, gap = 10;
    const placed: Rect[] = [];
    const bubble = bubbleRef.current;
    const target = bubble?.dataset.agent;
    if (bubble && target) {
      const head = current.renderer.headOf(target);
      if (head) placed.push(placeDetail(bubble, head));
      else bubble.style.visibility = "hidden";
    }
    const visible = new Set<string>();
    for (const element of talkRefs.current.values()) {
      const id = element.dataset.talk!;
      const kind = element.dataset.kind;
      let say = false;
      if (kind === "chat") {
        const line = current.sim.chatLine(id);
        const text = element.firstElementChild;
        if (line && text) { if (text.textContent !== line) text.textContent = line; say = true; }
      } else say = talking(current.sim.agent(id), kind === "home" ? "home" : "work");
      const head = id === target || !say ? null : current.renderer.headOf(id);
      if (!head) { element.style.visibility = "hidden"; continue; }
      const point = screenOf(head.x, head.y);
      const w = element.offsetWidth, h = element.offsetHeight;
      const left = Math.min(Math.max(point.x - w / 2, edge), Math.max(edge, view.current.width - w - edge));
      let spot: Rect | null = null;
      for (const lift of [0, h + 4]) {
        const top = point.y - gap - h - lift;
        const rect = { left, top, right: left + w, bottom: top + h };
        if (top >= edge && !placed.some((other) => overlaps(rect, other))) { spot = rect; break; }
      }
      if (!spot) { element.style.visibility = "hidden"; continue; }
      placed.push(spot);
      visible.add(id);
      element.style.transform = `translate(${Math.round(spot.left)}px, ${Math.round(spot.top)}px)`;
      element.style.setProperty("--tail-x", `${Math.round(Math.min(Math.max(point.x - spot.left, 10), w - 10))}px`);
      element.style.visibility = "visible";
    }
    talkingNow.current = visible;
  }

  /** 기록 말풍선 꼬리가 머리를 가리키게 두되, 창 밖으로 나가지 않게 좌우를 당기고 위에 자리가 없으면 발밑으로 내린다. */
  function placeDetail(bubble: HTMLDivElement, head: { x: number; y: number; foot: number }): Rect {
    const top = screenOf(head.x, head.y);
    const foot = screenOf(head.x, head.foot);
    const w = bubble.offsetWidth, h = bubble.offsetHeight, gap = 12, edge = 8;
    const below = top.y - gap - h < edge;
    const left = Math.min(Math.max(top.x - w / 2, edge), Math.max(edge, view.current.width - w - edge));
    const y = below ? foot.y + gap : top.y - gap - h;
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
    bubble.style.setProperty("--tail-x", `${Math.round(Math.min(Math.max(top.x - left, 14), w - 14))}px`);
    if (below) bubble.dataset.below = ""; else delete bubble.dataset.below;
    bubble.style.visibility = "visible";
    return { left, top: y, right: left + w, bottom: y + h };
  }

  function zoomAt(zoom: number, x = view.current.width / 2, y = view.current.height / 2) {
    const { width, height } = layoutOf().image;
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
    return toScene(camera.current, view.current, layoutOf().image.width, layoutOf().image.height, (event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio);
  };
  const hit = (event: ReactPointerEvent) => {
    const point = scenePoint(event);
    return engine.current?.renderer.hit(point.x, point.y) ?? null;
  };

  function openMenu(sessionId: string, left: number, top: number, keyboard: boolean) {
    menuLeavingRef.current = false;
    setMenuLeaving(false);
    setHovered(null);
    setMenu({ id: Date.now(), sessionId, left, top, keyboard });
  }
  /** 키보드로 고른 캐릭터는 머리 옆에 메뉴를 연다. */
  function openMenuAt(sessionId: string) {
    const head = engine.current?.renderer.headOf(sessionId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!head || !rect) { openMenu(sessionId, rect ? rect.left + rect.width / 2 : 200, rect ? rect.top + 80 : 200, true); return; }
    const point = screenOf(head.x, head.y);
    openMenu(sessionId, rect.left + point.x + 16, rect.top + point.y, true);
  }
  function closeMenu(returnFocus: boolean) {
    if (!menu || menuLeavingRef.current) return;
    menuLeavingRef.current = true;
    setMenuLeaving(true);
    if (returnFocus && menu.keyboard) document.querySelector<HTMLElement>(`[data-office-agent="${CSS.escape(menu.sessionId)}"]`)?.focus({ preventScroll: true });
  }
  function menuExited() {
    if (!menuLeavingRef.current) return;
    menuLeavingRef.current = false;
    setMenu(null);
    setMenuLeaving(false);
  }

  /** 상태 바꾸기·퇴근을 서버에 보내고 목록을 곧바로 다시 읽는다. 캐릭터는 다음 동기화에서 새 구역으로 서둘러 걸어간다. */
  async function run(session: OfficeSession, actions: SessionAction[], done: string) {
    try {
      for (const action of actions) await sendAction(session.id, action);
      await queryClient.invalidateQueries({ predicate: (query) => isSessionQuery(query.queryKey) });
      setNotice({ tone: "done", text: done, id: Date.now() });
    } catch (error) {
      setNotice({ tone: "error", text: `처리하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류입니다."}`, id: Date.now() });
    }
  }

  function menuEntries(session: OfficeSession): MenuEntry[] {
    const name = nameOf(session);
    const home: SessionAction[] = [...(session.status === "done" ? [] : [{ action: "status", status: "done" } as const]), ...(session.endedAt ? [] : [{ action: "end" } as const])];
    return [
      { kind: "label", id: "who", label: clip(name, 22) },
      { kind: "separator", id: "sep-who" },
      { kind: "label", id: "status-label", label: "작업 상태" },
      ...SESSION_STATUSES.map((status): MenuEntry => ({
        kind: "radio", id: `status-${status}`, label: STATUS_LABELS[status], checked: session.status === status,
        onSelect: () => { if (session.status !== status) void run(session, [{ action: "status", status }], `‘${clip(name, 20)}’ 세션을 ${STATUS_TO[status]} 옮깁니다.`); },
      })),
      { kind: "separator", id: "sep-home" },
      { kind: "item", id: "home", label: "퇴근 (작업 종료)", onSelect: () => void run(session, home, `‘${clip(name, 20)}’ 세션이 작업을 마치고 로비로 갑니다. 1분 뒤 퇴근합니다.`) },
      { kind: "item", id: "detail", label: "세션 상세 열기", onSelect: () => openSession(session.id) },
    ];
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointer.current;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      // 캐릭터를 누른 채 끌면 등을 잡아 들어 올린다. 발밑 바닥이 포인터 아래를 따라온다.
      if (drag.agent) {
        const sim = engine.current?.sim;
        if (!drag.dragging && Math.hypot(dx, dy) > 4 && sim?.grab(drag.agent)) { drag.dragging = true; setDragging(drag.agent); setHovered(null); }
        if (drag.dragging) {
          const point = scenePoint(event);
          sim?.hold(drag.agent, point.x, point.y + HOLD_OFFSET);
        }
        return;
      }
      if (!drag.panned && Math.hypot(dx, dy) > 4 && camera.current.zoom > 1.01) drag.panned = true;
      if (drag.panned) {
        const scale = screenOf(0, 0).scale;
        camera.current = clampCamera({ zoom: camera.current.zoom, cx: drag.cx - dx / scale, cy: drag.cy - dy / scale }, view.current, layoutOf().image.width, layoutOf().image.height);
        return;
      }
    }
    if (menu) return;
    const id = hit(event);
    if (id !== hovered) setHovered(id);
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const agent = hit(event);
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId, panned: false, cx: camera.current.cx, cy: camera.current.cy,
      agent: agent && roster.some((session) => session.id === agent) ? agent : null, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointer.current;
    pointer.current = null;
    if (!drag || drag.id !== event.pointerId || drag.panned) return;
    if (drag.dragging && drag.agent) { dropAgent(drag.agent); return; }
    if (drag.agent) openMenu(drag.agent, event.clientX + 6, event.clientY + 6, false);
  }
  /** 내려놓은 자리가 다른 구역이면 그 구역의 작업 상태로 바꾼다. 같은 구역·홀·벽이면 제자리로 돌아간다. */
  function dropAgent(id: string) {
    const sim = engine.current?.sim;
    const agent = sim?.agent(id);
    setDragging(null);
    if (!sim || !agent) return;
    const zone = zoneAt(layoutOf(), agent.x, agent.y);
    sim.drop(id);
    const session = roster.find((entry) => entry.id === id);
    if (!session || !zone || zone === "hall" || zone === agent.zone) return;
    void run(session, [{ action: "status", status: zone }], `‘${clip(nameOf(session), 20)}’ 세션을 ${STATUS_TO[zone]} 옮깁니다.`);
  }

  function chooseBuilding(id: BuildingId) {
    if (id === building) return;
    if (menu) { setMenu(null); setMenuLeaving(false); menuLeavingRef.current = false; }
    setBuilding(id);
    storeBuilding(id);
  }
  /** 사옥 단추 묶음은 라디오 그룹이라 방향키로 고르고 초점도 함께 옮긴다. */
  function buildingKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? BUILDINGS.length - 1 : null;
    if (!step && edge === null) return;
    event.preventDefault();
    const index = BUILDINGS.findIndex((entry) => entry.id === building);
    const next = BUILDINGS[edge ?? (index + step + BUILDINGS.length) % BUILDINGS.length]!;
    chooseBuilding(next.id);
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-building="${next.id}"]`)?.focus();
  }

  const legend = <div className="office-legend" aria-label="구역별 세션 수">
    {TALLIES.map((tally) => <span key={tally} className="office-legend-item" data-tally={tally}
      title={tally === "home" ? "작업을 마치고 세션이 끝나 퇴근한 세션" : counts[tally].total > counts[tally].shown ? `최근 ${counts[tally].shown}개만 자리에 있습니다` : undefined}>
      <i style={{ background: ZONE_COLORS[tally], boxShadow: tally === "home" ? "none" : `0 0 6px ${ZONE_COLORS[tally]}` }} aria-hidden="true" />
      <span className="office-legend-label">{zoneLabel(tally)}</span><b>{counts[tally].total}</b>
    </span>)}
  </div>;
  const empty = ready && list.data && list.data.items.length === 0;
  const lines = useMemo(() => (shownSession ? bubbleLines(shownSession, history.data?.items) : []), [shownSession, history.data]);
  const menuSession = menu ? roster.find((session) => session.id === menu.sessionId) ?? null : null;
  const items = menuSession ? menuEntries(menuSession) : [];
  const talkRef = (key: string) => (element: HTMLDivElement | null) => {
    if (element) talkRefs.current.set(key, element); else talkRefs.current.delete(key);
  };

  return <Window id="office" bodyClassName="office-body" header={<WindowTitleBar id="office" right={legend} />}>
    <div ref={stageRef} className="office-stage" data-building={building} data-ready={ready ? "" : undefined} data-hovering={hovered ? "" : undefined} data-dragging={dragging ? "" : undefined}
      onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
      onPointerCancel={() => { const drag = pointer.current; pointer.current = null; if (drag?.dragging && drag.agent) dropAgent(drag.agent); }}
      onPointerLeave={() => { if (!pointer.current) setHovered(null); }}>
      <canvas ref={canvasRef} className="office-canvas" role="img" data-fade={generation > 1 ? (generation % 2 ? "odd" : "even") : undefined}
        aria-label={`도트 사무실: ${TALLIES.map((tally) => `${zoneLabel(tally)} ${counts[tally].total}`).join(", ")}`} />
      {talkers.map((session) => <div key={session.id} ref={talkRef(`work:${session.id}`)} className="office-talk office-float" data-kind="work" data-talk={session.id}
        style={{ animationDelay: floatDelay(session.id) }} aria-hidden="true">
        <time>{stamp(session.updatedAt)}</time><span>{talkLine(session.summary)}</span>
      </div>)}
      {chatters.map((session) => <div key={session.id} ref={talkRef(`chat:${session.id}`)} className="office-talk office-float" data-kind="chat" data-talk={session.id}
        style={{ animationDelay: floatDelay(session.id) }} aria-hidden="true">
        <span />
      </div>)}
      {farewells.map((session) => <div key={session.id} ref={talkRef(`home:${session.id}`)} className="office-talk office-float" data-kind="home" data-talk={session.id}
        style={{ animationDelay: floatDelay(session.id) }} aria-hidden="true">
        <span>퇴근합니다! 수고하셨습니다</span>
      </div>)}
      {shownSession ? <div ref={bubbleRef} className="office-bubble office-float" data-agent={shownSession.id} role="status" aria-live="polite"
        style={{ visibility: "hidden", animationDelay: floatDelay(shownSession.id) }}>
        <div className="office-bubble-title">{nameOf(shownSession)}</div>
        <div className="office-bubble-meta">
          <i style={{ background: ZONE_COLORS[shownSession.status ?? "hall"] }} aria-hidden="true" />
          {shownSession.agent} · 세션 {shortId(shownSession)} · {shownSession.status ? STATUS_LABELS[shownSession.status] : "상태 없음"}{shownSession.endedAt ? " · 종료됨" : ""}
        </div>
        <ol className="office-bubble-lines">{lines.map((line, index) => <li key={index}><time>{line.time}</time><span>{line.text}</span></li>)}</ol>
        <div className="office-bubble-hint">눌러서 상태 바꾸기·퇴근 · 끌어서 다른 방에 놓기</div>
      </div> : null}
      <div className="office-buildings" role="radiogroup" aria-label="사옥" onPointerDown={(event) => event.stopPropagation()}>
        {BUILDINGS.map((entry) => {
          const Icon = BUILDING_ICONS[entry.id];
          const checked = entry.id === building;
          return <button key={entry.id} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} data-building={entry.id}
            title={entry.hint} onClick={() => chooseBuilding(entry.id)} onKeyDown={buildingKey}>
            <Icon aria-hidden="true" /><span>{entry.name}</span>
          </button>;
        })}
      </div>
      <div className="office-zoom" onPointerDown={(event) => event.stopPropagation()}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="축소" disabled={!zoomed} onClick={() => zoomAt(camera.current.zoom / 1.4)}><Minus /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="전체 보기" disabled={!zoomed} onClick={() => zoomAt(1)}><Maximize2 /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="확대" onClick={() => zoomAt(camera.current.zoom * 1.4)}><Plus /></Button>
      </div>
      {!ready && !failed ? <div className="office-overlay" role="status"><LoaderCircle className="office-spin" aria-hidden="true" />사무실 문을 여는 중…</div> : null}
      {failed || list.error ? <div className="office-overlay" role="alert"><TriangleAlert aria-hidden="true" />{failed ?? list.error?.message}</div> : null}
      {empty ? <div className="office-overlay" role="status">아직 출근한 세션이 없습니다. <code>relay record</code>로 세션을 기록하면 홀에 나타납니다.</div> : null}
      {notice && <div key={notice.id} className="office-toast material-toast" role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone}>
        {notice.tone === "error" && <TriangleAlert aria-hidden="true" />}
        <span>{notice.text}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="안내 닫기" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button>
      </div>}
      <ul className="sr-only" aria-label="사무실에 있는 세션. 고르면 작업 상태를 바꾸거나 퇴근시킵니다">
        {roster.map((session) => <li key={session.id}>
          <button type="button" data-office-agent={session.id} aria-haspopup="menu" onFocus={() => setFocused(session.id)} onBlur={() => setFocused(null)}
            onClick={() => openMenuAt(session.id)}>
            {nameOf(session)}, {zoneLabel(session.status ?? "hall")}{session.endedAt ? ", 종료됨" : ""}
          </button>
        </li>)}
      </ul>
    </div>
    {menu && menuSession && <DesktopMenu key={menu.id} items={items} position={{ left: menu.left, top: menuTop(menu.top, items) }} leaving={menuLeaving}
      onClose={closeMenu} onExited={menuExited} className="office-menu" />}
  </Window>;
}
