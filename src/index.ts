#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { errorBody, invalid, RelayError, storageError } from "./errors";
import { gitClue } from "./git";
import { SESSION_COMPACT_PROMPT, SESSION_START_PROMPT } from "./hooks/context";
import { autoInstallHostHooks, installHostHooks } from "./hooks/install";
import { transcriptModels } from "./hooks/transcript";
import { NoteStore, parseExport } from "./notes/notes.store";
import { copyToClipboard } from "./output/clipboard";
import { render } from "./output/human";
import { browse, copyNotice, interactiveTerminal, terminalContext } from "./output/interactive";
import { terminalWidth } from "./output/terminal";
import { SessionRepository } from "./session/session.repository";
import { ALIASES, HOOK_SUMMARY, PROVIDERS, SessionService, type ProviderAlias } from "./session/session.service";
import type { NewSession, Session } from "./session/session.types";
import { installSkills } from "./skills/install";
import { directory } from "./validation";
import { handoffMarkdown } from "./web/lib/handoff";
import { sessionCommand } from "./web/lib/session-context";
import { freePort, parseLaunchUrl, reservedPortRange, runningDataDirectory, startDetached, stopServer } from "./web/control";
import { startServer } from "./web/server";
import { version } from "../package.json";

const program = new Command().name("relay").description("로컬 AI Agent 세션 기록과 브라우저 조회")
  .version(version).option("--data-dir <path>", "저장소 절대경로 (RELAY_DATA_DIR보다 우선)")
  .option("--json", "데이터 명령의 JSON 출력")
  .option("--codex", "최근 Codex 세션 조회 (latest codex)")
  .option("--claude", "최근 Claude 세션 조회 (latest claude)")
  .option("--grok", "최근 Grok 세션 조회 (latest grok)")
  .option("--cursor", "최근 Cursor 세션 조회 (latest cursor)")
  .showSuggestionAfterError(false).exitOverride()
  .configureOutput({ writeErr: () => {} });

const shortcuts = ALIASES;
program.hook("preAction", (_command, actionCommand) => {
  const selected = shortcuts.filter(alias => program.opts()[alias]);
  if (selected.length > 1) invalid(`${shortcuts.map(alias => `--${alias}`).join(", ")} 중 하나만 지정하세요.`);
  if (selected.length && actionCommand !== program) invalid("최근 세션 조회 옵션은 다른 명령과 함께 사용할 수 없습니다.");
});
program.action((options, command: Command) => {
  const alias = shortcuts.find(alias => options[alias]);
  if (alias) return run(command, false, s => s.latest(alias));
  program.outputHelp();
});

const STATUS_HELP = "작업 상태: working | blocked | handoff | done";
const shell = () => process.platform === "win32" ? "powershell" : "bash";

