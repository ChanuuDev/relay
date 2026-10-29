import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
  // 글·그림은 두 번 누르면 뷰어로 열리므로, 기본 앱은 오른쪽 클릭 메뉴로 연다.
  await row(page, "보고서.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "기본 앱으로 열기" }).click();
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

/** 한 쪽짜리 최소 PDF. xref 오프셋을 계산해 pdf.js가 복구 없이 읽는다. */
function tinyPdf(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] >>"];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("파일 탐색기: 미리 보기 창 폭을 끌어 바꾸고, PDF 첫 쪽을 그리며, 그림·글을 두 번 누르면 뷰어가 연다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  writeFileSync(path.join(disk, "문서.pdf"), tinyPdf());
  writeFileSync(path.join(disk, "안내.md"), "# 안내\n\n**굵게** 쓴 글\n");
  writeFileSync(path.join(disk, "그림2.png"), PNG);
  writeFileSync(path.join(disk, "예제.ts"), "const greet = (name: string) => `안녕, ${name}`;\n/* 여러 줄\n   주석 */\nexport default greet;\n");
  await page.getByRole("button", { name: "새로 고침" }).click();
  await expect(row(page, "문서.pdf")).toBeVisible();

  // 미리 보기 창 경계를 끌면 폭이 바뀌고, 다시 열어도 남는다.
  await row(page, "그림.png").click();
  await expect(page.locator(".files-preview-art img")).toHaveJSProperty("naturalWidth", 1);
  const preview = page.locator(".files-preview");
  const before = (await preview.boundingBox())!.width;
  expect(Math.round(before)).toBe(272);
  const handle = page.locator(".files-preview-split > .split-handle");
  await expect(handle).toHaveAttribute("aria-label", "미리 보기 창 너비 조절");
  const edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x - 80, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await preview.boundingBox())!.width - 352) <= 3).toBe(true);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("파일 탐색기")).click();
  await expect(row(page, "문서.pdf")).toBeVisible();
  await expect.poll(async () => Math.abs((await preview.boundingBox())!.width - 352) <= 3).toBe(true);

  // PDF는 첫 쪽을 그리고 쪽수를 보인다.
  await row(page, "문서.pdf").click();
  await expect(page.locator(".files-preview-pdf")).toHaveAttribute("data-status", "ready");
  await expect(page.locator(".files-preview-pages")).toHaveText("1쪽");
  expect(await page.locator(".files-preview-pdf canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width > 0)).toBe(true);
  await expect(page.locator(".files-preview")).toContainText("PDF 문서");

  // 그림을 두 번 누르면 뷰어 창이 열리고, 같은 폴더의 그림을 오간다.
  await row(page, "그림.png").dblclick();
  const viewer = page.locator(win("viewer"));
  await expect(viewer).toHaveAttribute("data-focused", "");
  await expect(viewer.locator(".window-title")).toHaveText("그림.png");
  await expect(viewer.locator(".viewer-image-box")).toHaveAttribute("data-ready", "");
  await expect(viewer.locator(".viewer-status")).toContainText("1 × 1");
  await expect(viewer.locator(".viewer-count")).toHaveText("1 / 2");
  await expect(viewer.locator(".viewer-zoom")).toHaveText("100%");
  await viewer.getByRole("button", { name: "확대" }).click();
  await expect(viewer.locator(".viewer-zoom")).toHaveText("125%");
  await viewer.getByRole("button", { name: "배율. 누르면 창에 맞춤" }).click();
  await expect(viewer.locator(".viewer-zoom")).toHaveText("100%");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".window-title")).toHaveText("그림2.png");
  await expect(viewer.locator(".viewer-count")).toHaveText("2 / 2");
  await expect(viewer.getByRole("button", { name: "다음 파일" })).toBeDisabled();

  // Markdown은 서식으로 보이고 원문으로 바꿀 수 있다. Esc는 뷰어를 닫는다.
  await page.locator(dock("파일 탐색기")).click();
  await row(page, "안내.md").dblclick();
  await expect(viewer.locator(".window-title")).toHaveText("안내.md");
  await expect(viewer.locator(".viewer-prose h1")).toHaveText("안내");
  await expect(viewer.locator(".viewer-prose strong")).toHaveText("굵게");
  await expect(viewer.locator(".viewer-status")).toContainText("줄 4");
  // 본문은 고정 폭이 아니라 창을 넓히면 함께 넓어진다.
  const proseWidth = async () => (await viewer.locator(".viewer-prose").boundingBox())!.width;
  const narrow = await proseWidth();
  await viewer.locator(".window-title").dblclick();
  await expect.poll(proseWidth).toBeGreaterThan(narrow + 100);
  expect(Math.abs((await proseWidth()) - (await viewer.locator(".viewer-document").evaluate((node) => node.clientWidth)))).toBeLessThanOrEqual(1);
  await viewer.locator(".window-title").dblclick();
  await viewer.getByRole("radio", { name: "원문" }).click();
  await expect(viewer.locator(".viewer-source")).toContainText("# 안내");
  await viewer.locator(".viewer-stage").focus();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // 미리 보기의 `뷰어로 열기`도 같은 창을 연다.
  await row(page, "보고서.txt").click();
  await page.locator(".files-preview").getByRole("button", { name: "뷰어로 열기" }).click();
  await expect(viewer.locator(".window-title")).toHaveText("보고서.txt");
  await expect(viewer.locator(".viewer-source")).toContainText("첫 줄 내용");
  // 소스 코드는 줄 번호와 구문 색이 붙고, 여러 줄 주석도 줄마다 색이 이어진다.
  await page.locator(dock("파일 탐색기")).click();
  await row(page, "예제.ts").dblclick();
  await expect(viewer.locator(".window-title")).toHaveText("예제.ts");
  const code = viewer.locator(".viewer-code");
  await expect(code).toHaveAttribute("data-language", "typescript");
  await expect(code.locator(".viewer-line")).toHaveCount(5);
  await expect(code.locator(".viewer-line").first().locator(".hljs-keyword").first()).toHaveText("const");
  await expect(code.locator(".viewer-line").nth(1).locator(".hljs-comment")).toHaveText("/* 여러 줄");
  await expect(code.locator(".viewer-line").nth(2).locator(".hljs-comment")).toHaveText("   주석 */");
  await expect(viewer.locator(".viewer-status")).toContainText("TypeScript · 줄 5");
  await expect(code).toHaveAttribute("style", /--gutter: 2ch/);
  expect(await code.locator(".viewer-line .hljs-keyword").first().evaluate((el) => getComputedStyle(el).color)).not.toBe(await code.locator(".viewer-line .hljs-comment").first().evaluate((el) => getComputedStyle(el).color));
  await viewer.getByRole("button", { name: "줄 바꿈" }).click();
  await expect(code).not.toHaveAttribute("data-wrap", "");
  expect(errors).toEqual([]);
});

