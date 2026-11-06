import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { installDecision, parseBuild, type RelayBuild } from "./install-decision";
import { log } from "./log";
import { installedExe } from "./relay";

/** 앱에 동봉한 relay.exe와 설치 스크립트. 개발 중(패키지 전)에는 저장소의 dist·scripts를 본다. */
export function bundledExe(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "relay.exe")]
    : [path.resolve(app.getAppPath(), "..", "dist", "relay.exe")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function bundledInstaller(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "install-cli.ps1")]
    : [path.resolve(app.getAppPath(), "..", "scripts", "install-cli.ps1")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** relay.exe의 빌드 정보. 읽는 동안 훅을 다시 등록하지 않게 하고(동봉본 경로로 훅이 바뀌지 않도록), 이 명령이 없는 옛 실행 파일이면 null. */
function buildOf(exe: string): Promise<RelayBuild | null> {
  return new Promise((resolve) => {
    execFile(exe, ["version", "--json"], { env: { ...process.env, RELAY_SKIP_HOOK_INSTALL: "1" }, timeout: 15000, windowsHide: true, encoding: "utf8" },
      (error, stdout) => resolve(error ? null : parseBuild(stdout)));
  });
}
const describe = (build: RelayBuild | null) => (build ? `${build.version}${build.builtAt ? ` · ${build.builtAt}` : ""}` : "빌드 정보 없음");

/**
 * 설치된 relay.exe가 없거나, 동봉한 것이 더 나중에 빌드됐으면 install-cli.ps1로 설치한다(installDecision).
 * 저장소에서 따로 다시 설치한 더 새 CLI는 그대로 둔다. 스크립트가 ~/.local/bin 복사, PATH, relay:// 등록,
 * Agent 훅·스킬 설치, 실행 중 서버 재시작까지 맡는다. 패키지 전(개발)에는 설치하지 않고 있는 것을 쓴다.
 */
export async function ensureInstalled(): Promise<{ exe: string | null; installed: boolean; output: string }> {
  const bundled = bundledExe();
  const current = installedExe();
  if (!app.isPackaged || process.env.RELAY_DESKTOP_NO_INSTALL) return { exe: current ?? bundled, installed: false, output: "" };
  if (!bundled) return { exe: current, installed: false, output: "동봉한 relay.exe가 없습니다." };
  const same = Boolean(current) && sha256(current!) === sha256(bundled);
  const [installedBuild, bundledBuild] = current && !same ? await Promise.all([buildOf(current), buildOf(bundled)]) : [null, null];
  const decision = installDecision({ installed: Boolean(current), same, installedBuild, bundledBuild });
  if (decision === "same") return { exe: current, installed: false, output: "" };
  if (decision === "keep") {
    log("info", `설치된 relay.exe(${describe(installedBuild)})가 동봉본(${describe(bundledBuild)})보다 새것이라 그대로 씁니다.`);
    return { exe: current, installed: false, output: "" };
  }
  const script = bundledInstaller();
  if (!script) return { exe: current ?? bundled, installed: false, output: "설치 스크립트가 없습니다." };
  log("info", `relay.exe 설치: ${bundled} → ~/.local/bin`);
  const output = await runPowerShell(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ExecutablePath", bundled, "-Force"]);
  log("info", `설치 결과: ${output.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")}`);
  return { exe: installedExe() ?? bundled, installed: true, output };
}

function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim() || `install-cli.ps1 failed (${code})`))));
  });
}
