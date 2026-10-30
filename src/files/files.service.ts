import { spawn, spawnSync } from "node:child_process";
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync, type Dirent, type Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RelayError } from "../errors";
import { systemFileClipboard, type FileClipboardWriter } from "./windows-clipboard";
export type { FileClipboardWriter } from "./windows-clipboard";

/** 파일 탐색기 창의 서버 쪽. 로컬 디스크를 읽고, 화면이 시킨 복사·이동·휴지통 이동·새 폴더·이름 바꾸기만 한다. 열기는 운영체제의 탐색기·기본 앱에 넘긴다. */

export type FileKind = "directory" | "file";
export interface FileEntry { name: string; path: string; kind: FileKind; size: number | null; modified: string | null; hidden: boolean; link: boolean }
export interface Crumb { name: string; path: string }
export interface Listing { schemaVersion: 1; path: string; name: string; parent: string | null; crumbs: Crumb[]; entries: FileEntry[]; total: number; truncated: boolean }
export type PlaceId = "home" | "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos";
export interface Place { id: PlaceId; label: string; path: string }
export type DriveType = "fixed" | "removable" | "network" | "optical" | "ram" | "unknown";
export interface Drive { path: string; label: string; type: DriveType; total: number | null; free: number | null }
export interface Places { schemaVersion: 1; platform: NodeJS.Platform; separator: string; home: string; places: Place[]; drives: Drive[] }
export type OpenAction = "open" | "reveal";
/** 탐색기·기본 앱을 띄우는 부분. 테스트는 가짜를 넣는다. */
export type Launcher = (target: string, action: OpenAction, directory: boolean) => void;
/** 항목을 치우는 부분. Windows는 휴지통으로 옮기고(recycled), 그 밖에는 바로 지운다. 테스트는 가짜를 넣는다. */
export type Remover = (targets: string[]) => { recycled: boolean; failed: Failure[] };
export interface Failure { path: string; message: string }
/** 속성 창에 보이는 한 항목의 정보. contents는 폴더일 때 안에 든 항목 수와 크기다(너무 크면 partial). */
export interface FileInfo {
  schemaVersion: 1; name: string; path: string; kind: FileKind; size: number | null; created: string | null; modified: string | null; accessed: string | null;
  hidden: boolean; readonly: boolean; link: boolean; target: string | null; contents: { folders: number; files: number; bytes: number; partial: boolean } | null;
}
export type PasteMode = "copy" | "cut";
export interface PasteResult { schemaVersion: 1; mode: PasteMode; done: { from: string; to: string }[]; failed: Failure[] }
export interface DeleteResult { schemaVersion: 1; recycled: boolean; done: string[]; failed: Failure[] }
export interface SaveResult { schemaVersion: 1; path: string; size: number; modified: string }
export interface FolderResult { schemaVersion: 1; path: string; name: string }
export interface RenameResult { schemaVersion: 1; from: string; to: string; name: string }
export interface ClipboardResult { schemaVersion: 1; copied: number }

/** 한 폴더에서 돌려주는 최대 항목 수. 넘치면 이름 순 앞부분만 주고 truncated로 알린다. */
export const MAX_ENTRIES = 5000;
const MAX_PATH_LENGTH = 4096;
const windows = process.platform === "win32";
const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

const notFound = () => new RelayError("NOT_FOUND", "파일이나 폴더가 없습니다.", 3, 404);
function fsError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const code = (error as { code?: string })?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return notFound();
  if (code === "EACCES" || code === "EPERM") return new RelayError("ACCESS_DENIED", "이 위치를 읽을 권한이 없습니다.", 2, 403);
  if (code === "EBUSY") return new RelayError("FILE_BUSY", "다른 프로그램이 사용 중이라 읽을 수 없습니다.", 5, 409);
  return new RelayError("FILE_ERROR", "파일 시스템을 읽을 수 없습니다.", 5, 500);
}