test("뷰어: 글·코드를 고쳐 원래 인코딩·줄 끝으로 저장하고, 바뀐 파일·저장 안 한 변경은 묻는다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  const source = path.join(disk, "예제.ts");
  writeFileSync(source, "const a = 1;\r\nexport default a;\r\n");
  await page.getByRole("button", { name: "새로 고침" }).click();
  await row(page, "예제.ts").dblclick();
  const viewer = page.locator(win("viewer"));
  await expect(viewer.locator(".viewer-code")).toContainText("export default a;");
  await viewer.getByRole("button", { name: "편집" }).click();
  const input = viewer.getByRole("textbox", { name: "내용 편집" });
  await expect(input).toBeFocused();
  await expect(viewer.locator(".viewer-status")).toContainText("편집 중");
  await expect(viewer.locator(".viewer-status")).toContainText("UTF-8 · CRLF");
  // 투명한 입력칸의 글자 자리가 아래 색 입힌 코드의 글자 자리와 겹친다.
  const offset = await viewer.locator(".viewer-edit").evaluate((edit) => {
    const area = edit.querySelector("textarea")!, text = edit.querySelector<HTMLElement>(".viewer-text")!;
    const areaStyle = getComputedStyle(area), textStyle = getComputedStyle(text);
    return { x: area.getBoundingClientRect().left + parseFloat(areaStyle.paddingLeft) - (text.getBoundingClientRect().left + parseFloat(textStyle.paddingLeft)),
      y: area.getBoundingClientRect().top + parseFloat(areaStyle.paddingTop) - text.getBoundingClientRect().top, height: area.offsetHeight - (edit as HTMLElement).offsetHeight };
  });
  expect(Math.abs(offset.x)).toBeLessThanOrEqual(0.5); expect(Math.abs(offset.y)).toBeLessThanOrEqual(0.5); expect(offset.height).toBe(0);
  // 고치고 Ctrl+S로 저장하면 CRLF가 그대로 남는다.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// 끝\n");
  await page.keyboard.press("Tab");
  await expect(viewer.locator(".viewer-status")).toContainText("수정됨");
  await expect(viewer.locator(".viewer-edit .viewer-line")).toHaveCount(4);
  await page.keyboard.press("Control+s");
  await expect(viewer.locator(".files-toast")).toContainText("저장했습니다.");
  expect(readFileSync(source, "utf8")).toBe("const a = 1;\r\nexport default a;\r\n// 끝\r\n\t");
  await expect(viewer.getByRole("button", { name: "저장" })).toBeDisabled();
  // 다른 곳에서 바뀐 파일은 덮어쓰기 전에 묻는다.
  writeFileSync(source, "밖에서 고침\r\n");
  await input.press("Backspace");
  await viewer.getByRole("button", { name: "저장" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("다른 곳에서 파일이 바뀌었습니다");
  await dialog.getByRole("button", { name: "취소" }).click();
  expect(readFileSync(source, "utf8")).toBe("밖에서 고침\r\n");
  await viewer.getByRole("button", { name: "저장" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "덮어쓰기" }).click();
  await expect(viewer.locator(".files-toast")).toContainText("저장했습니다.");
  expect(readFileSync(source, "utf8")).toBe("const a = 1;\r\nexport default a;\r\n// 끝\r\n");
  // 저장하지 않은 채 닫으려 하면 묻고, 취소하면 고친 글이 남으며, 버리면 닫힌다.
  await input.press("x");
  await viewer.locator("[data-window-action=close]").click();
  await expect(page.getByRole("alertdialog")).toContainText("저장하지 않은 변경 사항이 있습니다");
  await page.getByRole("alertdialog").getByRole("button", { name: "취소" }).click();
  await expect(input).toHaveValue(/\nx$/);
  await viewer.locator("[data-window-action=close]").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "버리기" }).click();
  await expect(viewer).toHaveCount(0);
  expect(readFileSync(source, "utf8")).toBe("const a = 1;\r\nexport default a;\r\n// 끝\r\n");
  // 편집을 끝내면 서식 보기로 돌아가고, CP949 글도 그 인코딩으로 저장한다.
  const legacy = path.join(disk, "옛 글.txt");
  writeFileSync(legacy, Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0a]));
  await page.locator(dock("파일 탐색기")).click();
  await page.getByRole("button", { name: "새로 고침" }).click();
  await row(page, "옛 글.txt").dblclick();
  await expect(viewer.locator(".viewer-source")).toContainText("한글");
  await viewer.getByRole("button", { name: "편집" }).click();
  await expect(viewer.locator(".viewer-status")).toContainText("CP949 · LF");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("똠");
  await page.keyboard.press("Control+s");
  await expect(viewer.locator(".files-toast")).toContainText("저장했습니다.");
  expect([...readFileSync(legacy)]).toEqual([0xc7, 0xd1, 0xb1, 0xdb, 0x0a, 0x8c, 0x63]);
  await viewer.getByRole("button", { name: "편집" }).click();
  await expect(viewer.getByRole("textbox", { name: "내용 편집" })).toHaveCount(0);
  await expect(viewer.locator(".viewer-source")).toContainText("한글\n똠");
  expect(errors).toEqual([]);
});

