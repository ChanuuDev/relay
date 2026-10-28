import type { CSSProperties } from "react";
import { APPS, type AppId, type AppIconSpec } from "@/apps";

/** 앱 아이콘. PNG가 있으면 그림을, 없으면 그라디언트 타일에 lucide 아이콘을 그린다. 접근 가능한 이름은 감싼 버튼이 가진다. */
export function AppIcon({ app, size = 48 }: { app: AppId; size?: number }) {
  return <IconArt spec={APPS[app].icon} size={size} />;
}

export function IconArt({ spec, size = 48 }: { spec: AppIconSpec; size?: number }) {
  if ("src" in spec) return <img className="app-icon" src={spec.src} alt="" width={size} height={size} draggable={false} decoding="async" />;
  const Glyph = spec.glyph;
  return <span className="app-tile-box" style={{ "--tile-size": `${size}px` } as CSSProperties} aria-hidden="true">
    <span className="app-tile" style={{ "--tile-from": spec.from, "--tile-to": spec.to } as CSSProperties}><Glyph /></span>
  </span>;
}

/** 메뉴바 브랜드 마크. 색은 currentColor를 따른다. 자기 로고 path로 바꾼다. */
export function BrandMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 5.5 26.5 16 16 26.5 5.5 16z" fill="currentColor" />
  </svg>;
}
