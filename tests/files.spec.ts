import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env, ready, useRelayServer } from "./web-helpers";

useRelayServer();

const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
const win = (id: string) => `.window[data-window="${id}"]`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const row = (page: Page, name: string) => page.locator(`${win("files")} [role=option]`, { hasText: name });

/** 저장소 폴더 안에 둘러볼 파일을 만들고, 경로 입력으로 그 폴더를 연다. */
async function openFolder(page: Page) {
  const disk = path.join(realpathSync(env.dir), "둘러보기");
  mkdirSync(path.join(disk, "하위 폴더"), { recursive: true });
  writeFileSync(path.join(disk, "보고서.txt"), "첫 줄 내용\n둘째 줄\n");
  writeFileSync(path.join(disk, "그림.png"), PNG);
  writeFileSync(path.join(disk, "zeta.log"), "z");
  writeFileSync(path.join(disk, ".숨김"), "x");
  writeFileSync(path.join(disk, "하위 폴더", "안쪽.md"), "# 안쪽\n");
  await ready(page);
  await page.locator(dock("파일 탐색기")).click();
  await expect(page.locator(win("files"))).toHaveAttribute("data-focused", "");
  await expect(page.locator(".menubar-app")).toHaveText("파일 탐색기");
  // 시작 화면: 즐겨찾기와 드라이브
  await expect(page.locator(".files-home")).toContainText("장치 및 드라이브");
  await expect(page.locator(".files-drive").first()).toBeVisible();
  await page.getByRole("button", { name: "경로 직접 입력 (Ctrl+L)" }).click();
  await page.getByRole("textbox", { name: "경로" }).fill(disk);
  await page.keyboard.press("Enter");
  await expect(row(page, "보고서.txt")).toBeVisible();
  return disk;
}

