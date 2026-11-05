import { Inject, Injectable, Logger } from "@nestjs/common";
import { constants, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, type Dirent, type Stats } from "node:fs";
import { copyFile, cp, mkdir, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  attachmentName, byteRange, copyName, itemName, MAX_ENTRIES, MAX_FILE_BATCH, MAX_SAVE_BYTES, MAX_UPLOAD_BYTES, newFolderName, RelayError,
  type Crumb, type DeleteResult, type Failure, type FileEntry, type FileInfo, type FolderResult, type Listing, type PasteResult, type Places,
  type RenameResult, type SaveResult, type UploadResult,
} from "@relay/core";
import { CONFIG } from "../app.tokens.js";
import type { ServerConfig } from "../config.js";

/** 휴지통 폴더. 목록에 보이지 않고 경로로 가리킬 수도 없다. */
export const TRASH = ".trash";
const MAX_PATH_LENGTH = 4096;
const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

const notFound = () => new RelayError("NOT_FOUND", "파일이나 폴더가 없습니다.", 3, 404);
function fsError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const code = (error as { code?: string })?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return notFound();
  if (code === "EACCES" || code === "EPERM") return new RelayError("ACCESS_DENIED", "이 위치를 읽을 권한이 없습니다.", 2, 403);
  if (code === "EEXIST" || code === "ENOTEMPTY") return new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.", 2, 409);
  if (code === "EBUSY") return new RelayError("FILE_BUSY", "다른 프로그램이 사용 중이라 읽을 수 없습니다.", 5, 409);
  if (code === "EINVAL" || code === "ENAMETOOLONG") return new RelayError("INVALID_NAME", "이 이름은 쓸 수 없습니다.");
  return new RelayError("FILE_ERROR", "파일 시스템을 읽을 수 없습니다.", 5, 500);
}
const escaped = () => new RelayError("REMOTE_FORBIDDEN_PATH", "원격 파일 폴더 밖의 경로는 다룰 수 없습니다.", 2, 403);
const failureOf = (error: unknown): string => (error instanceof RelayError ? error.message : fsError(error).message);

