import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** 선택이 없을 때 오른쪽 내용 자리: 40px 아이콘(55%) · 13px 안내 · 단축키 힌트, 가운데 정렬 */
export function Placeholder({ icon: Icon, children, hint }: { icon: LucideIcon; children: ReactNode; hint?: ReactNode }) {
  return <div className="placeholder"><Icon aria-hidden="true" /><p>{children}</p>{hint ? <p className="placeholder-hint">{hint}</p> : null}</div>;
}

/** 아직 아무것도 없을 때: 위에서 퍼지는 강조색 광원 + 72px 아이콘 + 24px 제목 + 안내 + 단추들 */
export function HeroEmpty({ art, title, children, actions, glow }: { art: ReactNode; title: string; children: ReactNode; actions?: ReactNode; glow?: string }) {
  return <div className="hero-empty" style={glow ? { "--glow": glow } as CSSProperties : undefined}>
    {art}<h3>{title}</h3><p>{children}</p>{actions ? <div className="hero-actions">{actions}</div> : null}
  </div>;
}
