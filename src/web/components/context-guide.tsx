import { ArrowRight, Copy, GitBranch, Terminal } from "lucide-react";
import { Separator } from "./ui/separator";

export function ContextGuide() {
  return <aside className="welcome-panel" aria-label="맥락 전달 안내">
    <div className="welcome-illustration" aria-hidden="true"><div className="illustration-node"><Terminal /></div><span /><div className="illustration-node central"><GitBranch /></div><span /><div className="illustration-node"><Copy /></div></div>
    <p className="eyebrow">CONTEXT, CONTINUED</p><h3>지난 대화에서<br />다음 시작점으로.</h3>
    <p>Agent가 달라져도 작업의 맥락은 이어집니다. 필요한 세션을 열어 다음 대화에 전달하세요.</p>
    <Separator />
    <div className="welcome-step"><span>01</span><div><strong>이전 기록 찾기</strong><p>세션 이름, 요약, ID로 검색</p></div></div>
    <div className="welcome-step"><span>02</span><div><strong>작업의 맥락 확인</strong><p>최근 요약, 기록 이력, 연결된 세션</p></div></div>
    <div className="welcome-step"><span>03</span><div><strong>다음 대화에 전달</strong><p>세션 컨텍스트를 복사해 붙여넣기</p></div></div>
    <button type="button" className="welcome-action" onClick={() => document.getElementById("search")?.focus()}>이전 기록 찾기<ArrowRight /></button>
  </aside>;
}
