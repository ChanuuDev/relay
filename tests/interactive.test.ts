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
/** The highlighted body row; the help bar on the last line is reverse video too, so it is left out. */
const selectedRow = (lines: string[]) => lines.slice(0, -1).findIndex(line => line.startsWith("\x1b[7m"));
const shownText = (view: ReturnType<typeof screen>) => stripVTControlCharacters(view.last().join("\n"));
const tick = () => Bun.sleep(5);

/** What a list row opens: the same detail the browser shows, with one history entry. */
function inspect(session: Session) {
  return render({ session, parentSession: null, children: [], childrenPage: { total: 0 },
    updates: [{ id: "u", sessionId: session.id, sequence: 1, summary: `진행 ${session.sessionName}`, createdAt: at }],
    updatesPage: { total: 1 } }, SPACE);
}

function start(items: Session[], rows = 10) {
  const lines = render({ items, page: { total: items.length, offset: 0 } }, SPACE);
  const view = screen(rows); const keys = keyboard();
  return { lines, view, keys, done: browse(lines, SPACE, { screen: view, input: keys, detail: inspect }) };
}

describe("Interactive terminal", () => {
  test("render marks each row with its session and stays identical to the plain text", () => {
    const items = [session(1), session(2)];
    const value = { items, page: { total: 2, offset: 0 } };
    const lines = render(value, SPACE);
    expect(lines.map(line => line.text).join("\n")).toBe(human(value, SPACE));
    // Header, rule and footer belong to no session; only the rows can be opened.
    expect(lines.filter(line => line.owner).map(line => line.owner)).toEqual(items);
    expect(lines.filter(line => !line.owner).length).toBe(3);
    const detail = render({ session: items[0], updates: [{ id: "u", sessionId: items[0]!.id, sequence: 1, summary: "진행", createdAt: at }], updatesPage: { total: 1 } }, SPACE);
    expect(detail.every(line => line.owner === items[0])).toBe(true);
    expect(render({ items: [{ sequence: 1 }] }, SPACE).every(line => !line.owner)).toBe(true);
  });

  test("hovering selects the row under the pointer, a click opens its detail and a second click copies and closes", async () => {
    const items = [session(1), session(2), session(3)];
    const { view, keys, done } = start(items, 40);
    // Screen rows 1 and 2 are the header and rule; the first session sits on row 3.
    expect(selectedRow(view.last())).toBe(2);
    expect(shownText(view)).toContain("상세 보기");
    keys.send(report(35, 5, true));
    await tick();
    expect(selectedRow(view.last())).toBe(4);
    expect(stripVTControlCharacters(view.last()[4]!)).toContain(items[2]!.providerSessionId);
    keys.send(report(0, 5));
    keys.send(report(0, 5, false));     // the release that follows the click changes nothing
    await tick();
    // The detail covers the list: no row is highlighted, and the browser's sections are all there.
    expect(selectedRow(view.last())).toBe(-1);
    const shown = shownText(view);
    for (const part of [items[2]!.sessionName!, "codex · agent-session-chain", "최근 작업 요약", "요약 3", "세션 정보",
      items[2]!.providerSessionId, "기록 이력 (1건)", "진행 세션 이름 3", "세션 연결 (0건)", "최초 세션", "목록으로"]) expect(shown).toContain(part);
    expect(shown).not.toContain(items[0]!.providerSessionId);
    keys.send(report(0, 3));
    // The view ends the same way q does; the clipboard write happens after the terminal is restored,
    // so a slow clipboard tool cannot leave the screen hanging.
    expect(await done).toBe(items[2]!);
    expect(view.all()).toEndWith(RESTORE);
    expect(copyNotice(items[2]!, "copied")).toContain("복사됨");
    expect(copyNotice(items[2]!, "failed")).toContain("복사하지 못했습니다");
  });

  test("clicks outside a row and wheel scrolling never open anything", async () => {
    const items = [session(1), session(2)];
    const { view, keys, done } = start(items, 8);
    keys.send(report(0, 1));            // header
    keys.send(report(0, 8));            // empty space below the rows
    keys.send(report(65, 4));           // wheel down
    keys.send(report(64, 4));           // wheel up
    keys.send(report(0, 3, false));     // button release, not a press
    await tick();
    expect(selectedRow(view.last())).toBe(2);
    keys.send("q");
    expect(await done).toBeUndefined();
  });

  test("keyboard moves, Enter opens the selected row's detail and Enter again copies and closes", async () => {
    const items = [session(1), session(2), session(3)];
    const { view, keys, done } = start(items, 40);
    keys.send("\x1b[2;3R");             // cursor position report: ignored, must not close the view
    keys.send("G");
    await tick();
    expect(selectedRow(view.last())).toBe(4);
    keys.send("g");
    await tick();
    expect(selectedRow(view.last())).toBe(2);
    keys.send("\x1b[B");
    keys.send("\r");
    await tick();
    expect(shownText(view)).toContain(items[1]!.providerSessionId);
    expect(shownText(view)).not.toContain(items[2]!.providerSessionId);
    keys.send("\r");
    expect(await done).toBe(items[1]!);
  });

  test("Backspace and Esc leave the detail for the list with the row still selected; q closes from the detail", async () => {
    const items = [session(1), session(2)];
    const { view, keys, done } = start(items, 40);
    for (const back of ["\x7f", "\x1b", "\x08"]) {
      keys.send("\x1b[B");
      keys.send("\r");
      await tick();
      expect(selectedRow(view.last())).toBe(-1);
      expect(shownText(view)).toContain("최근 작업 요약");
      keys.send(back);
      await tick();
      expect(selectedRow(view.last())).toBe(3);
      expect(shownText(view)).not.toContain("최근 작업 요약");
      keys.send("\x1b[A");
      await tick();
      expect(selectedRow(view.last())).toBe(2);
    }
    keys.send("\x7f");                  // Backspace in the list has nothing to go back to
    keys.send("\r");
    await tick();
    expect(shownText(view)).toContain("최근 작업 요약");
    keys.send("q");
    expect(await done).toBeUndefined();
    expect(view.all()).toEndWith(RESTORE);
  });

  test("the detail scrolls with the keys and the wheel instead of moving a cursor", async () => {
    const items = [session(1, { summary: Array.from({ length: 30 }, (_, i) => `줄 ${i + 1}`).join("\n") })];
    const { view, keys, done } = start(items, 8);
    const first = () => stripVTControlCharacters(view.last()[0]!);
    keys.send("\r");
    await tick();
    expect(first()).toContain("세션 이름 1");
    keys.send("\x1b[B");
    await tick();
    expect(first()).toContain("codex");
    keys.send("\x1b[6~");
    await tick();
    expect(first()).toContain("줄 ");
    keys.send("G");
    await tick();
    expect(shownText(view)).toContain("이어받은 세션 없음");
    keys.send(report(64, 3));
    await tick();
    expect(shownText(view)).not.toContain("이어받은 세션 없음");
    keys.send("g");
    await tick();
    expect(first()).toContain("세션 이름 1");
    expect(selectedRow(view.last())).toBe(-1);
    keys.send("\x1b");
    await tick();
    expect(selectedRow(view.last())).toBe(2);
    keys.send("q");
    expect(await done).toBeUndefined();
  });

  test("a single session view starts in its detail: Enter copies at once and Esc or Backspace closes", async () => {
    const target = session(1);
    const lines = render({ session: target, parentSession: null, children: [], childrenPage: { total: 0 } }, SPACE);
    for (const [key, expected] of [["\r", target], ["\x1b", undefined], ["\x7f", undefined]] as const) {
      const view = screen(40); const keys = keyboard();
      const done = browse(lines, SPACE, { screen: view, input: keys });
      expect(selectedRow(view.last())).toBe(-1);
      expect(shownText(view)).toContain("세션 정보");
      expect(shownText(view)).not.toContain("목록으로");
      keys.send(key);
      expect(await done).toBe(expected);
    }
  });

  test("q, Esc and Ctrl+C each close the list without picking", async () => {
    for (const key of ["q", "\x1b", "\x03"]) {
      const { keys, done } = start([session(1)]);
      keys.send(key);
      expect(await done).toBeUndefined();
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
        storeDirectory: config.dataDirectory }));
      expect(text).toContain("relay show");
      expect(text).toContain(target.providerSessionId);
      expect(text).toContain(config.dataDirectory);
      expect(text).toEndWith("명령을 실행해 확인하고, 그 기록을 참고해 다음 작업에 참고 해주세요.");
    } finally { cleanup(dir); }
  });

  // A newline lands as Enter while the paste is still arriving, so the receiving CLI sends the
  // first lines as a message and drops the rest. The text has to stay a single line.
  test("the copied text stays one line even when the session values carry line breaks", () => {
    const dir = temporary();
    try {
      const config = loadConfig(dir);
      const target = { ...session(1), sessionName: "줄바꿈\n작업명", summary: "첫 줄\n```text\n둘째 줄\n```\n끝 줄" };
      const text = terminalContext(target, config);
      expect(text).not.toContain("\n");
      expect(text).not.toContain("\r");
      expect(text).toContain(target.providerSessionId);
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