/** 화면이 보낸 경로를 로컬 절대 경로로 바꾼다. 네트워크(UNC)·장치 경로와 NTFS 대체 스트림(`a.txt:stream`)은 받지 않는다. */
export function localPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > MAX_PATH_LENGTH || raw.includes("\0")) throw new RelayError("INVALID_ARGUMENT", "경로가 올바르지 않습니다.");
  if (windows) {
    const value = raw.replaceAll("/", "\\");
    if (value.startsWith("\\\\")) throw new RelayError("INVALID_ARGUMENT", "네트워크·장치 경로는 열 수 없습니다. 로컬 드라이브 경로를 쓰세요.");
    if (!/^[a-z]:(\\|$)/i.test(value) || value.indexOf(":", 2) !== -1) throw new RelayError("INVALID_ARGUMENT", "C:\\처럼 드라이브 문자로 시작하는 절대 경로를 쓰세요.");
    const resolved = path.win32.resolve(value.length === 2 ? `${value}\\` : value);
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  if (!path.isAbsolute(raw)) throw new RelayError("INVALID_ARGUMENT", "/로 시작하는 절대 경로를 쓰세요.");
  return path.resolve(raw);
}

// Windows의 숨김·시스템 속성은 Node가 알려 주지 않으므로 kernel32를 직접 부른다. 쓸 수 없으면 이름으로 짐작한다.
type Win32 = {
  attributes: (target: string) => number | null; drives: () => number; driveType: (root: string) => number; volumeLabel: (root: string) => string;
  knownFolder: (id: string) => string | null;
  /** SHFileOperationW(FO_DELETE, FOF_ALLOWUNDO): 탐색기처럼 휴지통으로 옮긴다. 0이면 성공. */
  recycle: (targets: string[]) => number;
};
let win32: Win32 | null | undefined;
function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  win32 = null;
  if (!windows) return win32;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen, FFIType, ptr, read } = require("bun:ffi") as typeof import("bun:ffi");
    const { symbols } = dlopen("kernel32.dll", {
      GetFileAttributesW: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetLogicalDrives: { args: [], returns: FFIType.u32 },
      GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetVolumeInformationW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    const shell = dlopen("shell32.dll", {
      SHGetKnownFolderPath: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SHFileOperationW: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    const ole = dlopen("ole32.dll", { CoTaskMemFree: { args: [FFIType.ptr], returns: FFIType.void } });
    const wide = (value: string) => Buffer.from(`${value}\0`, "utf16le");
    win32 = {
      attributes: (target) => { const value = symbols.GetFileAttributesW(ptr(wide(target))) >>> 0; return value === 0xffffffff ? null : value; },
      drives: () => symbols.GetLogicalDrives() >>> 0,
      driveType: (root) => symbols.GetDriveTypeW(ptr(wide(root))),
      volumeLabel: (root) => {
        const name = Buffer.alloc(522);
        return symbols.GetVolumeInformationW(ptr(wide(root)), ptr(name), 261, null, null, null, null, 0) ? name.toString("utf16le").replace(/\0[\s\S]*$/, "") : "";
      },
      // 사용자가 옮겨 둔 위치(OneDrive 백업 포함)까지 Windows가 실제로 쓰는 폴더를 알려 준다.
      knownFolder: (id) => {
        const hex = id.replaceAll("-", "");
        const guid = Buffer.alloc(16);
        guid.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0); guid.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4); guid.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
        Buffer.from(hex.slice(16), "hex").copy(guid, 8);
        const out = new BigUint64Array(1);
        const result = shell.symbols.SHGetKnownFolderPath(ptr(guid), 0, null, ptr(out));
        const address = Number(out[0]) as import("bun:ffi").Pointer;
        let value = "";
        if (result === 0 && address) for (let offset = 0; offset < 65536; offset += 2) { const code = read.u16(address, offset); if (!code) break; value += String.fromCharCode(code); }
        if (address) ole.symbols.CoTaskMemFree(address);
        return result === 0 && value ? value : null;
      },
      recycle: (targets) => {
        // SHFILEOPSTRUCTW(x64, 56바이트): hwnd 0 · wFunc 8 · pFrom 16 · pTo 24 · fFlags 32 · fAnyOperationsAborted 36 · hNameMappings 40 · lpszProgressTitle 48
        const from = Buffer.from(`${targets.join("\0")}\0\0`, "utf16le");
        const op = Buffer.alloc(56);
        op.writeUInt32LE(FO_DELETE, 8);
        op.writeBigUInt64LE(BigInt(ptr(from)), 16);
        op.writeUInt16LE(FOF_ALLOWUNDO | FOF_NO_UI, 32);
        const result = shell.symbols.SHFileOperationW(ptr(op));
        return result === 0 && op.readInt32LE(36) ? FO_ABORTED : result;
      },
    };
  } catch { win32 = null; }
  return win32;
}