/** 미리 보기로 그대로 내주는 형식. 나머지는 내려받기용 octet-stream이라 브라우저가 해석하지 않는다. */
const INLINE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  txt: "text/plain; charset=utf-8",
};
export const contentType = (name: string) => INLINE[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";

/** 지정 폴더(루트) 안의 경로. virtual은 화면이 쓰는 `/문서/a.txt`, real은 디스크의 실제 경로다. */
export interface Resolved { virtual: string; real: string; name: string }

/** 원격 파일 API. 모든 경로는 루트 기준 상대 경로이고, realpath가 루트 안인지 확인해 심볼릭 링크로도 빠져나가지 못하게 한다. */
@Injectable()
export class FilesService {
  private readonly logger = new Logger("files");
  readonly root: string | null;

  constructor(@Inject(CONFIG) config: ServerConfig) {
    if (!config.filesRoot) { this.root = null; return; }
    try {
      mkdirSync(config.filesRoot, { recursive: true });
      this.root = realpathSync(config.filesRoot);
      mkdirSync(path.join(this.root, TRASH), { recursive: true });
    } catch (error) {
      this.logger.error(`원격 파일 폴더를 열 수 없습니다: ${(error as Error).message}`);
      this.root = null;
    }
  }

  get enabled() { return this.root !== null; }

  private rootOrFail(): string {
    if (this.root === null) throw new RelayError("NOT_FOUND", "원격 파일 폴더가 설정되지 않았습니다.", 3, 404);
    return this.root;
  }

  private inside(real: string, root: string) { return real === root || real.startsWith(root + path.sep); }

  /** 화면이 보낸 경로를 루트 안의 실제 경로로 바꾼다. 있는 항목은 realpath로, 아직 없는 항목은 부모의 realpath로 루트 안인지 본다. */
  resolve(raw: unknown, { mustExist = true }: { mustExist?: boolean } = {}): Resolved {
    const root = this.rootOrFail();
    if (typeof raw !== "string" || !raw || raw.length > MAX_PATH_LENGTH || raw.includes("\0")) throw new RelayError("INVALID_ARGUMENT", "경로가 올바르지 않습니다.");
    const forward = raw.replaceAll("\\", "/");
    if (!forward.startsWith("/")) throw new RelayError("INVALID_ARGUMENT", "/로 시작하는 원격 폴더 경로를 쓰세요.");
    // `..`은 정규화하면 루트에서 멈추지만, 올라가려는 경로 자체를 받지 않는다.
    if (forward.split("/").includes("..")) throw escaped();
    const virtual = path.posix.normalize(forward).replace(/\/+$/, "") || "/";
    const segments = virtual.split("/").filter(Boolean);
    if (segments[0] === TRASH) throw escaped();
    const real = path.join(root, ...segments);
    let actual: string;
    try { actual = realpathSync(real); }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT" || mustExist) throw fsError(error);
      let parent: string;
      try { parent = realpathSync(path.dirname(real)); } catch (parentError) { throw fsError(parentError); }
      if (!this.inside(parent, root)) throw escaped();
      return { virtual, real, name: segments.at(-1) ?? "" };
    }
    if (!this.inside(actual, root)) throw escaped();
    return { virtual, real, name: segments.at(-1) ?? "" };
  }

  private virtualOf(real: string): string {
    const relative = path.relative(this.rootOrFail(), real).split(path.sep).filter(Boolean);
    return `/${relative.join("/")}`;
  }

  places(): Places {
    const root = this.rootOrFail();
    let total: number | null = null, free: number | null = null;
    try { const info = statfsSync(root); total = info.blocks * info.bsize; free = info.bavail * info.bsize; } catch { /* 용량은 부수 정보 */ }
    return { schemaVersion: 1, platform: "remote", separator: "/", home: "/", places: [{ id: "home", label: "원격 파일", path: "/" }],
      drives: [{ path: "/", label: "원격 서버", type: "fixed", total, free }] };
  }

  crumbs(virtual: string): Crumb[] {
    const crumbs: Crumb[] = [{ name: "원격 서버", path: "/" }];
    const segments = virtual.split("/").filter(Boolean);
    segments.forEach((segment, index) => crumbs.push({ name: segment, path: `/${segments.slice(0, index + 1).join("/")}` }));
    return crumbs;
  }

  private entryOf(directory: Resolved, name: string): FileEntry {
    const real = path.join(directory.real, name);
    let link = false;
    let stats: Stats | null = null;
    try { const own = lstatSync(real); link = own.isSymbolicLink(); stats = link ? statSync(real) : own; }
    catch { /* 끊어진 링크·권한 없는 항목도 이름은 보인다. */ }
    const directoryKind = stats?.isDirectory() ?? false;
    return { name, path: path.posix.join(directory.virtual, name), kind: directoryKind ? "directory" : "file", size: stats && !directoryKind ? stats.size : null,
      modified: stats ? stats.mtime.toISOString() : null, hidden: name.startsWith("."), link };
  }

  list(raw: unknown): Listing {
    const target = this.resolve(raw);
    try {
      if (!statSync(target.real).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "폴더가 아닙니다.", 2, 400);
      const names = readdirSync(target.real).filter((name) => !(target.virtual === "/" && name === TRASH)).sort(collator.compare);
      const entries = names.slice(0, MAX_ENTRIES).map((name) => this.entryOf(target, name));
      const crumbs = this.crumbs(target.virtual);
      return { schemaVersion: 1, path: target.virtual, name: crumbs.at(-1)!.name, parent: target.virtual === "/" ? null : path.posix.dirname(target.virtual),
        crumbs, entries, total: names.length, truncated: names.length > MAX_ENTRIES };
    } catch (error) { throw fsError(error); }
  }

  stat(raw: unknown): FileInfo {
    const target = this.resolve(raw);
    try {
      const own = lstatSync(target.real);
      const link = own.isSymbolicLink();
      let stats = own; let linkTarget: string | null = null;
      if (link) { try { stats = statSync(target.real); const real = realpathSync(target.real); linkTarget = this.inside(real, this.rootOrFail()) ? this.virtualOf(real) : null; } catch { /* 끊어진 링크 */ } }
      const directory = stats.isDirectory();
      const name = target.virtual === "/" ? "원격 서버" : target.name;
      return { schemaVersion: 1, name, path: target.virtual, kind: directory ? "directory" : "file", size: directory ? null : stats.size,
        created: stats.birthtime.getTime() > 0 ? stats.birthtime.toISOString() : null, modified: stats.mtime.toISOString(), accessed: stats.atime.toISOString(),
        hidden: target.name.startsWith("."), readonly: (stats.mode & 0o200) === 0, link, target: linkTarget, contents: directory ? this.folderContents(target.real) : null };
    } catch (error) { throw fsError(error); }
  }

  private folderContents(root: string): NonNullable<FileInfo["contents"]> {
    const result = { folders: 0, files: 0, bytes: 0, partial: false };
    const started = Date.now();
    const stack = [root];
    let seen = 0;
    while (stack.length) {
      const directory = stack.pop()!;
      let entries: Dirent[];
      try { entries = readdirSync(directory, { withFileTypes: true }); } catch { result.partial = true; continue; }
      for (const entry of entries) {
        if (++seen > 200_000 || Date.now() - started > 2000) { result.partial = true; return result; }
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) { result.folders += 1; stack.push(target); }
        else { result.files += 1; if (entry.isFile()) { try { result.bytes += statSync(target).size; } catch { result.partial = true; } } }
      }
    }
    return result;
  }

  /** 파일 내용. 미리 보기와 내려받기에 쓰고, 영상 탐색을 위해 Range를 받는다. 스트림으로 보낸다. */
  content(raw: unknown, rangeHeader: string | null, download: boolean): { status: number; headers: Record<string, string>; stream: Readable | null } {
    const target = this.resolve(raw);
    let size: number, modified: string;
    try { const stats = statSync(target.real); if (stats.isDirectory()) throw new RelayError("NOT_A_FILE", "폴더는 내용을 읽을 수 없습니다.", 2, 400); size = stats.size; modified = stats.mtime.toISOString(); }
    catch (error) { throw fsError(error); }
    const headers: Record<string, string> = {
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Type": download ? "application/octet-stream" : contentType(target.name), "Accept-Ranges": "bytes",
      "Content-Disposition": download ? attachmentName(target.name) : "inline", "X-File-Modified": modified, "Cache-Control": "no-store",
    };
    const range = byteRange(rangeHeader, size);
    if (range === "invalid") return { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` }, stream: null };
    if (!range) return { status: 200, headers: { ...headers, "Content-Length": String(size) }, stream: createReadStream(target.real) };
    return { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
      stream: createReadStream(target.real, { start: range.start, end: range.end }) };
  }

  /** 올리기. 임시 파일에 받아 다 받으면 제 이름으로 옮긴다. 같은 이름이 있으면 overwrite 없이는 거부한다. */
  async upload(raw: unknown, body: Readable, declaredLength: number | null, overwrite: boolean): Promise<UploadResult> {
    const target = this.resolve(raw, { mustExist: false });
    if (target.virtual === "/") throw new RelayError("INVALID_ARGUMENT", "올릴 파일의 경로를 주세요.");
    itemName(target.name);
    if (declaredLength !== null && declaredLength > MAX_UPLOAD_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", `파일이 너무 큽니다(최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`, 2, 413);
    if (existsSync(target.real)) {
      let directory = false;
      try { directory = statSync(target.real).isDirectory(); } catch { /* 아래에서 다시 본다 */ }
      if (directory) throw new RelayError("NOT_A_FILE", "폴더에는 올릴 수 없습니다.", 2, 400);
      if (!overwrite) throw new RelayError("FILE_EXISTS", "같은 이름의 파일이 이미 있습니다.", 2, 409);
    }
    const temp = path.join(path.dirname(target.real), `.${target.name}.upload-${randomBytes(6).toString("hex")}`);
    let received = 0;
    try {
      await pipeline(body, async function* (source) {
        for await (const chunk of source as AsyncIterable<Buffer>) {
          received += chunk.length;
          if (received > MAX_UPLOAD_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", `파일이 너무 큽니다(최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`, 2, 413);
          yield chunk;
        }
      }, createWriteStream(temp, { flags: "wx" }));
      await rename(temp, target.real);
    } catch (error) {
      try { rmSync(temp, { force: true }); } catch { /* 임시 파일 */ }
      throw error instanceof RelayError ? error : fsError(error);
    }
    const stats = statSync(target.real);
    return { schemaVersion: 1, path: target.virtual, size: stats.size, modified: stats.mtime.toISOString() };
  }

  /** 뷰어에서 고친 글을 이미 있는 파일에 다시 쓴다. 로컬과 같은 규칙(base64, modified 확인). */
  save(body: unknown): SaveResult {
    const value = this.object(body, "{ path, data, modified }", ["path", "data", "modified"]);
    const { data, modified } = value;
    if (typeof data !== "string" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new RelayError("INVALID_ARGUMENT", "data는 base64 문자열입니다.");
    if (modified !== null && typeof modified !== "string") throw new RelayError("INVALID_ARGUMENT", "modified는 읽었을 때의 수정 시각(ISO 문자열)이나 null입니다.");
    const target = this.resolve(value.path);
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_SAVE_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", `저장할 내용이 너무 큽니다(최대 ${MAX_SAVE_BYTES / 1024 / 1024}MB).`, 2, 413);
    let stats: Stats;
    try { stats = statSync(target.real); } catch (error) { throw fsError(error); }
    if (stats.isDirectory()) throw new RelayError("NOT_A_FILE", "폴더에는 저장할 수 없습니다.", 2, 400);
    if (modified !== null && stats.mtime.toISOString() !== modified) throw new RelayError("FILE_CHANGED", "연 뒤에 다른 곳에서 파일이 바뀌었습니다.", 2, 409, { modified: stats.mtime.toISOString() });
    try { writeFileSync(target.real, bytes); } catch (error) { throw fsError(error); }
    const after = statSync(target.real);
    return { schemaVersion: 1, path: target.virtual, size: after.size, modified: after.mtime.toISOString() };
  }

  mkdir(body: unknown): FolderResult {
    const value = this.object(body, "{ parent, name? }", ["parent", "name"]);
    const parent = this.resolve(value.parent);
    try { if (!statSync(parent.real).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "새 폴더를 만들 곳은 폴더여야 합니다.", 2, 400); }
    catch (error) { throw fsError(error); }
    const name = value.name === undefined ? newFolderName((candidate) => existsSync(path.join(parent.real, candidate))) : itemName(value.name);
    if (parent.virtual === "/" && name === TRASH) throw escaped();
    try { mkdirSync(path.join(parent.real, name)); } catch (error) { throw fsError(error); }
    return { schemaVersion: 1, path: path.posix.join(parent.virtual, name), name };
  }

  rename(body: unknown): RenameResult {
    const value = this.object(body, "{ path, name }", ["path", "name"]);
    const source = this.resolve(value.path);
    if (source.virtual === "/") throw new RelayError("INVALID_ARGUMENT", "루트 폴더는 이름을 바꿀 수 없습니다.");
    const name = itemName(value.name);
    const parentVirtual = path.posix.dirname(source.virtual);
    if (parentVirtual === "/" && name === TRASH) throw escaped();
    const target = path.join(path.dirname(source.real), name);
    const to = path.posix.join(parentVirtual, name);
    if (target === source.real) return { schemaVersion: 1, from: source.virtual, to, name };
    if (existsSync(target)) throw new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.", 2, 409);
    try { renameSync(source.real, target); } catch (error) { throw fsError(error); }
    return { schemaVersion: 1, from: source.virtual, to, name };
  }

  /** 루트 안에서 복사·이동. 덮어쓰지 않으며, 잘라내기에서 이름이 겹치면 그 항목만 건너뛴다. */
  async paste(body: unknown): Promise<PasteResult> {
    const value = this.object(body, "{ sources, destination, mode }", ["sources", "destination", "mode"]);
    const mode = value.mode;
    if (mode !== "copy" && mode !== "cut") throw new RelayError("INVALID_ARGUMENT", "mode는 copy 또는 cut입니다.");
    const sources = this.pathList(value.sources, "sources");
    const destination = this.resolve(value.destination);
    try { if (!statSync(destination.real).isDirectory()) throw new RelayError("NOT_A_DIRECTORY", "붙여넣을 곳은 폴더여야 합니다.", 2, 400); }
    catch (error) { throw fsError(error); }
    const result: PasteResult = { schemaVersion: 1, mode, done: [], failed: [] };
    for (const source of sources) {
      try {
        if (source.virtual === "/") throw new RelayError("INVALID_ARGUMENT", "루트 폴더 전체는 복사하거나 옮길 수 없습니다.");
        const directory = lstatSync(source.real).isDirectory();
        const sameFolder = path.posix.dirname(source.virtual) === destination.virtual;
        if (directory && (destination.virtual === source.virtual || destination.virtual.startsWith(`${source.virtual}/`))) {
          throw new RelayError("INVALID_ARGUMENT", "폴더를 자기 자신이나 그 하위 폴더에 넣을 수 없습니다.");
        }
        if (mode === "cut" && sameFolder) throw new RelayError("INVALID_ARGUMENT", "이미 이 폴더에 있습니다.");
        let targetName = source.name;
        if (mode === "copy") targetName = copyName(source.name, (candidate) => existsSync(path.join(destination.real, candidate)));
        else if (existsSync(path.join(destination.real, source.name))) throw new RelayError("FILE_EXISTS", "같은 이름의 항목이 이미 있습니다.");
        const target = path.join(destination.real, targetName);
        if (mode === "copy") {
          if (directory) await cp(source.real, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
          else await copyFile(source.real, target, constants.COPYFILE_EXCL);
        } else {
          await rename(source.real, target);
        }
        result.done.push({ from: source.virtual, to: path.posix.join(destination.virtual, targetName) });
      } catch (error) { result.failed.push({ path: source.virtual, message: failureOf(error) }); }
    }
    return result;
  }

  /** 휴지통(`.trash/<시각>/`)으로 옮긴다. 유지 작업이 30일 지난 것을 비운다. */
  async delete(body: unknown): Promise<DeleteResult> {
    const value = this.object(body, "{ paths }", ["paths"]);
    const result: DeleteResult = { schemaVersion: 1, recycled: true, done: [], failed: [] };
    const root = this.rootOrFail();
    const bin = path.join(root, TRASH, new Date().toISOString().replace(/[:.]/g, "-"));
    for (const target of this.pathList(value.paths, "paths")) {
      if (target.virtual === "/") { result.failed.push({ path: "/", message: "루트 폴더는 지울 수 없습니다." }); continue; }
      try {
        lstatSync(target.real);
        await mkdir(bin, { recursive: true });
        const name = copyName(target.name, (candidate) => existsSync(path.join(bin, candidate)));
        await rename(target.real, path.join(bin, name));
        result.done.push(target.virtual);
      } catch (error) { result.failed.push({ path: target.virtual, message: failureOf(error) }); }
    }
    return result;
  }

  /** 유지 작업: 휴지통에서 days일 지난 묶음을 지운다. */
  async purgeTrash(days = 30, now = Date.now()): Promise<number> {
    if (this.root === null) return 0;
    const bin = path.join(this.root, TRASH);
    let removed = 0;
    let entries: Dirent[] = [];
    try { entries = readdirSync(bin, { withFileTypes: true }); } catch { return 0; }
    for (const entry of entries) {
      const target = path.join(bin, entry.name);
      try { if (statSync(target).mtimeMs < now - days * 86_400_000) { await rm(target, { recursive: true, force: true }); removed++; } } catch { /* 다음에 */ }
    }
    return removed;
  }

  private object(body: unknown, hint: string, keys: string[]): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError("INVALID_ARGUMENT", `${hint} JSON을 보내세요.`);
    const value = body as Record<string, unknown>;
    const extra = Object.keys(value).filter((key) => !keys.includes(key));
    if (extra.length) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 키: ${extra.join(", ")}`);
    return value;
  }

  private pathList(value: unknown, label: string): Resolved[] {
    if (!Array.isArray(value) || !value.length) throw new RelayError("INVALID_ARGUMENT", `${label}는 경로 배열입니다.`);
    if (value.length > MAX_FILE_BATCH) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_FILE_BATCH}개까지만 다룹니다.`);
    const list = value.map((item) => this.resolve(item, { mustExist: false }));
    return list.filter((item, index) => list.findIndex((other) => other.virtual === item.virtual) === index);
  }
}

export type { Failure };
