// 마법사 화면의 HTML·CSS와 아이콘을 dist/renderer로 복사한다(tsc는 .ts만 옮기므로).
const { cpSync, mkdirSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const from = path.join(root, "src", "renderer");
const to = path.join(root, "dist", "renderer");
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (/\.(html|css|svg|png)$/.test(name)) cpSync(path.join(from, name), path.join(to, name));
}
cpSync(path.join(root, "resources", "icon.png"), path.join(to, "icon.png"));
console.log("renderer static copied");