const FO_DELETE = 3;
const FOF_ALLOWUNDO = 0x40;
/** FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_NOCONFIRMMKDIR: 창을 띄우지 않는다. */
const FOF_NO_UI = 0x614;
/** 사용자가 취소했을 때 쓰는 자체 코드(SHFileOperation은 0을 돌려준다). */
const FO_ABORTED = -1;
const FILE_ATTRIBUTE_READONLY = 0x1;

const HIDDEN_NAMES = new Set(["desktop.ini", "thumbs.db", "$recycle.bin", "system volume information", "pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log", "dumpstack.log.tmp", "config.msi", "recovery"]);
const FILE_ATTRIBUTE_HIDDEN = 0x2;
const FILE_ATTRIBUTE_SYSTEM = 0x4;
function isHidden(name: string, target: string): boolean {
  if (name.startsWith(".")) return true;
  if (!windows) return false;
  const attributes = loadWin32()?.attributes(target);
  if (attributes !== undefined && attributes !== null) return (attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) !== 0;
  const lower = name.toLowerCase();
  return HIDDEN_NAMES.has(lower) || lower.startsWith("ntuser.") || lower.startsWith("$");
}

/** 위치 경로 단추. C:\Users\me → [C:\, Users, me] */
export function crumbsOf(target: string): Crumb[] {
  const crumbs: Crumb[] = [];
  for (let current = target; ; ) {
    const parent = path.dirname(current);
    crumbs.unshift({ name: parent === current ? current.replace(/[\\/]$/, "") || current : path.basename(current), path: current });
    if (parent === current) break;
    current = parent;
  }
  return crumbs;
}

function entryOf(directory: string, name: string): FileEntry {
  const target = path.join(directory, name);
  let link = false;
  let stats: Stats | null = null;
  try { const own = lstatSync(target); link = own.isSymbolicLink(); stats = link ? statSync(target) : own; }
  catch { /* 끊어진 링크·권한 없는 항목도 이름은 보인다. */ }
  const directoryKind = stats?.isDirectory() ?? false;
  return { name, path: target, kind: directoryKind ? "directory" : "file", size: stats && !directoryKind ? stats.size : null,
    modified: stats ? stats.mtime.toISOString() : null, hidden: isHidden(name, target), link };
}

export function listDirectory(raw: unknown): Listing {
  const target = localPath(raw);
  try {
    if (!statSync(target).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "폴더가 아닙니다.", 2, 400);
    const names = readdirSync(target).sort(collator.compare);
    const entries = names.slice(0, MAX_ENTRIES).map((name) => entryOf(target, name));
    const parent = path.dirname(target);
    return { schemaVersion: 1, path: target, name: crumbsOf(target).at(-1)!.name, parent: parent === target ? null : parent,
      crumbs: crumbsOf(target), entries, total: names.length, truncated: names.length > MAX_ENTRIES };
  } catch (error) { throw fsError(error); }
}

const isDirectory = (target: string) => { try { return statSync(target).isDirectory(); } catch { return false; } };

/** 사용자 폴더. Windows에서는 Known Folder(SHGetKnownFolderPath)로 실제 위치를 읽고, 못 읽으면 홈 아래 같은 이름의 폴더를 쓴다. */
const USER_FOLDERS: [PlaceId, string, string, string][] = [
  ["desktop", "바탕 화면", "Desktop", "B4BFCC3A-DB2C-424C-B029-7FE99A87C641"], ["documents", "문서", "Documents", "FDD39AD0-238F-46AF-ADB4-6C85480369C7"],
  ["downloads", "다운로드", "Downloads", "374DE290-123F-4565-9164-39C4925E467B"], ["pictures", "사진", "Pictures", "33E28130-4E1E-4676-835A-98395C3BC3BB"],
  ["music", "음악", "Music", "4BD8D571-6D19-48D3-BE97-422220080E43"], ["videos", "동영상", "Videos", "18989B1D-99B5-455B-841C-AB7C74E4DDFC"],
];
function userPlaces(home: string): Place[] {
  const api = loadWin32();
  const places: Place[] = [{ id: "home", label: path.basename(home) || "홈", path: home }];
  for (const [id, label, name, known] of USER_FOLDERS) {
    const found = [api?.knownFolder(known), path.join(home, name)].find((candidate): candidate is string => typeof candidate === "string" && isDirectory(candidate));
    if (found) places.push({ id, label, path: found });
  }
  return places;
}

