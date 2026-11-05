import { mkdirSync } from "node:fs";
import { buildWeb } from "./build-web";

await buildWeb();
mkdirSync("dist", { recursive: true });
const outfile = process.platform === "win32" ? "dist/relay.exe" : "dist/relay";
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
const result = await Bun.build({ entrypoints: ["src/index.ts"], compile: { outfile }, minify: true, target: "bun",
  define: { "process.env.RELAY_BUILD_REVISION": JSON.stringify(revision.exitCode === 0 ? revision.stdout.toString().trim() : "") } });
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
console.log(`Built ${outfile}`);
