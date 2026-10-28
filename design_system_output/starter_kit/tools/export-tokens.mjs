// src/styles/tokens.css의 :root(라이트)와 .dark 변수를 읽어 tokens/design-tokens.json으로 내보낸다.
// React·Tailwind가 아닌 프로젝트(Vue, Svelte, 네이티브, Figma 변수 등)에 같은 값을 옮길 때 쓴다.
// 사용: node tools/export-tokens.mjs   (tokens.css를 고친 뒤 다시 돌린다)
import { mkdir, readFile, writeFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} 블록이 없습니다`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return stripComments(css.slice(css.indexOf("{", start) + 1, i));
  }
  throw new Error(`${selector} 블록이 닫히지 않았습니다`);
}

function vars(body) {
  const out = {};
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim().replace(/\s+/g, " ");
  return out;
}

const light = vars(block(":root"));
const dark = vars(block(".dark"));
const theme = vars(block("@theme inline"));
const groups = {
  color: (key) => !key.startsWith("glass") && !key.startsWith("window") && !key.startsWith("fs-") && !key.startsWith("lh-") && !["radius", "radius-control", "font-scale", "menubar-height"].includes(key) && !key.startsWith("dock-tip"),
  material: (key) => key.startsWith("glass") || key.startsWith("window") || key.startsWith("dock-tip"),
  type: (key) => key.startsWith("fs-") || key.startsWith("lh-") || key === "font-scale",
  shape: (key) => ["radius", "radius-control", "menubar-height"].includes(key),
};

const tokens = { $description: "Relay 데스크톱 셸 디자인 토큰. light는 :root, dark는 .dark의 값(dark에 없으면 light와 같다).", generatedFrom: "src/styles/tokens.css" };
for (const [group, test] of Object.entries(groups)) {
  tokens[group] = {};
  for (const key of Object.keys(light).filter(test)) tokens[group][key] = dark[key] && dark[key] !== light[key] ? { light: light[key], dark: dark[key] } : { value: light[key] };
}
tokens.theme = {
  radius: Object.fromEntries(Object.entries(theme).filter(([key]) => key.startsWith("radius-"))),
  font: Object.fromEntries(Object.entries(theme).filter(([key]) => key.startsWith("font-"))),
  text: Object.fromEntries(Object.entries(theme).filter(([key]) => key.startsWith("text-"))),
};
tokens.motion = {
  duration: { micro: "120ms", fast: "160ms", base: "220ms", window: "260ms", stagger: "30ms (총 300ms 상한)", tight: "20ms", bounce: "130ms × 4", pulse: "600ms" },
  ease: { enter: "power3.out", exit: "power2.in", move: "power3.inOut", pop: "back.out(1.4)", bounce: "power1.inOut", decay: "power2.out" },
  cssEquivalent: { enter: "cubic-bezier(.215,.61,.355,1)", exit: "cubic-bezier(.55,.085,.68,.53)", move: "cubic-bezier(.645,.045,.355,1)", toast: "cubic-bezier(.2,.8,.2,1)" },
};

await mkdir(new URL("../tokens/", import.meta.url), { recursive: true });
await writeFile(new URL("../tokens/design-tokens.json", import.meta.url), `${JSON.stringify(tokens, null, 2)}\n`);
console.log("tokens/design-tokens.json을 만들었습니다.");
