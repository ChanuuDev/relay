import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { useUI } from "../../lib/store";
import { sessionCommand, sessionContext } from "../../lib/session-context";
import type { DetailData, HealthData, QueryResult } from "../../lib/queries";

/** 선택한 세션의 조회 명령과 다음 대화에 붙여넣을 한 줄을 터미널 화면처럼 보여 준다. */
export function CommandWindow({ detail, health, copy }: {
  detail: QueryResult<DetailData>; health?: HealthData; copy: (value: string) => void;
}) {
  const shell = useUI((state) => state.shell);
  const setShell = useUI((state) => state.setShell);
  const session = detail.data?.session;
  const command = session ? sessionCommand(session, health?.dataDirectory, shell) : null;
  const context = session ? sessionContext(session, { shell, storeDirectory: health?.dataDirectory }) : null;
  const prompt = <span className="term-prompt">relay@local ~ %</span>;
  return <Window id="command" bodyClassName="terminal-body" header={
    <WindowTitleBar id="command" right={<div className="shell-picker">
      <label htmlFor="command-shell-kind">셸 종류</label>
      <NativeSelect id="command-shell-kind" size="sm" value={shell} onChange={(event) => setShell(event.target.value as typeof shell)}>
        <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption>
      </NativeSelect></div>} />}>
    <div className="term-line">{prompt}<span>relay --version</span></div>
    <div className="term-line term-output">{health?.appVersion ?? "—"}</div>
    {command && context ? <>
      <div className="term-line">{prompt}<span className="term-value">{command}</span>
        <Button size="xs" variant="secondary" onClick={() => copy(command)}>이 명령 복사</Button></div>
      <div className="term-line term-comment"># 다음 대화에 붙여넣을 한 줄</div>
      <div className="term-line"><span className="term-value">{context}</span>
        <Button size="xs" variant="secondary" onClick={() => copy(context)}>컨텍스트 줄 복사</Button></div>
    </> : <>
      <div className="term-line term-comment"># 세션 창에서 세션을 선택하면 조회 명령이 여기에 표시됩니다.</div>
      <div className="term-line">{prompt}<span>relay record --help</span><span className="term-cursor" /></div>
    </>}
  </Window>;
}