test("파일 탐색기: 목록 머리글 경계를 끌어 열 너비를 바꾸고, 두 번 누르면 기본 너비로 돌아간다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFolder(page);
  const header = (key: string) => page.locator(`${win("files")} .files-columns [data-column="${key}"]`);
  const cell = (key: string) => row(page, "보고서.txt").locator(`[data-column="${key}"]`);
  const width = async (locator: ReturnType<typeof header>) => Math.round((await locator.boundingBox())!.width);
  // 포인터 이동은 화면 프레임에 맞춰 전달되므로, 끈 뒤의 너비는 반영될 때까지 기다려 본다.
  const widthOf = (locator: ReturnType<typeof header>) => expect.poll(() => width(locator));
  const start = { modified: await width(header("modified")), kind: await width(header("kind")), name: await width(header("name")) };
  expect(start.modified).toBe(152); expect(start.kind).toBe(136);
  const drag = async (key: string, dx: number) => {
    const handle = header(key).locator(".files-col-resize");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
    await page.mouse.up();
  };
  // 날짜|종류 경계를 오른쪽으로 40px 끌면 날짜 열이 넓어지고 종류 열이 좁아진다. 행 칸도 같이 움직인다.
  await drag("kind", 40);
  await widthOf(header("modified")).toBe(192); await widthOf(header("kind")).toBe(96);
  await widthOf(cell("modified")).toBe(192);
  // 끌기는 정렬을 바꾸지 않는다.
  await expect(header("kind")).not.toHaveAttribute("aria-sort", /.+/);
  // 이름|날짜 경계를 왼쪽으로 끌면 날짜 열이 넓어지고 이름 열이 좁아진다. 종류 열은 그대로다. 이름 열은 120px 아래로는 줄지 않는다.
  await drag("modified", -10);
  await widthOf(header("modified")).toBe(202); await widthOf(header("kind")).toBe(96);
  await widthOf(header("name")).toBe(start.name - 10);
  await drag("modified", -400);
  await widthOf(header("name")).toBe(120);
  const widest = await width(header("modified"));
  expect(widest).toBeGreaterThan(202);
  // 다시 열어도 남는다.
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("파일 탐색기")).click();
  await expect(row(page, "보고서.txt")).toBeVisible();
  await widthOf(header("modified")).toBe(widest);
  // 경계를 두 번 누르면 모든 열이 기본 너비로 돌아간다.
  await header("kind").locator(".files-col-resize").dblclick();
  await widthOf(header("modified")).toBe(152); await widthOf(header("kind")).toBe(136);
  await expect(header("kind")).not.toHaveAttribute("aria-sort", /.+/);
});

