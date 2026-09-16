import { mkdirSync } from "node:fs";

export async function buildWeb() {
  mkdirSync("src/web/generated", { recursive: true });
  const result = await Bun.build({
    entrypoints: ["src/web/client.tsx"], outdir: "src/web/generated", naming: "app.js",
    target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "WEB JavaScript build failed");
  const css = Bun.spawn([process.execPath, "node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i", "src/web/styles.css", "-o", "src/web/generated/style.css", "--minify"],
    { stdout: "inherit", stderr: "inherit" });
  if (await css.exited !== 0) throw new Error("WEB CSS build failed");
  console.log("Built React web assets");
}

if (import.meta.main) await buildWeb();
