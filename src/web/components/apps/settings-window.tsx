import { useState, type ChangeEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Window } from "../desktop/window";
import { ErrorNotice } from "../session-common";
import { useDesktop } from "../../lib/desktop-store";
import { useUI } from "../../lib/store";
import type { Theme } from "../../lib/theme";
import { COLORS, MAX_CUSTOM_IMAGES, PRESETS, deleteCustomImage, imageLabel, prepareImage, presetUrl, sameChoice, storeCustomImage, type WallpaperChoice } from "../../lib/wallpaper";
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

/** macOS 배경화면 패널처럼 16:9 견본을 격자로 늘어놓는다. 고른 것은 시스템 블루 링, 기본 견본은 낮·밤을 대각선으로 나눠 보여 주고,
 *  내 사진은 여러 장을 넣어 두고 견본 모서리의 ×로 한 장씩 지운다. */
function WallpaperSettings() {
  const wallpaper = useUI((state) => state.wallpaper);
  const setWallpaper = useUI((state) => state.setWallpaper);
  const images = useUI((state) => state.customImages);
  const addCustomImage = useUI((state) => state.addCustomImage);
  const removeCustomImage = useUI((state) => state.removeCustomImage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tile = (choice: WallpaperChoice, label: string, thumb: ReactNode, onRemove?: () => void) =>
    <div key={`${choice.kind}-${"id" in choice ? choice.id : ""}`} className="wallpaper-tile">
      <button type="button" role="radio" aria-checked={sameChoice(wallpaper, choice)} className="wallpaper-choice" onClick={() => setWallpaper(choice)}>
        <span className="wallpaper-thumb">{thumb}</span><span className="wallpaper-label">{label}</span>
      </button>
      {onRemove && <button type="button" className="wallpaper-remove" aria-label={`${label} 지우기`} onClick={onRemove}><X aria-hidden="true" /></button>}
    </div>;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true); setError(null);
    const failures: string[] = [];
    try {
      for (const file of files) {
        if (useUI.getState().customImages.length >= MAX_CUSTOM_IMAGES) { failures.push(`내 사진은 ${MAX_CUSTOM_IMAGES}장까지 둘 수 있습니다.`); break; }
        try {
          const blob = await prepareImage(file);
          const saved = await storeCustomImage(blob, imageLabel(file));
          addCustomImage({ id: saved.id, name: saved.name, url: URL.createObjectURL(blob) });
          setWallpaper({ kind: "custom", id: saved.id });
        } catch (failure) { failures.push(`${file.name}: ${failure instanceof Error ? failure.message : "저장할 수 없습니다."}`); }
      }
    } finally { setBusy(false); }
    if (failures.length) setError(failures.join(" "));
  }
  async function remove(id: string) {
    await deleteCustomImage(id);
    removeCustomImage(id);
    const current = useUI.getState().wallpaper;
    if (current.kind === "custom" && current.id === id) setWallpaper({ kind: "dynamic" });
  }

  return <section className="settings-group" id="wallpaper-settings">
    <h3>바탕화면</h3>
    <div className="wallpaper-picker" role="radiogroup" aria-label="바탕화면">
      {tile({ kind: "dynamic" }, "기본", <><img src="/wallpaper-light.jpg" alt="" data-layer="light" /><img src="/wallpaper-dark.jpg" alt="" data-layer="dark" /></>)}
      {PRESETS.map((preset) => tile({ kind: "preset", id: preset.id }, preset.label, <img src={presetUrl(preset.id)} alt="" loading="lazy" />))}
      {COLORS.map((color) => tile({ kind: "color", id: color.id }, color.label, <span className="wallpaper-swatch" data-color={color.id} />))}
      {images.map((image) => tile({ kind: "custom", id: image.id }, image.name, <img src={image.url} alt="" />, () => void remove(image.id)))}
      <label className="wallpaper-choice wallpaper-tile-add" data-busy={busy ? "" : undefined}>
        <input id="wallpaper-file" type="file" accept="image/*" multiple onChange={pick} disabled={busy} />
        <span className="wallpaper-thumb"><Plus aria-hidden="true" /></span><span className="wallpaper-label">{busy ? "저장 중…" : "사진 추가…"}</span>
      </label>
    </div>
    {error && <p className="settings-note settings-error" role="alert">{error}</p>}
    <p className="settings-note">기본은 테마에 따라 낮·밤 사진이 바뀝니다. 내 사진은 {MAX_CUSTOM_IMAGES}장까지 이 브라우저에만 저장되며 서버로 보내지 않습니다. 견본 모서리의 ×로 지웁니다.</p>
  </section>;
}
