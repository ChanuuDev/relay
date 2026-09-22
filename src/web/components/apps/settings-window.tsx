import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Window } from "../desktop/window";
import { ErrorNotice } from "../session-common";
import { useDesktop } from "../../lib/desktop-store";
import { useUI } from "../../lib/store";
import type { Theme } from "../../lib/theme";
import type { Connection } from "../desktop/menu-bar";
import type { HealthData } from "../../lib/queries";

const THEMES: { value: Theme; label: string }[] = [{ value: "dark", label: "다크" }, { value: "light", label: "라이트" }, { value: "system", label: "시스템" }];
const CONNECTION_LABEL: Record<Connection, string> = { online: "연결됨", pending: "확인 중…", offline: "연결 끊김" };

export function SettingsWindow({ health, healthError, connection }: {
  health?: HealthData; healthError: Error | null; connection: Connection;
}) {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const shell = useUI((state) => state.shell);
  const setShell = useUI((state) => state.setShell);
  const resetLayout = useDesktop((state) => state.resetLayout);
  return <Window id="settings" bodyClassName="settings-body material-chrome">
    <section className="settings-group">
      <h3>모양</h3>
      <div className="settings-row">
        <fieldset className="theme-field"><legend>테마</legend>
          {THEMES.map((item) => <span key={item.value} className="theme-option">
            <input type="radio" id={`theme-${item.value}`} name="theme" value={item.value} checked={theme === item.value} onChange={() => setTheme(item.value)} />
            <label htmlFor={`theme-${item.value}`}>{item.label}</label>
          </span>)}
        </fieldset>
      </div>
      <p className="settings-note">시스템을 고르면 운영체제의 밝기 설정을 따릅니다.</p>
    </section>
    <section className="settings-group">
      <h3>명령</h3>
      <div className="settings-row">
        <label htmlFor="settings-shell">셸 종류</label>
        <NativeSelect id="settings-shell" size="sm" value={shell} onChange={(event) => setShell(event.target.value as typeof shell)}>
          <NativeSelectOption value="powershell">PowerShell</NativeSelectOption><NativeSelectOption value="bash">Bash</NativeSelectOption>
        </NativeSelect>
      </div>
    </section>
    <section className="settings-group">
      <h3>창</h3>
      <div className="settings-row"><span>창 배치</span><Button size="sm" variant="outline" onClick={resetLayout}>창 배치 초기화</Button></div>
      <p className="settings-note">저장된 창 위치와 크기를 지우고 기본 배치로 되돌립니다.</p>
    </section>
    <section className="settings-group" id="storage-info">
      <h3>저장소</h3>
      <ErrorNotice id="global-error" error={healthError} />
      <div className="settings-row"><span>데이터베이스</span><code>{health?.databasePath ?? "확인 중…"}</code></div>
      <div className="settings-row"><span>버전</span><span>RELAY {health?.appVersion ? `v${health.appVersion}` : "—"}</span></div>
      <div className="settings-row"><span>연결</span><span className="settings-connection"><span className="connection-dot" data-state={connection} />{CONNECTION_LABEL[connection]}</span></div>
      <div className="settings-row"><span>모드</span><Badge variant="outline">읽기 전용</Badge></div>
      <p className="settings-note">127.0.0.1에서만 열리는 읽기 전용 로컬 서버입니다.</p>
    </section>
  </Window>;
}
