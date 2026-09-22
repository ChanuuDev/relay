import { useRef, type ComponentProps, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { ArrowLeft, ArrowRight, CircleAlert, Copy, Inbox } from "lucide-react";
import { enter } from "../lib/motion";
import type { Page } from "../../session/session.types";
import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { navigate, pageTo, sessionUrl } from "../lib/store";
import type { BriefSession } from "../lib/queries";

export function NavLink({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); navigate(href);
    }
  }} />;
}

export function SessionLink({ session }: { session: BriefSession }) {
  return <NavLink className="session-name" href={sessionUrl(session.id)}>{session.sessionName ?? "이름 없는 세션"}</NavLink>;
}

export function Tip({ children, text }: { children: ReactNode; text: string }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
}

export function CopyButton({ value, copy, label }: { value: string | (() => string); copy: (value: string) => void; label: string }) {
  return <Tip text={label}><Button variant="ghost" size="icon-sm" aria-label={label}
    onClick={(event) => { event.stopPropagation(); copy(typeof value === "function" ? value() : value); }}><Copy /></Button></Tip>;
}

export function ErrorNotice({ id, error }: { id: string; error: Error | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // B5 알림 등장.
  useGSAP(() => { if (error) enter(ref.current, { y: 6 }); }, { dependencies: [Boolean(error)] });
  if (!error) return null;
  return <Alert ref={ref} variant="destructive" id={id}><CircleAlert /><AlertTitle>조회하지 못했습니다</AlertTitle>
    <AlertDescription>{error.message}. 마지막 성공 데이터가 있으면 유지하며 자동으로 다시 시도합니다.</AlertDescription></Alert>;
}

export function Loading() {
  return <div className="loading" role="status" aria-label="불러오는 중">{[0, 1, 2, 3].map((i) => <div className="loading-row" key={i}>
    <Skeleton className="size-10 rounded-xl" /><div className="flex flex-1 flex-col gap-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div>
  </div>)}</div>;
}

export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><Inbox /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>
    <EmptyDescription>{description}</EmptyDescription></EmptyHeader>{children}</Empty>;
}

export function Pager({ page, queryKey = "offset", onPage }: { page: Page; queryKey?: string; onPage?: (offset: number) => void }) {
  const change = (offset: number) => onPage ? onPage(offset) : pageTo(queryKey, offset);
  const from = page.total && page.offset < page.total ? page.offset + 1 : 0;
  return <div className="pager"><span>총 <strong>{page.total.toLocaleString()}</strong>건 · {from}–{Math.min(page.offset + page.limit, page.total)}건</span>
    <div className="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label="이전" disabled={page.offset === 0}
      onClick={() => change(Math.max(0, page.offset - page.limit))}><ArrowLeft /></Button>
      <span className="page-number">{Math.floor(page.offset / page.limit) + 1} / {Math.max(1, Math.ceil(page.total / page.limit))}</span>
      <Button variant="ghost" size="icon-sm" aria-label="다음" disabled={page.offset + page.limit >= page.total}
        onClick={() => change(page.offset + page.limit)}><ArrowRight /></Button></div></div>;
}
