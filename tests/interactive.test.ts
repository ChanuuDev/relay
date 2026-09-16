import { describe, expect, test } from "bun:test";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { loadConfig } from "../src/config";
import { human, render } from "../src/output/human";
import { browse, copyNotice, terminalContext, type Keys, type Screen } from "../src/output/interactive";
import type { Session } from "../src/session/session.types";
import { sessionContext } from "../src/web/lib/session-context";
import { cleanup, root, temporary } from "./helpers";

const SPACE = 100;
const at = "2026-09-16T04:02:09.792Z";
function session(index: number, extra: Partial<Session> = {}): Session {
  return { id: `ses_00000000-0000-0000-0000-00000000000${index}`, provider: "openai", agent: "codex",
    providerSessionId: `f47ac10b-58cc-4372-a567-0e02b2c3d4000${index}`, sessionName: `세션 이름 ${index}`,
    model: "gpt-5", workingDirectory: root, summary: `요약 ${index}`,
    parentSessionId: null, createdAt: at, updatedAt: at, ...extra };
}

function screen(rows = 10) {
  const written: string[] = [];
  const fake = { rows, columns: SPACE, write: (text: string) => written.push(text), on: () => {}, off: () => {} };
  // Every repaint starts by homing the cursor, so the writes split cleanly into frames.
  return Object.assign(fake, {
    frames: () => written.join("").split("\x1b[H").slice(1),
    last: () => (written.join("").split("\x1b[H").at(-1) ?? "").split("\r\n"),
    all: () => written.join(""),
  }) satisfies Screen & Record<string, unknown>;
}

function keyboard() {
  const state = { raw: [] as boolean[], paused: false, listener: undefined as ((chunk: Buffer) => void) | undefined };
  const fake = {
    on: (_event: "data", listener: (chunk: Buffer) => void) => { state.listener = listener; },
    off: () => { state.listener = undefined; },
    resume: () => {}, pause: () => { state.paused = true; },
    setRawMode: (mode: boolean) => { state.raw.push(mode); },
  };
  return Object.assign(fake, { state, send: (text: string) => state.listener?.(Buffer.from(text, "utf8")) }) satisfies Keys & Record<string, unknown>;
}

/** SGR mouse report: 0 is a left press, 35 plain motion, 64/65 the wheel; rows and columns are 1-based. */
const report = (button: number, row: number, press = true) => `\x1b[<${button};12;${row}${press ? "M" : "m"}`;
/** Mouse reporting off, cursor back, alternate screen released. */
const RESTORE = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l";
const selectedRow = (lines: string[]) => lines.findIndex(line => line.startsWith("\x1b[7m"));
const tick = () => Bun.sleep(5);

function start(items: Session[], rows = 10) {
  const lines = render({ items, page: { total: items.length, offset: 0 } }, SPACE);
  const view = screen(rows); const keys = keyboard();
  const copied: Session[] = [];
  const done = browse(lines, SPACE, async s => { copied.push(s); return "copied"; }, view, keys);
  return { lines, view, keys, copied, done };
}

