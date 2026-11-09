import { test, expect, type Page } from "@playwright/test";
import { env, ready, record, useRelayServer } from "./web-helpers";

useRelayServer();

const win = (page: Page, id: string) => page.locator(`.window[data-window="${id}"]`);
const api = <T,>(page: Page, route: string) => page.evaluate(async (route) => (await (await fetch(route, { cache: "no-store" })).json()), route) as Promise<T>;
type Task = { id: string; title: string; project: string; memo: string; provider: string | null; status: string; board: boolean; notes: string[] };
type Event = { id: string; title: string; allDay: boolean; start: string; end: string; attachments: Array<{ kind: string; id: string }> };
const tasks = (page: Page) => api<{ items: Task[] }>(page, "/api/v1/tasks").then((data) => data.items);
const events = (page: Page) => api<{ items: Event[] }>(page, "/api/v1/events").then((data) => data.items);
const pad = (value: number) => String(value).padStart(2, "0");
const local = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

async function openApp(page: Page, title: string, id: string) {
  await page.locator(`.dock-item[aria-label="${title}"]`).click();
  await expect(win(page, id)).toBeVisible();
}
/** 메모 하나를 API로 만든다(첨부 고르기 대상). */
async function seedNote(page: Page, id: string, title: string) {
  await page.evaluate(async ({ id, title, origin }) => {
    const now = Date.now();
    await fetch("/api/v1/notes", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ upserts: [{ id, kind: "note", parentId: null, title, body: "본문", position: null, createdAt: now, updatedAt: now }], deletes: [] }) });
  }, { id, title, origin: env.url });
}

test("Tasks: 추가하고 프로젝트·에이전트·메모·첨부 메모를 적으면 Relay DB에 남고, 완료 체크는 완료 보기로 옮긴다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await ready(page);
  await seedNote(page, "memo-spec", "설계 메모");
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await openApp(page, "Tasks", "tasks");
  const tasksWindow = win(page, "tasks");
  await expect(tasksWindow.locator(".notes-sync")).toHaveText("Relay DB에 저장됨");
  await expect(tasksWindow.locator(".planner-empty").first()).toContainText("Task가 없습니다");

  await tasksWindow.locator("#tasks-new").fill("로그인 오류 고치기");
  await tasksWindow.locator("#tasks-new").press("Enter");
  const form = tasksWindow.locator(".planner-form");
  await expect(form.getByLabel("Task 제목")).toHaveValue("로그인 오류 고치기");
  await form.getByRole("radio", { name: "Claude Code" }).click();
  await form.getByLabel("프로젝트", { exact: true }).fill("relay");
  await form.getByLabel("메모", { exact: true }).fill("재현 절차와 완료 조건");
  await form.getByRole("radio", { name: "진행 중" }).click();
  await form.getByRole("button", { name: "메모 첨부" }).click();
  const picker = page.locator(".planner-picker");
  await picker.getByPlaceholder("메모 검색").fill("설계");
  await picker.locator('[data-id="memo-spec"]').click();
  await page.keyboard.press("Escape");
  await expect(form.locator(".planner-chip")).toContainText("설계 메모");
  await expect.poll(async () => (await tasks(page))[0]).toMatchObject({ title: "로그인 오류 고치기", project: "relay", memo: "재현 절차와 완료 조건",
    provider: "anthropic", status: "doing", notes: ["memo-spec"] });

  // 첨부 메모를 누르면 메모 앱에서 그 메모가 열린다.
  await form.locator(".planner-chip-open").click();
  await expect(win(page, "notes")).toBeVisible();
  await expect(win(page, "notes").locator('[aria-selected="true"]').first()).toContainText("설계 메모");

  // 새로 고쳐도 서버에서 다시 온다. 완료로 표시하면 진행 중 보기에서 빠지고 완료 보기에 보인다.
  await page.reload();
  await openApp(page, "Tasks", "tasks");
  const row = tasksWindow.locator(".tasks-row").first();
  await expect(row).toContainText("로그인 오류 고치기");
  await expect(row.locator(".planner-project")).toHaveText("relay");
  await row.getByRole("checkbox", { name: "완료로 표시" }).click();
  await expect(tasksWindow.locator(".tasks-row")).toHaveCount(0);
  await tasksWindow.getByRole("tab", { name: /완료/ }).click();
  await expect(tasksWindow.locator(".tasks-row")).toHaveCount(1);
  await expect.poll(async () => (await tasks(page))[0]?.status).toBe("done");
  expect(errors).toEqual([]);
});