test("파일 탐색기: 폴더를 열고 미리 보기·숨김·찾기·이동·키보드가 동작한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  await expect(page.locator(".files-crumb[aria-current=location]")).toHaveText("둘러보기");
  await expect(page.locator(".files-status")).toContainText("항목 4개 · 숨김 1개");
  await expect(row(page, ".숨김")).toHaveCount(0);
  // 폴더가 먼저, 그다음 이름 순(한국어 정렬이라 한글 뒤에 영문)
  await expect(page.locator(`${win("files")} [role=option]`).first()).toContainText("하위 폴더");

  // 고르면 오른쪽 미리 보기에 글과 정보가 나온다.
  await row(page, "보고서.txt").click();
  await expect(row(page, "보고서.txt")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".files-preview-text pre")).toHaveText("첫 줄 내용\n둘째 줄\n");
  await expect(page.locator(".files-preview")).toContainText("텍스트 문서");
  await expect(page.locator(".files-preview")).toContainText(path.join(disk, "보고서.txt"));
  await row(page, "그림.png").click();
  await expect(page.locator(".files-preview-art img")).toHaveJSProperty("naturalWidth", 1);

  // 숨김 항목 보기
  await page.getByRole("button", { name: "숨김 항목 보기" }).click();
  await expect(row(page, ".숨김")).toBeVisible();
  await page.getByRole("button", { name: "숨김 항목 보기" }).click();
  await expect(row(page, ".숨김")).toHaveCount(0);

  // 이 폴더에서 찾기
  await page.getByRole("textbox", { name: "이 폴더에서 찾기" }).fill("보고");
  await expect(page.locator(`${win("files")} [role=option]`)).toHaveCount(1);
  await page.getByRole("textbox", { name: "이 폴더에서 찾기" }).press("Escape");
  await expect(page.locator(`${win("files")} [role=option]`)).toHaveCount(4);

  // 폴더를 두 번 눌러 들어가고, 뒤로 오면 들어갔던 폴더가 골라져 있다.
  await row(page, "하위 폴더").dblclick();
  await expect(row(page, "안쪽.md")).toBeVisible();
  await expect(page.locator(".files-crumb[aria-current=location]")).toHaveText("하위 폴더");
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(row(page, "하위 폴더")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "앞으로" }).click();
  await expect(row(page, "안쪽.md")).toBeVisible();

  // 키보드: Backspace로 위로, 화살표로 고르고 Enter로 폴더 열기, 글자를 치면 그 이름으로
  await page.locator(".files-list").focus();
  await page.keyboard.press("Backspace");
  await expect(row(page, "하위 폴더")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(row(page, "zeta.log")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(row(page, "하위 폴더")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "그림.png")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "보고서.txt")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("z");
  await expect(row(page, "zeta.log")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(row(page, "안쪽.md")).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(row(page, "보고서.txt")).toBeVisible();

  // 열 머리를 누르면 정렬이 바뀐다(폴더는 늘 먼저).
  await page.getByRole("columnheader", { name: "이름" }).click();
  await expect(page.getByRole("columnheader", { name: "이름" })).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator(`${win("files")} [role=option]`).nth(1)).toContainText("zeta.log");

  // 아이콘 보기: 그림은 섬네일로 보인다. 보기는 다시 열어도 남는다.
  await page.getByRole("radio", { name: "아이콘 보기" }).click();
  await expect(page.locator(".files-list")).toHaveAttribute("data-view", "grid");
  await expect(page.locator(".files-tile", { hasText: "그림.png" }).locator("img")).toHaveJSProperty("naturalWidth", 1);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("파일 탐색기")).click();
  await expect(page.locator(".files-list")).toHaveAttribute("data-view", "grid");
  await expect(page.locator(".files-tile", { hasText: "보고서.txt" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("파일 탐색기: 탐색기에서 보기·기본 앱으로 열기는 서버에 맡기고, 없는 경로는 알린다", async ({ page }) => {
  const opened: unknown[] = [];
  // 실제 탐색기 창이 뜨지 않도록 열기 요청은 가로챈다.
  await page.route("**/api/v1/files/open", async (route) => {
    const body = route.request().postDataJSON() as { path: string; action: string };
    opened.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, path: body.path, action: body.action }) });
  });
  const disk = await openFolder(page);
  await row(page, "보고서.txt").click();
  await page.locator(".files-preview").getByRole("button", { name: "탐색기에서 보기" }).click();
  await expect(page.locator(".files-toast")).toContainText("탐색기에서 보여 줍니다.");
  await row(page, "보고서.txt").dblclick();
  await expect(page.locator(".files-toast")).toContainText("기본 앱으로 엽니다.");
  // 오른쪽 클릭 메뉴
  await row(page, "하위 폴더").click({ button: "right" });
  await page.getByRole("menuitem", { name: "탐색기에서 보기" }).click();
  expect(opened).toEqual([
    { path: path.join(disk, "보고서.txt"), action: "reveal" },
    { path: path.join(disk, "보고서.txt"), action: "open" },
    { path: path.join(disk, "하위 폴더"), action: "reveal" },
  ]);

  // 없는 경로를 치면 내용 자리에 알리고 상위 폴더로 돌아갈 수 있다.
  await page.getByRole("button", { name: "경로 직접 입력 (Ctrl+L)" }).click();
  await page.getByRole("textbox", { name: "경로" }).fill(path.join(disk, "없는 폴더"));
  await page.keyboard.press("Enter");
  await expect(page.locator(".files-empty")).toContainText("파일이나 폴더가 없습니다.");
  await page.getByRole("button", { name: "상위 폴더" }).click();
  await expect(row(page, "보고서.txt")).toBeVisible();

  // 다른 꼴로 친 경로(슬래시·끝 구분자)도 서버가 정리한 경로로 바꿔 연다.
  await page.getByRole("button", { name: "경로 직접 입력 (Ctrl+L)" }).click();
  await page.getByRole("textbox", { name: "경로" }).fill(`${path.join(disk, "하위 폴더").replaceAll("\\", "/")}/`);
  await page.keyboard.press("Enter");
  await expect(row(page, "안쪽.md")).toBeVisible();
  await expect(page.locator(".files-crumb[aria-current=location]")).toHaveText("하위 폴더");
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(row(page, "보고서.txt")).toBeVisible();

  // 이 PC로 돌아가기
  await page.getByRole("button", { name: "이 PC", exact: true }).first().click();
  await expect(page.locator(".files-home")).toBeVisible();
});