describe("Interactive terminal", () => {
  test("render marks each row with its session and stays identical to the plain text", () => {
    const items = [session(1), session(2)];
    const value = { items, page: { total: 2, offset: 0 } };
    const lines = render(value, SPACE);
    expect(lines.map(line => line.text).join("\n")).toBe(human(value, SPACE));
    // Header, rule and footer belong to no session; only the rows can be copied.
    expect(lines.filter(line => line.owner).map(line => line.owner)).toEqual(items);
    expect(lines.filter(line => !line.owner).length).toBe(3);
    const detail = render({ session: items[0], updates: [{ id: "u", sessionId: items[0]!.id, sequence: 1, summary: "진행", createdAt: at }], updatesPage: { total: 1 } }, SPACE);
    expect(detail.every(line => line.owner === items[0])).toBe(true);
    expect(render({ items: [{ sequence: 1 }] }, SPACE).every(line => !line.owner)).toBe(true);
  });

  test("hovering selects the row under the pointer and clicking copies it and closes", async () => {
    const items = [session(1), session(2), session(3)];
    const { view, keys, copied, done } = start(items);
    // Screen rows 1 and 2 are the header and rule; the first session sits on row 3.
    expect(selectedRow(view.last())).toBe(2);
    keys.send(report(35, 5, true));
    await tick();
    expect(selectedRow(view.last())).toBe(4);
    expect(stripVTControlCharacters(view.last()[4]!)).toContain(items[2]!.providerSessionId);
    keys.send(report(0, 5));
    // A copy ends the view the same way q does, so the reader is back at the prompt with the text ready.
    expect(await done).toEqual({ session: items[2]!, result: "copied" });
    expect(copied).toEqual([items[2]!]);
    expect(view.all()).toEndWith(RESTORE);
    expect(copyNotice({ session: items[2]!, result: "copied" })).toContain("복사됨");
    expect(copyNotice({ session: items[2]!, result: "failed" })).toContain("복사하지 못했습니다");
  });

  test("clicks outside a row and wheel scrolling never copy", async () => {
    const items = [session(1), session(2)];
    const { keys, copied, done } = start(items, 8);
    keys.send(report(0, 1));            // header
    keys.send(report(0, 8));            // empty space below the rows
    keys.send(report(65, 4));           // wheel down
    keys.send(report(64, 4));           // wheel up
    keys.send(report(0, 3, false));     // button release, not a press
    await tick();
    expect(copied).toEqual([]);
    keys.send("q");
    expect(await done).toBeUndefined();
  });

  test("keyboard moves, then Enter copies the selected row and closes", async () => {
    const items = [session(1), session(2), session(3)];
    const { view, keys, copied, done } = start(items);
    keys.send("\x1b[2;3R");             // cursor position report: ignored, must not close the view
    keys.send("G");
    await tick();
    expect(selectedRow(view.last())).toBe(4);
    keys.send("g");
    await tick();
    expect(selectedRow(view.last())).toBe(2);
    keys.send("\x1b[B");
    keys.send("\r");
    expect(await done).toEqual({ session: items[1]!, result: "copied" });
    expect(copied).toEqual([items[1]!]);
  });

  test("q, Esc and Ctrl+C each close without copying", async () => {
    for (const key of ["q", "\x1b", "\x03"]) {
      const { keys, copied, done } = start([session(1)]);
      keys.send(key);
      expect(await done).toBeUndefined();
      expect(copied).toEqual([]);
    }
  });

  test("closing restores the terminal it took over", async () => {
    const { view, keys, done } = start([session(1)]);
    expect(view.all()).toStartWith("\x1b[?1049h");
    expect(view.all()).toContain("\x1b[?1003h");
    expect(keys.state.raw).toEqual([true]);
    keys.send("\x1b");
    await done;
    expect(keys.state.raw).toEqual([true, false]);
    expect(keys.state.paused).toBe(true);
    expect(view.all()).toEndWith(RESTORE);
  });

  test("the copied text is the browser view's session context for the local store", () => {
    const dir = temporary();
    try {
      const config = loadConfig(dir);
      const target = session(1);
      const text = terminalContext(target, config);
      expect(text).toBe(sessionContext(target, { shell: process.platform === "win32" ? "powershell" : "bash",
        storeDirectory: config.dataDirectory, origin: "http://127.0.0.1:7474" }));
      expect(text).toContain("# Relay 세션 컨텍스트");
      expect(text).toContain(target.providerSessionId);
      expect(text).toContain(`http://127.0.0.1:7474/sessions/${target.id}`);
      expect(text).toContain("이 세션의 마지막 기록입니다.");
    } finally { cleanup(dir); }
  });

  test("redirected output prints the plain table and exits instead of waiting for a reader", async () => {
    const dir = temporary();
    try {
      const record = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "record", "--provider", "openai",
        "--agent", "codex", "--session-id", "redirect-check", "--summary", "요약", "--cwd", root, "--data-dir", dir],
        { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(record.exitCode).toBe(0);
      const listed = Bun.spawn([process.execPath, path.join(root, "src/index.ts"), "list", "--data-dir", dir],
        { cwd: root, stdout: "pipe", stderr: "pipe" });
      const code = await Promise.race([listed.exited, Bun.sleep(10_000).then(() => { listed.kill(); return "timeout"; })]);
      const stdout = await new Response(listed.stdout).text();
      expect(code).toBe(0);
      expect(stdout).toContain("redirect-check");
      expect(stdout).toContain("총 1건");
      expect(stdout).not.toContain("\x1b[?1049h");
    } finally { cleanup(dir); }
  }, 20_000);
});
