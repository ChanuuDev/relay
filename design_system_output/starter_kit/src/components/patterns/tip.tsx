import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { copyText } from "@/lib/toast";

/** 아이콘 단추에는 늘 툴팁과 aria-label을 같이 단다.
 *  shadcn의 TooltipTrigger(asChild)는 자기 data-slot="tooltip-trigger"를 자식에 합쳐 Button의 data-slot="button"을 덮어쓴다.
 *  그러면 primitives.css의 [data-slot="button"] 규칙이 모두 빠지므로, data-slot이 없는 Radix Trigger를 직접 쓴다. */
export function Tip({ children, text }: { children: ReactNode; text: string }) {
  return <Tooltip><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipContent>{text}</TooltipContent></Tooltip>;
}

/** 복사 아이콘 단추(ghost · icon-sm) + 툴팁 + 결과 토스트 */
export function CopyButton({ value, label }: { value: string | (() => string); label: string }) {
  return <Tip text={label}><Button variant="ghost" size="icon-sm" aria-label={label}
    onClick={(event) => { event.stopPropagation(); void copyText(typeof value === "function" ? value() : value); }}><Copy /></Button></Tip>;
}