test("파일 탐색기: 오른쪽 클릭으로 복사·잘라내기·붙여넣기·삭제·속성을 한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  // 복사한 파일을 폴더 메뉴의 붙여넣기로 그 폴더에 넣는다.
  await row(page, "보고서.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "복사", exact: true }).click();
  await expect(page.locator(".files-toast")).toContainText("복사했습니다");
  await row(page, "하위 폴더").click({ button: "right" });
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(page.locator(".files-toast")).toContainText("1개를 붙여 넣었습니다.");
  expect(existsSync(path.join(disk, "하위 폴더", "보고서.txt"))).toBe(true);
  // 같은 폴더에 또 붙여 넣으면 `- 복사본`이 되고 그 항목이 골라진다.
  await page.locator(".files-list").click({ button: "right", position: { x: 200, y: 300 } });
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(row(page, "보고서 - 복사본.txt")).toHaveAttribute("aria-selected", "true");
  // 잘라내기: 흐려지고, 다른 폴더에 붙여 넣으면 옮겨진다.
  await row(page, "보고서 - 복사본.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "잘라내기" }).click();
  await expect(row(page, "보고서 - 복사본.txt")).toHaveAttribute("data-cut", "");
  await row(page, "하위 폴더").dblclick();
  await expect(row(page, "안쪽.md")).toBeVisible();
  await page.locator(".files-list").focus();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".files-toast")).toContainText("1개를 옮겼습니다.");
  await expect(row(page, "보고서 - 복사본.txt")).toHaveAttribute("aria-selected", "true");
  expect(existsSync(path.join(disk, "보고서 - 복사본.txt"))).toBe(false);
  // 이름이 겹치는 잘라내기는 그 항목만 건너뛰고 알린다.
  await row(page, "보고서.txt").click();
  await page.keyboard.press("Control+x");
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(row(page, "그림.png")).toBeVisible();
  await page.locator(".files-list").focus();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".files-toast")).toContainText("같은 이름의 항목이 이미 있습니다.");
  expect(existsSync(path.join(disk, "하위 폴더", "보고서.txt"))).toBe(true);
  // 키보드 복사·붙여넣기
  await row(page, "zeta.log").click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(row(page, "zeta - 복사본.log")).toHaveAttribute("aria-selected", "true");
  // 삭제는 확인 창을 거친다. 취소하면 그대로다.
  await row(page, "zeta - 복사본.log").click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제" }).click();
  const confirm = page.locator(".confirm-dialog");
  await expect(confirm).toContainText("zeta - 복사본.log");
  await confirm.getByRole("button", { name: "취소" }).click();
  await expect(confirm).toHaveCount(0);
  expect(existsSync(path.join(disk, "zeta - 복사본.log"))).toBe(true);
  await page.locator(".files-list").focus();
  await page.keyboard.press("Delete");
  await confirm.locator("[data-variant=destructive]").click();
  await expect(page.locator(".files-toast")).toContainText(process.platform === "win32" ? "휴지통으로 옮겼습니다." : "삭제했습니다.");
  await expect(row(page, "zeta - 복사본.log")).toHaveCount(0);
  expect(existsSync(path.join(disk, "zeta - 복사본.log"))).toBe(false);
  // 속성 창: 종류·위치·크기·날짜. 폴더는 안에 든 항목을 센다.
  await row(page, "그림.png").click({ button: "right" });
  await page.getByRole("menuitem", { name: "속성" }).click();
  const properties = page.locator(".properties-dialog");
  await expect(properties.locator(".properties-title")).toHaveText("그림.png");
  await expect(properties).toContainText("PNG 이미지");
  await expect(properties).toContainText(disk);
  await expect(properties).toContainText(`${PNG.length} 바이트`);
  await expect(properties).toContainText("수정한 날짜");
  await properties.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(properties).toHaveCount(0);
  await row(page, "하위 폴더").click();
  await page.locator(".files-list").focus();
  await page.keyboard.press("Alt+Enter");
  await expect(properties.locator(".properties-title")).toHaveText("하위 폴더");
  await expect(properties).toContainText("파일 3개, 폴더 0개");
  await page.keyboard.press("Escape");
  await expect(properties).toHaveCount(0);
  // 미리 보기 단추로도 속성이 열린다.
  await page.locator(".files-preview").getByRole("button", { name: "속성" }).click();
  await expect(properties.locator(".properties-title")).toHaveText("하위 폴더");
  expect(errors).toEqual([]);
});

