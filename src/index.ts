#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { errorBody, invalid, RelayError, storageError } from "./errors";
import { SessionRepository } from "./session/session.repository";
import { SessionService } from "./session/session.service";
import type { NewSession } from "./session/session.types";
import { human } from "./output/human";
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
  if (alias) run(command, false, s => s.latest(alias));
  else program.outputHelp();
});

function run(command: Command, write: boolean, action: (service: SessionService) => unknown) {
  const options = command.optsWithGlobals();
  const config = loadConfig(options.dataDir);
  const db = openDatabase(config, !write);
  try {
    const result = action(new SessionService(new SessionRepository(db), config.retentionDays));
    process.stdout.write((options.json ? JSON.stringify(result) : human(result)) + "\n");
  } finally { db.close(); }
}

function creation(command: Command) {
  return command.requiredOption("--provider <provider>", "제공자 회사 식별자: openai/anthropic/xai 등")
    .requiredOption("--agent <agent>", "도구 식별자: codex/claude-code/grok 등")
    .requiredOption("--session-id <id>", "새 세션의 실제 Provider Session ID")
    .requiredOption("--summary <text>", "시작 요약 (1~4000자)")
    .option("--session-name <name>", "세션 이름 (최대 200자)")
    .option("--model <model>", "모델 (미지정 시 null)")
    .option("--cwd <path>", "존재하는 작업 디렉터리 절대경로");
}

creation(program.command("start").description("세션 시작 기록"))
  .action((options: NewSession, command: Command) => run(command, true, s => s.start(options)));
creation(program.command("continue <session-id>").description("종료된 부모 세션에 새 세션 연결"))
  .option("--parent-provider <provider>", "부모 세션의 제공자")
  .action((id: string, options: NewSession & { parentProvider?: string }, command: Command) => run(command, true, s => s.start(options, id, options.parentProvider)));

program.command("update").description("진행 요약과 이력 추가")
  .requiredOption("--session-id <id>", "Provider Session ID").requiredOption("--summary <text>", "진행 요약")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((o, c: Command) => run(c, true, s => s.update(o.sessionId, o.summary, o.provider)));
program.command("finish").description("세션 종료 기록")
  .requiredOption("--session-id <id>", "Provider Session ID").requiredOption("--summary <text>", "종료 요약")
  .requiredOption("--status <status>", "completed / interrupted / abandoned")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((o, c: Command) => run(c, true, s => s.finish(o.sessionId, o.summary, o.status, o.provider)));

program.command("show <session-id>").description("세션 상세 조회")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)").option("--history", "진행 이력 포함")
  .option("--limit <number>", "이력 페이지 크기 (1~100, 기본 50)").option("--offset <number>", "이력 offset (기본 0)")
  .action((id: string, o, c: Command) => run(c, false, s => s.show(id, o.provider, o.history, o)));
program.command("list").description("세션 테이블 조회")
  .option("--status <status>", "상태").option("--provider <provider>", "제공자").option("--agent <agent>", "도구")
  .option("--cwd <path>", "작업 경로 정확히 일치").option("--query <text>", "이름·ID·요약·경로 부분 검색")
  .option("--limit <number>", "페이지 크기 (1~100, 기본 50)").option("--offset <number>", "offset (기본 0)")
  .action((o, c: Command) => run(c, false, s => s.list({ ...o, q: o.query })));
program.command("latest <provider>").description("codex / claude / grok 중 명시한 출처의 최근 Relay 기록")
  .option("--cwd <path>", "명시한 작업 경로 내에서만 조회")
  .action((alias: string, o, c: Command) => run(c, false, s => s.latest(alias, o.cwd)));

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
