import { Desktop } from "@/components/desktop/desktop";
import { DocsWindow } from "./windows/docs-window";
import { GalleryWindow } from "./windows/gallery-window";
import { LibraryWindow } from "./windows/library-window";
import { SettingsWindow } from "./windows/settings-window";
import { TerminalWindow } from "./windows/terminal-window";
import { WelcomeWindow } from "./windows/welcome-window";

/** 데스크톱형 견본: src/apps.ts에 등록한 창을 모두 띄운다. 열림·닫힘은 창 스토어가 정하므로 늘 렌더해 둔다. */
export function DesktopDemo() {
  return <Desktop status="online" statusText="연결됨" label="로컬 · 데모 데이터"
    brandItems={[{ kind: "item", id: "page", label: "페이지형 레이아웃 보기", onSelect: () => { location.hash = "#page"; } }]}>
    <WelcomeWindow />
    <LibraryWindow />
    <DocsWindow />
    <GalleryWindow />
    <TerminalWindow />
    <SettingsWindow />
  </Desktop>;
}