test("파일 탐색기: 왼쪽 트리가 지금 폴더까지 펼쳐지고, 오른쪽 클릭으로 즐겨찾기를 고친다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  const tree = page.locator(".files-tree");
  const node = (name: string) => tree.locator(`[role=treeitem][aria-label="${name}"]`);
  // 이 PC 아래가 지금 폴더까지 펼쳐지고 지금 폴더가 골라져 있다.
  await expect(node("이 PC")).toHaveAttribute("aria-expanded", "true");
  await expect(node("둘러보기")).toHaveAttribute("aria-selected", "true");
  await expect(node("둘러보기")).toBeInViewport();
  // 펼침 단추로 하위 폴더를 읽어 오고, 하위 폴더가 없는 폴더는 펼침 단추가 사라진다.
  await node("둘러보기").locator(":scope > .tree-row .tree-chevron").click();
  await expect(node("하위 폴더")).toBeVisible();
  await node("하위 폴더").locator(":scope > .tree-row .tree-chevron").click();
  await expect(node("하위 폴더")).not.toHaveAttribute("aria-expanded");
  // 트리 항목을 누르면 그 폴더로 간다.
  await node("하위 폴더").locator(":scope > .tree-row").click();
  await expect(row(page, "안쪽.md")).toBeVisible();
  await expect(node("하위 폴더")).toHaveAttribute("aria-selected", "true");

  // 키보드: ←로 상위 항목, ←로 접기, →로 펼치기, Enter로 열기
  await node("하위 폴더").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(node("둘러보기")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(node("둘러보기")).toHaveAttribute("aria-expanded", "false");
  await expect(node("하위 폴더")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(node("하위 폴더")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(row(page, "보고서.txt")).toBeVisible();

  // 오른쪽 클릭 → 즐겨찾기에 추가하면 즐겨찾기 묶음과 이 PC 시작 화면에 나온다.
  const favorites = node("즐겨찾기").locator(":scope > [role=group] > [role=treeitem]");
  const before = await favorites.count();
  await node("하위 폴더").locator(":scope > .tree-row").click({ button: "right" });
  await page.getByRole("menuitem", { name: "즐겨찾기에 추가" }).click();
  await expect(page.locator(".files-toast")).toContainText("즐겨찾기에 추가했습니다.");
  await expect(favorites).toHaveCount(before + 1);
  await expect(favorites.last()).toHaveAttribute("aria-label", "하위 폴더");
  // 본문 목록의 폴더 메뉴에도 같은 항목이 있고, 이미 즐겨찾기면 제거로 바뀐다.
  await row(page, "하위 폴더").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "즐겨찾기에서 제거" })).toBeVisible();
  await page.keyboard.press("Escape");
  // 위로 이동하고, 다시 열어도 남는다.
  await favorites.last().locator(":scope > .tree-row").click({ button: "right" });
  await page.getByRole("menuitem", { name: "위로 이동" }).click();
  await expect(favorites.nth(before - 1)).toHaveAttribute("aria-label", "하위 폴더");
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("파일 탐색기")).click();
  await expect(favorites.nth(before - 1)).toHaveAttribute("aria-label", "하위 폴더");
  await page.getByRole("button", { name: "이 PC", exact: true }).first().click();
  await expect(page.locator(".files-place", { hasText: "하위 폴더" })).toBeVisible();
  // 제거
  await favorites.nth(before - 1).locator(":scope > .tree-row").click({ button: "right" });
  await page.getByRole("menuitem", { name: "즐겨찾기에서 제거" }).click();
  await expect(favorites).toHaveCount(before);
  expect(path.basename(disk)).toBe("둘러보기");
  expect(errors).toEqual([]);
});