test("파일 탐색기: Ctrl·Shift+클릭으로 여럿을 고르면 맨 왼쪽에 체크 상자 열이 나오고, 고른 묶음을 복사·삭제한다", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const disk = await openFolder(page);
  const main = page.locator(`${win("files")} .files-main`);
  const checks = page.locator(`${win("files")} .files-row .files-check`);
  const picked = page.locator(`${win("files")} [role=option][aria-selected=true]`);
  const checkOf = (name: string) => row(page, name).locator(".files-check");
  await expect(page.locator(".files-list")).toHaveAttribute("aria-multiselectable", "true");
  // 하나만 고르면 체크 상자 열이 없다.
  await row(page, "하위 폴더").click();
  await expect(picked).toHaveCount(1);
  await expect(checks).toHaveCount(0);
  await expect(page.locator(`${win("files")} .files-columns .files-check`)).toHaveCount(0);
  // Ctrl+클릭으로 더하면 맨 왼쪽에 체크 상자 열이 나오고 고른 행만 체크된다.
  await row(page, "그림.png").click({ modifiers: ["Control"] });
  await expect(picked).toHaveCount(2);
  await expect(main).toHaveAttribute("data-checking", "");
  await expect(checks).toHaveCount(4);
  await expect(checkOf("그림.png")).toHaveAttribute("data-checked", "");
  await expect(checkOf("보고서.txt")).not.toHaveAttribute("data-checked", /.*/);
  const box = (await checkOf("보고서.txt").boundingBox())!;
  const name = (await row(page, "보고서.txt").locator(".files-cell-name").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(name.x);
  // 머리글 열도 체크 상자 열만큼 밀려 행 칸과 맞는다.
  const header = (await page.locator(`${win("files")} .files-columns [data-column="name"]`).boundingBox())!;
  expect(Math.round(header.x)).toBe(Math.round(name.x));
  await expect(page.locator(".files-status")).toContainText("2개 선택됨");
  await expect(page.locator(".files-preview")).toContainText("항목 2개");
  await expect(page.locator(".files-preview")).toContainText("폴더 1개 · 파일 1개");
  // 체크 상자를 누르면 넣고 뺀다. 하나로 줄어도 체크 상자 열은 남는다.
  await checkOf("보고서.txt").click();
  await expect(picked).toHaveCount(3);
  await checkOf("하위 폴더").click();
  await checkOf("그림.png").click();
  await expect(picked).toHaveCount(1);
  await expect(row(page, "보고서.txt")).toHaveAttribute("aria-selected", "true");
  await expect(checks).toHaveCount(4);
  // 체크 상자를 두 번 눌러도 열리지 않는다.
  await checkOf("하위 폴더").dblclick();
  await expect(row(page, "그림.png")).toBeVisible();
  await expect(row(page, "하위 폴더")).toHaveAttribute("aria-selected", "false");
  // 그냥 누르면 하나만 고르고 체크 상자 열이 사라진다.
  await row(page, "zeta.log").click();
  await expect(picked).toHaveCount(1);
  await expect(checks).toHaveCount(0);

  // Shift+클릭은 기준 항목부터 범위, 기준은 그대로 남는다. Ctrl+Shift+클릭은 범위를 더한다.
  await row(page, "하위 폴더").click();
  await row(page, "보고서.txt").click({ modifiers: ["Shift"] });
  await expect(picked).toHaveCount(3);
  await expect(row(page, "zeta.log")).toHaveAttribute("aria-selected", "false");
  await row(page, "그림.png").click({ modifiers: ["Shift"] });
  await expect(picked).toHaveCount(2);
  await expect(row(page, "보고서.txt")).toHaveAttribute("aria-selected", "false");
  await row(page, "zeta.log").click({ modifiers: ["Control"] });
  await row(page, "보고서.txt").click({ modifiers: ["Control", "Shift"] });
  await expect(picked).toHaveCount(4);
  // 키보드: Shift+화살표·End로 범위, Esc로 모두 풀기, Ctrl+A로 모두 선택
  await row(page, "그림.png").click();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(picked).toHaveCount(2);
  await page.keyboard.press("Shift+End");
  await expect(picked).toHaveCount(3);
  await expect(row(page, "하위 폴더")).toHaveAttribute("aria-selected", "false");
  await expect(row(page, "zeta.log")).toHaveAttribute("data-lead", "");
  await page.keyboard.press("Escape");
  await expect(picked).toHaveCount(0);
  await expect(checks).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(picked).toHaveCount(4);
  // 머리글의 체크 상자는 모두 고르면 체크, 일부면 가로줄이다. 누르면 모두 풀고, 일부일 때 누르면 모두 고른다.
  const all = page.getByRole("checkbox", { name: "모두 선택" });
  await expect(all).toHaveAttribute("aria-checked", "true");
  await all.click();
  await expect(picked).toHaveCount(0);
  await row(page, "그림.png").click();
  await row(page, "zeta.log").click({ modifiers: ["Control"] });
  await expect(all).toHaveAttribute("aria-checked", "mixed");

  // 고른 둘을 복사해 폴더 메뉴로 붙여 넣는다.
  await page.keyboard.press("Control+c");
  await expect(page.locator(".files-toast")).toContainText("항목 2개를 복사했습니다.");
  await row(page, "하위 폴더").click({ button: "right" });
  await expect(picked).toHaveCount(1);
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(page.locator(".files-toast")).toContainText("2개를 붙여 넣었습니다.");
  expect(existsSync(path.join(disk, "하위 폴더", "그림.png"))).toBe(true);
  expect(existsSync(path.join(disk, "하위 폴더", "zeta.log"))).toBe(true);
  // 지금 폴더에 붙여 넣으면 붙여 넣은 항목이 모두 골라진다.
  await page.locator(".files-list").focus();
  await page.keyboard.press("Control+v");
  await expect(row(page, "그림 - 복사본.png")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "zeta - 복사본.log")).toHaveAttribute("aria-selected", "true");
  await expect(picked).toHaveCount(2);
  // 고른 묶음 안에서 오른쪽 클릭하면 묶음을 그대로 두고 묶음 메뉴가 열린다.
  await row(page, "zeta - 복사본.log").click({ button: "right" });
  await expect(picked).toHaveCount(2);
  await expect(page.getByRole("menu")).toContainText("항목 2개");
  await page.getByRole("menuitem", { name: "삭제" }).click();
  const confirm = page.locator(".confirm-dialog");
  await expect(confirm).toContainText("항목 2개를");
  await confirm.locator("[data-variant=destructive]").click();
  await expect(page.locator(".files-toast")).toContainText(process.platform === "win32" ? "항목 2개를 휴지통으로 옮겼습니다." : "항목 2개를 삭제했습니다.");
  await expect(row(page, "그림 - 복사본.png")).toHaveCount(0);
  await expect(row(page, "zeta - 복사본.log")).toHaveCount(0);
  expect(existsSync(path.join(disk, "그림 - 복사본.png"))).toBe(false);
  expect(existsSync(path.join(disk, "zeta - 복사본.log"))).toBe(false);

  // 아이콘 보기에서도 여럿을 고르면 그림 왼쪽 위에 체크 상자가 나온다.
  await page.getByRole("radio", { name: "아이콘 보기" }).click();
  const tile = (name: string) => page.locator(".files-tile", { hasText: name });
  await tile("그림.png").click();
  await expect(page.locator(".files-tile .files-check")).toHaveCount(0);
  await tile("보고서.txt").click({ modifiers: ["Control"] });
  await expect(page.locator(".files-tile .files-check")).toHaveCount(4);
  await expect(tile("보고서.txt").locator(".files-check")).toHaveAttribute("data-checked", "");
  expect(errors).toEqual([]);
});
