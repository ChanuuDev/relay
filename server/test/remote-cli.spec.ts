import { afterEach, expect, test } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
let directory: string | undefined;
let embedder: ChildProcess | undefined;
afterEach(async () => {
  embedder?.kill(); embedder = undefined;
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
  const runAt = async (store: string, ...args: string[]) => {
    const result = await promisify(execFile)(bun, [path.join(root, "src/index.ts"), ...args, "--data-dir", store, "--json"], { cwd: root, env: { ...process.env, RELAY_ALLOW_HTTP: "1" }, windowsHide: true });
    return JSON.parse(result.stdout);
  };
  const run = (...args: string[]) => runAt(directory!, ...args);
  expect((await run("remote", "test")).ok).toBe(true);
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
  const local = path.join(directory, "local"); mkdirSync(local);
  await runAt(local, "record", "--provider", "openai", "--agent", "codex", "--session-id", "local-migrate", "--summary", "이전할 로컬 기록", "--cwd", root);
  await runAt(local, "notes", "import", exportFile);
  writeFileSync(path.join(local, "config.json"), readFileSync(path.join(directory, "config.json")));
  expect((await runAt(local, "migrate", "--to-remote", "--dry-run")).counts.sessions).toBe(1);
  await runAt(local, "migrate", "--to-remote");
  expect((await run("show", "local-migrate", "--history")).updates).toHaveLength(1);
  await runAt(local, "migrate", "--to-remote");
  expect((await run("show", "local-migrate", "--history")).updates).toHaveLength(1);
  expect(existsSync(path.join(local, "relay.db"))).toBe(true);
});

test("원격 모드의 CLI가 색인 워커를 돌려 벡터를 올리고, 질의 벡터를 실어 뜻으로 찾는다", async () => {
  t = await testApp();
  await t.app.listen(0, "127.0.0.1");
  const address = t.app.getHttpServer().address() as { port: number };
  directory = mkdtempSync(path.join(os.tmpdir(), "relay-contract-"));
  writeFileSync(path.join(directory, "config.json"), JSON.stringify({ schemaVersion: 2, mode: "remote", remote: { url: `http://127.0.0.1:${address.port}`, token: t.token } }));
  const root = path.resolve("..");
  const bundledBun = path.join(root, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const bun = existsSync(bundledBun) ? bundledBun : "bun";
  const run = async (...args: string[]) => {
    const result = await promisify(execFile)(bun, [path.join(root, "src/index.ts"), ...args, "--data-dir", directory!, "--json"], { cwd: root, env: { ...process.env, RELAY_ALLOW_HTTP: "1", RELAY_NO_GIT: "1" }, windowsHide: true });
    return JSON.parse(result.stdout);
  };
  // 이 PC의 임베딩 서버(테스트용: 뜻을 흉내 내는 벡터를 준다).
  const port = await new Promise<number>((resolve) => { const probe = net.createServer(); probe.listen(0, "127.0.0.1", () => { const free = (probe.address() as net.AddressInfo).port; probe.close(() => resolve(free)); }); });
  embedder = spawn(bun, [path.join(root, "tests", "support", "fake-embedder.ts"), String(port)], { stdio: "ignore", windowsHide: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/calls`, { signal: AbortSignal.timeout(500) })).ok) break; } catch { /* 아직 뜨지 않았다. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const old = Date.now() - 60_000;
  const note = (id: string, title: string, body: string) => ({ id, kind: "note", parentId: null, title, body, position: null, createdAt: old, updatedAt: old });
  const exportFile = path.join(directory, "notes.json");
  writeFileSync(exportFile, JSON.stringify({ format: "relay-notes", schemaVersion: 1, items: [
    note("n-sync", "증분 동기화 설계", "# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다."),
    note("n-wake", "노트북을 열면 메모가 늦게 뜬다", "sleep에서 resume한 뒤 sync가 밀린다."), note("n-cook", "김치찌개", "두부를 넣고 끓인다.")] }));
  await run("notes", "import", exportFile);

  expect(await run("embed", "status")).toMatchObject({ activeModelKey: null, summary: { total: 3, ready: 0, pending: 3 } });
  expect(await run("memo", "--search", "wake up sync")).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "no_index" });
  expect(await run("embed", "setup", "--url", `http://127.0.0.1:${port}`, "--model", "fake-embed", "--dimensions", "16")).toMatchObject({ saved: true, diagnosis: { ok: true } });
  const worked = await run("embed", "run");
  expect(worked).toMatchObject({ notes: 3, embedded: 3, failed: 0, remaining: 0, offline: false });
  expect(await run("embed", "status", "--note", "n-sync")).toMatchObject({ activeModelKey: worked.modelKey, embedderOnline: true, summary: { total: 3, ready: 3, pending: 0 }, items: [{ status: "ready", chunks: 1 }] });
  // 낱말이 겹치지 않아도 찾는다(「wake up sync」는 n-sync 본문에 없다). 벡터는 이 PC가 계산해 실어 보낸다.
  const found = await run("memo", "--search", "wake up sync");
  expect(found).toMatchObject({ searchMode: "hybrid", modelKey: worked.modelKey });
  expect(found.items.map((item: { id: string }) => item.id).slice(0, 2).sort()).toEqual(["n-sync", "n-wake"]);
  expect((await run("graph", "suggest", "--semantic")).items.map((item: { from: { id: string }; to: { id: string } }) => [item.from.id, item.to.id].sort().join("|"))).toEqual(["n-sync|n-wake"]);
  // 의미 카드와 문서 등록도 원격 서버에 남는다.
  const pending = await run("embed", "cards", "--limit", "5");
  const cards = path.join(directory, "cards.json");
  writeFileSync(cards, JSON.stringify({ author: "test-model", cards: [{ noteId: "n-cook", contentHash: pending.items.find((item: { noteId: string }) => item.noteId === "n-cook").contentHash, summary: "찌개 끓이는 법", terms: ["stew recipe"], questions: [] }] }));
  expect(await run("embed", "cards", "--save", cards)).toMatchObject({ saved: 1, skipped: [] });
  expect((await run("memo", "--search", "stew recipe", "--mode", "keyword")).items.map((item: { id: string }) => item.id)).toEqual(["n-cook"]);
  const doc = path.join(directory, "adr.md");
  writeFileSync(doc, "# 동기화 결정\n\n푸시로 바꾼다.\n");
  const registered = await run("memo", "register", doc, "--type", "decision", "--status", "adopted", "--project", "relay");
  expect(registered).toMatchObject({ action: "created" });
  expect((await run("memo", "meta", registered.noteId)).meta).toMatchObject({ docType: "decision", docStatus: "adopted", project: "relay" });
  // 워커와 검색의 응답은 멱등 표에 남지 않는다.
  const { schema } = await import("../src/db/database.js");
  expect((await t.db.select().from(schema.idempotencyKeys)).filter((row) => JSON.stringify(row.body).includes("leaseToken") || JSON.stringify(row.body).includes("searchMode"))).toEqual([]);
}, 120_000);
