import { expect, type Page } from "@playwright/test";
import { ready } from "./web-helpers";

// 메모 그래프 화면 테스트가 함께 쓰는 것: 메모 넣기, 고루 섞인 메모 묶음, 그래프 열기와 멎을 때까지 기다리기.

export const KEY = "relay-notes-v1";
export const VIEW_KEY = "relay-notes-view-v1";
export const GRAPH_KEY = "relay-notes-graph-v1";
export const dock = (name: string) => `.dock-item[aria-label="${name}"]`;
export const win = (id: string) => `.window[data-window="${id}"]`;

export type Seed = { id: string; kind: "folder" | "note"; parentId: string | null; name?: string; title?: string; body?: string; updatedAt?: number };
/** 브라우저 저장소에 메모를 넣고 다시 불러온 뒤 메모 창을 연다(notes.spec.ts와 같은 방법). */
export async function seed(page: Page, items: Seed[], extra: Record<string, unknown> = {}) {
  await ready(page);
  const now = Date.parse("2026-10-22T09:30:00+09:00");
  const full = items.map((entry, index) => ({ createdAt: now + index, updatedAt: now + index * 3_600_000 * 7, title: "", body: "", name: "", ...entry }));
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, VIEW_KEY)).toBe(true);
  await page.evaluate(([key, value, view]) => { localStorage.setItem(key, value); localStorage.removeItem(view); },
    [KEY, JSON.stringify({ version: 1, items: full, ...extra }), VIEW_KEY] as const);
  await page.reload();
  await expect(page.locator("#connection-state")).toContainText("연결됨");
  await page.locator(dock("메모")).click();
  await expect(page.locator(win("notes"))).toBeVisible();
}

/** 링크·언급·태그·비슷한 내용이 고루 섞인 메모 묶음. */
export const SAMPLE: Seed[] = [
  { id: "f-work", kind: "folder", parentId: null, name: "업무" },
  { id: "f-meet", kind: "folder", parentId: "f-work", name: "회의" },
  { id: "f-proj", kind: "folder", parentId: "f-work", name: "프로젝트" },
  { id: "f-study", kind: "folder", parentId: null, name: "공부" },
  { id: "f-life", kind: "folder", parentId: null, name: "생활" },
  { id: "n-relay", kind: "note", parentId: "f-proj", title: "Relay 출시 계획", body: "[[주간 회의]]에서 정한 일정대로 #출시 준비를 한다.\n서버 배포와 설치 파일 점검, 데스크톱 앱 업데이트." },
  { id: "n-weekly", kind: "note", parentId: "f-meet", title: "주간 회의", body: "Relay 출시 일정과 서버 배포 순서를 정리했다.\n다음 회의까지 설치 파일 점검. #회의" },
  { id: "n-retro", kind: "note", parentId: "f-meet", title: "회고", body: "주간 회의에서 나온 아쉬운 점: 배포 자동화, 테스트 시간 #회의" },
  { id: "n-deploy", kind: "note", parentId: "f-proj", title: "서버 배포 절차", body: "빌드 → 설치 파일 생성 → 서버 재시작 → 상태 확인\n[[Relay 출시 계획]] 참고 #출시" },
  { id: "n-design", kind: "note", parentId: "f-proj", title: "그래프 디자인", body: "지식 그래프 화면: 관계망, 집중, 구조, 주제, 시간 보기.\n애니메이션과 유리 재질 디자인. [[색 팔레트]]" },
  { id: "n-palette", kind: "note", parentId: "f-study", title: "색 팔레트", body: "디자인 색 팔레트 정리: 다크 모드와 라이트 모드 색, 유리 재질, 대비." },
  { id: "n-motion", kind: "note", parentId: "f-study", title: "모션 원칙", body: "애니메이션 원칙: 전환은 짧고 부드럽게, 스프링과 감속 곡선. 디자인 일관성. #디자인" },
  { id: "n-ts", kind: "note", parentId: "f-study", title: "타입스크립트 메모", body: "타입스크립트 제네릭과 유니언 타입 정리.\n테스트 작성 요령과 타입 검사." },
  { id: "n-test", kind: "note", parentId: "f-study", title: "테스트 전략", body: "단위 테스트와 화면 테스트 비율, 테스트 시간 줄이기.\n배포 전 검증, 타입스크립트 타입 검사." },
  { id: "n-books", kind: "note", parentId: "f-life", title: "읽을 책", body: "디자인 책 두 권, 타입스크립트 책 한 권. #독서" },
  { id: "n-shop", kind: "note", parentId: "f-life", title: "장보기", body: "우유, 달걀, 커피 원두" },
  { id: "n-coffee", kind: "note", parentId: "f-life", title: "커피 원두 기록", body: "에티오피아 원두, 산미가 좋다.\n장보기 목록에 원두를 더한다." },
  { id: "n-trip", kind: "note", parentId: "f-life", title: "여행 준비", body: "부산 여행: 숙소, 기차표, 맛집 #여행" },
  { id: "n-busan", kind: "note", parentId: "f-life", title: "부산 맛집", body: "여행 준비 중 찾은 부산 맛집 목록: 돼지국밥, 밀면 #여행" },
  { id: "n-run", kind: "note", parentId: "f-life", title: "운동 계획", body: "주 3회 달리기, 스트레칭" },
  { id: "n-idea", kind: "note", parentId: null, title: "아이디어 모음", body: "메모 앱에 지식 그래프 추가하기 → [[그래프 디자인]]\n회고에서 나온 자동화 아이디어" },
  { id: "n-inbox", kind: "note", parentId: null, title: "", body: "받은 편지함 정리하기\n이번 주 안에" },
];

export type GraphApi = { point: (id: string) => { x: number; y: number; r: number } | null; visibleIds: () => string[]; camera: { x: number; y: number; k: number } };
export const graph = (page: Page) => page.locator(".notes-graph");
/** 움직임이 모두 멈출 때까지 기다린다(렌더러가 쉬면 data-settled를 단다). */
export const settled = (page: Page) => expect(graph(page)).toHaveAttribute("data-settled", "", { timeout: 25000 });
export const pointOf = (page: Page, id: string) => page.evaluate((target) => (document.querySelector(".notes-graph") as HTMLElement & { relayGraph: GraphApi }).relayGraph.point(target), id);
export async function openGraph(page: Page) {
  await page.locator("#notes-graph-toggle").click();
  await expect(graph(page)).toBeVisible();
  await settled(page);
}