test("업무: 인벤토리의 Task를 보드 칸으로 끌어 놓고, 칸 사이로 옮기며, 보드에서 내리면 인벤토리로 돌아온다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await openApp(page, "업무", "board");
  const board = win(page, "board");
  const inventory = board.locator(".board-inventory");
  for (const title of ["첫째 할 일", "둘째 할 일"]) {
    await inventory.getByPlaceholder("새 Task 추가").fill(title);
    await inventory.getByPlaceholder("새 Task 추가").press("Enter");
  }
  await expect(inventory.locator(".board-card")).toHaveCount(2);
  const column = (label: string) => board.locator(`.board-column[aria-label^="${label} 칸"]`);

  // 인벤토리 → 진행 중 칸
  await inventory.locator(".board-card", { hasText: "첫째 할 일" }).dragTo(column("진행 중").locator(".board-cards"));
  await expect(column("진행 중").locator(".board-card")).toHaveText(["첫째 할 일"]);
  await expect(inventory.locator(".board-card")).toHaveCount(1);
  // 둘째를 진행 중 칸의 맨 위로 끼운다.
  await inventory.locator(".board-card", { hasText: "둘째 할 일" }).dragTo(column("진행 중").locator(".board-card", { hasText: "첫째 할 일" }), { targetPosition: { x: 20, y: 4 } });
  await expect(column("진행 중").locator(".board-card")).toHaveText(["둘째 할 일", "첫째 할 일"]);
  await expect(inventory.locator(".board-card")).toHaveCount(0);
  await expect(inventory).toContainText("인벤토리가 비었습니다");
  // 칸 사이: 첫째를 완료 칸으로
  await column("진행 중").locator(".board-card", { hasText: "첫째 할 일" }).dragTo(column("완료").locator(".board-cards"));
  await expect(column("완료").locator(".board-card")).toHaveText(["첫째 할 일"]);
  await expect.poll(async () => (await api<{ columns: Array<{ status: string; items: Task[] }> }>(page, "/api/v1/board")).columns
    .map((item) => `${item.status}:${item.items.map((task) => task.title).join(",")}`)).toEqual(["todo:", "doing:둘째 할 일", "review:", "done:첫째 할 일"]);
  // 키보드: Alt+→로 검토 칸으로
  await column("진행 중").locator(".board-card").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(column("검토").locator(".board-card")).toHaveText(["둘째 할 일"]);
  // 보드 카드를 인벤토리로 끌면 보드에서 내린다.
  await column("검토").locator(".board-card").dragTo(inventory);
  await expect(inventory.locator(".board-card")).toHaveText(["둘째 할 일"]);
  // 완료 비우기: 완료 Task는 보드에서 내려가도 인벤토리에 오지 않는다.
  await column("완료").getByRole("button", { name: "완료 비우기" }).click();
  await expect(column("완료").locator(".board-card")).toHaveCount(0);
  await expect(inventory.locator(".board-card")).toHaveCount(1);
  // 칸 머리의 + 로 그 칸에 바로 만든다. 카드를 누르면 편집 창이 열린다.
  await column("할 일").getByRole("button", { name: "할 일 칸에 Task 추가" }).click();
  await column("할 일").getByPlaceholder("할 일에 추가").fill("바로 만든 카드");
  await column("할 일").getByPlaceholder("할 일에 추가").press("Enter");
  await expect(column("할 일").locator(".board-card")).toHaveText(["바로 만든 카드"]);
  await column("할 일").locator(".board-card").click();
  const dialog = page.locator(".planner-dialog");
  await expect(dialog.getByLabel("Task 제목")).toHaveValue("바로 만든 카드");
  await dialog.getByRole("radio", { name: "Codex" }).click();
  await page.keyboard.press("Escape");
  await expect(column("할 일").locator(".board-card .planner-provider")).toHaveAttribute("data-provider", "openai");
  expect(errors).toEqual([]);
});