const DRIVE_TYPES: Record<number, DriveType> = { 2: "removable", 3: "fixed", 4: "network", 5: "optical", 6: "ram" };
function space(root: string) {
  try { const info = statfsSync(root); return { total: info.blocks * info.bsize, free: info.bavail * info.bsize }; }
  catch { return { total: null, free: null }; }
}
function drives(): Drive[] {
  if (!windows) return [{ path: "/", label: "/", type: "fixed", ...space("/") }];
  const api = loadWin32();
  const letters = api
    ? [...Array(26).keys()].filter((index) => api.drives() & (1 << index)).map((index) => String.fromCharCode(65 + index))
    : [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].filter((letter) => existsSync(`${letter}:\\`));
  return letters.map((letter) => {
    const root = `${letter}:\\`;
    const type = api ? DRIVE_TYPES[api.driveType(root)] ?? "unknown" : "unknown";
    // 빈 광학 드라이브·끊긴 네트워크 드라이브는 용량을 묻지 않는다.
    const ready = type !== "network" && type !== "optical";
    const label = (ready ? api?.volumeLabel(root) : "") || (type === "removable" ? "이동식 디스크" : type === "network" ? "네트워크 드라이브" : type === "optical" ? "광학 드라이브" : "로컬 디스크");
    return { path: root, label, type, ...(ready ? space(root) : { total: null, free: null }) };
  });
}

export function places(): Places {
  const home = os.homedir();
  return { schemaVersion: 1, platform: process.platform, separator: path.sep, home, places: userPlaces(home), drives: drives() };
}

/** 미리 보기로 그대로 내주는 형식. 나머지는 내려받기용 octet-stream이라 브라우저가 해석하지 않는다. */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|x-wav|wave|ogg|webm|mp4|aac|flac|x-flac)|text\/plain)/;
export function contentType(target: string): string {
  const type = Bun.file(target).type.split(";")[0].trim().toLowerCase();
  if (INLINE_TYPES.test(type)) return type === "text/plain" ? "text/plain; charset=utf-8" : type;
  return "application/octet-stream";
}

