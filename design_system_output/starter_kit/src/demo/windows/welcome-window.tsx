import { ArrowRight, Copy, Layers, Terminal } from "lucide-react";
import { Window } from "@/components/desktop/window";
import { Separator } from "@/components/ui/separator";
import { useDesktop } from "@/lib/desktop-store";

const STEPS = [
  ["01", "토큰과 재질 확인", "tokens.css · materials.css"],
  ["02", "앱 목록 바꾸기", "src/apps.ts에 창을 등록"],
  ["03", "스크린샷으로 판정", "다크·라이트·모바일"],
] as const;

/** 시작 안내 창: 일러스트(노드-점선-중앙 노드) · eyebrow · 24px 제목 · 단계 목록 · 링크형 행동. 내용은 불투명. */
export function WelcomeWindow() {
  return <Window id="welcome" bodyClassName="overflow-y-auto bg-background">
    <div className="welcome">
      <div className="welcome-illustration" aria-hidden="true">
        <span className="illustration-node"><Terminal /></span><span className="illustration-link" />
        <span className="illustration-node central"><Layers /></span><span className="illustration-link" />
        <span className="illustration-node"><Copy /></span>
      </div>
      <p className="eyebrow">GETTING STARTED</p>
      <h3>유리 데스크톱으로<br />새 화면 시작하기.</h3>
      <p>기능은 달라도 같은 재질·치수·움직임을 쓰면 한 계열의 화면이 됩니다. 이 창들은 그 견본입니다.</p>
      <Separator />
      {STEPS.map(([number, title, text]) => <div key={number} className="welcome-step"><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}
      <button type="button" className="welcome-action" onClick={() => useDesktop.getState().open("gallery")}>컴포넌트 둘러보기 <ArrowRight /></button>
    </div>
  </Window>;
}
