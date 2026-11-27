import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dock, graph, openGraph, settled, win } from "./graph-helpers";
import { cli, env, freePort, launch, ready, root, stop, useRelayServer } from "./web-helpers";

// 메모 의미 검색을 화면에서 본다. 임베딩 서버는 뜻을 흉내 내는 테스트용 서버(tests/support/fake-embedder.ts)를 쓴다.
useRelayServer();

let embedder: ChildProcess | undefined;
test.afterEach(() => { embedder?.kill(); embedder = undefined; });

const old = Date.now() - 600_000;
const note = (id: string, title: string, body: string, at: number) => ({ id, kind: "note", parentId: null, title, body, position: null, createdAt: old + at, updatedAt: old + at });
const NOTES = [
  note("n-sync", "증분 동기화 설계", "# 증분 동기화 설계\n\n## 누락된 작업 재처리\n\n기기가 다시 깨어나면 밀린 변경을 다시 받아 순서대로 적용한다.", 1),
  note("n-wake", "노트북을 열면 메모가 늦게 뜬다", "sleep에서 resume한 뒤 sync가 밀린다.", 2),
  note("n-deploy", "서버 배포 절차", "이미지를 레지스트리에 올리고 컨테이너를 다시 띄운다.", 3),
  note("n-cook", "김치찌개", "두부를 넣고 끓인다.", 4),
  note("n-trip", "부산 여행", "기차와 숙소를 예약한다.", 5),
];

