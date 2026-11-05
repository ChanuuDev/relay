import { RelayError } from "./errors.js";

/** 파일 탐색기 API의 모양. 로컬(PC 디스크)과 원격(서버 지정 폴더)이 같은 모양으로 답한다. */
export type FileKind = "directory" | "file";
export interface FileEntry { name: string; path: string; kind: FileKind; size: number | null; modified: string | null; hidden: boolean; link: boolean }
export interface Crumb { name: string; path: string }
export interface Listing { schemaVersion: 1; path: string; name: string; parent: string | null; crumbs: Crumb[]; entries: FileEntry[]; total: number; truncated: boolean }
export type PlaceId = "home" | "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos";
export interface Place { id: PlaceId; label: string; path: string }
export type DriveType = "fixed" | "removable" | "network" | "optical" | "ram" | "unknown";
export interface Drive { path: string; label: string; type: DriveType; total: number | null; free: number | null }
export interface Places { schemaVersion: 1; platform: string; separator: string; home: string; places: Place[]; drives: Drive[] }
export type OpenAction = "open" | "reveal";
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
export interface UploadResult { schemaVersion: 1; path: string; size: number; modified: string }

/** 한 폴더에서 돌려주는 최대 항목 수. 넘치면 이름 순 앞부분만 주고 truncated로 알린다. */
export const MAX_ENTRIES = 5000;
/** 한 번에 다루는 경로 수(붙여넣기·삭제). */
export const MAX_FILE_BATCH = 200;
/** 뷰어가 저장하는 글의 상한. 뷰어가 읽는 8MB에 인코딩 차이를 더한 여유다. */
export const MAX_SAVE_BYTES = 16 * 1024 * 1024;
/** 원격 폴더에 올리는 파일 하나의 상한. */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

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

/** Windows가 파일 이름에 못 쓰는 글자(제어 문자 포함)와 장치 예약 이름. 원격(리눅스)도 같은 규칙을 써서 두 쪽을 오가도 이름이 깨지지 않게 한다. */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_NAME_LENGTH = 255;
/** 새 이름. 탐색기처럼 앞뒤 공백과 끝의 점은 떼고, 못 쓰는 글자·예약 이름·너무 긴 이름은 받지 않는다. */
export function itemName(raw: unknown): string {
  if (typeof raw !== "string") throw new RelayError("INVALID_ARGUMENT", "name은 문자열입니다.");
  const name = raw.trim().replace(/[. ]+$/, "");
  if (!name) throw new RelayError("INVALID_NAME", "이름을 입력하세요.");
  if (BAD_NAME.test(name)) throw new RelayError("INVALID_NAME", '이름에 다음 문자는 쓸 수 없습니다: \\ / : * ? " < > |');
  if (RESERVED_NAME.test(name.split(".")[0].trimEnd())) throw new RelayError("INVALID_NAME", `‘${name}’은(는) Windows가 예약한 이름이라 쓸 수 없습니다.`);
  if (name.length > MAX_NAME_LENGTH) throw new RelayError("INVALID_NAME", `이름이 너무 깁니다(${MAX_NAME_LENGTH}자까지).`);
  return name;
}

/** 붙여넣을 이름. 같은 폴더에 복사하거나 같은 이름이 있으면 탐색기처럼 `이름 - 복사본`, `이름 - 복사본 (2)`를 쓴다. */
export function copyName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem} - 복사본${index > 1 ? ` (${index})` : ""}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new RelayError("FILE_ERROR", "붙여넣을 이름을 정하지 못했습니다.", 5, 500);
}

/** 새 폴더 이름. 탐색기처럼 `새 폴더`, 있으면 `새 폴더 (2)`, `새 폴더 (3)`… */
export function newFolderName(taken: (candidate: string) => boolean): string {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1 ? "새 폴더" : `새 폴더 (${index})`;
    if (!taken(candidate)) return candidate;
  }
  throw new RelayError("FILE_ERROR", "새 폴더 이름을 정하지 못했습니다.", 5, 500);
}

/** 내려받기 헤더. ASCII가 아닌 이름은 RFC 5987 형식으로 함께 보낸다. */
export const attachmentName = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
