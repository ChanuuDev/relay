import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { RelayError } from "../errors";

/** 모든 응답에 실리는 서버 프로세스 ID 헤더. `relay web --close`는 이 값으로 종료할 프로세스를 정한다. */
export const PID_HEADER = "Relay-Pid";

export type Probe =
  | { kind: "none" }                 // 아무것도 듣지 않는다
  | { kind: "foreign" }              // Relay가 아닌 것이 듣거나, 응답하지 않는다
  | { kind: "legacy" }               // PID 헤더가 없는 이전 버전 Relay
  | { kind: "relay"; pid: number };

/** 그 주소에서 무엇이 듣고 있는지 본다. 세션 데이터는 읽지 않는다. */
export async function probe(url: string, timeoutMs = 1500): Promise<Probe> {
  let response: Response;
  try { response = await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" }); }
  catch (error) {
    const name = (error as { name?: string }).name;
    return { kind: name === "TimeoutError" || name === "AbortError" ? "foreign" : "none" };
  }
  const pid = Number(response.headers.get(PID_HEADER));
  if (Number.isSafeInteger(pid) && pid > 0) return { kind: "relay", pid };
  let body: unknown;
  try { body = await response.json(); } catch { return { kind: "foreign" }; }
  const relay = typeof body === "object" && body !== null && (body as { schemaVersion?: unknown }).schemaVersion === 1;
  return { kind: relay ? "legacy" : "foreign" };
}

/** 실행 중인 Relay 서버가 쓰는 저장소 경로. Relay가 아니거나 응답이 없거나 알려 주지 않으면 null. */
export async function runningDataDirectory(url: string, timeoutMs = 1500): Promise<string | null> {
  try {
    const response = await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    if (!response.headers.has(PID_HEADER)) return null;
    const body = await response.json() as { dataDirectory?: unknown };
    return typeof body.dataDirectory === "string" && body.dataDirectory ? body.dataDirectory : null;
  } catch { return null; }
}

export type ExcludedRange = { start: number; end: number; administered: boolean };

/** `netsh interface ipv4 show excludedportrange protocol=tcp` 출력의 범위 표. `*`가 붙은 줄은 관리자가 고정한 제외라 직접 바인드는 된다. */
export function parseExcludedRanges(text: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*(\*?)\s*$/.exec(line);
    if (match) ranges.push({ start: Number(match[1]), end: Number(match[2]), administered: match[3] === "*" });
  }
  return ranges;
}

