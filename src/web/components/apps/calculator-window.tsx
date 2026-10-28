import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Calculator, Delete, History, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { SplitView } from "../desktop/split-view";
import { DesktopMenu, type MenuEntry } from "../desktop/menu";
import { ConfirmDialog } from "../desktop/confirm-dialog";
import { EMPTY, formatTokens, insertValue, keyFromKeyboard, keysFromText, preview, press, smartParen, type CalcState, type Key, type Operator } from "../../lib/calculator";
import { useCalculatorHistory, type Calculation } from "../../lib/calculator-history";
import { useDesktop } from "../../lib/desktop-store";
import { cn } from "../../lib/utils";

/** 보이는 입력과 기록 패널 표시. 새로 고쳐도 하던 계산이 남는다. */
const VIEW_KEY = "relay-calculator-v1";
type View = { state: CalcState; history: boolean };
function readView(): View {
  try {
    const value = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<View> | null;
    const state = value?.state;
    const valid = state && Array.isArray(state.tokens) && (state.done === null || typeof state.done?.result === "string");
    return { state: valid ? { tokens: state.tokens, done: state.done ?? null, error: null } : EMPTY, history: value?.history !== false };
  } catch { return { state: EMPTY, history: true }; }
}

type Pad = { key: Key | "paren"; label: string; name: string; tone: "digit" | "function" | "operator"; wide?: boolean };
const PAD: Pad[] = [
  { key: "back", label: "⌫", name: "지우기", tone: "function" }, { key: "±", label: "±", name: "부호 바꾸기", tone: "function" },
  { key: "%", label: "%", name: "퍼센트", tone: "function" }, { key: "÷", label: "÷", name: "나누기", tone: "operator" },
  { key: "7", label: "7", name: "7", tone: "digit" }, { key: "8", label: "8", name: "8", tone: "digit" }, { key: "9", label: "9", name: "9", tone: "digit" },
  { key: "×", label: "×", name: "곱하기", tone: "operator" },
  { key: "4", label: "4", name: "4", tone: "digit" }, { key: "5", label: "5", name: "5", tone: "digit" }, { key: "6", label: "6", name: "6", tone: "digit" },
  { key: "−", label: "−", name: "빼기", tone: "operator" },
  { key: "1", label: "1", name: "1", tone: "digit" }, { key: "2", label: "2", name: "2", tone: "digit" }, { key: "3", label: "3", name: "3", tone: "digit" },
  { key: "+", label: "+", name: "더하기", tone: "operator" },
  { key: "paren", label: "( )", name: "괄호", tone: "function" }, { key: "0", label: "0", name: "0", tone: "digit" },
  { key: ".", label: ".", name: "소수점", tone: "digit" }, { key: "=", label: "=", name: "계산", tone: "operator" },
];
const PRESS_MS = 130;
const dayFormat = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const timeFormat = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
function dayLabel(time: number) {
  const day = new Date(time); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return diff === 0 ? "오늘" : diff === 1 ? "어제" : dayFormat.format(time);
}
/** 글이 길수록 큰 줄의 글자를 줄인다. */
const bigSize = (text: string) => (text.length <= 9 ? 44 : text.length <= 13 ? 34 : text.length <= 20 ? 26 : 20);
const editable = (target: EventTarget | null) => target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=alertdialog]"));

type Menu = { id: number; item: Calculation; left: number; top: number };

