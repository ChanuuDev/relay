// Windows 파일 감시기가 Electron 기본 리소스를 잠가도 패키징할 수 있게 임시 폴더에서 만든 뒤 설치 파일만 옮긴다.
const { spawnSync } = require("node:child_process");
const { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const stage = mkdtempSync(path.join(os.tmpdir(), "relay-package-"));
const release = path.join(root, "release");
const result = spawnSync(process.execPath, [require.resolve("electron-builder/cli.js"), "--win", "nsis", "--x64", `--config.directories.output=${stage}`], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(release, { recursive: true });
for (const name of readdirSync(stage)) {
  if ((name.endsWith(".exe") && !name.includes("__")) || name.endsWith(".exe.blockmap")) {
    cpSync(path.join(stage, name), path.join(release, name));
    console.log(`Created release/${name}`);
  }
}
if (path.dirname(stage) !== os.tmpdir() || !path.basename(stage).startsWith("relay-package-")) throw new Error("Unsafe staging cleanup target");
try { rmSync(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
catch { console.warn("패키징 임시 파일이 잠겨 있어 임시 폴더에 남았습니다."); }
