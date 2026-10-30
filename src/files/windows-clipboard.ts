import { spawn } from "node:child_process";
import { RelayError } from "../errors";

export type FileClipboardWriter = (paths: string[]) => Promise<void>;

// WinForms는 STA에서 FileDrop(CF_HDROP)을 만들고, copy=true로 도우미 종료 뒤에도 데이터를 남긴다.
// 경로는 코드에 끼워 넣지 않고 stdin의 base64 JSON으로 보낸다(한글·따옴표·긴 목록 포함).
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
$paths = [string[]](ConvertFrom-Json $json)
$files = New-Object Collections.Specialized.StringCollection
$files.AddRange($paths)
$data = New-Object Windows.Forms.DataObject
$data.SetFileDropList($files)
$effect = [IO.MemoryStream]::new([byte[]](1, 0, 0, 0))
try {
  $data.SetData('Preferred DropEffect', $effect)
  [Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 50)
} finally { $effect.Dispose() }
`;
const encoded = Buffer.from(script, "utf16le").toString("base64");
const unavailable = () => new RelayError("CLIPBOARD_UNAVAILABLE", "Windows 클립보드에 파일을 복사하지 못했습니다. 다시 복사해 주세요.", 5, 503);
let pending: Promise<void> = Promise.resolve();

/** 요청 순서대로 게시해, 먼저 시작한 느린 복사가 나중 복사를 덮어쓰지 않게 한다. */
export const systemFileClipboard: FileClipboardWriter = (paths) => {
  if (process.platform !== "win32") return Promise.reject(new RelayError("NOT_SUPPORTED", "시스템 파일 클립보드는 Windows에서 지원합니다.", 2, 501));
  const next = pending.catch(() => {}).then(() => new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 10_000, stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", () => reject(unavailable()));
    child.once("close", (code) => code === 0 ? resolve() : reject(unavailable()));
    child.stdin.on("error", () => reject(unavailable()));
    child.stdin.end(Buffer.from(JSON.stringify(paths), "utf8").toString("base64"));
  }));
  pending = next;
  return next;
};
