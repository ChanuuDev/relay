import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { errorFromBody } from "@relay/core";
import type { Config } from "../config";
import { RelayError } from "../errors";

interface Pending { key: string; destination: string; route: string; body: unknown; createdAt: string }
export class RemoteClient {
  private deadline: number;
  constructor(public config: Config, timeoutMs = 8000) { this.deadline = Date.now() + timeoutMs; }
  private get remote() {
    if (!this.config.remote) throw new RelayError("INVALID_CONFIG", "원격 서버를 먼저 설정하세요.");
    return this.config.remote;
  }
  private get destination() { return createHash("sha256").update(this.remote.url + "\n" + this.remote.token).digest("hex"); }
  private get directory() { return path.join(this.config.dataDirectory, "outbox"); }
  async fetch(route: string, init: RequestInit = {}, key?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.remote.token}`);
    if (this.remote.deviceId) headers.set("X-Relay-Device", this.remote.deviceId);
    if (key) headers.set("Idempotency-Key", key);
    try {
      return await fetch(this.remote.url + route, { ...init, headers, redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, this.deadline - Date.now())) });
    } catch { throw new RelayError("REMOTE_UNREACHABLE", "원격 서버에 연결하지 못했습니다. 연결과 서버 상태를 확인하세요.", 7, 502); }
  }
  async json<T>(route: string, body?: unknown, key?: string): Promise<T> {
    const response = await this.fetch(route, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, key);
    let data: unknown;
    try { data = await response.json(); } catch { throw new RelayError("REMOTE_UNREACHABLE", "원격 서버의 JSON 응답을 읽지 못했습니다.", 7, 502); }
    if (!response.ok) throw errorFromBody(data, response.status);
    return data as T;
  }
  list() {
    const read = (directory: string) => existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith(".json")).sort() : [];
    return { schemaVersion: 1, pending: read(this.directory), failed: read(path.join(this.directory, "failed")) };
  }
  /** 요청에는 자격 증명을 넣지 않는다. 목적지 해시로 다른 서버·토큰으로의 오전송을 막는다. */
  enqueue(route: string, body: unknown) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const key = crypto.randomUUID();
    const name = `${Date.now()}-${key}.json`;
    const item: Pending = { key, destination: this.destination, route, body, createdAt: new Date().toISOString() };
    const target = path.join(this.directory, name);
    writeFileSync(target + ".tmp", JSON.stringify(item), { mode: 0o600 });
    renameSync(target + ".tmp", target);
    return name;
  }
  async write<T>(route: string, body: unknown): Promise<T> {
    const name = this.enqueue(route, body);
    const result = await this.flush(name);
    if (result.error) throw result.error;
    if (result.delivered) return result.value as T;
    process.stderr.write("REMOTE_QUEUED: 원격 전송을 대기열에 보관했습니다. 다음 실행 때 다시 보냅니다.\n");
    // 쓰기 호출자가 오프라인 결과를 실제 세션으로 오인하지 않게 별도 결과를 반환한다.
    return { schemaVersion: 1, queued: true } as T;
  }
  /** 프로세스 간 단일 소비자. 중단된 프로세스의 잠금만 회수한다. */
  async flush(wanted?: string): Promise<{ delivered?: boolean; value?: unknown; error?: RelayError; sent: number }> {
    const lock = path.join(this.directory, ".lock");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { mkdirSync(lock); writeFileSync(path.join(lock, "pid"), String(process.pid)); }
    catch {
      try {
        const pid = Number(readFileSync(path.join(lock, "pid"), "utf8"));
        if (!Number.isSafeInteger(pid) || pid <= 0) return { sent: 0 };
        try { process.kill(pid, 0); return { sent: 0 }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return { sent: 0 }; }
        rmSync(lock, { recursive: true });
      } catch { return { sent: 0 }; }
      return this.flush(wanted);
    }
    const result: { delivered?: boolean; value?: unknown; error?: RelayError; sent: number } = { sent: 0 };
    try {
      for (const name of this.list().pending) {
        if (Date.now() >= this.deadline) break;
        const file = path.join(this.directory, name);
        let item: Pending;
        try { item = JSON.parse(readFileSync(file, "utf8")); } catch { this.fail(file, name); continue; }
        if (item.destination !== this.destination) continue;
        if (!item.route.startsWith("/api/v1/") || /[\\?#]/.test(item.route) || item.route.includes("..") || typeof item.key !== "string") { this.fail(file, name); continue; }
        try {
          const value = await this.json(item.route, item.body, item.key);
          rmSync(file); result.sent++;
          if (name === wanted) { result.delivered = true; result.value = value; }
        } catch (error) {
          const failure = error as RelayError;
          if (failure.httpStatus >= 400 && failure.httpStatus < 500 && ![401, 403, 408, 429].includes(failure.httpStatus)) {
            this.fail(file, name);
            if (name === wanted) result.error = failure;
            continue;
          }
          break;
        }
      }
      return result;
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  private fail(file: string, name: string) {
    const directory = path.join(this.directory, "failed");
    mkdirSync(directory, { recursive: true, mode: 0o700 }); renameSync(file, path.join(directory, name));
  }
}
