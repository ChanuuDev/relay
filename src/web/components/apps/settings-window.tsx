import { Download } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Window } from "../desktop/window";
import { ErrorNotice } from "../session-common";
import { useDesktop } from "../../lib/desktop-store";
import { DEFAULT_FONT_SIZE, FONT_SIZES, type FontSize } from "../../lib/font-size";
import { useInstall } from "../../lib/pwa";
import { useUI } from "../../lib/store";
import type { Theme } from "../../lib/theme";
import { WallpaperSettings } from "./wallpaper-settings";
import type { Connection } from "../desktop/menu-bar";
import type { HealthData } from "../../lib/queries";

const THEMES: { value: Theme; label: string }[] = [{ value: "dark", label: "다크" }, { value: "light", label: "라이트" }, { value: "system", label: "시스템" }];
const CONNECTION_LABEL: Record<Connection, string> = { online: "연결됨", pending: "확인 중…", offline: "연결 끊김" };

export function SettingsWindow({ health, healthError, connection }: {
  health?: HealthData; healthError: Error | null; connection: Connection;
}) {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const fontSize = useUI((state) => state.fontSize);
  const setFontSize = useUI((state) => state.setFontSize);
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
      <div className="settings-row">
        <label htmlFor="settings-font-size">글자 크기</label>
        <Select value={String(fontSize)} onValueChange={(value) => setFontSize(Number(value) as FontSize)}>
          <SelectTrigger id="settings-font-size" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size === DEFAULT_FONT_SIZE ? `${size}px (기본)` : `${size}px`}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="settings-note">시스템을 고르면 운영체제의 밝기 설정을 따릅니다. 글자 크기는 창 안의 글자에 적용되고 메뉴바와 Dock은 그대로 둡니다.</p>
    </section>
    <WallpaperSettings />
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
    <AppSettings />
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

/** 설치형 앱(PWA). 브라우저가 설치를 제안할 수 있을 때만 설치 버튼을 보이고, 그 밖에는 지금 상태와 설치 방법을 알려 준다. */
function AppSettings() {
  const prompt = useInstall((state) => state.prompt);
  const standalone = useInstall((state) => state.standalone);
  const installed = useInstall((state) => state.installed);
  const install = useInstall((state) => state.install);
  const state = (label: string) => <span className="app-install-state"><img src="/icons/app-192.png" alt="" />{label}</span>;
  return <section className="settings-group" id="app-settings">
    <h3>앱</h3>
    <div className="settings-row">
      <span>데스크톱 앱</span>
      {standalone ? state("앱 창에서 실행 중") : installed ? state("설치했습니다")
        : prompt ? <Button size="sm" variant="outline" onClick={() => void install()}><Download />앱으로 설치</Button>
        : state("브라우저 탭에서 보는 중")}
    </div>
    <p className="settings-note">{standalone ? "작업 표시줄과 시작 메뉴에서 바로 엽니다. 서버가 꺼져 있어도 창은 열리고, relay web --headless로 서버를 켜면 저절로 다시 연결됩니다."
      : installed ? "시작 메뉴나 작업 표시줄에서 Relay를 여세요. 이 탭은 닫아도 됩니다."
      : prompt ? "브라우저 탭 없이 별도 창으로 열고, 작업 표시줄과 시작 메뉴에서 바로 실행합니다. 서버가 꺼져 있어도 창은 열리고 서버를 켜면 다시 연결됩니다."
      : "Chrome·Edge 주소 표시줄의 앱 설치 아이콘이나 브라우저 메뉴의 ‘앱 설치’로 설치합니다. 이미 설치했다면 같은 자리의 ‘앱에서 열기’를 누릅니다."}</p>
  </section>;
}