/** 한 구간 Range(bytes=a-b, a-, -n)만 받는다. 맞지 않으면 null(전체), 범위를 벗어나면 "invalid". */
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number; let end: number;
  if (!match[1]) { const tail = Number(match[2]); start = Math.max(0, size - tail); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

const attachmentName = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** 파일 내용. 미리 보기(이미지·영상·소리·글)와 내려받기에 쓰고, 영상 탐색을 위해 Range를 받는다. */
export function fileResponse(request: Request, url: URL, headers: Record<string, string>): Response {
  for (const key of url.searchParams.keys()) if (key !== "path" && key !== "download") throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
  if (url.searchParams.getAll("path").length !== 1 || url.searchParams.getAll("download").length > 1) throw new RelayError("INVALID_ARGUMENT", "path는 한 번만 줍니다.");
  const target = localPath(url.searchParams.get("path"));
  let size: number, modified: string;
  try { const stats = statSync(target); if (stats.isDirectory()) throw new RelayError("NOT_A_FILE", "폴더는 내용을 읽을 수 없습니다.", 2, 400); size = stats.size; modified = stats.mtime.toISOString(); }
  catch (error) { throw fsError(error); }
  const download = url.searchParams.get("download") === "1";
  const base = { ...headers,
    // 내용은 이 서버 화면의 미리 보기 안에서만 쓴다. 바로 열어도 스크립트가 돌지 않게 sandbox로 감싼다.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Content-Type": download ? "application/octet-stream" : contentType(target), "Accept-Ranges": "bytes",
    "Content-Disposition": download ? attachmentName(path.basename(target)) : "inline",
    // 뷰어가 고친 글을 저장할 때 이 값으로 그 사이 다른 곳에서 바뀌었는지 본다.
    "X-File-Modified": modified };
  const range = byteRange(request.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  const file = Bun.file(target);
  if (!range) return new Response(file, { headers: base });
  return new Response(file.slice(range.start, range.end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${range.start}-${range.end}/${size}` } });
}

/** 기본 앱으로 열지 않는 실행 형식. 이런 파일은 탐색기에서 선택해 보여 주기만 한다. */
const EXECUTABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|cpl|hta|lnk|url|reg|jar|appref-ms|application|gadget|msc|ps2|scf|inf|sys|dll)$/i;
export const isExecutable = (name: string) => EXECUTABLE.test(name);

export const systemLauncher: Launcher = (target, action, directory) => {
  const run = (command: string, args: string[], verbatim = false) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: verbatim });
    child.on("error", () => { /* 탐색기가 없는 환경에서도 서버는 계속 돈다. */ });
    child.unref();
  };
  if (windows) {
    // Windows 경로에는 큰따옴표가 들어갈 수 없으므로 그대로 감싼다.
    if (action === "reveal") run("explorer.exe", [`/select,"${target}"`], true);
    else run("explorer.exe", [`"${target}"`], true);
    return;
  }
  if (process.platform === "darwin") run("open", action === "reveal" ? ["-R", target] : [target]);
  else run("xdg-open", [action === "reveal" && !directory ? path.dirname(target) : target]);
};

/** POST /api/v1/files/open 본문 {path, action}. 폴더는 탐색기 창으로 열고, 실행 형식 파일은 열지 않고 선택만 한다. */
export function openPath(body: unknown, launch: Launcher) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ path, action } JSON을 보내세요.");
  const { path: raw, action, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  if (action !== "open" && action !== "reveal") throw new RelayError("INVALID_ARGUMENT", "action은 open 또는 reveal입니다.");
  const target = localPath(raw);
  let directory: boolean;
  try { directory = statSync(target).isDirectory(); } catch (error) { throw fsError(error); }
  const effective: OpenAction = action === "open" && !directory && isExecutable(target) ? "reveal" : action;
  launch(target, effective, directory);
  return { schemaVersion: 1 as const, path: target, action: effective };
}

const isRoot = (target: string) => path.dirname(target) === target;
const samePath = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
/** child가 parent 자신이거나 그 안에 있는가 */
function isInside(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function isReadonly(target: string, stats: Stats): boolean {
  if (windows) { const attributes = loadWin32()?.attributes(target); if (attributes !== undefined && attributes !== null) return (attributes & FILE_ATTRIBUTE_READONLY) !== 0; }
  return (stats.mode & 0o200) === 0;
}

/** 폴더 안 항목 수와 크기. 너무 크거나 오래 걸리면 거기까지만 세고 partial로 알린다. */
const CONTENTS_MAX_ENTRIES = 200_000;
const CONTENTS_MAX_MS = 2000;
export function folderContents(root: string): NonNullable<FileInfo["contents"]> {
  const result = { folders: 0, files: 0, bytes: 0, partial: false };
  const started = Date.now();
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const directory = stack.pop()!;
    let entries: Dirent[];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { result.partial = true; continue; }
    for (const entry of entries) {
      if (++seen > CONTENTS_MAX_ENTRIES || Date.now() - started > CONTENTS_MAX_MS) { result.partial = true; return result; }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { result.folders += 1; stack.push(target); }
      else { result.files += 1; if (entry.isFile()) { try { result.bytes += statSync(target).size; } catch { result.partial = true; } } }
    }
  }
  return result;
}

/** GET /api/v1/files/stat?path=: 속성 창에 보이는 정보. */
export function statPath(raw: unknown): FileInfo {
  const target = localPath(raw);
  try {
    const own = lstatSync(target);
    const link = own.isSymbolicLink();
    let stats = own; let linkTarget: string | null = null;
    if (link) { try { stats = statSync(target); linkTarget = realpathSync(target); } catch { /* 끊어진 링크는 링크 자체의 정보만 보인다. */ } }
    const directory = stats.isDirectory();
    const name = isRoot(target) ? target.replace(/[\\/]$/, "") || target : path.basename(target);
    return { schemaVersion: 1, name, path: target, kind: directory ? "directory" : "file", size: directory ? null : stats.size,
      created: stats.birthtime.getTime() > 0 ? stats.birthtime.toISOString() : null, modified: stats.mtime.toISOString(), accessed: stats.atime.toISOString(),
      hidden: isHidden(name, target), readonly: isReadonly(target, stats), link, target: linkTarget,
      contents: directory ? folderContents(target) : null };
  } catch (error) { throw fsError(error); }
}

const MAX_BATCH = 200;
function pathList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new RelayError("INVALID_ARGUMENT", `${label}는 경로 배열입니다.`);
  if (value.length > MAX_BATCH) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_BATCH}개까지만 다룹니다.`);
  const list = value.map(localPath);
  // 같은 경로를 두 번 주면 한 번만 다룬다.
  return list.filter((item, index) => list.findIndex((other) => samePath(other, item)) === index);
}
const failureOf = (error: unknown): string => (error instanceof RelayError ? error.message : fsError(error).message);

/** POST /api/v1/files/clipboard {paths}. 전부 검사한 뒤 Windows의 파일 목록 클립보드에 복사한다. */
export async function copyToClipboard(body: unknown, write: FileClipboardWriter = systemFileClipboard): Promise<ClipboardResult> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ paths } JSON을 보내세요.");
  const { paths: raw, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  const paths = pathList(raw, "paths");
  for (const target of paths) { try { lstatSync(target); } catch (error) { throw fsError(error); } }
  await write(paths);
  return { schemaVersion: 1, copied: paths.length };
}

/** 붙여넣을 이름. 같은 폴더에 복사하거나 같은 이름이 있으면 탐색기처럼 `이름 - 복사본`, `이름 - 복사본 (2)`를 쓴다. */
export function copyName(directory: string, name: string, taken = (candidate: string) => existsSync(path.join(directory, candidate))): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem} - 복사본${index > 1 ? ` (${index})` : ""}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new RelayError("FILE_ERROR", "붙여넣을 이름을 정하지 못했습니다.", 5, 500);
}

