import html from "./public/index.html" with { type: "text" };
import themeScript from "./public/theme.js" with { type: "text" };
import manifest from "./public/manifest.webmanifest" with { type: "text" };
import serviceWorker from "./public/sw.js" with { type: "text" };
import js from "./generated/app.js" with { type: "text" };
import css from "./generated/style.css" with { type: "text" };
import wallpaperDark from "./public/wallpaper-dark.jpg" with { type: "file" };
import wallpaperLight from "./public/wallpaper-light.jpg" with { type: "file" };
import wallpaperAurora from "./public/wallpapers/aurora.jpg" with { type: "file" };
import wallpaperDunes from "./public/wallpapers/dunes.jpg" with { type: "file" };
import wallpaperWaves from "./public/wallpapers/waves.jpg" with { type: "file" };
import wallpaperForest from "./public/wallpapers/forest.jpg" with { type: "file" };
import iconSessions from "./public/icons/sessions.png" with { type: "file" };
import iconGuide from "./public/icons/guide.png" with { type: "file" };
import iconCommand from "./public/icons/command.png" with { type: "file" };
import iconSettings from "./public/icons/settings.png" with { type: "file" };
import iconApp192 from "./public/icons/app-192.png" with { type: "file" };
import iconApp512 from "./public/icons/app-512.png" with { type: "file" };
import iconOpenAI from "./public/icons/providers/openai.png" with { type: "file" };
import iconAnthropic from "./public/icons/providers/anthropic.png" with { type: "file" };
import iconXAI from "./public/icons/providers/xai.png" with { type: "file" };
import pretendard from "./public/fonts/PretendardVariable.woff2" with { type: "file" };

// 텍스트 자산은 문자열로, 이미지 자산은 실행 파일에 포함된 파일 경로로 둔다.
export type Asset = { body: string; type: string } | { file: string; type: string; cache: string };

const image = (file: string, type: string): Asset => ({ file, type, cache: "public, max-age=86400" });

// Bun's ambient *.html type describes HTML bundles, but the explicit text loader returns a string.
export const assets = new Map<string, Asset>([
  ["/icon.svg", { body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0a5ce0"/><path d="M10 24V8h7a5 5 0 0 1 1 10l5 6h-5l-5-6v6zm3-10h4a1 1 0 0 0 0-2h-4z" fill="#ffffff"/></svg>', type: "image/svg+xml" }],
  ["/", { body: html as unknown as string, type: "text/html; charset=utf-8" }],
  ["/theme.js", { body: themeScript, type: "text/javascript; charset=utf-8" }],
  // 설치형 앱(PWA): 매니페스트와 서버가 꺼져 있을 때 화면을 여는 서비스 워커.
  ["/manifest.webmanifest", { body: manifest, type: "application/manifest+json; charset=utf-8" }],
  ["/sw.js", { body: serviceWorker, type: "text/javascript; charset=utf-8" }],
  ["/app.js", { body: js, type: "text/javascript; charset=utf-8" }],
  ["/style.css", { body: css, type: "text/css; charset=utf-8" }],
  ["/wallpaper-dark.jpg", image(wallpaperDark, "image/jpeg")],
  ["/wallpaper-light.jpg", image(wallpaperLight, "image/jpeg")],
  ["/wallpapers/aurora.jpg", image(wallpaperAurora, "image/jpeg")],
  ["/wallpapers/dunes.jpg", image(wallpaperDunes, "image/jpeg")],
  ["/wallpapers/waves.jpg", image(wallpaperWaves, "image/jpeg")],
  ["/wallpapers/forest.jpg", image(wallpaperForest, "image/jpeg")],
  ["/icons/sessions.png", image(iconSessions, "image/png")],
  ["/icons/guide.png", image(iconGuide, "image/png")],
  ["/icons/command.png", image(iconCommand, "image/png")],
  ["/icons/settings.png", image(iconSettings, "image/png")],
  ["/icons/app-192.png", image(iconApp192, "image/png")],
  ["/icons/app-512.png", image(iconApp512, "image/png")],
  ["/icons/providers/openai.png", image(iconOpenAI, "image/png")],
  ["/icons/providers/anthropic.png", image(iconAnthropic, "image/png")],
  ["/icons/providers/xai.png", image(iconXAI, "image/png")],
  ["/fonts/PretendardVariable.woff2", { file: pretendard, type: "font/woff2", cache: "public, max-age=31536000, immutable" }],
]);
