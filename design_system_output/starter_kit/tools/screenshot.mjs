// 디자인 판정용 스크린샷: 다크·라이트·모바일을 한 번에 찍는다. 합격 기준은 "오류 없는 코드"가 아니라 스크린샷으로 본 아름다움이다.
//
// 준비(한 번):  npm i -D playwright && npx playwright install chromium
// 사용:        npm run dev  (다른 터미널)  →  node tools/screenshot.mjs [주소] [저장 폴더]
//              기본 주소 http://127.0.0.1:5173/ , 기본 폴더 screenshots/
// 테마·바탕화면은 localStorage(app-theme, app-wallpaper)로 정한다. 키를 바꿨다면 아래 값을 맞춘다.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "screenshots";

const CASES = [
  { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 900, theme: "light", wallpaper: { kind: "dynamic" } },
  { name: "laptop-dark", width: 1280, height: 800, theme: "dark", wallpaper: { kind: "color", id: "midnight" } },
  { name: "narrow-light", width: 860, height: 760, theme: "light" },
  { name: "mobile-dark", width: 390, height: 844, theme: "dark" },
  { name: "mobile-light", width: 390, height: 844, theme: "light" },
  { name: "reduced-transparency", width: 1440, height: 900, theme: "dark", media: { reducedMotion: "reduce" }, forcedTransparency: true },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = false;
for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 2 });
  await context.addInitScript(([theme, wallpaper]) => {
    localStorage.setItem("app-theme", theme);
    if (wallpaper) localStorage.setItem("app-wallpaper", wallpaper);
  }, [c.theme, c.wallpaper ? JSON.stringify(c.wallpaper) : ""]);
  const page = await context.newPage();
  if (c.media) await page.emulateMedia(c.media);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(BASE);
  await page.waitForTimeout(1200);   // 창 진입 애니메이션(260ms + 순차)과 사진 로드를 기다린다
  if (c.forcedTransparency) await page.addStyleTag({ content: ".material-bar,.material-chrome,.material-dock,.material-menu,.material-toast{background:var(--background)!important;backdrop-filter:none!important}" });
  await page.screenshot({ path: `${OUT}/${c.name}.png` });
  if (errors.length) { failed = true; console.log(`✗ ${c.name}: ${errors.join(" | ")}`); } else console.log(`✓ ${c.name}`);
  await context.close();
}
await browser.close();
console.log(`\n${OUT}/에 저장했습니다. README §9 판정 기준으로 한 장씩 보세요.`);
if (failed) process.exitCode = 1;
