import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import type { ConnectionReport, DesktopConfig, MigrateResult, Mode, RelayConfig, RelayStatus, RemoteConfig } from "../shared/types";
import { dataDirectory, defaultDeviceName, normalizeUrl, readConfig, writeConfig } from "./config";
import { log, logFile } from "./log";
import { probe, RelayProcess } from "./relay";
import { testConnection } from "./remote";
import { ensureInstalled } from "./setup";

/**
 * Relay Windows 앱.
 *  - 처음 실행(설정에 mode 없음): 마법사 창에서 로컬/원격을 고르고 연결을 확인한 뒤 저장한다.
 *  - 그 뒤: relay.exe 웹 서버를 켜고 http://127.0.0.1:<포트> 화면을 창에 띄운다. 창을 닫으면 트레이로 내려간다.
 *  - 로그인 때 `--hidden`으로 조용히 시작해 트레이만 둔다(설정에서 끌 수 있음).
 */
const hiddenStart = process.argv.includes("--hidden");
let config: RelayConfig = readConfig();
let relay: RelayProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let wizardWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", () => { void showMain(); });
  app.whenReady().then(boot).catch((error) => { log("error", `시작 실패: ${(error as Error).stack ?? error}`); dialog.showErrorBox("Relay", (error as Error).message); app.quit(); });
}

const iconPath = () => (app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.resolve(app.getAppPath(), "resources", "icon.png"));

async function boot() {
  app.setAppUserModelId("dev.chanuu.relay");
  log("info", `Relay 앱 시작 (packaged=${app.isPackaged}, hidden=${hiddenStart}, data=${dataDirectory()})`);
  registerIpc();
  applyAutoLaunch(config.desktop ?? { autoLaunch: true, closeToTray: true });
  createTray();
  const setup = await ensureInstalled().catch((error) => { log("warn", `설치 건너뜀: ${(error as Error).message}`); return { exe: null, installed: false, output: "" }; });
  if (!setup.exe) { log("warn", "relay.exe를 찾지 못했습니다. 마법사에서 안내한다."); }
  if (!config.mode) { await openWizard(); return; }
  try {
    await startRelay();
    if (!hiddenStart) await showMain();
  } catch (error) {
    log("warn", "서버 시작 실패: 설정 창에서 포트를 확인하세요.");
    await openWizard();
    void dialog.showMessageBox(wizardWindow!, { type: "warning", message: "로컬 서버를 시작하지 못했습니다.", detail: (error as Error).message });
  }
}

async function startRelay(): Promise<RelayStatus> {
  const { installedExe } = await import("./relay");
  const exe = installedExe();
  if (!exe) throw new Error("설치된 relay.exe가 없습니다. 앱을 다시 설치하거나 npm run build 뒤 scripts/install-cli.ps1을 실행하세요.");
  relay = new RelayProcess(exe, dataDirectory(), config.webPort);
  await relay.start();
  const status = await currentStatus();
  broadcast(status);
  return status;
}

async function currentStatus(): Promise<RelayStatus> {
  const url = `http://127.0.0.1:${config.webPort}`;
  const found = await probe(url);
  const { installedExe } = await import("./relay");
  return { dataDirectory: dataDirectory(), remote: found.remote ?? null, running: found.kind === "relay", external: relay?.external ?? false, url, pid: found.pid, mode: config.mode ?? null,
    remoteUrl: config.mode === "remote" ? config.remote?.url ?? null : null, appVersion: found.appVersion, build: found.build, exe: installedExe() };
}

function broadcast(status: RelayStatus) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("relay:status", status);
}

async function showMain() {
  if (!config.mode) { await openWizard(); return; }
  if (!relay) { await startRelay(); }
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 760, minHeight: 520, show: false, title: "Relay", icon: iconPath(), backgroundColor: "#111318",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (quitting || !(config.desktop?.closeToTray ?? true)) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => { mainWindow = null; if (!(config.desktop?.closeToTray ?? true)) app.quit(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  await mainWindow.loadURL(`${relay!.url}/`);
}

async function openWizard() {
  if (wizardWindow && !wizardWindow.isDestroyed()) { wizardWindow.show(); wizardWindow.focus(); return; }
  wizardWindow = new BrowserWindow({
    width: 760, height: 680, minWidth: 640, minHeight: 560, title: "Relay 설정", icon: iconPath(), backgroundColor: "#0f1115", autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "..", "preload", "index.js") },
  });
  wizardWindow.once("ready-to-show", () => wizardWindow?.show());
  wizardWindow.on("closed", () => { wizardWindow = null; if (!config.mode && !mainWindow) app.quit(); });
  await wizardWindow.loadFile(path.join(__dirname, "..", "renderer", "wizard.html"));
}

function createTray() {
  try {
    const image = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip("Relay");
    refreshTrayMenu();
    tray.on("double-click", () => void showMain());
  } catch (error) { log("warn", `트레이를 만들 수 없습니다: ${(error as Error).message}`); }
}

function refreshTrayMenu() {
  if (!tray) return;
  const modeLabel = config.mode === "remote" ? `원격 · ${config.remote?.url.replace(/^https?:\/\//, "") ?? ""}` : config.mode === "local" ? "로컬 (이 PC)" : "설정 전";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Relay 열기", click: () => void showMain() },
    { label: `모드: ${modeLabel}`, enabled: false },
    { type: "separator" },
    { label: "설정…", click: () => void openWizard() },
    { label: "서버 다시 시작", click: () => void restartRelay() },
    { label: "outbox 전송", enabled: config.mode === "remote", click: () => { void runMaintenance(["outbox", "flush", "--json"]).then(result => {
      tray?.displayBalloon({ title: "Relay", content: result.ok ? "전송 대기열을 확인했습니다. 설정 창에서 남은 건수를 확인하세요." : "전송하지 못했습니다. 설정 창에서 연결을 확인하세요." });
    }); } },
    { label: "로그 폴더 열기", click: () => void shell.showItemInFolder(logFile()) },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } },
  ]));
}

