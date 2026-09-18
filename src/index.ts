#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { errorBody, invalid, RelayError, storageError } from "./errors";
import { autoInstallHostHooks, installHostHooks } from "./hooks/install";
import { copyToClipboard } from "./output/clipboard";
import { render } from "./output/human";
import { browse, copyNotice, interactiveTerminal, terminalContext } from "./output/interactive";
import { terminalWidth } from "./output/terminal";
import { SessionRepository } from "./session/session.repository";
import { HOOK_SUMMARY, PROVIDERS, SessionService } from "./session/session.service";
import type { NewSession, Session } from "./session/session.types";
import { directory } from "./validation";
import { sessionCommand } from "./web/lib/session-context";
import { startServer } from "./web/server";
import { version } from "../package.json";

const program = new Command().name("relay").description("로컬 AI Agent 세션 기록과 브라우저 조회")
  .version(version).option("--data-dir <path>", "저장소 절대경로 (RELAY_DATA_DIR보다 우선)")
  .option("--json", "데이터 명령의 JSON 출력")
  .option("--codex", "최근 Codex 세션 조회 (latest codex)")
  .option("--claude", "최근 Claude 세션 조회 (latest claude)")
  .option("--grok", "최근 Grok 세션 조회 (latest grok)")
  .showSuggestionAfterError(false).exitOverride()
  .configureOutput({ writeErr: () => {} });

const shortcuts = ["codex", "claude", "grok"] as const;
program.hook("preAction", (_command, actionCommand) => {
  const selected = shortcuts.filter(alias => program.opts()[alias]);
  if (selected.length > 1) invalid("--codex, --claude, --grok 중 하나만 지정하세요.");
  if (selected.length && actionCommand !== program) invalid("최근 세션 조회 옵션은 다른 명령과 함께 사용할 수 없습니다.");
});
program.action((options, command: Command) => {
  const alias = shortcuts.find(alias => options[alias]);
  if (alias) return run(command, false, s => s.latest(alias));
  program.outputHelp();
});

async function run(command: Command, write: boolean, action: (service: SessionService) => unknown) {
  const options = command.optsWithGlobals();
  const config = loadConfig(options.dataDir);
  const db = openDatabase(config, !write);
  const service = new SessionService(new SessionRepository(db), config.retentionDays);
  let picked: Session | undefined;
  try {
    let result: unknown;
    try { result = action(service); }
    catch (error) {
      if (error instanceof RelayError && error.code === "SESSION_NOT_FOUND" && error.details?.relayId &&
        typeof error.details.providerSessionId === "string" && typeof error.details.provider === "string") {
        const shell = process.platform === "win32" ? "powershell" : "bash";
        const command = sessionCommand({ providerSessionId: error.details.providerSessionId, provider: error.details.provider }, config.dataDirectory, shell);
        error.message += ` 다음 명령으로 조회하세요:\n${command}`;
        error.details = { ...error.details, command, shell };
      }
      throw error;
    }
    if (options.json) return void process.stdout.write(JSON.stringify(result) + "\n");
    const space = terminalWidth();
    const lines = render(result, space);
    // The reader browses the same rows in the terminal, then keeps the plain table in the scrollback.
    // A list keeps the store open meanwhile, so the picked row can show its history and connections.
    const listed = Array.isArray((result as { items?: unknown }).items);
    picked = interactiveTerminal() && lines.some(line => line.owner)
      ? await browse(lines, space, listed ? { detail: session => render(inspect(service, session), space) } : {}) : undefined;
    process.stdout.write(lines.map(line => line.text).join("\n") + "\n");
  } finally { db.close(); }
  // The clipboard runs after the view is gone, so a slow tool never delays closing it.
  // stdout stays the table alone; what the reader picked is status, so it goes to stderr.
  if (picked) process.stderr.write(copyNotice(picked, await copyToClipboard(terminalContext(picked, config))) + "\n");
}

/** A picked row shows what the browser's detail panel shows; a row the store has since dropped still shows itself. */
function inspect(service: SessionService, session: Session): unknown {
  try { return service.inspect(session.id); } catch { return { session }; }
}

function creation(command: Command) {
  return command.requiredOption("--provider <provider>", "제공자 회사 식별자: openai/anthropic/xai 등")
    .requiredOption("--agent <agent>", "도구 식별자: codex/claude-code/grok 등")
    .requiredOption("--session-id <id>", "새 세션의 실제 Agent Session ID")
    .requiredOption("--summary <text>", "첫 기록 요약 (1~4000자)")
    .option("--session-name <name>", "세션 이름 (최대 200자)")
    .option("--model <model>", "모델 (미지정 시 null)")
    .option("--cwd <path>", "존재하는 작업 디렉터리 절대경로");
}

creation(program.command("record").description("세션 정보 첫 기록"))
  .action((options: NewSession, command: Command) => run(command, true, s => s.record(options)));
creation(program.command("continue <session-id>").description("이전 세션 기록에 새 세션 연결"))
  .option("--parent-provider <provider>", "부모 세션의 제공자")
  .action((id: string, options: NewSession & { parentProvider?: string }, command: Command) => run(command, true, s => s.record(options, id, options.parentProvider)));

program.command("update").description("진행 요약과 이력 추가")
  .requiredOption("--session-id <id>", "Agent Session ID").requiredOption("--summary <text>", "진행 요약")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((o, c: Command) => run(c, true, s => s.update(o.sessionId, o.summary, o.provider)));
