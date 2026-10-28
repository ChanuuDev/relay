import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_FONT_SIZE, FONT_SIZES, type FontSize } from "@/lib/font-size";
import type { Theme } from "@/lib/theme";
import { useUI } from "@/lib/ui-store";
import { COLORS, DAY_PHOTO, NIGHT_PHOTO, PRESETS, presetUrl, sameChoice, type WallpaperChoice } from "@/lib/wallpaper";
import { SettingsGroup } from "./settings";

const THEMES: { value: Theme; label: string }[] = [{ value: "dark", label: "다크" }, { value: "light", label: "라이트" }, { value: "system", label: "시스템" }];

/** 설정 창의 「모양」 그룹: 테마 라디오 + 글자 크기 Select(12–18px). */
export function AppearanceSettings() {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  const fontSize = useUI((state) => state.fontSize);
  const setFontSize = useUI((state) => state.setFontSize);
  return <SettingsGroup title="모양" note="시스템을 고르면 운영체제의 밝기 설정을 따릅니다. 글자 크기는 창 안의 글자에 적용되고 메뉴바와 Dock은 그대로 둡니다.">
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
      <div>
        <Select value={String(fontSize)} onValueChange={(value) => setFontSize(Number(value) as FontSize)}>
          <SelectTrigger id="settings-font-size" size="sm" className="min-width-label"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size === DEFAULT_FONT_SIZE ? `${size}px (기본)` : `${size}px`}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  </SettingsGroup>;
}

/** 설정 창의 「바탕화면」 그룹: 16:9 견본 격자(role=radiogroup). 낮과 밤 견본은 대각선으로 나눠 보인다. */
export function WallpaperSettings() {
  const choice = useUI((state) => state.wallpaper);
  const setWallpaper = useUI((state) => state.setWallpaper);
  const tile = (value: WallpaperChoice, label: string, art: ReactNode) => {
    const checked = sameChoice(choice, value);
    return <button key={label} type="button" role="radio" aria-checked={checked} className="wallpaper-choice" onClick={() => setWallpaper(value)}>
      <span className="wallpaper-thumb">{art}</span><span className="wallpaper-label">{label}</span>
    </button>;
  };
  return <SettingsGroup title="바탕화면" id="wallpaper-settings" note="기본은 그래파이트입니다. 낮과 밤은 테마에 따라 사진이 바뀝니다. 유리 재질은 바탕화면이 비쳐야 살아납니다.">
    <div className="wallpaper-picker" role="radiogroup" aria-label="바탕화면">
      {tile({ kind: "dynamic" }, "낮과 밤", <><img src={DAY_PHOTO} alt="" data-layer="day" /><img src={NIGHT_PHOTO} alt="" data-layer="night" /></>)}
      {PRESETS.map((preset) => tile({ kind: "preset", id: preset.id }, preset.label, <img src={presetUrl(preset.id)} alt="" loading="lazy" />))}
      {COLORS.map((color) => tile({ kind: "color", id: color.id }, color.label, <span className="wallpaper-swatch" data-color={color.id} />))}
    </div>
  </SettingsGroup>;
}
