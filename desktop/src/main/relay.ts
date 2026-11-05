import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { log } from "./log";
import type { RemoteStatus } from "../shared/types";

export interface Probe { remote?: RemoteStatus; kind: "none" | "foreign" | "relay"; pid: number | null; appVersion: string | null; build: string | null }

/** 그 주소에서 무엇이 듣고 있는지 본다. relay.exe는 모든 응답에 Relay-Pid 헤더를 싣는다. */
export async function probe(url: string, timeoutMs = 3000): Promise<Probe> {
  try {
    const response = await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const pid = Number(response.headers.get("relay-pid"));
    const body = await response.json().catch(() => null) as { schemaVersion?: unknown; appVersion?: unknown; build?: unknown; remote?: RemoteStatus } | null;
    const relay = Number.isSafeInteger(pid) && pid > 0;
    return { kind: relay && body?.schemaVersion === 1 ? "relay" : "foreign", pid: relay ? pid : null,
      remote: body?.remote, appVersion: typeof body?.appVersion === "string" ? body.appVersion : null, build: typeof body?.build === "string" ? body.build : null };
  } catch (error) {
    const name = (error as { name?: string }).name;
    return { kind: name === "TimeoutError" || name === "AbortError" ? "foreign" : "none", pid: null, appVersion: null, build: null };
  }
}

/** 설치된 relay.exe. 앱 리소스에 동봉한 사본은 설치용이고 실행은 늘 설치 위치의 것을 쓴다(훅·PATH와 같은 경로). */
export function installedExe(): string | null {
  const candidates = [process.env.RELAY_DESKTOP_RELAY_EXE, path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "relay.exe")]
    .filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * relay.exe 웹 서버의 수명. 이미 돌고 있으면 그대로 쓰고(external), 없으면 자식으로 띄운다.
 * 자식은 앱이 끝나면 함께 끝난다. 설정이 바뀌면 `relay web --reload`로 같은 포트·저장소에서 다시 띄운다.
 */
export class RelayProcess {
  private child: ChildProcess | null = null;
  external = false;

  constructor(public exe: string, public dataDir: string, public port: number) {}

  get url() { return `http://127.0.0.1:${this.port}`; }

  async start(timeoutMs = 15_000): Promise<Probe> {
    const before = await probe(this.url);
    if (before.kind === "relay") { this.external = this.child === null; log("info", `relay 서버가 이미 듣고 있습니다 (PID ${before.pid})`); return before; }
    if (before.kind === "foreign") throw new Error(`포트 ${this.port}를 다른 프로그램이 쓰고 있습니다. 설정에서 포트를 바꾸세요.`);
    log("info", `relay 서버 시작: ${this.exe} web --port ${this.port}`);
    this.child = spawn(this.exe, ["web", "--port", String(this.port), "--data-dir", this.dataDir], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    this.child.stderr?.on("data", (chunk: Buffer) => { const text = chunk.toString("utf8").trim(); if (text) log("info", `relay: ${text.split("\n")[0]}`); });
    this.child.on("exit", (code) => { log("warn", `relay 서버가 끝났습니다 (code ${code})`); this.child = null; });
    this.external = false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await probe(this.url, 2500);
      if (found.kind === "relay") return found;
      if (!this.child) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("relay 서버가 시간 안에 응답하지 않았습니다. ~/.relay/desktop.log를 확인하세요.");
  }

  /** 현재 설치본으로 같은 포트·저장소에서 다시 띄운다(설정을 바꾼 뒤). */
  async reload(): Promise<Probe> {
    const external = this.external;
    log("info", "서버 설정 다시 적용 시작");
    await this.run(["web", "--reload", "--port", String(this.port), "--data-dir", this.dataDir]);
    log("info", "서버 설정 다시 적용 완료");
    this.child = null; this.external = external;
    return probe(this.url);
  }

  /** 앱이 띄운 서버만 끝낸다. 밖에서 띄운 서버는 두어 다른 창이 쓰게 한다. */
  async stop() {
    if (this.external) return;
    try { await this.run(["web", "--close", "--port", String(this.port)], 5000); } catch { this.child?.kill(); }
    this.child = null;
  }

  /** relay.exe 명령 하나를 돌려 stdout을 돌려준다(--json 명령용). */
  run(args: string[], timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, RELAY_DATA_DIR: this.dataDir } });
      let out = "", err = "";
      child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
      const timer = setTimeout(() => { child.kill(); reject(new Error("relay 명령이 시간 안에 끝나지 않았습니다.")); }, timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => { log("info", `CLI 종료: ${args[0]} (code ${code})`); clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error((err || out).trim() || `relay ${args[0]} 실패 (code ${code})`)); });
    });
  }
}
