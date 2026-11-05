import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, RelayStatus } from "../shared/types";

/** 마법사·설정 화면에만 노출하는 최소 API. Relay 본 화면(127.0.0.1)은 이 객체를 쓰지 않는다. */
const api: DesktopApi = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveMode: (input) => ipcRenderer.invoke("config:save-mode", input),
  testConnection: (input) => ipcRenderer.invoke("remote:test", input),
  getStatus: () => ipcRenderer.invoke("relay:status"),
  restartRelay: () => ipcRenderer.invoke("relay:restart"),
  migrate: (input) => ipcRenderer.invoke("migrate:run", input),
  setDesktop: (input) => ipcRenderer.invoke("config:set-desktop", input),
  openMain: () => ipcRenderer.invoke("window:open-main"),
  defaultDeviceName: () => ipcRenderer.invoke("device:default-name"),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: RelayStatus) => listener(status);
    ipcRenderer.on("relay:status", handler);
    return () => ipcRenderer.removeListener("relay:status", handler);
  },
};

contextBridge.exposeInMainWorld("relayDesktop", api);
