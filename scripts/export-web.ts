import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildWeb } from "./build-web";

/* 브라우저 모드 화면을 정적 파일로 내보낸다: bun run scripts/export-web.ts [출력 폴더] [--no-build]
   relay.exe가 내려주는 화면 자산(src/web/assets.ts)을 그대로 쓰고, index.html에 `relay-web` 메타를 더해 브라우저 모드로 켜지게 한다.
   원격 서버의 nginx가 이 폴더를 내려주고 `/api/`는 relay-api로 넘긴다(deploy/nginx/relay-web.conf). */

const args = process.argv.slice(2);
const output = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "dist/web");
if (!args.includes("--no-build")) await buildWeb();
// 자산 모듈은 방금 만든 generated 파일을 읽어야 하므로 빌드 뒤에 가져온다.
const { assets, buildId, mermaidFrameHtml } = await import("../src/web/assets");
const { MERMAID_FRAME_PATH } = await import("../src/web/lib/mermaid");

rmSync(output, { recursive: true, force: true });
const write = (route: string, data: string | Buffer) => {
  const target = path.join(output, route === "/" ? "index.html" : route.replace(/^\//, ""));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
};
for (const [route, asset] of assets) {
  if ("file" in asset) {
    const target = path.join(output, route.replace(/^\//, ""));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(asset.file, target);
  } else if (route === "/") {
    if (!asset.body.includes('<meta name="relay-build"')) throw new Error("index.html에 relay-build 메타가 없습니다.");
    write(route, asset.body.replace('<meta name="relay-build"', '<meta name="relay-web" content="1">\n  <meta name="relay-build"'));
  } else write(route, asset.body);
}
write(MERMAID_FRAME_PATH, mermaidFrameHtml);
write("/sw-web.js", readFileSync("src/web/generated/sw-web.js"));
// 배포 확인용: 이 폴더가 어느 화면 빌드인지 남긴다.
write("/build.json", `${JSON.stringify({ schemaVersion: 1, build: buildId })}\n`);
console.log(`Exported browser-mode web to ${path.relative(process.cwd(), output) || "."} (build ${buildId})`);