/** POST /api/v1/files/paste 본문 {sources, destination, mode}. 덮어쓰지 않으며, 잘라내기에서 이름이 겹치면 그 항목만 건너뛴다. */
export function pasteItems(body: unknown): PasteResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ sources, destination, mode } JSON을 보내세요.");
  const { sources: rawSources, destination: rawDestination, mode, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  if (mode !== "copy" && mode !== "cut") throw new RelayError("INVALID_ARGUMENT", "mode는 copy 또는 cut입니다.");
  const sources = pathList(rawSources, "sources");
  const destination = localPath(rawDestination);
  try { if (!statSync(destination).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "붙여넣을 곳은 폴더여야 합니다.", 2, 400); }
  catch (error) { throw fsError(error); }
  const result: PasteResult = { schemaVersion: 1, mode, done: [], failed: [] };
  for (const source of sources) {
    try {
      if (isRoot(source)) throw new RelayError("INVALID_ARGUMENT", "드라이브 전체는 복사하거나 옮길 수 없습니다.");
      const stats = lstatSync(source);
      const directory = stats.isDirectory();
      const sameFolder = samePath(path.dirname(source), destination);
      if (directory && isInside(destination, source)) throw new RelayError("INVALID_ARGUMENT", "폴더를 자기 자신이나 그 하위 폴더에 넣을 수 없습니다.");
      if (mode === "cut" && sameFolder) throw new RelayError("INVALID_ARGUMENT", "이미 이 폴더에 있습니다.");
      const name = path.basename(source);
      let targetName = name;
      if (mode === "copy") targetName = copyName(destination, name);
      else if (existsSync(path.join(destination, name))) throw new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.");
      const target = path.join(destination, targetName);
      if (mode === "copy") {
        if (directory) cpSync(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
        else copyFileSync(source, target, constants.COPYFILE_EXCL);
      } else {
        try { renameSync(source, target); }
        catch (error) {
          // 다른 드라이브로는 이름을 바꿀 수 없으니 복사한 뒤 원본을 지운다.
          if ((error as { code?: string }).code !== "EXDEV") throw error;
          if (directory) cpSync(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
          else copyFileSync(source, target, constants.COPYFILE_EXCL);
          rmSync(source, { recursive: true, force: false });
        }
      }
      result.done.push({ from: source, to: target });
    } catch (error) { result.failed.push({ path: source, message: failureOf(error) }); }
  }
  return result;
}

/** Windows가 파일 이름에 못 쓰는 글자(제어 문자 포함)와 장치 예약 이름 */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 255;
/** 새 이름. 탐색기처럼 앞뒤 공백과 끝의 점은 떼고, Windows가 못 쓰는 글자·예약 이름·너무 긴 이름은 받지 않는다. */
export function itemName(raw: unknown): string {
  if (typeof raw !== "string") throw new RelayError("INVALID_ARGUMENT", "name은 문자열입니다.");
  const name = raw.trim().replace(/[. ]+$/, "");
  if (!name) throw new RelayError("INVALID_NAME", "이름을 입력하세요.");
  if (BAD_NAME.test(name)) throw new RelayError("INVALID_NAME", '이름에 다음 문자는 쓸 수 없습니다: \\ / : * ? " < > |');
  if (RESERVED_NAME.test(name.split(".")[0].trimEnd())) throw new RelayError("INVALID_NAME", `‘${name}’은(는) Windows가 예약한 이름이라 쓸 수 없습니다.`);
  if (name.length > MAX_NAME_LENGTH) throw new RelayError("INVALID_NAME", `이름이 너무 깁니다(${MAX_NAME_LENGTH}자까지).`);
  return name;
}
function changeError(error: unknown): RelayError {
  const code = (error as { code?: string })?.code;
  if (code === "EEXIST" || code === "ENOTEMPTY") return new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.", 2, 409);
  if (code === "EACCES" || code === "EPERM") return new RelayError("ACCESS_DENIED", "바꿀 권한이 없거나 다른 프로그램이 사용 중입니다.", 2, 403);
  if (code === "EBUSY") return new RelayError("FILE_BUSY", "다른 프로그램이 사용 중이라 바꿀 수 없습니다.", 5, 409);
  if (code === "EINVAL" || code === "ENAMETOOLONG") return new RelayError("INVALID_NAME", "이 이름은 쓸 수 없습니다.");
  return fsError(error);
}

/** 새 폴더 이름. 탐색기처럼 `새 폴더`, 있으면 `새 폴더 (2)`, `새 폴더 (3)`… */
export function newFolderName(directory: string, taken = (candidate: string) => existsSync(path.join(directory, candidate))): string {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1 ? "새 폴더" : `새 폴더 (${index})`;
    if (!taken(candidate)) return candidate;
  }
  throw new RelayError("FILE_ERROR", "새 폴더 이름을 정하지 못했습니다.", 5, 500);
}

/** POST /api/v1/files/mkdir 본문 {parent, name?}. name이 없으면 `새 폴더`(겹치면 번호를 붙임)로 만든다. 같은 이름이 있으면 만들지 않는다. */
export function makeFolder(body: unknown): FolderResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ parent, name } JSON을 보내세요.");
  const { parent: rawParent, name: rawName, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  const parent = localPath(rawParent);
  try { if (!statSync(parent).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "새 폴더를 만들 곳은 폴더여야 합니다.", 2, 400); }
  catch (error) { throw fsError(error); }
  const name = rawName === undefined ? newFolderName(parent) : itemName(rawName);
  const target = path.join(parent, name);
  try { mkdirSync(target); } catch (error) { throw changeError(error); }
  return { schemaVersion: 1, path: target, name };
}

