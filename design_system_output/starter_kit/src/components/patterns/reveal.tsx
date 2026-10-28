import { useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { collapseHeight, expandHeight } from "@/lib/motion";

/** 위에서 아래로 펼치는 상자(필터 행 등). 바깥은 높이만 0↔auto로 바꾸고 안쪽 행은 제 높이를 지켜 윗줄부터 드러난다.
 *  접힘 트윈이 끝난 뒤 언마운트한다(과도 상태 패턴). 안쪽 첫 자식에 유리(material-*)를 줘도 된다. */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useGSAP(() => {
    const element = ref.current;
    if (!element) return;
    if (open) { expandHeight(element); return; }
    void collapseHeight(element).then(() => { if (!element.isConnected) return; setMounted(false); });
  }, { dependencies: [open, mounted] });

  return mounted ? <div ref={ref} className="reveal">{children}</div> : null;
}