/** Windows(Hyper-V·WSL의 WinNAT)가 동적으로 예약해 버린 범위에 포트가 들었으면 그 범위. 아니면 null. */
export function reservedPortRange(port: number): ExcludedRange | null {
  if (process.platform !== "win32") return null;
  try {
    const result = Bun.spawnSync(["netsh", "interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], { stdout: "pipe", stderr: "ignore" });
    return parseExcludedRanges(result.stdout.toString()).find((range) => !range.administered && port >= range.start && port <= range.end) ?? null;
  } catch { return null; }
}

/** 포트를 못 잡은 까닭을 가려 알린다. 예약 범위에 든 포트는 코드가 아니라 OS 설정 문제라 푸는 명령을 함께 적는다. */
export function portFailure(port: number, code: string, message: string): RelayError {
  const range = reservedPortRange(port);
  if (!range) return new RelayError(code, message, 6, 500);
  return new RelayError("PORT_RESERVED", `포트 ${port}는 Windows가 예약한 범위(${range.start}–${range.end}, Hyper-V·WSL의 동적 예약)에 들어 있어 쓸 수 없습니다. ` +
    `relay web --free-port --port ${port}를 실행하면 관리자 권한(UAC)으로 예약을 풀고 이 포트를 Relay용으로 고정합니다.`, 6, 500, { port, range: [range.start, range.end] });
}

/** 관리자 권한(UAC 창)으로 WinNAT를 다시 시작해 동적 예약을 풀고, 이 포트를 관리 제외로 고정해 다시 예약되지 않게 한다. */
export function freePort(port: number): { range: ExcludedRange | null } {
  if (process.platform !== "win32") throw new RelayError("INVALID_ARGUMENT", "--free-port는 Windows에서만 쓸 수 있습니다.");
  const script = `net stop winnat; netsh int ipv4 add excludedportrange protocol=tcp startport=${port} numberofports=1; net start winnat`;
  const launch = `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','${script}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", launch], { stdout: "ignore", stderr: "ignore" });
  if (result.exitCode !== 0) throw new RelayError("ELEVATION_DENIED", "관리자 권한 요청이 거부되거나 실패해 포트 예약을 풀지 못했습니다.", 6, 500);
  return { range: reservedPortRange(port) };
}

/** 컴파일된 실행 파일 안의 진입점 경로. Bun은 이 가상 경로를 fs에서도 있는 것처럼 보여 주므로 존재 여부로는 가릴 수 없다. */
const EMBEDDED = /^(\/\$bunfs\/|[A-Za-z]:[\\/]~BUN[\\/])/;

/** 같은 프로그램을 다시 부르는 명령. 개발 중(`bun src/index.ts`)이면 스크립트 경로를 함께 넘기고, 실행 파일이면 실행 파일만 부른다. */
export function selfCommand(): string[] {
  const script = process.argv[1];
  return script && !EMBEDDED.test(script) && existsSync(script) ? [process.execPath, script] : [process.execPath];
}

export type Started = { pid: number; already: boolean };

/** 브라우저가 여는 `relay://web?port=7474` 링크. 설치한 화면(PWA)이 서버에 닿지 못하면 이 링크로 백그라운드 서버를 켠다.
 *  다른 사이트도 이 링크를 열 수 있으므로 포트만 받고(1024–65535), 저장소 같은 경로는 받지 않는다. */
export function parseLaunchUrl(raw: string): { port: number } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new RelayError("INVALID_ARGUMENT", `relay:// 링크가 아닙니다: ${raw}`); }
  if (url.protocol !== "relay:" || url.host !== "web" || (url.pathname !== "" && url.pathname !== "/")) throw new RelayError("INVALID_ARGUMENT", `지원하지 않는 relay:// 링크입니다: ${raw}`);
  const port = url.searchParams.has("port") ? Number(url.searchParams.get("port")) : 7474;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RelayError("INVALID_ARGUMENT", "relay:// 링크의 port는 1024–65535 사이의 숫자여야 합니다.");
  return { port };
}

/** 터미널과 분리된 서버를 띄우고 응답할 때까지 기다린다. 이미 Relay가 듣고 있으면 그대로 둔다.
 *  자식은 부모 콘솔에 붙지 않고 표준 입출력도 끊으므로, 터미널을 닫아도 계속 돈다. */
export async function startDetached(url: string, args: string[], timeoutMs = 10000): Promise<Started> {
  const before = await probe(url);
  if (before.kind === "relay") return { pid: before.pid, already: true };
  if (before.kind === "legacy") throw new RelayError("PORT_IN_USE", "이전 버전의 Relay 서버가 이미 실행 중입니다. 해당 터미널에서 Ctrl+C로 종료하세요.", 6, 500);
  if (before.kind === "foreign") throw new RelayError("PORT_IN_USE", "포트가 사용 중입니다. 기존 서버를 확인하거나 --port를 지정하세요.", 6, 500);
  const [command, ...prefix] = selfCommand();
  let ended = false;
  const child = spawn(command, [...prefix, ...args], { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => { ended = true; });
  child.once("exit", () => { ended = true; });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await probe(url, 500);
    if (found.kind === "relay" && found.pid === child.pid) return { pid: child.pid, already: false };
    if (ended) break;
    await Bun.sleep(100);
  }
  if (!ended) { try { child.kill(); } catch { /* 이미 끝났다 */ } }
  throw portFailure(new URL(url).port ? Number(new URL(url).port) : 80, "SERVER_START_FAILED", "백그라운드 서버를 시작할 수 없습니다. 포트와 권한을 확인하세요.");
}

/** PID 헤더가 없는 이전 버전 Relay는 Windows에서 포트를 가진 프로세스를 찾되, 프로세스 이름이 relay일 때만 돌려준다. */
function legacyPid(port: number): number | null {
  if (process.platform !== "win32") return null;
  const script = `$c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
    "if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -ieq 'relay') { $p.Id } }";
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "ignore" });
  const pid = Number(result.stdout.toString().trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** 듣고 있는 Relay 서버를 끝낸다. Relay가 아니면 손대지 않고, 아무것도 없으면 null을 돌려준다. */
export async function stopServer(url: string, port: number, timeoutMs = 5000): Promise<{ pid: number } | null> {
  const found = await probe(url);
  if (found.kind === "none") return null;
  if (found.kind === "foreign") throw new RelayError("SERVER_FOREIGN", "이 포트의 서버는 Relay가 아니므로 종료하지 않습니다.", 6, 500);
  const pid = found.kind === "relay" ? found.pid : legacyPid(port);
  if (!pid) throw new RelayError("SERVER_LEGACY", "이전 버전의 Relay 서버는 --close로 종료할 수 없습니다. 해당 터미널에서 Ctrl+C로 종료하세요.", 6, 500);
  try { process.kill(pid); }
  catch (error) {
    if ((error as { code?: string }).code !== "ESRCH") throw new RelayError("SERVER_STOP_FAILED", `서버 프로세스(PID ${pid})를 종료할 수 없습니다. 권한을 확인하세요.`, 6, 500);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe(url, 500)).kind === "none") return { pid };
    await Bun.sleep(100);
  }
  throw new RelayError("SERVER_STOP_FAILED", `서버 프로세스(PID ${pid})가 종료되지 않았습니다.`, 6, 500);
}