const bundled = path.join(root, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
const bun = existsSync(bundled) ? bundled : "bun";
const fake = path.join(root, "tests", "support", "fake-embedder.ts");

/** 임베딩 서버를 띄우고, 메모와 임베딩 설정을 저장소에 넣은 뒤 Relay 서버를 다시 띄운다. 색인 워커가 모든 메모를 색인할 때까지 기다린다. */
async function indexed() {
  const port = await freePort();
  embedder = spawn(bun, [fake, String(port)], { cwd: root, stdio: "ignore", windowsHide: true });
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/calls`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, { timeout: 15000 }).toBe(true);
  await stop();
  const file = path.join(env.dir, "notes.json");
  writeFileSync(file, JSON.stringify({ format: "relay-notes", schemaVersion: 1, items: NOTES }));
  cli(["notes", "import", file]);
  // 자가 진단을 거쳐 설정을 저장한다(뜻을 담는 서버인지 확인한다).
  expect(cli(["embed", "setup", "--url", `http://127.0.0.1:${port}`, "--model", "fake-embed", "--dimensions", "16"])).toMatchObject({ saved: true, diagnosis: { ok: true } });
  await launch();
  // relay web이 뜨면 색인 워커가 스스로 돈다.
  await expect.poll(async () => (await (await fetch(`${env.url}/api/v1/notes/index-status`)).json() as { summary: { ready: number; total: number } }).summary, { timeout: 30000 })
    .toEqual({ total: NOTES.length, ready: NOTES.length, pending: 0, failed: 0 });
}

test("의미 검색: 낱말이 달라도 뜻이 가까운 메모를 검색 결과 아래에 보이고, 그래프는 뜻이 가까운 메모를 잇고 「관련 없음」으로 물릴 수 있다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await indexed();
  await ready(page);
  await page.locator(dock("메모")).click();
  const notes = page.locator(win("notes"));
  await expect(notes).toBeVisible();
  await expect(notes.locator(".notes-tree")).toContainText("증분 동기화 설계");

  // 검색: 「wake up」은 어느 메모에도 그대로 들어 있지 않다. 글자로 찾은 것은 없고, 뜻으로 찾은 메모가 아래에 뜬다.
  const search = notes.locator("#notes-search");
  await search.fill("wake up sync");
  const related = notes.getByRole("region", { name: "관련 메모" });
  await expect(related).toBeVisible();
  await expect(related.locator("h3")).toHaveText("뜻이 가까운 메모");
  await expect(related.locator(".notes-result .tree-label").first()).toHaveText(/증분 동기화 설계|노트북을 열면 메모가 늦게 뜬다/);
  const hit = related.locator(".notes-result", { hasText: "증분 동기화 설계" });
  await expect(hit.locator(".notes-result-path")).toContainText("누락된 작업 재처리");
  await expect(hit.locator(".notes-result-snippet")).toContainText("밀린 변경을 다시 받아");
  await expect(notes.locator(".notes-tree-empty")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("semantic-search-dark.png") });
  // 글자가 그대로 든 메모는 위(바로 뜨는 목록)에만 나오고 아래에 거듭 나오지 않는다.
  await search.fill("sync");
  await expect(notes.getByRole("list", { name: "검색 결과" }).locator(".notes-result")).toHaveText([/노트북을 열면 메모가 늦게 뜬다/]);
  await expect(related.locator(".notes-result", { hasText: "노트북을 열면" })).toHaveCount(0);
  await expect(related.locator(".notes-result", { hasText: "증분 동기화 설계" })).toBeVisible();
  // 뜻으로는 닿지 않는데 낱말로만 걸린 메모(「이미지」「올리고」)는 남기되 관련이 낮을 수 있다고 알린다.
  await search.fill("sync 이미지 올리고");
  await expect(related.locator(".notes-result", { hasText: "서버 배포 절차" }).locator(".notes-result-path")).toContainText("관련이 낮을 수 있음");
  await expect(related.locator(".notes-result", { hasText: "증분 동기화 설계" }).locator(".notes-result-path")).not.toContainText("관련이 낮을 수 있음");
  await search.fill("sync");
  // 눌러서 연다.
  await related.locator(".notes-result", { hasText: "증분 동기화 설계" }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("증분 동기화 설계");
  await search.fill("");

  // 그래프: 뜻이 가까운 두 메모가 「뜻이 가까움」 선으로 이어지고, 발견 패널이 근거 절과 함께 제안한다.
  await notes.locator(".titlebar").dblclick({ position: { x: 200, y: 20 } });
  await openGraph(page);
  await notes.locator(".graph-rail-button[data-tool=insight]").click();
  const panel = notes.getByRole("complementary", { name: "발견" });
  const index = panel.getByRole("region", { name: "의미 색인" });
  await expect(index.locator("h4")).toContainText(`${NOTES.length}/${NOTES.length}`);
  await expect(index).toContainText("색인 워커 켜짐");
  const suggestion = panel.locator(".graph-suggest li", { hasText: "증분 동기화 설계" });
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toContainText("노트북을 열면");
  await expect(suggestion.locator("p")).toContainText("낱말은 달라도 뜻이 가깝습니다");
  await expect(suggestion.locator("p")).toContainText("「누락된 작업 재처리」");
  // 고른 메모의 카드에 그 연결이 「뜻이 가까움」으로 적힌다.
  await suggestion.locator(".graph-suggest-pair button", { hasText: "증분 동기화 설계" }).click();
  const card = notes.locator(".graph-card");
  await expect(card.locator(".graph-card-links")).toContainText("뜻이 가까움");
  await expect(card.locator(".graph-card-links")).toContainText("노트북을 열면");
  await settled(page);
  // 패널 안의 단추를 누르거나 초점을 옮겨도 그래프 영역이 밀리지 않는다(바탕의 빛이 영역 밖으로 번져 있어, 스크롤을 막지 않으면 패널과 카드가 통째로 밀려 잘린다).
  expect(await page.evaluate(() => { const area = document.querySelector(".notes-graph") as HTMLElement; area.scrollTop = 40; area.scrollLeft = 40; return [area.scrollTop, area.scrollLeft]; })).toEqual([0, 0]);
  await page.screenshot({ path: test.info().outputPath("semantic-graph-dark.png") });

  // 「관련 없음」: 그 쌍을 다시 제안하지 않고 선도 걷는다. 서버에 남아 다시 열어도 그대로다.
  await suggestion.getByRole("button", { name: /관련 없음/ }).click();
  await expect(notes.locator(".graph-notice")).toContainText("이 쌍은 다시 제안하지 않습니다.");
  await expect(panel.locator(".graph-suggest li", { hasText: "증분 동기화 설계" })).toHaveCount(0);
  await expect(card.locator(".graph-card-links")).not.toContainText("뜻이 가까움");
  const left = await page.evaluate(async () => (await (await fetch("/api/v1/notes/semantic-links", { cache: "no-store" })).json() as { items: unknown[] }).items.length);
  expect(left).toBe(0);
  // 보일 연결 설정에 「뜻이 가까움」이 있다.
  await expect(graph(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("쉬다 꺼진 임베딩 서버: 처음에는 낱말로 답하고, 서버가 뜨면 다시 치지 않아도 뜻으로 찾은 결과로 바뀐다", async ({ page }) => {
  await indexed();
  // 임베딩 서버를 끄고, 필요할 때 띄우는 명령을 설정에 적는다(쓰지 않으면 꺼지는 로컬 서버와 같은 상태).
  await stop();
  embedder!.kill(); embedder = undefined;
  const file = path.join(env.dir, "embedding.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as { url: string };
  const port = Number(new URL(config.url).port);
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/calls`, { signal: AbortSignal.timeout(300) })).ok; } catch { return false; } }, { timeout: 10000 }).toBe(false);
  writeFileSync(file, JSON.stringify({ ...config, launch: [bun, fake, String(port)], idleMinutes: 1 }));
  await launch();
  try {
    await ready(page);
    await page.locator(dock("메모")).click();
    const notes = page.locator(win("notes"));
    await expect(notes.locator(".notes-tree")).toContainText("증분 동기화 설계");
    const asked = (response: { url(): string; request(): { postDataJSON(): unknown } }) => response.url().endsWith("/api/v1/notes/search") && (response.request().postDataJSON() as { query?: string })?.query === "wake up sync";
    const first = page.waitForResponse(asked);
    await notes.locator("#notes-search").fill("wake up sync");
    // 첫 답은 낱말 검색이다(서버는 이 질의를 받고 임베딩 서버를 띄우기 시작한다).
    expect(await (await first).json()).toMatchObject({ searchMode: "lexical_fallback", fallbackReason: "embedder_offline" });
    // 잠시 뒤 화면이 한 번 더 물어, 뜻으로 찾은 결과로 바꾼다.
    const related = notes.getByRole("region", { name: "관련 메모" });
    await expect(related.locator("h3")).toHaveText("뜻이 가까운 메모", { timeout: 15000 });
    await expect(related.locator(".notes-result", { hasText: "증분 동기화 설계" }).locator(".notes-result-snippet")).toContainText("밀린 변경을 다시 받아");
    await expect(notes.locator(".notes-related-note")).toHaveCount(0);
  } finally { await fetch(`http://127.0.0.1:${port}/exit`, { signal: AbortSignal.timeout(2000) }).catch(() => {}); }
});
