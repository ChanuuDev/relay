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
const HELP = "클릭 또는 Enter: 세션 컨텍스트를 복사하고 닫기 · ↑↓ 이동 · q 또는 Esc: 닫기";

export function copyNotice(session: Session, result: CopyResult): string {
  if (result === "copied") return `복사됨 · ${session.providerSessionId} · 다음 대화에 붙여넣으세요`;
  if (result === "requested") return `터미널에 복사를 요청했습니다 · ${session.providerSessionId} · 붙여넣기가 안 되면 브라우저 화면에서 복사하세요`;
  return `클립보드 도구를 찾지 못해 복사하지 못했습니다 · ${session.providerSessionId}`;
}

type Action = "up" | "down" | "pageup" | "pagedown" | "home" | "end" | "copy" | "quit" | "none";

const KEYS: [string, Action][] = [
  ["\x1b[A", "up"], ["\x1bOA", "up"], ["\x1b[B", "down"], ["\x1bOB", "down"],
  ["\x1b[5~", "pageup"], ["\x1b[6~", "pagedown"],
  ["\x1b[1~", "home"], ["\x1b[H", "home"], ["\x1bOH", "home"],
  ["\x1b[4~", "end"], ["\x1b[F", "end"], ["\x1bOF", "end"],
];

function single(character: string): Action {
  if (character === "\x03" || character === "\x1b" || character === "q" || character === "Q") return "quit";
  if (character === "\r" || character === "\n" || character === " ") return "copy";
  if (character === "j") return "down";
  if (character === "k") return "up";
  if (character === "g") return "home";
  if (character === "G") return "end";
  return "none";
}

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

/** Draws the rendered lines until a row is picked or a close key ends the view, and resolves with the
 *  pick once the terminal is restored. Writing to the clipboard is the caller's job, so a slow
 *  clipboard tool cannot hold the view open after the click. */
export function browse(lines: Line[], space: number,
  screen: Screen = process.stdout, input: Keys = process.stdin): Promise<Session | undefined> {
  const rows = lines.flatMap((line, index) => line.owner ? [index] : []);
  let cursor = rows[0] ?? -1;
  let top = 0;
  let closed = false;
  let picked: Session | undefined;

  const body = () => Math.max(1, (screen.rows || 24) - 1);
  const anchor = () => Math.max(0, Math.min(top, Math.max(0, lines.length - body())));

  // The row already carries column colours; strip them so the selected bar reads as one surface.
  const selected = (text: string) => {
    const shown = head(text.replace(STYLE, ""), space);
    return `${REVERSE}${shown}${" ".repeat(Math.max(0, space - width(shown)))}${RESET}`;
  };

  const bar = () => {
    const room = Math.max(1, (screen.columns || space) - 1);
    const shown = clip(HELP, room - 1);
    return `${REVERSE} ${shown}${" ".repeat(Math.max(0, room - width(shown) - 1))}${RESET}`;
  };

  const draw = () => {
    const height = body();
    if (cursor >= 0) {
      if (cursor < top) top = cursor;
      if (cursor >= top + height) top = cursor - height + 1;
    }
    top = anchor();
    const painted: string[] = [];
    for (let offset = 0; offset < height; offset++) {
      const index = top + offset;
      const text = lines[index]?.text ?? "";
      painted.push((index === cursor ? selected(text) : text) + "\x1b[K");
    }
    screen.write(`\x1b[H${painted.join("\r\n")}\r\n${bar()}\x1b[K`);
  };

  const move = (step: number) => {
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

    // Picking a session is the whole point of the view, so it ends the same way q does.
    const pick = () => {
      const session = cursor >= 0 ? lines[cursor]?.owner : undefined;
      if (!session || closed) return;
      picked = session;
      close();
    };

    const perform = (action: Action) => {
      if (action === "quit") return close();
      if (action === "copy") return pick();
      if (action === "none") return;
      if (action === "up") move(-1);
      else if (action === "down") move(1);
      else if (action === "pageup") move(-body());
      else if (action === "pagedown") move(body());
      else if (action === "home") move(-rows.length);
      else move(rows.length);
      draw();
    };

    const mouse = (button: number, row: number, press: boolean) => {
      if (button === 64 || button === 65) {
        if (!press) return;
        top = Math.max(0, Math.min(top + (button === 64 ? -3 : 3), Math.max(0, lines.length - body())));
        draw();
        return;
      }
      const index = row >= 1 && row <= body() ? top + row - 1 : -1;
      const over = index >= 0 && Boolean(lines[index]?.owner) ? index : -1;
      if (over >= 0 && over !== cursor) { cursor = over; draw(); }
      // Motion carries bit 32; only a plain left press is a click.
      if (press && (button & 32) === 0 && (button & 3) === 0 && over >= 0) pick();
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
        // Skip an unrecognised CSI/SS3 report whole, so its leading Escape is not read as quit.
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
