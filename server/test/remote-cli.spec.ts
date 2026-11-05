import { afterEach, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
let directory: string | undefined;
afterEach(async () => {
  await t?.close();
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("relay-contract-")) rmSync(directory, { recursive: true, force: true });
});
test("두 CLI 클라이언트가 실제 NestJS API에서 같은 세션·메모와 재전송 결과를 본다", async () => {
  t = await testApp();
  await t.app.listen(0, "127.0.0.1");
  const address = t.app.getHttpServer().address() as { port: number };
  directory = mkdtempSync(path.join(os.tmpdir(), "relay-contract-"));
  writeFileSync(path.join(directory, "config.json"), JSON.stringify({ schemaVersion: 2, mode: "remote", remote: { url: `http://127.0.0.1:${address.port}`, token: t.token } }));
  const root = path.resolve("..");
  const bundledBun = path.join(root, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const bun = existsSync(bundledBun) ? bundledBun : "bun";
  const run = async (...args: string[]) => {
    const result = await promisify(execFile)(bun, [path.join(root, "src/index.ts"), ...args, "--data-dir", directory!, "--json"], { cwd: root, env: { ...process.env, RELAY_ALLOW_HTTP: "1" }, windowsHide: true });
    return JSON.parse(result.stdout);
  };
  const record = ["record", "--provider", "openai", "--agent", "codex", "--session-id", "contract-parent", "--summary", "처음", "--cwd", root];
  const parent = await run(...record);
  const update = await run("update", "--session-id", "contract-parent", "--summary", "다른 PC에서 갱신", "--status", "working");
  expect(update.session.id).toBe(parent.session.id);
  const shown = await run("show", "contract-parent", "--history");
  expect(shown.updates.map((row: { sequence: number }) => row.sequence)).toEqual([2, 1]);
  await run("continue", "contract-parent", "--parent-provider", "openai", "--provider", "anthropic", "--agent", "claude-code", "--session-id", "contract-child", "--summary", "이어서", "--cwd", root);
  expect((await run("chain", "contract-child")).items).toHaveLength(2);
  expect((await run("handoff", "contract-child")).markdown).toContain("이어서");
  expect((await run("latest", "claude")).session.providerSessionId).toBe("contract-child");
  await run("pin", "contract-child"); expect((await run("show", "contract-child")).session.pinned).toBe(true);
  const exportFile = path.join(directory, "notes.json");
  const now = Date.now();
  writeFileSync(exportFile, JSON.stringify({ format: "relay-notes", schemaVersion: 1, items: [{ id: "note-contract", kind: "note", title: "공유 메모", body: "두 PC", parentId: null, position: null, createdAt: now, updatedAt: now }] }));
  await run("notes", "import", exportFile);
  await run("notes", "export", exportFile);
  expect(JSON.parse(readFileSync(exportFile, "utf8")).items[0].title).toBe("공유 메모");
  expect((await run("outbox", "list")).pending).toHaveLength(0);
});
