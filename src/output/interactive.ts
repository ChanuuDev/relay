import type { Config } from "../config";
import type { Session } from "../session/session.types";
import { sessionContext } from "../web/lib/session-context";
import type { CopyResult } from "./clipboard";
import type { Line } from "./human";
import { clip, head, width } from "./terminal";

const ALT_ON = "\x1b[?1049h", ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l", CURSOR_SHOW = "\x1b[?25h";
// 1000 press/release, 1002 drag, 1003 plain motion so hovering moves the row, 1006 SGR coordinates past column 223.
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const MOUSE_EVENT = /^\x1b\[<(\d+);\d+;(\d+)([Mm])/;
const STYLE = /\x1b\[[0-9;]*m/g;
const REVERSE = "\x1b[7m", RESET = "\x1b[0m";
const LIST_HELP = "클릭 또는 Enter: 상세 보기 · ↑↓ 이동 · q 또는 Esc: 닫기";
const DETAIL_HELP = "클릭 또는 Enter: 세션 컨텍스트를 복사하고 닫기 · ↑↓ 스크롤 · Backspace 또는 Esc: 목록으로 · q: 닫기";
const ALONE_HELP = "클릭 또는 Enter: 세션 컨텍스트를 복사하고 닫기 · ↑↓ 스크롤 · q 또는 Esc: 닫기";

export function copyNotice(session: Session, result: CopyResult): string {
  if (result === "copied") return `복사됨 · ${session.providerSessionId} · 다음 대화에 붙여넣으세요`;
  if (result === "requested") return `터미널에 복사를 요청했습니다 · ${session.providerSessionId} · 붙여넣기가 안 되면 브라우저 화면에서 복사하세요`;
  return `클립보드 도구를 찾지 못해 복사하지 못했습니다 · ${session.providerSessionId}`;
}

type Action = "up" | "down" | "pageup" | "pagedown" | "home" | "end" | "enter" | "back" | "escape" | "quit" | "none";

const KEYS: [string, Action][] = [
  ["\x1b[A", "up"], ["\x1bOA", "up"], ["\x1b[B", "down"], ["\x1bOB", "down"],
  ["\x1b[5~", "pageup"], ["\x1b[6~", "pagedown"],
  ["\x1b[1~", "home"], ["\x1b[H", "home"], ["\x1bOH", "home"],
  ["\x1b[4~", "end"], ["\x1b[F", "end"], ["\x1bOF", "end"],
];

function single(character: string): Action {
  if (character === "\x03" || character === "q" || character === "Q") return "quit";
  if (character === "\x1b") return "escape";
  // Backspace arrives as DEL on most terminals and as BS on the Windows console.
  if (character === "\x7f" || character === "\x08") return "back";
  if (character === "\r" || character === "\n" || character === " ") return "enter";
  if (character === "j") return "down";
  if (character === "k") return "up";
  if (character === "g") return "home";
  if (character === "G") return "end";
  return "none";
}

/** How far a movement key goes: rows in the list, lines in the detail; the ends are unbounded. */
const STEP: Partial<Record<Action, number>> = { up: -1, down: 1, home: -Infinity, end: Infinity };

/** The terminal copies what the browser view copies: one shared builder, addressed at the local store. */
export function terminalContext(session: Session, config: Config): string {
  return sessionContext(session, {
    shell: process.platform === "win32" ? "powershell" : "bash",
    storeDirectory: config.dataDirectory,
  });
}

/** Both ends must be a terminal: a redirected list stays plain text so pipes and tests are unaffected. */
export function interactiveTerminal(): boolean {
  return process.env.RELAY_NO_TUI !== "1" && Boolean(process.stdout.isTTY) &&
    Boolean(process.stdin.isTTY) && typeof process.stdin.setRawMode === "function";
}

export interface Screen {
  write(text: string): unknown;
  rows?: number; columns?: number;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}
export interface Keys {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  off(event: "data", listener: (chunk: Buffer) => void): unknown;
  resume(): unknown; pause(): unknown;
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
}
export interface View {
  screen?: Screen; input?: Keys;
  /** Renders a listed session's detail. Without it the lines are the detail already, so a pick copies at once. */
  detail?: (session: Session) => Line[];
}

/** Draws the rendered lines: picking a list row opens its detail, and picking again in the detail is the
 *  copy. Resolves with the pick once the terminal is restored. Writing to the clipboard is the caller's
 *  job, so a slow clipboard tool cannot hold the view open after the click. */
export function browse(lines: Line[], space: number,
  { screen = process.stdout, input = process.stdin, detail }: View = {}): Promise<Session | undefined> {
  const rows = lines.flatMap((line, index) => line.owner ? [index] : []);
  let cursor = rows[0] ?? -1;
  let top = 0;
  // The detail card covers the list until Backspace or Esc brings the list back. Without a detail
  // renderer the lines are the card themselves, and there is no list to go back to.
  let card: { session: Session | undefined; lines: Line[]; top: number } | undefined =
    detail ? undefined : { session: lines.find(line => line.owner)?.owner, lines, top: 0 };
  let closed = false;
  let picked: Session | undefined;

  const body = () => Math.max(1, (screen.rows || 24) - 1);
  const anchor = (source: Line[], first: number) => Math.max(0, Math.min(first, source.length - body()));

  // The row already carries column colours; strip them so the selected bar reads as one surface.
  const selected = (text: string) => {
    const shown = head(text.replace(STYLE, ""), space);
    return `${REVERSE}${shown}${" ".repeat(Math.max(0, space - width(shown)))}${RESET}`;
  };

  const bar = () => {
    const room = Math.max(1, (screen.columns || space) - 1);
    const shown = clip(card ? (detail ? DETAIL_HELP : ALONE_HELP) : LIST_HELP, room - 1);
    return `${REVERSE} ${shown}${" ".repeat(Math.max(0, room - width(shown) - 1))}${RESET}`;
  };

  const draw = () => {
    const height = body();
    let source = lines, first = 0, marked = -1;
    if (card) {
      card.top = anchor(card.lines, card.top);
      source = card.lines; first = card.top;
    } else {
      if (cursor >= 0) {
        if (cursor < top) top = cursor;
        if (cursor >= top + height) top = cursor - height + 1;
      }
      top = anchor(lines, top); first = top; marked = cursor;
    }
    const painted: string[] = [];
    for (let offset = 0; offset < height; offset++) {
      const index = first + offset;
      const text = source[index]?.text ?? "";
      painted.push((index === marked ? selected(text) : text) + "\x1b[K");
    }
    screen.write(`\x1b[H${painted.join("\r\n")}\r\n${bar()}\x1b[K`);
  };

  // The list keeps the cursor on a row; the detail only scrolls.
  const move = (step: number) => {
    if (card) { card.top = Math.max(0, Math.min(card.lines.length, card.top + step)); return; }
    if (!rows.length) return;
    const current = Math.max(0, rows.indexOf(cursor));
    cursor = rows[Math.max(0, Math.min(rows.length - 1, current + step))]!;
  };

  return new Promise<Session | undefined>(resolve => {
    const close = () => {
      if (closed) return;
      closed = true;
      input.off("data", onData);
      screen.off("resize", draw);
      input.setRawMode?.(false);
      input.pause();
      screen.write(`${MOUSE_OFF}${CURSOR_SHOW}${ALT_OFF}`);
      resolve(picked);
    };

    // Opening the detail is what a list row is for; copying is what the detail is for.
    const open = () => {
      const session = cursor >= 0 ? lines[cursor]?.owner : undefined;
      if (!session || !detail || closed) return;
      card = { session, lines: detail(session), top: 0 };
      draw();
    };
    const pick = () => {
      if (!card?.session || closed) return;
      picked = card.session;
      close();
    };
    // Leaving the detail returns to the list, cursor still on the row; a lone detail can only close.
    const leave = () => {
      if (!detail) return close();
      card = undefined;
      draw();
    };

    const perform = (action: Action) => {
      if (action === "none") return;
      if (action === "quit") return close();
      if (action === "escape") return card ? leave() : close();
      if (action === "back") return card ? leave() : undefined;
      if (action === "enter") return card ? pick() : open();
      move(STEP[action] ?? (action === "pageup" ? -body() : body()));
      draw();
    };

    const mouse = (button: number, row: number, press: boolean) => {
      if (button === 64 || button === 65) {
        if (!press) return;
        const step = button === 64 ? -3 : 3;
        if (card) card.top = anchor(card.lines, card.top + step);
        else top = anchor(lines, top + step);
        draw();
        return;
      }
      // Motion carries bit 32; only a plain left press is a click.
      const click = press && (button & 32) === 0 && (button & 3) === 0;
      const inside = row >= 1 && row <= body();
      if (card) { if (click && inside) pick(); return; }
      const index = inside ? top + row - 1 : -1;
      const over = index >= 0 && Boolean(lines[index]?.owner) ? index : -1;
      if (over >= 0 && over !== cursor) { cursor = over; draw(); }
      if (click && over >= 0) open();
    };

    const onData = (chunk: Buffer) => {
      const data = chunk.toString("utf8");
      let index = 0;
      while (index < data.length && !closed) {
        const rest = data.slice(index);
        const event = MOUSE_EVENT.exec(rest);
        if (event) {
          mouse(Number(event[1]), Number(event[2]), event[3] === "M");
          index += event[0].length;
          continue;
        }
        const key = KEYS.find(([sequence]) => rest.startsWith(sequence));
        if (key) { perform(key[1]); index += key[0].length; continue; }
        // Skip an unrecognised CSI/SS3 report whole, so its leading Escape is not read as a key.
        if (rest.startsWith("\x1b[") || rest.startsWith("\x1bO")) {
          const final = rest.slice(2).search(/[@-~]/);
          index += final >= 0 ? final + 3 : rest.length;
          continue;
        }
        perform(single(rest[0]!));
        index += 1;
      }
    };

    screen.write(`${ALT_ON}${CURSOR_HIDE}${MOUSE_ON}\x1b[2J`);
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
    screen.on("resize", draw);
    draw();
  });
}