/** POST /api/v1/files/rename 본문 {path, name}. 같은 폴더 안에서 이름만 바꾸고 덮어쓰지 않는다. 대소문자만 바꾸는 것은 된다. */
export function renameItem(body: unknown): RenameResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ path, name } JSON을 보내세요.");
  const { path: raw, name: rawName, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  const source = localPath(raw);
  if (isRoot(source) || samePath(source, os.homedir())) throw new RelayError("INVALID_ARGUMENT", "드라이브나 사용자 폴더는 이름을 바꿀 수 없습니다.");
  const name = itemName(rawName);
  try { lstatSync(source); } catch (error) { throw fsError(error); }
  const target = path.join(path.dirname(source), name);
  if (target === source) return { schemaVersion: 1, from: source, to: target, name };
  // Windows의 rename은 같은 이름의 파일을 덮어쓰므로 먼저 막는다. 대소문자만 다르면 같은 항목이라 괜찮다.
  if (!samePath(target, source) && existsSync(target)) throw new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.", 2, 409);
  try { renameSync(source, target); } catch (error) { throw changeError(error); }
  return { schemaVersion: 1, from: source, to: target, name };
}

/** Windows에서는 휴지통으로 옮긴다(bun:ffi가 없으면 PowerShell). 그 밖의 운영체제는 바로 지운다. */
export const systemRemover: Remover = (targets) => {
  const failed: Failure[] = [];
  if (!windows) {
    for (const target of targets) { try { rmSync(target, { recursive: true, force: false }); } catch (error) { failed.push({ path: target, message: failureOf(error) }); } }
    return { recycled: false, failed };
  }
  const api = loadWin32();
  for (const target of targets) {
    if (api) {
      const code = api.recycle([target]);
      if (code === 0) continue;
      failed.push({ path: target, message: code === FO_ABORTED ? "휴지통으로 옮기기를 취소했습니다." : code === 2 || code === 3 ? "파일이나 폴더가 없습니다."
        : code === 5 || code === 0x78 ? "이 항목을 옮길 권한이 없습니다." : code === 32 ? "다른 프로그램이 사용 중이라 옮길 수 없습니다." : `휴지통으로 옮기지 못했습니다(코드 ${code}).` });
      continue;
    }
    const directory = isDirectory(target);
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${directory ? "DeleteDirectory" : "DeleteFile"}($env:RELAY_REMOVE_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, RELAY_REMOVE_TARGET: target }, windowsHide: true, timeout: 30_000, encoding: "utf8" });
    if (run.status !== 0) failed.push({ path: target, message: "휴지통으로 옮기지 못했습니다." });
  }
  return { recycled: true, failed };
};

