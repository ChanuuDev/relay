import { Window } from "@/components/desktop/window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppearanceSettings, WallpaperSettings } from "@/components/patterns/appearance-settings";
import { SettingsGroup, SettingsRow } from "@/components/patterns/settings";
import { useDesktop } from "@/lib/desktop-store";

/** 설정 창: 바깥은 유리(material-chrome), 안은 반투명 그룹 카드. 라벨 열 120px. */
export function SettingsWindow() {
  const resetLayout = useDesktop((state) => state.resetLayout);
  return <Window id="settings" bodyClassName="settings-body material-chrome">
    <AppearanceSettings />
    <WallpaperSettings />
    <SettingsGroup title="창" note="저장된 창 위치와 크기를 지우고 기본 배치로 되돌립니다.">
      <SettingsRow label="창 배치"><Button size="sm" variant="outline" onClick={resetLayout}>창 배치 초기화</Button></SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="정보" id="about">
      <SettingsRow label="버전"><Badge variant="secondary">v1.0.0</Badge></SettingsRow>
      <SettingsRow label="저장소"><code>C:\Users\me\.app\data.db</code></SettingsRow>
      <SettingsRow label="연결"><span className="inline-flex items-center gap-1.5"><span className="status-dot" />연결됨</span></SettingsRow>
    </SettingsGroup>
  </Window>;
}