async function run(command: Command, write: boolean, action: (service: SessionService, config: ReturnType<typeof loadConfig>) => unknown) {
  const options = command.optsWithGlobals();
  const config = loadConfig(options.dataDir);
  const db = openDatabase(config, !write);
  // A record written from the CLI carries the working tree as it stands; reads never touch git.
  const service = new SessionService(new SessionRepository(db), config.retentionDays, write ? gitClue : undefined);
  let picked: Session | undefined;
  try {
    let result: unknown;
    try { result = action(service, config); }
    catch (error) {
      if (error instanceof RelayError && error.code === "SESSION_NOT_FOUND" && error.details?.relayId &&
        typeof error.details.providerSessionId === "string" && typeof error.details.provider === "string") {
        const command = sessionCommand({ providerSessionId: error.details.providerSessionId, provider: error.details.provider }, config.dataDirectory, shell());
        error.message += ` 다음 명령으로 조회하세요:\n${command}`;
        error.details = { ...error.details, command, shell: shell() };
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
    .option("--status <status>", STATUS_HELP)
    .option("--cwd <path>", "존재하는 작업 디렉터리 절대경로");
}

creation(program.command("record").description("세션 정보 첫 기록"))
  .action((options: NewSession, command: Command) => run(command, true, s => s.record(options)));
creation(program.command("continue <session-id>").description("이전 세션 기록에 새 세션 연결"))
  .option("--parent-provider <provider>", "부모 세션의 제공자")
  .action((id: string, options: NewSession & { parentProvider?: string }, command: Command) => run(command, true, s => s.record(options, id, options.parentProvider)));

program.command("update").description("진행 요약과 이력 추가. 이름과 작업 상태는 준 것만 바뀐다")
  .requiredOption("--session-id <id>", "Agent Session ID").requiredOption("--summary <text>", "진행 요약")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .option("--session-name <name>", "세션 이름 변경 (최대 200자)")
  .option("--status <status>", STATUS_HELP)
  .action((o, c: Command) => run(c, true, s => s.update(o.sessionId, o.summary, o.provider, { sessionName: o.sessionName, status: o.status })));
program.command("show <session-id>").description("Agent Session ID로 세션 상세 조회 (Relay 내부 ID 아님)")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)").option("--history", "진행 이력 포함")
  .option("--limit <number>", "이력 페이지 크기 (1~100, 기본 50)").option("--offset <number>", "이력 offset (기본 0)")
  .action((id: string, o, c: Command) => run(c, false, s => s.show(id, o.provider, o.history, o)));
program.command("chain <session-id>").description("처음 세션부터 이어받은 세션까지 작업 흐름 전체 조회")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((id: string, o, c: Command) => run(c, false, s => s.chain(id, o.provider)));
program.command("handoff <session-id>").description("요약·이력·흐름·재개 명령을 담은 인계 문서(Markdown) 출력")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .option("--limit <number>", "담을 이력 건수 (1~100, 기본 50)")
  .option("--shell <shell>", "명령 인용 셸: powershell | bash (기본은 현재 OS)")
  .action((id: string, o, c: Command) => run(c, false, (s, config) => {
    if (o.shell !== undefined && o.shell !== "powershell" && o.shell !== "bash") invalid("shell: powershell 또는 bash를 입력하세요.");
    const packet = s.packet(id, o.provider, { limit: o.limit });
    return { schemaVersion: 1, sessionId: packet.session.id,
      markdown: handoffMarkdown({ ...packet, childrenTotal: packet.childrenPage.total, updatesTotal: packet.updatesPage.total },
        { shell: o.shell ?? shell(), storeDirectory: config.dataDirectory }) };
  }));
program.command("list").description("세션 테이블 조회")
  .option("--provider <provider>", "제공자").option("--agent <agent>", "도구")
  .option("--cwd <path>", "작업 경로 정확히 일치").option("--query <text>", "이름·ID·요약·경로 부분 검색")
  .option("--status <status>", STATUS_HELP).option("--pinned", "고정한 세션만")
  .option("--limit <number>", "페이지 크기 (1~100, 기본 50)").option("--offset <number>", "offset (기본 0)")
  .action((o, c: Command) => run(c, false, s => s.list({ ...o, q: o.query })));
program.command("latest <provider>").description(`${ALIASES.join(" / ")} 중 명시한 출처의 최근 Relay 기록`)
  .option("--cwd <path>", "명시한 작업 경로 내에서만 조회")
  .action((alias: string, o, c: Command) => run(c, false, s => s.latest(alias, o.cwd)));
program.command("pin <session-id>").description("보관 기간과 종료 정리에서 제외하도록 세션 고정")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((id: string, o, c: Command) => run(c, true, s => s.pin(id, true, o.provider)));
program.command("unpin <session-id>").description("세션 고정 해제")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .action((id: string, o, c: Command) => run(c, true, s => s.pin(id, false, o.provider)));
program.command("delete <session-id>").description("세션 기록과 이력 삭제. 이어받은 세션이 있으면 --force로 연결을 끊고 삭제")
  .option("--provider <provider>", "제공자 (ID 충돌 시 필수)")
  .option("--force", "이어받은 세션의 연결을 끊고 삭제")
  .action((id: string, o, c: Command) => run(c, true, s => s.delete(id, o.provider, Boolean(o.force))));

const notes = program.command("notes").description("메모 내보내기·가져오기 (다른 PC나 저장소로 옮길 때)");
notes.command("export <file>").description("모든 메모와 폴더를 JSON 파일로 내보냄 (같은 이름의 파일은 덮어씀)")
  .action((file: string, _o, c: Command) => withNotes(c, false, store => {
    const data = store.exportAll();
    const target = path.resolve(file);
    try { writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`); }
    catch { throw new RelayError("FILE_WRITE_FAILED", `파일을 쓸 수 없습니다: ${target}`, 5, 500); }
    const count = (kind: string) => data.items.filter(item => item.kind === kind).length;
    const result = { schemaVersion: 1, path: target, notes: count("note"), folders: count("folder") };
    return [result, `메모 ${result.notes}개 · 폴더 ${result.folders}개를 내보냈습니다: ${target}`];
  }));
notes.command("import <file>").description("내보낸 JSON 파일의 메모를 합침. 없는 항목은 넣고, 같은 항목은 더 최근에 고친 쪽을 남기며 아무것도 지우지 않음")
  .action((file: string, _o, c: Command) => {
    const items = parseExport(readExport(path.resolve(file)));
    return withNotes(c, true, store => {
      const result = store.merge(items);
      return [result, `메모를 가져왔습니다: 추가 ${result.added} · 갱신 ${result.updated} · 그대로 ${result.kept}`];
    });
  });

/** 메모 저장소를 열어 한 가지 일을 하고 닫는다. --json이면 결과 객체를, 아니면 한 줄 안내를 stdout에 쓴다. */
function withNotes(command: Command, write: boolean, action: (store: NoteStore) => [unknown, string]) {
  const db = openDatabase(loadConfig(command.optsWithGlobals().dataDir), !write);
  let output: [unknown, string];
  try { output = action(new NoteStore(db)); } finally { db.close(); }
  process.stdout.write(`${command.optsWithGlobals().json ? JSON.stringify(output[0]) : output[1]}\n`);
}

/** 내보낸 파일을 읽는다. Windows PowerShell이 만든 UTF-16 파일과 BOM이 붙은 UTF-8도 받는다. */
function readExport(file: string): unknown {
  let bytes: Buffer;
  try { bytes = readFileSync(file); } catch { throw new RelayError("FILE_NOT_FOUND", `파일을 읽을 수 없습니다: ${file}`, 3, 404); }
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder("utf-16le").decode(bytes) : new TextDecoder("utf-8").decode(bytes);
  try { return JSON.parse(text); } catch { invalid(`JSON 파일이 아닙니다: ${file}`); }
}

/** Which hook event fired; none of them means the session started. */
type HookOptions = { end?: boolean; compact?: boolean; modelSwitch?: boolean };

program.command("hook <agent>").description(`Agent 세션 훅의 JSON을 stdin으로 받아 첫 기록·종료·압축 처리 (${ALIASES.join("/")})`)
  .option("--end", "SessionEnd: 종료 시각·사유를 기록하고, 훅 자동 기록만 남은 세션은 삭제")
  .option("--compact", "PreCompact: 컨텍스트 압축 횟수와 시각을 기록")
  .option("--model-switch", "PostModelSwitch: 세션이 바꾼 모델을 모델 목록에 추가")
  .action(async (alias: string, options: HookOptions, command: Command) => {
    // Answer once before opening the store; recording must never block or fail the host session.
    let answered = false;
    try {
      const raw = process.stdin.isTTY ? "" : await Bun.stdin.text();
      const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const payload = parsed as Record<string, unknown>;
      // A subagent shares the host session; only the session itself is recorded or closed.
      if (payload.agent_id || payload.subagentType || payload.subagent_type || !Object.hasOwn(PROVIDERS, alias)) return;
      const host = alias as ProviderAlias;
      const environmentId = { claude: process.env.CLAUDE_CODE_SESSION_ID, codex: process.env.CODEX_THREAD_ID,
        grok: process.env.GROK_SESSION_ID, cursor: undefined }[host];
      // Cursor names the chat by conversation_id; its session_id usually repeats it and its CLI resumes by that id.
      const sessionId = [...(host === "cursor" ? [payload.conversation_id] : []), payload.session_id, payload.sessionId, payload.thread_id, environmentId]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (!sessionId) return;
      const { provider, agent } = PROVIDERS[host];
      process.stdout.write(JSON.stringify(hookOutput(host, options, payload, { provider, agent, sessionId })) + "\n");
      answered = true;
      const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
      const cwd = [payload.cwd, roots[0]].find((value): value is string => typeof value === "string" && existsSync(value)) ?? process.cwd();
      const config = loadConfig(command.optsWithGlobals().dataDir);
      const db = openDatabase(config);
      try {
        // The hook has a few seconds at most, so it records without reading the working tree.
        const service = new SessionService(new SessionRepository(db), config.retentionDays);
        // The host knows the model, the agent does not need to say it: the list takes the models the
        // transcript shows answering, then the one the payload names (Codex·Cursor on every event, Claude Code on a switch).
        const noteModels = () => {
          const models = [...transcriptModels(payload.transcript_path), payload.model, payload.to_model];
          if (models.some(model => typeof model === "string")) service.models(sessionId, provider, models);
        };
        const steps = options.modelSwitch ? [noteModels]
          : options.end ? [() => service.end(sessionId, provider, endReason(payload)), noteModels]
          : options.compact ? [() => service.compact(sessionId, provider, typeof payload.trigger === "string" ? payload.trigger : undefined), noteModels]
          : [() => service.record({ provider, agent, sessionId, sessionName: path.basename(cwd), cwd, summary: HOOK_SUMMARY }), noteModels];
        // Each step stands alone, so a record that cannot be written still gets its models, and the other way round.
        for (const step of steps) { try { step(); } catch { /* 기록 실패가 세션을 막지 않는다 */ } }
      } finally { db.close(); }
    } catch { /* 기록 실패가 세션을 막지 않는다 */ }
    finally { if (!answered) process.stdout.write("{}\n"); }
  });

/**
 * What the host gets back. Only a session start carries guidance: the first-record steps, or, when the
 * host starts the session again after compacting its context, the steps to read the record back.
 * Grok ignores SessionStart output and reads the same guidance from its rules file instead.
 */
function hookOutput(host: ProviderAlias, options: HookOptions, payload: Record<string, unknown>,
  info: { provider: string; agent: string; sessionId: string }): unknown {
  if (options.end || options.compact || options.modelSwitch || host === "grok") return {};
  const compacted = [payload.source, payload.session_source].includes("compact");
  const text = `${compacted ? SESSION_COMPACT_PROMPT : SESSION_START_PROMPT}\n\n현재 호스트가 제공한 세션 정보: ${JSON.stringify(info)}`;
  if (host === "cursor") return { additional_context: text };
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
}

/** The host's end reason in the form the record accepts; absent when the host sent none. */
function endReason(payload: Record<string, unknown>): string | undefined {
  const given = [payload.reason, payload.end_reason, payload.endReason].find((value): value is string => typeof value === "string");
  const reason = given?.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 200);
  return reason || undefined;
}

program.command("install-hooks").description("Claude/Grok/Codex 세션 훅·시작 안내 등록 및 스킬 설치")
  .option("--bin-dir <path>", "relay.exe와 훅 래퍼를 둘 절대경로")
  .action((o, c: Command) => {
    const hooks = installHostHooks({ binDirectory: o.binDir === undefined ? undefined : directory(o.binDir, false) });
    const result = { ...hooks, skills: installSkills().targets };
    if (c.optsWithGlobals().json) return void process.stdout.write(JSON.stringify(result) + "\n");
    process.stdout.write(render(result).map(line => line.text).join("\n") + "\n");
  });

program.command("install-skills").description("relay-session 스킬을 Claude/Grok/Codex 사용자 스킬 폴더에 실제 사본으로 설치 (링크는 사본으로 교체)")
  .option("--force", "내용이 다른 기존 사본을 덮어씀")
  .action((o: { force?: boolean }, c: Command) => {
    const result = installSkills({ force: o.force });
    if (c.optsWithGlobals().json) return void process.stdout.write(JSON.stringify(result) + "\n");
    process.stdout.write(render(result).map(line => line.text).join("\n") + "\n");
  });

program.command("web").description("127.0.0.1 조회 서버 실행 (Ctrl+C 또는 --close로 종료)")
  .option("--port <number>", "HTTP 포트 (기본 7474)").option("--open", "기본 브라우저 열기")
  .option("--headless", "터미널과 분리해 백그라운드로 실행 (터미널을 닫아도 유지)")
  .option("--close", "실행 중인 서버 종료")
  .option("--reload", "실행 중인 서버를 닫고 이 relay로 백그라운드에서 다시 띄움 (포트·저장소 유지, 열린 화면은 새 버전으로 새로 고침)")
  .option("--free-port", "Windows(Hyper-V·WSL)가 동적으로 예약한 포트를 관리자 권한(UAC)으로 풀고 Relay용으로 고정")
  .action(async (o, c: Command) => {
    if (c.optsWithGlobals().json) invalid("web은 --json을 지원하지 않습니다.");
    if (o.close && (o.headless || o.open || o.reload)) invalid("--close는 --headless, --open, --reload와 함께 쓸 수 없습니다.");
    if (o.freePort && (o.close || o.headless || o.open || o.reload)) invalid("--free-port는 다른 옵션과 함께 쓸 수 없습니다.");
    const config = loadConfig(c.optsWithGlobals().dataDir, o.port);
    const url = `http://${config.webHost}:${config.webPort}`;
    if (o.freePort) {
      const before = reservedPortRange(config.webPort);
      process.stderr.write(before ? `포트 ${config.webPort}는 Windows 예약 범위(${before.start}–${before.end})에 들어 있습니다. 관리자 권한 요청 창에서 예를 누르세요.\n`
        : `포트 ${config.webPort}는 지금 예약 범위에 없습니다. 다시 예약되지 않도록 고정합니다. 관리자 권한 요청 창에서 예를 누르세요.\n`);
      const { range } = freePort(config.webPort);
      process.stderr.write(range ? `아직 예약 범위(${range.start}–${range.end})에 들어 있습니다. 재부팅 뒤 다시 시도하세요.\n`
        : `포트 ${config.webPort}를 Relay용으로 고정했습니다. 이제 relay web --headless로 서버를 켜세요.\n`);
      return;
    }
    if (o.reload) {
      // 저장소를 따로 주지 않았으면 실행 중인 서버의 저장소를 이어받는다. 다시 띄우는 실행 파일은 지금 부른 relay다.
      const running = c.optsWithGlobals().dataDir === undefined ? await runningDataDirectory(url) : null;
      const target = running && running !== config.dataDirectory ? loadConfig(running, String(config.webPort)) : config;
      const stopped = await stopServer(url, config.webPort);
      const started = await startDetached(url, ["web", "--port", String(config.webPort), "--data-dir", target.dataDirectory]);
      process.stderr.write(stopped ? `Relay 웹 서버를 다시 시작했습니다: ${url} (PID ${stopped.pid} → ${started.pid})\n` :
        started.already ? `Relay 웹 서버가 이미 실행 중입니다: ${url} (PID ${started.pid})\n` :
        `실행 중인 서버가 없어 새로 띄웠습니다: ${url} (백그라운드 · PID ${started.pid})\n`);
      process.stderr.write(`Relay ${version} · 저장소: ${target.databasePath}\n열린 화면은 새 버전으로 스스로 새로 고칩니다. 종료: relay web --close\n`);
      if (o.open) await openBrowser(url);
      return;
    }
    if (o.close) {
      const stopped = await stopServer(url, config.webPort);
      process.stderr.write(stopped ? `Relay 웹 서버를 종료했습니다: ${url} (PID ${stopped.pid})\n` : `실행 중인 Relay 웹 서버가 없습니다: ${url}\n`);
      return;
    }
    if (o.headless) {
      // 자식에게 포트와 저장소를 명시해 부모와 같은 설정으로 띄운다. 자식은 터미널 없이 돌고 --close로 끝난다.
      const started = await startDetached(url, ["web", "--port", String(config.webPort), "--data-dir", config.dataDirectory]);
      process.stderr.write(started.already ? `Relay 웹 서버가 이미 실행 중입니다: ${url} (PID ${started.pid})\n` :
        `Relay ${version}: ${url} (백그라운드 · PID ${started.pid})\n저장소: ${config.databasePath}\n`);
      process.stderr.write("종료: relay web --close\n");
      if (o.open) await openBrowser(url);
      return;
    }
    const running = startServer(config);
    process.stderr.write(`Relay ${version}: ${url}\n저장소: ${config.databasePath}\n종료: Ctrl+C 또는 relay web --close\n`);
    const stop = async () => { await running.stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    if (o.open) await openBrowser(url);
  });

program.command("open-url <url>").description("브라우저가 연 relay:// 링크 처리 (설치 시 Windows에 등록). relay://web?port=7474 → 그 포트에 백그라운드 서버를 켬")
  .action(async (raw: string, _o, c: Command) => {
    if (c.optsWithGlobals().json) invalid("open-url은 --json을 지원하지 않습니다.");
    const { port } = parseLaunchUrl(raw);
    const config = loadConfig(c.optsWithGlobals().dataDir, String(port));
    const url = `http://${config.webHost}:${config.webPort}`;
    const started = await startDetached(url, ["web", "--port", String(config.webPort), "--data-dir", config.dataDirectory]);
    process.stderr.write(started.already ? `Relay 웹 서버가 이미 실행 중입니다: ${url} (PID ${started.pid})\n` :
      `Relay ${version}: ${url} (백그라운드 · PID ${started.pid})\n저장소: ${config.databasePath}\n종료: relay web --close\n`);
  });

/** OS 기본 브라우저에는 생성한 루프백 주소만 넘기고, 저장된 세션 텍스트는 절대 넘기지 않는다. */
async function openBrowser(url: string) {
  try {
    const command = process.platform === "win32" ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath '${url}' -ErrorAction Stop`] :
      process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new Error();
  } catch { process.stderr.write(`브라우저를 열지 못했습니다. 직접 접속하세요: ${url}\n`); }
}

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
