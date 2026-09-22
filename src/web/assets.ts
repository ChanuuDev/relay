import html from "./public/index.html" with { type: "text" };
import themeScript from "./public/theme.js" with { type: "text" };
import js from "./generated/app.js" with { type: "text" };
import css from "./generated/style.css" with { type: "text" };
import wallpaperDark from "./public/wallpaper-dark.jpg" with { type: "file" };
import wallpaperLight from "./public/wallpaper-light.jpg" with { type: "file" };
import iconSessions from "./public/icons/sessions.png" with { type: "file" };
import iconGuide from "./public/icons/guide.png" with { type: "file" };
import iconCommand from "./public/icons/command.png" with { type: "file" };
import iconSettings from "./public/icons/settings.png" with { type: "file" };
import pretendard from "./public/fonts/PretendardVariable.woff2" with { type: "file" };

// 텍스트 자산은 문자열로, 이미지 자산은 실행 파일에 포함된 파일 경로로 둔다.
export type Asset = { body: string; type: string } | { file: string; type: string; cache: string };

const image = (file: string, type: string): Asset => ({ file, type, cache: "public, max-age=86400" });

// Bun's ambient *.html type describes HTML bundles, but the explicit text loader returns a string.
export const assets = new Map<string, Asset>([
  ["/icon.svg", { body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0a5ce0"/><path d="M10 24V8h7a5 5 0 0 1 1 10l5 6h-5l-5-6v6zm3-10h4a1 1 0 0 0 0-2h-4z" fill="#ffffff"/></svg>', type: "image/svg+xml" }],
  ["/", { body: html as unknown as string, type: "text/html; charset=utf-8" }],
  ["/theme.js", { body: themeScript, type: "text/javascript; charset=utf-8" }],
  ["/app.js", { body: js, type: "text/javascript; charset=utf-8" }],
  ["/style.css", { body: css, type: "text/css; charset=utf-8" }],
  ["/wallpaper-dark.jpg", image(wallpaperDark, "image/jpeg")],
  ["/wallpaper-light.jpg", image(wallpaperLight, "image/jpeg")],
  ["/icons/sessions.png", image(iconSessions, "image/png")],
  ["/icons/guide.png", image(iconGuide, "image/png")],
  ["/icons/command.png", image(iconCommand, "image/png")],
  ["/icons/settings.png", image(iconSettings, "image/png")],
  ["/fonts/PretendardVariable.woff2", { file: pretendard, type: "font/woff2", cache: "public, max-age=31536000, immutable" }],
]);
