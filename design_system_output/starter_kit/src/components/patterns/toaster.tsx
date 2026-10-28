import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { Check, CircleAlert, Info } from "lucide-react";
import { enterToast, exitToast } from "@/lib/motion";
import { useToast } from "@/lib/toast";

const ICONS = { success: Check, info: Info, error: CircleAlert } as const;

/** 화면 아래 가운데 유리 알약 토스트. 진입은 back.out(1.4)로 살짝 튀어 오르고, 3초 뒤 아래로 가라앉으며 사라진다. */
export function Toaster() {
  const toast = useToast((state) => state.toast);
  const clear = useToast((state) => state.clear);
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setLeaving(false);
    const timer = setTimeout(() => setLeaving(true), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useGSAP(() => {
    const element = ref.current;
    if (!element || !toast) return;
    if (!leaving) { enterToast(element); return; }
    const id = toast.id;
    void exitToast(element).then(() => clear(id));
  }, { dependencies: [toast?.id, leaving] });

  if (!toast) return null;
  const Icon = ICONS[toast.tone];
  return <div ref={ref} className="toast material-toast" role="status" data-tone={toast.tone === "success" ? undefined : toast.tone}>
    <Icon aria-hidden="true" />{toast.text}
  </div>;
}
