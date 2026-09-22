import { appIcon, APPS, type AppId } from "../../lib/app-config";

/** 메뉴바용 Relay 마크. 색은 currentColor를 따른다. */
export function RelayMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M10 24V8h7a5 5 0 0 1 1 10l5 6h-5l-5-6v6zm3-10h4a1 1 0 0 0 0-2h-4z" fill="currentColor" />
  </svg>;
}

/** Dock·탭바·상단바에서 쓰는 앱 아이콘(생성 PNG). 접근 가능한 이름은 버튼이 가진다. */
export function AppIcon({ app, size = 48 }: { app: AppId; size?: number }) {
  return <img className="app-icon" src={appIcon(app)} alt="" width={size} height={size} draggable={false} decoding="async" data-app={APPS[app].id} />;
}
