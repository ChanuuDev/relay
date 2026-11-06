import { mkdirSync } from "node:fs";

export async function buildWeb() {
  mkdirSync("src/web/generated", { recursive: true });
  const result = await Bun.build({
    entrypoints: ["src/web/client.tsx"], outdir: "src/web/generated", naming: "app.js",
    target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "WEB JavaScript build failed");
  // Mermaid(약 5MB)는 메모에 다이어그램이 있을 때만 숨은 틀이 받도록 따로 묶는다.
  const diagram = await Bun.build({
    entrypoints: ["src/web/mermaid-frame.ts"], outdir: "src/web/generated", naming: "mermaid-frame.js",
    target: "browser", format: "esm", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!diagram.success) throw new AggregateError(diagram.logs, "WEB diagram build failed");
  // 수식(KaTeX)도 수식을 처음 그릴 때만 받도록 따로 묶는다.
  const math = await Bun.build({
    entrypoints: ["src/web/katex-entry.ts"], outdir: "src/web/generated", naming: "katex.js",
    target: "browser", format: "esm", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!math.success) throw new AggregateError(math.logs, "WEB math build failed");
  // 브라우저 모드(원격 서버가 내려준 화면)의 서비스 워커. 클래식 스크립트로 등록하므로 즉시 실행 함수로 묶는다.
  const worker = await Bun.build({
    entrypoints: ["src/web/sw-web.ts"], outdir: "src/web/generated", naming: "sw-web.js",
    target: "browser", format: "iife", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!worker.success) throw new AggregateError(worker.logs, "WEB browser-mode worker build failed");
  const css = Bun.spawn([process.execPath, "node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i", "src/web/styles.css", "-o", "src/web/generated/style.css", "--minify"],
    { stdout: "inherit", stderr: "inherit" });
  if (await css.exited !== 0) throw new Error("WEB CSS build failed");
  console.log("Built React web assets");
}

if (import.meta.main) await buildWeb();
