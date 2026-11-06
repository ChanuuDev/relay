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
  const css = Bun.spawn([process.execPath, "node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i", "src/web/styles.css", "-o", "src/web/generated/style.css", "--minify"],
    { stdout: "inherit", stderr: "inherit" });
  if (await css.exited !== 0) throw new Error("WEB CSS build failed");
  console.log("Built React web assets");
}

if (import.meta.main) await buildWeb();
