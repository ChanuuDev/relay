import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, X } from "lucide-react";
import { SESSION_STATUSES, STATUS_LABELS, type Session, type SessionAction } from "../../session/session.types";
import { Button } from "./ui/button";
import { DesktopMenu, type MenuEntry } from "./desktop/menu";
import { ConfirmDialog } from "./desktop/confirm-dialog";
import { resource, type DetailData } from "../lib/queries";
import { sendAction, STATUS_TO } from "../lib/session-actions";
import { sessionContext } from "../lib/session-context";
import { listLocation, navigate, useUI } from "../lib/store";

/** id는 열 때마다 바뀌어, 앞 메뉴의 종료 트윈 중에 새로 열어도 새 메뉴로 다시 마운트되고 첫 항목이 초점을 받는다. */
type Menu = { id: number; session: Session; left: number; top: number };
type Notice = { tone: "done" | "error"; text: string; id: number };
const NOTICE_MS = 3000;

const nameOf = (session: Pick<Session, "sessionName">) => session.sessionName ?? "이름 없는 세션";
const rowOf = (id: string) => document.querySelector<HTMLElement>(`#list-content .session-row[data-flip-id="${CSS.escape(id)}"]`);
/** 초점이 아무 데도 없는지. 보던 상세를 닫으며 화면이 초점을 맡겨 둔 작업 영역(#workspace)도 잃은 것으로 본다. */
const lost = (workspace = false) => {
  const active = document.activeElement;
  return !active || active === document.body || (workspace && active.id === "workspace");
};
/** 행의 링크에 초점을 준다. 행이 사라졌으면 초점을 잃었을 때만 작업 영역으로 보낸다(이웃 행에 옮겨 둔 초점은 그대로 둔다). */
const focusRow = (id: string | null) => {
  const link = id ? rowOf(id)?.querySelector<HTMLElement>(".session-name") : null;
  if (link) link.focus({ preventScroll: true });
  else if (lost()) document.getElementById("workspace")?.focus({ preventScroll: true });
};
/** 지운 행 대신 초점을 받을 이웃 행(아래, 없으면 위). */
const neighborOf = (id: string) => {
  const row = rowOf(id);
  return ((row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null)?.dataset.flipId ?? null;
};
/** 메뉴가 화면 아래로 넘치지 않게 위로 올린다(항목 26px, 머리 24px, 구분선 9px). */
const menuTop = (top: number, entries: MenuEntry[]) => {
  const height = entries.reduce((sum, entry) => sum + (entry.kind === "separator" ? 9 : entry.kind === "label" ? 24 : 26), 8);
  return Math.max(8, Math.min(top, window.innerHeight - height - 8));
};
const isSessionQuery = (key: readonly unknown[]) => typeof key[1] === "string" && key[1].startsWith("/api/v1/sessions");

/** 세션 목록의 오른쪽 클릭 메뉴: 작업 상태·종료 처리·고정·컨텍스트 복사·삭제.
 *  결과는 창 아래 가운데의 유리 안내로 보이고, 목록·상세는 곧바로 다시 읽는다. */
export function useSessionActions({ storeDirectory, copy }: { storeDirectory?: string; copy: (value: string) => void }) {
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [leaving, setLeaving] = useState(false);
  // 닫히는 메뉴의 종료 트윈이 끝나기 전에 새 메뉴를 열면, 늦게 오는 종료 알림은 무시한다.
  const leavingRef = useRef(false);
  // 메뉴가 닫힐 때 초점을 돌려줄 행. 삭제 확인처럼 다른 곳이 초점을 가져가면 false.
  const focusAfter = useRef<string | false>(false);
  const [confirm, setConfirm] = useState<Session | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // 이어받은 세션이 있으면 연결을 끊고 지운다는 것을 확인 창에 미리 알린다.
  const target = useQuery(resource<DetailData>(`/api/v1/sessions/${encodeURIComponent(confirm?.id ?? "")}`, confirmOpen && Boolean(confirm)));
  const linked = target.data?.childrenPage.total ?? 0;

  useEffect(() => {
    if (notice?.tone !== "done") return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function open(session: Session, left: number, top: number) {
    leavingRef.current = false;
    setLeaving(false);
    focusAfter.current = session.id;
    setMenu({ id: Date.now(), session, left, top });
  }
  function close(returnFocus: boolean) {
    if (!menu || leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    if (returnFocus && focusAfter.current) focusRow(focusAfter.current);
  }
  function exited() {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    setMenu(null);
    setLeaving(false);
  }

  async function run(session: Session, action: SessionAction, done: string, after?: () => void) {
    try {
      const result = await sendAction(session.id, action);
      // 보고 있던 세션을 지웠으면 목록으로 돌아간다(없는 상세를 다시 읽지 않게 먼저 옮긴다).
      if (result.deleted && location.pathname === `/sessions/${encodeURIComponent(session.id)}`) navigate(listLocation());
      await queryClient.invalidateQueries({ predicate: (query) => isSessionQuery(query.queryKey) });
      after?.();
      setNotice({ tone: "done", text: done, id: Date.now() });
    } catch (error) {
      setNotice({ tone: "error", text: `처리하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류입니다."}`, id: Date.now() });
    }
  }

  function entries(session: Session): MenuEntry[] {
    const name = nameOf(session);
    return [
      { kind: "label", id: "status-label", label: "작업 상태" },
      ...SESSION_STATUSES.map((status): MenuEntry => ({
        kind: "radio", id: `status-${status}`, label: STATUS_LABELS[status], checked: session.status === status,
        onSelect: () => { if (session.status !== status) void run(session, { action: "status", status }, `‘${name}’ 세션을 ${STATUS_TO[status]} 표시했습니다.`); },
      })),
      { kind: "separator", id: "sep-state" },
      session.endedAt
        ? { kind: "item", id: "reopen", label: "종료 취소", onSelect: () => void run(session, { action: "reopen" }, `‘${name}’ 세션의 종료 표시를 지웠습니다.`) }
        : { kind: "item", id: "end", label: "종료 처리", onSelect: () => void run(session, { action: "end" }, `‘${name}’ 세션을 종료로 표시했습니다.`) },
      { kind: "item", id: "pin", label: session.pinned ? "고정 해제" : "고정",
        onSelect: () => void run(session, { action: "pin", pinned: !session.pinned }, session.pinned ? `‘${name}’ 세션의 고정을 풀었습니다.` : `‘${name}’ 세션을 고정했습니다.`) },
      { kind: "separator", id: "sep-copy" },
      { kind: "item", id: "copy", label: "세션 컨텍스트 복사", onSelect: () => copy(sessionContext(session, { shell: useUI.getState().shell, storeDirectory })) },
      { kind: "separator", id: "sep-delete" },
      { kind: "item", id: "delete", label: "삭제…", danger: true, onSelect: () => { focusAfter.current = false; setConfirm(session); setConfirmOpen(true); } },
    ];
  }

  function remove() {
    if (!confirm) return;
    const session = confirm;
    const neighbor = neighborOf(session.id);
    // 지운 행이 사라지며 초점을 잃었을 때만 이웃 행으로 옮긴다(다시 그린 뒤에 본다).
    void run(session, { action: "delete", force: linked > 0 }, `‘${nameOf(session)}’ 세션 기록을 삭제했습니다.`, () => requestAnimationFrame(() => {
      if (lost(true)) focusRow(neighbor);
    }));
  }

  const items = menu ? entries(menu.session) : [];
  const element = <>
    {menu && <DesktopMenu key={menu.id} items={items} position={{ left: menu.left, top: menuTop(menu.top, items) }} leaving={leaving}
      onClose={close} onExited={exited} className="session-menu" />}
    <ConfirmDialog open={confirmOpen} confirmLabel="삭제" confirmDisabled={!target.data}
      title={`‘${confirm ? nameOf(confirm) : ""}’ 기록을 삭제할까요?`}
      description={<>
        <p>요약과 기록 이력을 지우며 되돌릴 수 없습니다. Agent의 원본 대화는 남습니다.</p>
        {linked > 0 && <p>이어받은 세션 {linked.toLocaleString()}건은 남고 이 세션과의 연결만 끊어집니다.</p>}
      </>}
      onConfirm={remove} onClose={() => setConfirmOpen(false)} onCloseFocus={() => { if (confirm) focusRow(confirm.id); }} />
    {notice && <div key={notice.id} id="session-action-status" className="sessions-toast material-toast" role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone}>
      {notice.tone === "error" && <TriangleAlert aria-hidden="true" />}
      <span>{notice.text}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="안내 닫기" onClick={() => setNotice(null)}><X aria-hidden="true" /></Button>
    </div>}
  </>;
  return { open, menuId: menu && !leaving ? menu.session.id : undefined, element };
}
