import type { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";
import { SessionRepository } from "../src/session/session.repository";
import { SessionService } from "../src/session/session.service";

export const root = path.resolve(import.meta.dir, "..");
export function temporary() { return mkdtempSync(path.join(tmpdir(), "relay-test-")); }
export function cleanup(dir: string) {
  const target = realpathSync(dir);
  const parent = realpathSync(tmpdir());
  if (path.dirname(target).toLowerCase() !== parent.toLowerCase() || !path.basename(target).startsWith("relay-test-")) throw new Error("Unsafe test cleanup target");
  // Windows는 막 끝난 서버 프로세스·백신 검사가 relay.db를 잠시 붙잡는다. Bun의 rmSync는 maxRetries를 따르지 않으므로 직접 다시 시도한다.
  for (let attempt = 0; ; attempt++) {
    try { rmSync(target, { recursive: true, force: true }); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 40 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error;
      Bun.sleepSync(100);
    }
  }
}
export function fixture(retentionDays = 0) {
  const dir = temporary(); const config = loadConfig(dir); const db = openDatabase(config);
  const repo = new SessionRepository(db); const service = new SessionService(repo, retentionDays);
  return { dir, config, db, repo, service, close() { db.close(); cleanup(dir); } };
}
export function age(db: Database, providerSessionId: string, days: number) {
  db.query("UPDATE sessions SET updated_at = ? WHERE provider_session_id = ?")
    .run(new Date(Date.now() - days * 86_400_000).toISOString(), providerSessionId);
}
export function input(id: string, extra: Record<string, string> = {}) {
  return { provider: "openai", agent: "codex", sessionId: id, summary: "시작 요약", cwd: root, ...extra };
}
export function cli(dir: string, args: string[]) {
  const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), ...args, "--data-dir", dir, "--json"],
    { cwd: root, env: { ...process.env, RELAY_DATA_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString(); const stderr = result.stderr.toString();
  return { code: result.exitCode, stdout, stderr, data: JSON.parse(stdout || stderr) };
}
export async function cliAsync(dir: string, args: string[]) {
  const result = Bun.spawn([process.execPath, path.join(root, "src/index.ts"), ...args, "--data-dir", dir, "--json"],
    { cwd: root, env: { ...process.env, RELAY_DATA_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited]);
  return { code, stdout, stderr, data: JSON.parse(stdout || stderr) };
}