program.command("show <session-id>").description("Agent Session ID로 세션 상세 조회 (Relay 내부 ID 아님)")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)").option("--history", "진행 이력 포함")
  .option("--limit <number>", "이력 페이지 크기 (1~100, 기본 50)").option("--offset <number>", "이력 offset (기본 0)")
  .action((id: string, o, c: Command) => run(c, false, s => s.show(id, o.provider, o.history, o)));
program.command("list").description("세션 테이블 조회")
  .option("--provider <provider>", "제공자").option("--agent <agent>", "도구")
  .option("--cwd <path>", "작업 경로 정확히 일치").option("--query <text>", "이름·ID·요약·경로 부분 검색")
  .option("--limit <number>", "페이지 크기 (1~100, 기본 50)").option("--offset <number>", "offset (기본 0)")
  .action((o, c: Command) => run(c, false, s => s.list({ ...o, q: o.query })));
program.command("latest <provider>").description("codex / claude / grok 중 명시한 출처의 최근 Relay 기록")
  .option("--cwd <path>", "명시한 작업 경로 내에서만 조회")
  .action((alias: string, o, c: Command) => run(c, false, s => s.latest(alias, o.cwd)));

program.command("hook <agent>").description("Agent 세션 훅의 JSON을 stdin으로 받아 첫 기록 또는 종료 처리 (codex/claude/grok)")
  .option("--end", "SessionEnd: 종료 시각·사유를 기록하고, 훅 자동 기록만 남은 세션은 삭제")
  .action(async (alias: string, options: { end?: boolean }, command: Command) => {
    // A session hook must never block or fail the host session: answer first, record second, stay silent on failure.
    process.stdout.write("{}\n");
    try {
      const raw = process.stdin.isTTY ? "" : await Bun.stdin.text();
      const payload = (raw.trim() ? JSON.parse(raw) : {}) as Record<string, unknown>;
      // A subagent shares the host session; only the session itself is recorded or closed.
      if (payload.agent_id || payload.subagentType || payload.subagent_type || !Object.hasOwn(PROVIDERS, alias)) return;
      const sessionId = [payload.session_id, payload.sessionId, payload.thread_id,
        process.env.CLAUDE_CODE_SESSION_ID, process.env.CODEX_THREAD_ID, process.env.GROK_SESSION_ID]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (!sessionId) return;
      const cwd = typeof payload.cwd === "string" && existsSync(payload.cwd) ? payload.cwd : process.cwd();
      const { provider, agent } = PROVIDERS[alias as keyof typeof PROVIDERS];
      const config = loadConfig(command.optsWithGlobals().dataDir);
      const db = openDatabase(config);
      try {
        const service = new SessionService(new SessionRepository(db), config.retentionDays);
        if (options.end) service.end(sessionId, provider, endReason(payload));
        else service.record({ provider, agent, sessionId, sessionName: path.basename(cwd), cwd, summary: HOOK_SUMMARY });
      } finally { db.close(); }
    } catch { /* 기록 실패가 세션을 막지 않는다 */ }
  });

/** The host's end reason in the form the record accepts; absent when the host sent none. */
function endReason(payload: Record<string, unknown>): string | undefined {
  const given = [payload.reason, payload.end_reason, payload.endReason].find((value): value is string => typeof value === "string");
  const reason = given?.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 200);
  return reason || undefined;
}

program.command("install-hooks").description("Claude/Grok/Codex SessionStart·SessionEnd 훅 등록")
  .option("--bin-dir <path>", "relay.exe와 훅 래퍼를 둘 절대경로")
  .action((o, c: Command) => {
    const result = installHostHooks({ binDirectory: o.binDir === undefined ? undefined : directory(o.binDir, false) });
    if (c.optsWithGlobals().json) return void process.stdout.write(JSON.stringify(result) + "\n");
    process.stdout.write(render(result).map(line => line.text).join("\n") + "\n");
  });

program.command("web").description("127.0.0.1 조회 서버 실행 (Ctrl+C로 종료)")
  .option("--port <number>", "HTTP 포트 (기본 7474)").option("--open", "기본 브라우저 열기")
  .action(async (o, c: Command) => {
    if (c.optsWithGlobals().json) invalid("web은 --json을 지원하지 않습니다.");
    const config = loadConfig(c.optsWithGlobals().dataDir, o.port);
    const running = startServer(config);
    const url = `http://${config.webHost}:${config.webPort}`;
    process.stderr.write(`Relay ${version}: ${url}\n저장소: ${config.databasePath}\n종료: Ctrl+C\n`);
    const stop = async () => { await running.stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    if (o.open) {
      try {
        // Only the generated loopback URL reaches the OS opener, never stored session text.
        const command = process.platform === "win32" ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath '${url}' -ErrorAction Stop`] :
          process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
        const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
        if (await child.exited !== 0) throw new Error();
      } catch { process.stderr.write(`브라우저를 열지 못했습니다. 직접 접속하세요: ${url}\n`); }
    }
  });

try {
  autoInstallHostHooks();
  if (process.argv.length <= 2) program.outputHelp();
  else await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const failure = error instanceof CommanderError ? new RelayError("INVALID_ARGUMENT", error.message.replace(/^error: /, "")) :
      error instanceof RelayError ? error : storageError(error);
    const json = process.argv.includes("--json");
    process.stderr.write((json ? JSON.stringify(errorBody(failure)) : `${failure.code}: ${failure.message}`) + "\n");
    process.exitCode = failure.exitCode;
  }
}
