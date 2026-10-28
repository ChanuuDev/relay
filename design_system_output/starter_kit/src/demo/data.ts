import type { WorkStatus } from "@/components/patterns/status-badge";

/** 데모용 가짜 데이터. 새 프로젝트에서는 지운다. */
export type Entry = {
  id: string; title: string; summary: string; owner: string; initial: string; project: string;
  status: WorkStatus | null; pinned?: boolean; stale?: boolean; ended?: boolean; updated: number;
  history: { status: WorkStatus | null; text: string; at: number }[];
};

const MIN = 60_000;
const now = Date.now();

export const OWNERS = ["모든 담당", "디자인", "프런트엔드", "백엔드", "운영"] as const;

export const ENTRIES: Entry[] = [
  { id: "e1", title: "결제 화면 유리 재질 정리", owner: "디자인", initial: "디", project: "C:/work/checkout-web", status: "working", pinned: true, updated: now - 2 * MIN,
    summary: "결제 단계 상단바와 사이드바를 material-chrome으로 바꾸고, 내용 패널은 불투명 바탕으로 되돌렸다.\n남은 일: 다크 모드에서 보조 글자 대비 확인.",
    history: [
      { status: "working", text: "상단바·사이드바를 유리로 바꾸고 내용은 불투명으로 유지.", at: now - 2 * MIN },
      { status: "working", text: "바탕화면 그래파이트 기준으로 대비 측정 시작.", at: now - 40 * MIN },
      { status: null, text: "작업 시작: 기존 흰 패널을 데스크톱 셸로 옮기기.", at: now - 3 * 60 * MIN },
    ] },
  { id: "e2", title: "주문 목록 FLIP 재정렬", owner: "프런트엔드", initial: "프", project: "C:/work/orders", status: "handoff", updated: now - 18 * MIN,
    summary: "폴링으로 순서가 바뀐 행만 Flip으로 미끄러지고, 내용이 바뀐 행은 펄스로 알린다. 같은 내용이면 아무것도 움직이지 않는다.",
    history: [{ status: "handoff", text: "재정렬과 펄스 구현 완료. 다음 세션에서 감소 모드 회귀만 확인.", at: now - 18 * MIN }] },
  { id: "e3", title: "알림 토스트 문구 다듬기", owner: "디자인", initial: "디", project: "C:/work/notify", status: "done", updated: now - 65 * MIN,
    summary: "토스트는 13px 한 줄, 아이콘 16px, 3초 뒤 사라진다. 실패는 빨간 아이콘만 바꾸고 바탕은 같은 유리를 쓴다.",
    history: [{ status: "done", text: "문구와 아이콘 정리 끝.", at: now - 65 * MIN }] },
  { id: "e4", title: "백엔드 상태 API 연결", owner: "백엔드", initial: "백", project: "C:/work/status-api", status: "blocked", updated: now - 3 * 60 * MIN,
    summary: "health 응답에 build 값을 넣어 화면이 새 빌드를 알아채게 하려 했으나 배포 권한이 없어 멈춤.",
    history: [{ status: "blocked", text: "배포 권한 요청 중.", at: now - 3 * 60 * MIN }] },
  { id: "e5", title: "설정 창 글자 크기 단계", owner: "프런트엔드", initial: "프", project: "C:/work/settings", status: "working", stale: true, updated: now - 9 * 60 * MIN,
    summary: "12–18px 선택지. 창 안 글자만 커지고 메뉴바·Dock은 그대로 둔다. 한 줄 상자 높이는 calc(1em + 여백).",
    history: [{ status: "working", text: "Select 목록 item-aligned 확인 중.", at: now - 9 * 60 * MIN }] },
  { id: "e6", title: "운영 대시보드 첫 화면", owner: "운영", initial: "운", project: "C:/work/ops-dashboard", status: null, ended: true, updated: now - 26 * 60 * MIN,
    summary: "페이지형 레이아웃(유리 사이드바 + 불투명 본문)으로 숫자 타일과 표를 배치.",
    history: [{ status: null, text: "초안만 남기고 종료.", at: now - 26 * 60 * MIN }] },
  { id: "e7", title: "Dock 라벨 깜빡임 수정", owner: "프런트엔드", initial: "프", project: "C:/work/desktop-shell", status: "done", updated: now - 50 * 60 * MIN,
    summary: "라벨을 아이콘마다 띄우지 않고 Dock 전체에 하나만 두어 가까운 아이콘을 따라 미끄러지게 했다.",
    history: [{ status: "done", text: "MotionValue로 매 프레임 위치를 맞춤.", at: now - 50 * 60 * MIN }] },
];

const relative = new Intl.RelativeTimeFormat("ko-KR", { numeric: "auto" });
/** "방금 전", "18분 전", "3시간 전", "어제" */
export function ago(time: number) {
  const minutes = Math.round((time - Date.now()) / MIN);
  if (minutes > -1) return "방금 전";
  if (minutes > -60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}
export const fullTime = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