test("캘린더: 종일·시간 일정을 만들고 메모와 Task를 첨부하며, 끝이 시작보다 앞이면 저장하지 않는다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await seedNote(page, "memo-meeting", "회의 안건");
  await page.evaluate(async (origin) => {
    const now = Date.now();
    await fetch("/api/v1/tasks", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ upserts: [{ id: "task-review", title: "코드 리뷰", status: "todo", createdAt: now, updatedAt: now }], deletes: [] }) });
  }, env.url);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await openApp(page, "캘린더", "calendar");
  const calendar = win(page, "calendar");
  const today = local();
  await expect(calendar.locator(`.cal-day[data-date="${today}"]`)).toHaveAttribute("data-today", "");

  // 날짜를 두 번 누르면 그날 종일 일정
  await calendar.locator(`.cal-day[data-date="${today}"]`).dblclick();
  const dialog = page.locator(".cal-dialog");
  await expect(dialog.getByRole("switch", { name: "종일" })).toBeChecked();
  await dialog.getByLabel("일정 제목").fill("릴리스");
  await dialog.getByRole("button", { name: "저장" }).click();
  await expect(calendar.locator(`.cal-day[data-date="${today}"] .cal-chip`)).toHaveText(["릴리스"]);

  // 새 일정: 시간 단위, 메모·Task 첨부
  await calendar.getByRole("button", { name: "새 일정", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "종일" })).not.toBeChecked();
  await dialog.getByLabel("일정 제목").fill("주간 회의");
  await dialog.getByLabel("시작 시각").fill("10:00");
  await dialog.getByLabel("끝 시각").fill("09:00");
  await expect(dialog.getByRole("alert")).toHaveText("끝이 시작보다 앞입니다.");
  await expect(dialog.getByRole("button", { name: "저장" })).toBeDisabled();
  await dialog.getByLabel("끝 시각").fill("11:30");
  await dialog.getByRole("radio", { name: "초록" }).click();
  await dialog.getByRole("button", { name: "메모 첨부" }).click();
  await page.locator('.planner-picker [data-id="memo-meeting"]').click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Task 첨부" }).click();
  await page.locator('.planner-picker [data-id="task-review"]').click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".planner-chip")).toHaveText(["회의 안건", "코드 리뷰"]);
  await dialog.getByRole("button", { name: "저장" }).click();
  await expect.poll(async () => (await events(page)).map((event) => ({ title: event.title, allDay: event.allDay, start: event.start, end: event.end, attachments: event.attachments })))
    .toEqual([
      { title: "릴리스", allDay: true, start: today, end: today, attachments: [] },
      { title: "주간 회의", allDay: false, start: `${today}T10:00`, end: `${today}T11:30`, attachments: [{ kind: "note", id: "memo-meeting" }, { kind: "task", id: "task-review" }] },
    ]);
  // 고른 날 목록: 종일이 먼저, 시간 일정은 시각과 첨부를 보인다. 첨부 Task를 누르면 Tasks에서 열린다.
  const agenda = calendar.locator(".cal-agenda-item");
  await expect(agenda).toHaveCount(2);
  await expect(agenda.nth(0)).toContainText("종일");
  await expect(agenda.nth(1)).toContainText("10:00–11:30");
  await calendar.locator(".cal-agenda-attachments .planner-chip", { hasText: "코드 리뷰" }).locator(".planner-chip-open").click();
  await expect(win(page, "tasks")).toBeVisible();
  await expect(win(page, "tasks").getByLabel("Task 제목")).toHaveValue("코드 리뷰");
  expect(errors).toEqual([]);
});

test("잔디: 에이전트 기록이 오늘 칸을 칠하고, 칸을 누르면 그날 세션이 보이며 세션 창으로 연다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  record("grass-a", "잔디 확인 세션", "anthropic", "claude-code");
  // 그날 세션 목록이 창보다 길어도 잔디 칸이 눌리지 않아야 한다(실제 데이터에서 찾은 문제).
  for (let index = 0; index < 11; index++) record(`grass-${index}`, `세션 ${index}`);
  await ready(page);
  await openApp(page, "잔디", "activity");
  const activity = win(page, "activity");
  const today = local();
  const cell = activity.locator(`.activity-cell[data-date="${today}"]`);
  await expect(cell).toHaveAttribute("data-level", "4");
  await expect(cell).toHaveAttribute("aria-label", /기록 12회, 세션 12개/);
  await expect(activity.locator(".activity-stats")).toContainText("총 기록12회");
  await expect(activity.locator(".activity-session")).toHaveCount(12);
  const grid = (await activity.locator(".activity-grid").boundingBox())!;
  const card = (await activity.locator(".activity-card").boundingBox())!;
  expect(grid.height).toBeGreaterThan(60);
  expect(card.height).toBeGreaterThan(grid.height);
  await expect(cell).toBeInViewport();
  // Provider로 거르면 그 에이전트 기록만 센다.
  await activity.getByRole("radio", { name: "Claude Code" }).click();
  await expect(cell).toHaveAttribute("aria-label", /기록 1회, 세션 1개/);
  await expect(activity.locator(".activity-session")).toHaveCount(1);
  await activity.locator(".activity-session").click();
  await expect(win(page, "sessions")).toBeVisible();
  await expect(page).toHaveURL(/\/sessions\//);
  expect(errors).toEqual([]);
});