/** POST /api/v1/files/delete 본문 {paths}. 드라이브 루트와 사용자 홈은 지우지 않는다. */
export function deleteItems(body: unknown, remove: Remover): DeleteResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ paths } JSON을 보내세요.");
  const { paths: rawPaths, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  const result: DeleteResult = { schemaVersion: 1, recycled: false, done: [], failed: [] };
  const home = os.homedir();
  const targets: string[] = [];
  for (const target of pathList(rawPaths, "paths")) {
    if (isRoot(target) || samePath(target, home)) { result.failed.push({ path: target, message: "드라이브 전체나 사용자 폴더는 지울 수 없습니다." }); continue; }
    try { lstatSync(target); targets.push(target); } catch (error) { result.failed.push({ path: target, message: failureOf(error) }); }
  }
  if (targets.length) {
    const outcome = remove(targets);
    result.recycled = outcome.recycled;
    result.failed.push(...outcome.failed);
    result.done = targets.filter((target) => !outcome.failed.some((failure) => samePath(failure.path, target)));
  }
  return result;
}

/** 뷰어가 저장하는 글의 상한. 뷰어가 읽는 8MB에 인코딩 차이를 더한 여유다. */
export const MAX_SAVE_BYTES = 16 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function writeError(error: unknown): RelayError {
  const code = (error as { code?: string })?.code;
  if (code === "EACCES" || code === "EPERM") return new RelayError("ACCESS_DENIED", "이 파일에 쓸 권한이 없습니다. 읽기 전용인지 확인하세요.", 2, 403);
  if (code === "EBUSY") return new RelayError("FILE_BUSY", "다른 프로그램이 사용 중이라 저장할 수 없습니다.", 5, 409);
  return fsError(error);
}

/**
 * POST /api/v1/files/save 본문 {path, data, modified}. 뷰어에서 고친 글을 이미 있는 파일에 다시 쓴다(새 파일은 만들지 않는다).
 * data는 화면이 원래 인코딩으로 바꾼 바이트의 base64다. modified는 읽었을 때의 수정 시각이며,
 * 그 뒤 다른 곳에서 바뀌었으면 덮어쓰지 않고 FILE_CHANGED(409)로 알린다. null이면 확인 없이 덮어쓴다.
 */
export function saveFile(body: unknown): SaveResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", "{ path, data, modified } JSON을 보내세요.");
  const { path: raw, data, modified, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${Object.keys(rest).join(", ")}`);
  if (typeof data !== "string" || data.length % 4 !== 0 || !BASE64.test(data)) throw new RelayError("INVALID_ARGUMENT", "data는 base64 문자열입니다.");
  if (modified !== null && typeof modified !== "string") throw new RelayError("INVALID_ARGUMENT", "modified는 읽었을 때의 수정 시각(ISO 문자열)이나 null입니다.");
  const target = localPath(raw);
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_SAVE_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", `저장할 내용이 너무 큽니다(최대 ${MAX_SAVE_BYTES / 1024 / 1024}MB).`, 2, 413);
  let stats: Stats;
  try { stats = statSync(target); } catch (error) { throw fsError(error); }
  if (stats.isDirectory()) throw new RelayError("NOT_A_FILE", "폴더에는 저장할 수 없습니다.", 2, 400);
  if (modified !== null && stats.mtime.toISOString() !== modified) {
    throw new RelayError("FILE_CHANGED", "연 뒤에 다른 곳에서 파일이 바뀌었습니다.", 2, 409, { modified: stats.mtime.toISOString() });
  }
  try { writeFileSync(target, bytes); } catch (error) { throw writeError(error); }
  const after = statSync(target);
  return { schemaVersion: 1, path: target, size: after.size, modified: after.mtime.toISOString() };
}
