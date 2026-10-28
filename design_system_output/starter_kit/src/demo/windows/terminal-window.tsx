import { useState } from "react";
import { Copy } from "lucide-react";
import { Window } from "@/components/desktop/window";
import { WindowTitleBar } from "@/components/desktop/window-title-bar";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { copyText } from "@/lib/toast";

/** 터미널 창: 유리 없이 늘 어두운 창(#1c1c1e), 12.5px 고정폭, 초록 프롬프트, 깜빡이는 커서. */
export function TerminalWindow() {
  const [shell, setShell] = useState("powershell");
  const command = shell === "powershell" ? "npm run dev -- --host 127.0.0.1" : "npm run dev -- --host=127.0.0.1";
  return <Window id="terminal" terminal bodyClassName="terminal-body"
    header={<WindowTitleBar id="terminal" right={<label className="shell-picker">셸
      <NativeSelect size="sm" value={shell} onChange={(event) => setShell(event.target.value)}>
        <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption>
      </NativeSelect></label>} />}>
    <div className="term-line term-comment"># 개발 서버를 띄운다</div>
    <div className="term-line"><span className="term-prompt">$</span><span className="term-value">{command}</span>
      <Button size="xs" variant="outline" onClick={() => void copyText(command, "명령을 복사했습니다")}><Copy />복사</Button></div>
    <div className="term-line term-output">VITE v8 ready in 412 ms · Local: http://127.0.0.1:5173/</div>
    <div className="term-block term-output">{"다음 대화에 붙여넣을 안내:\n1. design_output.md를 읽는다\n2. AGENTS.md의 규칙을 지킨다\n3. 스크린샷으로 확인한다"}</div>
    <div className="term-line"><span className="term-prompt">$</span><span className="term-cursor" aria-hidden="true" /></div>
  </Window>;
}