async function restartRelay(): Promise<RelayStatus> {
  if (!relay) return startRelay();
  await relay.reload();
  const status = await currentStatus();
  broadcast(status);
  return status;
}

function applyAutoLaunch(desktop: DesktopConfig) {
  if (!app.isPackaged || process.env.RELAY_DESKTOP_NO_INSTALL) return;
  app.setLoginItemSettings({ openAtLogin: desktop.autoLaunch, openAsHidden: true, args: ["--hidden"] });
}

async function runMaintenance(args: string[]): Promise<MigrateResult> {
  const { installedExe } = await import("./relay");
  const exe = installedExe();
  if (!exe) return { ok: false, output: "relay.exe를 찾지 못했습니다." };
  const runner = relay ?? new RelayProcess(exe, dataDirectory(), config.webPort);
  try { return { ok: true, output: (await runner.run(args)).trim() }; }
  catch (error) { return { ok: false, output: (error as Error).message }; }
}

function registerIpc() {
  const handle = (channel: string, listener: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!wizardWindow || event.sender !== wizardWindow.webContents || event.senderFrame !== wizardWindow.webContents.mainFrame) throw new Error("설정 창에서만 사용할 수 있습니다.");
      return listener(event, ...args);
    });
  };
  handle("config:get", () => config);
  handle("folder:open", async (_event, kind: string) => {
    if (kind !== "data" && kind !== "logs") throw new Error("열 폴더를 확인하세요.");
    const error = await shell.openPath(kind === "data" ? dataDirectory() : path.dirname(logFile()));
    if (error) throw new Error(error);
  });
  handle("integration:install", (_event, kind: string) => {
    if (kind !== "hooks" && kind !== "skills") throw new Error("설치할 연동을 확인하세요.");
    return runMaintenance([kind === "hooks" ? "install-hooks" : "install-skills", "--json"]);
  });
  handle("outbox:flush", async () => {
    if (config.mode !== "remote") return { ok: false, output: "원격 모드에서만 전송 대기열을 사용합니다." };
    const result = await runMaintenance(["outbox", "flush", "--json"]);
    broadcast(await currentStatus());
    return result;
  });
  handle("config:set-port", async (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("포트는 1~65535 정수로 입력하세요.");
    if (port === config.webPort) return config;
    if ((await probe(`http://127.0.0.1:${port}`)).kind !== "none") throw new Error(`포트 ${port}는 이미 사용 중입니다. 다른 포트를 입력하세요.`);
    const previous = config;
    const wasRunning = (await probe(`http://127.0.0.1:${config.webPort}`)).kind === "relay";
    if (wasRunning && relay) await relay.run(["web", "--close", "--port", String(config.webPort)]);
    relay = null;
    try {
      config = writeConfig({ ...config, webPort: port });
      if (config.mode) await startRelay();
      if (mainWindow) await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
      return config;
    } catch (error) {
      await (relay as RelayProcess | null)?.stop().catch(() => {});
      config = writeConfig(previous);
      relay = null;
      if (wasRunning) await startRelay().catch(() => {});
      if (mainWindow) await mainWindow.loadURL(`http://127.0.0.1:${previous.webPort}/`).catch(() => {});
      throw error;
    }
  });
  handle("device:default-name", () => defaultDeviceName());
  handle("remote:test", (_event, input: { url: string; token: string; deviceName: string }): Promise<ConnectionReport> => testConnection(input));
  handle("config:save-mode", async (_event, input: { mode: Mode; remote?: RemoteConfig }) => {
    if (input.mode !== "local" && input.mode !== "remote") throw new Error("저장 모드를 확인하세요.");
    if (input.mode === "remote") {
      if (!input.remote?.url || !input.remote.token) throw new Error("원격 서버 주소와 토큰이 필요합니다.");
      input.remote.url = normalizeUrl(input.remote.url);
    }
    config = writeConfig({ ...config, mode: input.mode, remote: input.mode === "remote" ? input.remote : undefined });
    log("info", `모드 저장: ${config.mode}`);
    refreshTrayMenu();
    if (relay) await restartRelay();
    else { const status = await startRelay(); if (status.external) await restartRelay(); }
    return config;
  });
  handle("config:set-desktop", (_event, input: Partial<DesktopConfig>) => {
    const desktop = { ...(config.desktop ?? { autoLaunch: true, closeToTray: true }), ...input };
    config = writeConfig({ ...config, desktop });
    applyAutoLaunch(desktop);
    return config;
  });
  handle("relay:status", () => currentStatus());
  handle("relay:restart", () => restartRelay());
  handle("migrate:run", async (_event, input: { dryRun: boolean }): Promise<MigrateResult> => {
    const { installedExe } = await import("./relay");
    const exe = installedExe();
    if (!exe) return { ok: false, output: "relay.exe를 찾지 못했습니다." };
    const runner = relay ?? new RelayProcess(exe, dataDirectory(), config.webPort);
    try {
      const output = await runner.run(["migrate", "--to-remote", ...(input.dryRun ? ["--dry-run"] : []), "--json"], 10 * 60_000);
      return { ok: true, output: output.trim() };
    } catch (error) { return { ok: false, output: (error as Error).message }; }
  });
  handle("window:open-main", async () => { await showMain(); wizardWindow?.close(); });
}

app.on("window-all-closed", () => { /* 트레이에 남는다 */ });
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", (event) => {
  if (!relay || relay.external || config.desktop?.keepServerRunning) return;
  event.preventDefault();
  relay.stop().finally(() => { relay = null; app.quit(); });
});