/** macOS 계산기처럼 기록 패널과 키패드가 있는 계산기. `=`로 끝낸 계산은 Relay 저장소에 이력으로 남는다. */
export function CalculatorWindow({ copy }: { copy: (value: string) => void }) {
  const open = useDesktop((state) => state.windows.calculator.open);
  const items = useCalculatorHistory((state) => state.items);
  const status = useCalculatorHistory((state) => state.status);
  const sync = useCalculatorHistory((state) => state.sync);
  const [view, setView] = useState(readView);
  const [pressed, setPressed] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLeaving, setMenuLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 좁은 창(34em 이하)에서는 기록과 계산기를 한 번에 하나만 보인다. 처음에는 계산기다.
  const [narrow, setNarrow] = useState(false);
  const [pane, setPane] = useState<"pad" | "history">("pad");
  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const stateRef = useRef(view.state);
  stateRef.current = view.state;
  const { state } = view;

  useEffect(() => { if (open) void useCalculatorHistory.getState().load(); }, [open]);
  useEffect(() => {
    const element = bodyRef.current;
    if (!open || !element) return;
    const measure = () => setNarrow(element.clientWidth > 0 && element.clientWidth <= 34 * parseFloat(getComputedStyle(element).fontSize));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* 저장 공간이 없어도 계산은 된다. */ }
  }, [view]);
  useEffect(() => {
    if (!pressed) return;
    const timer = setTimeout(() => setPressed(null), PRESS_MS);
    return () => clearTimeout(timer);
  }, [pressed]);

  const setState = (next: CalcState) => setView((current) => ({ ...current, state: next }));
  function apply(keys: Key[]) {
    let next = stateRef.current;
    for (const key of keys) {
      const step = press(next, key);
      next = step.state;
      if (step.finished) useCalculatorHistory.getState().add(step.finished.expression, step.finished.result);
    }
    stateRef.current = next;
    setState(next);
  }
  const tap = (pad: Pad) => apply([pad.key === "paren" ? smartParen(stateRef.current) : pad.key]);
  /** 보고 있는 값: 계산 결과, 아니면 미리 보기, 아니면 입력 중인 식. */
  const currentValue = () => {
    const now = stateRef.current;
    return now.done?.result ?? preview(now.tokens) ?? (formatTokens(now.tokens) || "0");
  };

  // 계산기 창이 앞에 있으면 키보드로 친다. 입력 칸·메뉴·대화 상자에 초점이 있으면 그쪽이 받는다.
  // 캡처 단계에서 받아, 화면 전체의 `/`(세션 검색) 단축키보다 먼저 나누기로 쓴다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || useDesktop.getState().focused !== "calculator" || editable(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        event.preventDefault(); copy(currentValue()); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 기록 목록의 행은 Enter·Delete·Backspace를 스스로 다룬다.
      if ((event.target as HTMLElement | null)?.closest?.(".calc-history") && ["Enter", " ", "Delete", "Backspace"].includes(event.key)) return;
      const key = keyFromKeyboard(event);
      if (!key) return;
      event.preventDefault();
      apply([key]);
      setPressed(key === "(" || key === ")" ? "paren" : key);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (useDesktop.getState().focused !== "calculator" || editable(event.target)) return;
      const keys = keysFromText(event.clipboardData?.getData("text") ?? "");
      if (!keys) return;
      event.preventDefault();
      apply([...(stateRef.current.done || stateRef.current.error ? ["clear" as Key] : []), ...keys]);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("paste", onPaste); };
  }, [open]);

  const typing = !state.done && !state.error;
  const expression = formatTokens(state.tokens);
  const live = typing ? preview(state.tokens) : null;
  const upper = state.done ? `${state.done.expression} =` : state.error ? expression : live ? `= ${live}` : "";
  const big = state.done ? state.done.result : state.error ? state.error : expression || "0";
  const pendingOp = typing && state.tokens.at(-1)?.kind === "op" ? (state.tokens.at(-1) as { op: Operator }).op : null;
  // 입력 중이면 한 글자 지우기(⌫), 비었거나 결과가 보이면 모두 지우기(AC).
  const clearsAll = !typing || state.tokens.length === 0;

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Calculation[] }> = [];
    for (const item of items) {
      const label = dayLabel(item.createdAt);
      if (out.at(-1)?.label === label) out.at(-1)!.items.push(item); else out.push({ label, items: [item] });
    }
    return out;
  }, [items]);

  /** 고른 뒤 초점을 계산기 영역으로 옮겨, 이어 누르는 Enter가 기록을 다시 고르지 않고 계산(=)이 되게 한다.
   *  보이면 곧바로, 좁은 창에서 아직 감춰져 있으면 키패드가 그려진 다음 프레임에 옮긴다. */
  const focusMain = () => {
    const main = mainRef.current;
    if (main?.getClientRects().length) main.focus({ preventScroll: true });
    else requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };
  /** 기록을 고르면 결과를 계산기에 넣는다. 좁은 창에서는 키패드로 돌아간다. */
  function putResult(item: Calculation) {
    const next = insertValue(stateRef.current, item.result);
    stateRef.current = next;
    setState(next);
    setPane("pad");
    focusMain();
  }
  function reuseExpression(item: Calculation) {
    const keys = keysFromText(item.expression);
    if (!keys) return;
    stateRef.current = EMPTY;
    apply(keys);
    setPane("pad");
    focusMain();
  }
  const showSide = narrow ? pane === "history" : view.history;
  const showMain = !narrow || pane === "pad";
  function remove(item: Calculation) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".calc-history .calc-entry"));
    const index = rows.findIndex((row) => row.dataset.id === item.id);
    useCalculatorHistory.getState().remove(item.id);
    requestAnimationFrame(() => (rows[index + 1] ?? rows[index - 1] ?? document.getElementById("calc-clear"))?.focus({ preventScroll: true }));
  }

  function openMenu(item: Calculation, left: number, top: number) {
    leavingRef.current = false;
    setMenuLeaving(false);
    setMenu({ id: Date.now(), item, left, top });
  }
  function closeMenu(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    leavingRef.current = true;
    setMenuLeaving(true);
    if (returnFocus) document.querySelector<HTMLElement>(`.calc-entry[data-id="${CSS.escape(menu.item.id)}"]`)?.focus({ preventScroll: true });
  }
  function menuExited() {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    setMenu(null);
    setMenuLeaving(false);
  }
  const menuItems = (item: Calculation): MenuEntry[] => [
    { kind: "item", id: "use", label: "결과 넣기", onSelect: () => putResult(item) },
    { kind: "item", id: "reuse", label: "식 다시 쓰기", onSelect: () => reuseExpression(item) },
    { kind: "separator", id: "sep-copy" },
    { kind: "item", id: "copy-result", label: "결과 복사", onSelect: () => copy(item.result) },
    { kind: "item", id: "copy-all", label: "식과 결과 복사", onSelect: () => copy(`${item.expression} = ${item.result}`) },
    { kind: "separator", id: "sep-delete" },
    { kind: "item", id: "delete", label: "삭제", danger: true, onSelect: () => remove(item) },
  ];
  function onEntryKey(event: ReactKeyboardEvent<HTMLButtonElement>, item: Calculation) {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(item); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".calc-history .calc-entry"));
      const index = rows.indexOf(event.currentTarget);
      rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
      return;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(item, rect.left + 24, rect.top + 30);
    }
  }

  const syncLabel = status === "loading" || status === "idle" ? "불러오는 중…" : status === "error" ? "서버 연결 대기"
    : sync === "saving" ? "저장 중…" : sync === "offline" ? "저장 대기 · 다시 시도 중" : sync === "rejected" ? "저장 실패" : "Relay DB에 저장됨";

  return <Window id="calculator" bodyClassName="calculator-body" header={
    <WindowTitleBar id="calculator" right={
      <Button type="button" variant="ghost" size="icon-sm" className="calc-history-toggle" aria-label="기록" title="기록 보기" aria-pressed={showSide}
        onClick={() => { if (narrow) setPane(pane === "pad" ? "history" : "pad"); else setView((current) => ({ ...current, history: !current.history })); }}>
        <History aria-hidden="true" /></Button>} />}>
    <div className="calc-frame" ref={bodyRef}>
    <SplitView name="calculator" label="계산 기록" className="calc-layout" data-side={showSide ? "shown" : "hidden"} data-main={showMain ? "shown" : "hidden"}
      defaultWidth={232} minWidth={188} maxWidth={360} minMain={280} side={
      <aside className="calc-history material-chrome" aria-label="계산 기록">
        <div className="calc-history-head">
          <span>기록</span>
          <Button type="button" variant="ghost" size="icon-xs" id="calc-clear" aria-label="기록 모두 지우기" title="기록 모두 지우기"
            disabled={!items.length} onClick={() => setConfirmOpen(true)}><Trash2 aria-hidden="true" /></Button>
        </div>
        <div className="calc-history-list">
          {groups.length ? groups.map((group) => <section key={group.label} className="calc-day" aria-label={group.label}>
            <h3>{group.label}</h3>
            {group.items.map((item) => <button key={item.id} type="button" className="calc-entry" data-id={item.id}
              title={`${timeFormat.format(item.createdAt)} · 눌러서 결과 넣기`}
              onClick={() => putResult(item)} onKeyDown={(event) => onEntryKey(event, item)}
              onContextMenu={(event) => { event.preventDefault(); openMenu(item, event.clientX, event.clientY); }}
              data-menu={menu?.item.id === item.id && !menuLeaving ? "" : undefined}>
              <span className="calc-entry-expression">{item.expression}</span>
              <span className="calc-entry-result">= {item.result}</span>
            </button>)}
          </section>) : <div className="calc-empty">
            <Calculator aria-hidden="true" />
            <strong>계산 기록이 없습니다</strong>
            <span>{status === "error" ? "Relay 서버에 연결하면 기록을 불러옵니다." : "=로 끝낸 계산이 여기에 남습니다."}</span>
          </div>}
        </div>
        <div className="calc-history-foot"><span>계산 {items.length.toLocaleString()}개</span>
          <span className="notes-sync" data-sync={status === "ready" ? sync : status === "idle" ? "loading" : status}>{syncLabel}</span></div>
      </aside>} main={
      <section className="calc-main" aria-label="계산기" tabIndex={-1} ref={mainRef}>
        <div className="calc-display" data-state={state.error ? "error" : state.done ? "done" : "typing"}>
          <div className="calc-upper" aria-hidden={!upper}>{upper}</div>
          <output className="calc-big" aria-live="polite" aria-label={state.done ? `결과 ${state.done.result}` : undefined}
            style={{ fontSize: state.error ? 22 : bigSize(big) }}>{big}</output>
        </div>
        <div className="calc-pad" role="group" aria-label="키패드">
          {PAD.map((pad) => {
            const back = pad.key === "back";
            const label = back ? (clearsAll ? "AC" : "⌫") : pad.label;
            return <button key={pad.key} type="button" className={cn("calc-key", back && clearsAll && "calc-key-text")} data-tone={pad.tone}
              data-key={pad.key} aria-label={back ? (clearsAll ? "모두 지우기" : "지우기") : pad.name}
              data-pressed={pressed === pad.key || (back && pressed === "clear") ? "" : undefined}
              data-active={pendingOp === pad.key ? "" : undefined}
              onClick={() => { if (back && clearsAll) apply(["clear"]); else tap(pad); }}>
              {back && !clearsAll ? <Delete aria-hidden="true" /> : label}
            </button>;
          })}
        </div>
      </section>} />
    </div>
    {menu && <DesktopMenu key={menu.id} items={menuItems(menu.item)} position={{ left: menu.left, top: Math.max(8, Math.min(menu.top, window.innerHeight - 200)) }}
      leaving={menuLeaving} onClose={closeMenu} onExited={menuExited} />}
    <ConfirmDialog open={confirmOpen} confirmLabel="모두 지우기" title="계산 기록을 모두 지울까요?"
      description={<p>기록 {items.length.toLocaleString()}개를 Relay 저장소에서 지우며 되돌릴 수 없습니다.</p>}
      onConfirm={() => useCalculatorHistory.getState().clear()} onClose={() => setConfirmOpen(false)}
      onCloseFocus={() => (document.getElementById("calc-clear") as HTMLButtonElement | null)?.disabled
        ? document.querySelector<HTMLElement>(".calc-key[data-key='=']")?.focus({ preventScroll: true })
        : document.getElementById("calc-clear")?.focus({ preventScroll: true })} />
  </Window>;
}
