import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
const outfile = process.platform === "win32" ? "dist/relay.exe" : "dist/relay";
const result = await Bun.build({ entrypoints: ["src/index.ts"], compile: { outfile }, minify: true, target: "bun" });
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
console.log(`Built ${outfile}`);
