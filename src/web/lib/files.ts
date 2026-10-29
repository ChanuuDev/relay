import { create } from "zustand";
import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileTerminal, FileText, FileVideo, Folder, Presentation, type LucideIcon,
} from "lucide-react";
import type { DeleteResult, Drive, FileEntry, FileInfo, Listing, PasteMode, PasteResult, Place, Places, SaveResult } from "../../files/files.service";

export type { DeleteResult, Drive, FileEntry, FileInfo, Listing, PasteMode, PasteResult, Place, Places, SaveResult };

/** 복사·잘라내기한 항목. 창 안에서만 쓰는 클립보드라 새로 고치면 비워진다. */
export type Clipboard = { paths: string[]; mode: PasteMode };

/** 위치. null은 `이 PC`(즐겨찾기·드라이브 시작 화면)다. */
export type Location = string | null;
export type View = "list" | "grid";
export type SortKey = "name" | "modified" | "kind" | "size";
export type Sort = { key: SortKey; desc: boolean };
/** 목록 보기에서 사용자가 끌어 정한 열 너비(px). 없는 열은 기본 너비이고, 이름 열은 늘 남는 폭을 다 쓴다. */
export type ColumnKey = "modified" | "kind" | "size";
export type ColumnWidths = Partial<Record<ColumnKey, number>>;
export const COLUMN_MIN: Record<ColumnKey, number> = { modified: 72, kind: 56, size: 48 };
const COLUMN_MAX = 640;
/** favorites가 null이면 사용자 폴더(places) 기본 즐겨찾기를 쓴다. expanded는 펼친 트리 항목 키(`fav:경로`, `pc:경로`, `pc:`)다. */
type Prefs = { view: View; hidden: boolean; preview: boolean; sort: Sort; location: Location; favorites: string[] | null; expanded: string[]; columns: ColumnWidths };

const PREFS_KEY = "relay-files-v1";
const MAX_HISTORY = 100;
const DEFAULT_PREFS: Prefs = { view: "list", hidden: false, preview: true, sort: { key: "name", desc: false }, location: null, favorites: null, expanded: ["fav:", "pc:"], columns: {} };
const MAX_FAVORITES = 50;
const MAX_EXPANDED = 200;
const SORT_KEYS: SortKey[] = ["name", "modified", "kind", "size"];

function columnsOf(value: unknown): ColumnWidths {
  const columns: ColumnWidths = {};
  if (!value || typeof value !== "object") return columns;
  for (const key of Object.keys(COLUMN_MIN) as ColumnKey[]) {
    const width = (value as Record<string, unknown>)[key];
    if (typeof width === "number" && Number.isFinite(width)) columns[key] = Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN[key], width)));
  }
  return columns;
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
    const sort = raw.sort && SORT_KEYS.includes(raw.sort.key) ? { key: raw.sort.key, desc: Boolean(raw.sort.desc) } : DEFAULT_PREFS.sort;
    const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, max) : null);
    return { view: raw.view === "grid" ? "grid" : "list", hidden: raw.hidden === true, preview: raw.preview !== false, sort,
      location: typeof raw.location === "string" && raw.location ? raw.location : null,
      favorites: strings(raw.favorites, MAX_FAVORITES), expanded: strings(raw.expanded, MAX_EXPANDED) ?? DEFAULT_PREFS.expanded, columns: columnsOf(raw.columns) };
  } catch { return DEFAULT_PREFS; }
}

type State = Prefs & {
  history: Location[]; index: number; selected: string | null; clipboard: Clipboard | null;
  go: (location: Location, select?: string | null) => void; back: () => void; forward: () => void; settle: (path: string) => void;
  select: (path: string | null) => void; setView: (view: View) => void; toggleHidden: () => void; togglePreview: () => void; sortBy: (key: SortKey) => void;
  setClipboard: (clipboard: Clipboard | null) => void;
  /** current는 지금 보이는 즐겨찾기(기본값이면 사용자 폴더 목록). 처음 고칠 때 기본값을 실제 목록으로 굳힌다. */
  addFavorite: (path: string, current: string[]) => void; removeFavorite: (path: string, current: string[]) => void;
  moveFavorite: (path: string, delta: number, current: string[]) => void; resetFavorites: () => void;
  setExpanded: (key: string, open: boolean) => void; expandAll: (keys: string[]) => void; collapseAll: () => void;
  /** 끈 열 너비를 저장한다. 빈 값이면 모든 열이 기본 너비로 돌아간다. */
  setColumns: (columns: ColumnWidths) => void;
};

const save = (state: Prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ view: state.view, hidden: state.hidden, preview: state.preview, sort: state.sort, location: state.location,
      favorites: state.favorites, expanded: state.expanded, columns: state.columns }));
  }
  catch { /* 저장 공간이 없어도 창은 동작한다. */ }
};

/** 창 안의 탐색 이력과 보기 설정. 보기 설정과 마지막 위치는 다음에 열 때 그대로 쓴다. */
export const useFiles = create<State>((set, get) => {
  const prefs = loadPrefs();
  const update = (patch: Partial<State>) => { set(patch); save(get()); };
  return {
    ...prefs, history: [prefs.location], index: 0, selected: null, clipboard: null,
    setClipboard: (clipboard) => set({ clipboard }),
    go: (location, select = null) => {
      const { history, index } = get();
      if (history[index] === location) { set({ selected: select }); return; }
      const next = [...history.slice(0, index + 1), location].slice(-MAX_HISTORY);
      update({ history: next, index: next.length - 1, location, selected: select });
    },
    back: () => {
      const { history, index } = get();
      if (index > 0) update({ index: index - 1, location: history[index - 1], selected: history[index] });
    },
    forward: () => {
      const { history, index } = get();
      if (index < history.length - 1) update({ index: index + 1, location: history[index + 1], selected: null });
    },
    // 사용자가 친 경로(c:/users 같은 꼴)를 서버가 정리한 경로로 바꿔 끼운다. 이력은 늘지 않는다.
    settle: (path) => {
      const { history, index } = get();
      if (history[index] === path) return;
      update({ history: history.map((entry, at) => (at === index ? path : entry)), location: path });
    },
    select: (selected) => set({ selected }),
    setView: (view) => update({ view }),
    toggleHidden: () => update({ hidden: !get().hidden }),
    togglePreview: () => update({ preview: !get().preview }),
    sortBy: (key) => { const { sort } = get(); update({ sort: { key, desc: sort.key === key ? !sort.desc : key === "modified" || key === "size" } }); },
    addFavorite: (path, current) => { if (!current.includes(path)) update({ favorites: [...current, path].slice(0, MAX_FAVORITES) }); },
    removeFavorite: (path, current) => update({ favorites: current.filter((item) => item !== path) }),
    moveFavorite: (path, delta, current) => {
      const from = current.indexOf(path);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return;
      const next = [...current];
      next.splice(to, 0, ...next.splice(from, 1));
      update({ favorites: next });
    },
    resetFavorites: () => update({ favorites: null }),
    setColumns: (columns) => update({ columns: columnsOf(columns) }),
    setExpanded: (key, open) => {
      const { expanded } = get();
      if (open === expanded.includes(key)) return;
      update({ expanded: open ? [...expanded, key].slice(-MAX_EXPANDED) : expanded.filter((item) => item !== key) });
    },
    expandAll: (keys) => {
      const { expanded } = get();
      const missing = keys.filter((key) => !expanded.includes(key));
      if (missing.length) update({ expanded: [...expanded, ...missing].slice(-MAX_EXPANDED) });
    },
    collapseAll: () => update({ expanded: [] }),
  };
});

export const listUrl = (target: string) => `/api/v1/files?path=${encodeURIComponent(target)}`;
export const contentUrl = (target: string, download = false) => `/api/v1/files/content?path=${encodeURIComponent(target)}${download ? "&download=1" : ""}`;

/** 파일 API를 부른다. 실패하면 서버가 준 한국어 문구를 그대로 오류로 올린다. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { signal, cache: "no-store" }); }
  catch (error) {
    if (error instanceof TypeError) throw new Error("Relay 서버에 연결할 수 없습니다.", { cause: error });
    throw error;
  }
  const data = await response.json() as { schemaVersion?: number; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data as T;
}

/** 운영체제의 탐색기로 보이거나 기본 앱으로 연다. 실행 파일은 서버가 열지 않고 선택만 한다. */
export async function openOnSystem(target: string, action: "open" | "reveal"): Promise<"open" | "reveal"> {
  const response = await fetch("/api/v1/files/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: target, action }) });
  const data = await response.json() as { action?: "open" | "reveal"; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data.action ?? action;
}

export type Preview = "image" | "video" | "audio" | "text" | "pdf" | null;
export type FileType = { label: string; icon: LucideIcon; tone: string; preview: Preview };
/** 두 번 누르면 뷰어 창에서 여는 종류. 글·소스 코드는 모두 `text`이고, 그 밖의 파일은 기본 앱으로 연다. */
export type ViewerKind = "image" | "text";
export const viewerKind = (entry: Pick<FileEntry, "name" | "kind">): ViewerKind | null => {
  if (entry.kind === "directory") return null;
  const ext = extensionOf(entry.name);
  if (IMAGE_EXT.has(ext)) return "image";
  return TEXT_EXT.has(ext) || BARE_TEXT_NAMES.has(entry.name.toLowerCase()) ? "text" : null;
};

/** 확장자 없이 이름으로 알아보는 글 파일. */
const BARE_TEXT_NAMES = new Set(["dockerfile", "makefile", "license", "readme", "changelog", "authors", "contributors", "notice", "procfile", "vagrantfile", "gemfile", "rakefile", "jenkinsfile", "cmakelists.txt"]);
/** 확장자(또는 이름) → highlight.js 언어와 사람이 읽을 이름. 없으면 색 없이 보인다. */
const LANGUAGES: Record<string, [language: string, label: string]> = {
  js: ["javascript", "JavaScript"], mjs: ["javascript", "JavaScript"], cjs: ["javascript", "JavaScript"], jsx: ["javascript", "JavaScript (JSX)"],
  ts: ["typescript", "TypeScript"], tsx: ["typescript", "TypeScript (TSX)"], json: ["json", "JSON"], jsonc: ["json", "JSON"], json5: ["json", "JSON5"],
  xml: ["xml", "XML"], html: ["xml", "HTML"], htm: ["xml", "HTML"], vue: ["xml", "Vue"], svelte: ["xml", "Svelte"], svg: ["xml", "SVG"],
  css: ["css", "CSS"], scss: ["scss", "SCSS"], less: ["less", "Less"],
  py: ["python", "Python"], rb: ["ruby", "Ruby"], go: ["go", "Go"], rs: ["rust", "Rust"], java: ["java", "Java"], kt: ["kotlin", "Kotlin"], kts: ["kotlin", "Kotlin"],
  c: ["c", "C"], h: ["c", "C"], cc: ["cpp", "C++"], cpp: ["cpp", "C++"], hpp: ["cpp", "C++"], cs: ["csharp", "C#"], swift: ["swift", "Swift"], php: ["php", "PHP"],
  sh: ["bash", "셸 스크립트"], bash: ["bash", "Bash"], zsh: ["bash", "Zsh"], env: ["bash", "환경 변수"], ps1: ["powershell", "PowerShell"], psm1: ["powershell", "PowerShell"],
  bat: ["dos", "배치 파일"], cmd: ["dos", "배치 파일"], sql: ["sql", "SQL"], lua: ["lua", "Lua"], r: ["r", "R"], pl: ["perl", "Perl"], dart: ["dart", "Dart"], gradle: ["gradle", "Gradle"],
  yml: ["yaml", "YAML"], yaml: ["yaml", "YAML"], toml: ["ini", "TOML"], ini: ["ini", "INI"], cfg: ["ini", "설정 파일"], conf: ["ini", "설정 파일"], properties: ["properties", "Properties"],
  editorconfig: ["ini", "EditorConfig"], gitignore: ["plaintext", "Git 무시 목록"], gitattributes: ["plaintext", "Git 속성"], md: ["markdown", "Markdown"], markdown: ["markdown", "Markdown"],
  tex: ["latex", "LaTeX"], diff: ["diff", "Diff"], patch: ["diff", "Patch"], dockerfile: ["dockerfile", "Dockerfile"], makefile: ["makefile", "Makefile"],
};
export type CodeLanguage = { language: string; label: string };
/** 파일 이름으로 구문 강조 언어를 고른다. 모르는 글 파일(txt·log·csv 등)은 null이다. */
export function codeLanguage(name: string): CodeLanguage | null {
  const lower = name.toLowerCase();
  const found = LANGUAGES[extensionOf(name)] ?? LANGUAGES[lower] ?? (lower.startsWith("dockerfile") ? LANGUAGES.dockerfile : lower === "cmakelists.txt" ? ["makefile", "CMake"] : null);
  return found ? { language: found[0], label: found[1] } : null;
}

const TEXT = "txt md markdown log csv tsv json jsonc json5 yml yaml toml ini cfg conf env gitignore gitattributes editorconfig xml svg html htm css scss less js mjs cjs jsx ts tsx vue svelte py rb go rs java kt kts c h cc cpp hpp cs swift php sh bash zsh ps1 psm1 bat cmd sql lua r pl dart gradle properties lock tex srt vtt diff patch";
const CODE = "json jsonc json5 yml yaml toml xml html htm css scss less js mjs cjs jsx ts tsx vue svelte py rb go rs java kt kts c h cc cpp hpp cs swift php lua r pl dart gradle sql";
const TERMINAL = "sh bash zsh ps1 psm1 bat cmd exe msi com";
const TEXT_EXT = new Set(TEXT.split(" "));
const CODE_EXT = new Set(CODE.split(" "));
const TERMINAL_EXT = new Set(TERMINAL.split(" "));
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "webm", "ogv", "mov"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"]);
const ARCHIVE_EXT = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "cab"]);
const SHEET_EXT = new Set(["xls", "xlsx", "xlsm", "ods", "numbers", "cell"]);
const SLIDE_EXT = new Set(["ppt", "pptx", "odp", "key", "show"]);
const DOC_EXT = new Set(["doc", "docx", "odt", "rtf", "pdf", "hwp", "hwpx", "pages"]);
const NAMES: Record<string, string> = {
  txt: "텍스트 문서", md: "Markdown 문서", log: "로그 파일", csv: "CSV 파일", json: "JSON 파일", pdf: "PDF 문서", hwp: "한글 문서", hwpx: "한글 문서",
  doc: "Word 문서", docx: "Word 문서", xls: "Excel 워크시트", xlsx: "Excel 워크시트", ppt: "PowerPoint 프레젠테이션", pptx: "PowerPoint 프레젠테이션",
  exe: "응용 프로그램", msi: "Windows Installer 패키지", lnk: "바로 가기", url: "인터넷 바로 가기", zip: "압축(ZIP) 파일", "7z": "7-Zip 압축 파일",
  png: "PNG 이미지", jpg: "JPEG 이미지", jpeg: "JPEG 이미지", gif: "GIF 이미지", webp: "WebP 이미지", svg: "SVG 이미지", mp4: "MP4 동영상", mov: "QuickTime 동영상",
  mp3: "MP3 오디오", wav: "WAV 오디오", html: "HTML 문서", htm: "HTML 문서", ts: "TypeScript 파일", tsx: "TypeScript 파일", js: "JavaScript 파일", py: "Python 파일",
  ps1: "PowerShell 스크립트", bat: "배치 파일", cmd: "Windows 명령 스크립트", dll: "응용 프로그램 확장", ini: "구성 설정",
};

export const extensionOf = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""; };

/** 종류 이름·아이콘·미리 보기 방식. Windows 탐색기의 `종류` 열과 비슷한 이름을 쓴다. */
export function fileType(entry: Pick<FileEntry, "name" | "kind">): FileType {
  if (entry.kind === "directory") return { label: "파일 폴더", icon: Folder, tone: "folder", preview: null };
  const ext = extensionOf(entry.name);
  const label = NAMES[ext] ?? (ext ? `${ext.toUpperCase()} 파일` : "파일");
  if (IMAGE_EXT.has(ext)) return { label: NAMES[ext] ?? `${ext.toUpperCase()} 이미지`, icon: FileImage, tone: "image", preview: "image" };
  if (VIDEO_EXT.has(ext)) return { label: NAMES[ext] ?? `${ext.toUpperCase()} 동영상`, icon: FileVideo, tone: "video", preview: ext === "mov" ? null : "video" };
  if (AUDIO_EXT.has(ext)) return { label: NAMES[ext] ?? `${ext.toUpperCase()} 오디오`, icon: FileAudio, tone: "audio", preview: "audio" };
  if (ARCHIVE_EXT.has(ext)) return { label, icon: FileArchive, tone: "archive", preview: null };
  if (SHEET_EXT.has(ext)) return { label, icon: FileSpreadsheet, tone: "sheet", preview: null };
  if (SLIDE_EXT.has(ext)) return { label, icon: Presentation, tone: "slide", preview: null };
  if (DOC_EXT.has(ext)) return { label, icon: FileText, tone: "doc", preview: ext === "pdf" ? "pdf" : null };
  if (TERMINAL_EXT.has(ext)) return { label, icon: FileTerminal, tone: "code", preview: TEXT_EXT.has(ext) ? "text" : null };
  if (CODE_EXT.has(ext)) return { label, icon: FileCode, tone: "code", preview: "text" };
  if (TEXT_EXT.has(ext)) return { label, icon: FileText, tone: "text", preview: "text" };
  if (BARE_TEXT_NAMES.has(entry.name.toLowerCase())) return { label: codeLanguage(entry.name)?.label ?? "텍스트 문서", icon: codeLanguage(entry.name) ? FileCode : FileText, tone: codeLanguage(entry.name) ? "code" : "text", preview: "text" };
  return { label, icon: File, tone: "plain", preview: null };
}

const UNITS = ["KB", "MB", "GB", "TB"];
/** Windows 탐색기처럼 1024 단위. 10 미만은 소수 한 자리. */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} 바이트`;
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value).toLocaleString("ko-KR")} ${UNITS[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "");

const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
/** 폴더가 늘 먼저이고, 같은 종류끼리 고른 열로 정렬한다. 같으면 이름 순. */
export function sortEntries(entries: FileEntry[], sort: Sort): FileEntry[] {
  const sign = sort.desc ? -1 : 1;
  const compare = (a: FileEntry, b: FileEntry) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    let order = 0;
    if (sort.key === "modified") order = (a.modified ?? "").localeCompare(b.modified ?? "");
    else if (sort.key === "size") order = (a.size ?? -1) - (b.size ?? -1);
    else if (sort.key === "kind") order = collator.compare(fileType(a).label, fileType(b).label);
    return order * sign || collator.compare(a.name, b.name) * (sort.key === "name" ? sign : 1);
  };
  return [...entries].sort(compare);
}

/** 미리 보기 글은 앞 256KB만 읽는다. NUL이 있으면 이진 파일로 보고, UTF-8이 아니면 한국어 Windows의 기본 인코딩(CP949)으로 읽는다. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;
export const decodeText = (bytes: Uint8Array): string | null => decodeTextAs(bytes)?.text ?? null;

/** 읽은 글의 인코딩. 뷰어가 고친 글을 같은 인코딩(BOM 포함)으로 다시 쓴다. */
export type TextEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "euc-kr";
export const ENCODING_LABELS: Record<TextEncoding, string> = { "utf-8": "UTF-8", "utf-8-bom": "UTF-8 BOM", "utf-16le": "UTF-16 LE", "euc-kr": "CP949" };
/** exact가 false면 깨진 글자를 바꿔 읽었거나 끝을 잘라 읽은 것이라, 그대로 저장하면 원래 바이트를 잃는다. */
export type DecodedText = { text: string; encoding: TextEncoding; exact: boolean };
export function decodeTextAs(bytes: Uint8Array): DecodedText | null {
  const sample = bytes.subarray(0, 8192);
  const utf16 = sample[0] === 0xff && sample[1] === 0xfe;
  if (!utf16 && sample.includes(0)) return null;
  if (utf16) { const text = new TextDecoder("utf-16le").decode(bytes); return { text, encoding: "utf-16le", exact: bytes.length % 2 === 0 && !text.includes("�") }; }
  const encoding = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8-bom" : "utf-8";
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding, exact: true }; }
  catch {
    // 잘린 끝의 반쪽 글자 때문일 수 있으니 끝 3바이트를 빼고 다시 본다.
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.max(0, bytes.length - 3))), encoding, exact: false }; }
    catch { const text = new TextDecoder("euc-kr").decode(bytes); return { text, encoding: "euc-kr", exact: !text.includes("�") }; }
  }
}

let cp949: Map<string, number> | null = null;
/** CP949 두 바이트 글자의 역표. 브라우저에는 euc-kr 인코더가 없으니 디코더로 처음 한 번 만든다. */
function cp949Table() {
  if (cp949) return cp949;
  const table = new Map<string, number>();
  const decoder = new TextDecoder("euc-kr");
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x41; trail <= 0xfe; trail += 1) {
      pair[0] = lead; pair[1] = trail;
      const char = decoder.decode(pair);
      if (char.length === 1 && char !== "�" && !table.has(char)) table.set(char, (lead << 8) | trail);
    }
  }
  return (cp949 = table);
}

/** 글을 encoding의 바이트로 바꾼다. CP949로 나타낼 수 없는 글자가 있으면 그 글자를 던진다. */
export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (encoding === "utf-8-bom") { const body = new TextEncoder().encode(text); const bytes = new Uint8Array(body.length + 3); bytes.set([0xef, 0xbb, 0xbf]); bytes.set(body, 3); return bytes; }
  if (encoding === "utf-16le") {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff; bytes[1] = 0xfe;
    for (let at = 0; at < text.length; at += 1) { const unit = text.charCodeAt(at); bytes[2 + at * 2] = unit & 0xff; bytes[3 + at * 2] = unit >> 8; }
    return bytes;
  }
  const table = cp949Table();
  const out: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x80) { out.push(code); continue; }
    const pair = table.get(char);
    if (pair === undefined) throw new UnencodableError(char);
    out.push(pair >> 8, pair & 0xff);
  }
  return Uint8Array.from(out);
}
export class UnencodableError extends Error {
  constructor(public char: string) { super(`‘${char}’은(는) CP949로 저장할 수 없는 글자입니다.`); }
}

export async function readTextPreview(target: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(contentUrl(target), { signal, headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` }, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "이 파일을 읽을 권한이 없습니다." : "파일을 읽지 못했습니다.");
  return decodeText(new Uint8Array(await response.arrayBuffer()));
}

/** 뷰어 창은 글을 앞 8MB까지 읽는다. 더 큰 파일은 거기까지만 보이고 truncated로 알린다. */
export const TEXT_VIEWER_BYTES = 8 * 1024 * 1024;
/** decoded가 null이면 이진 파일이다. modified는 읽은 순간의 수정 시각이라 저장할 때 그 사이 바뀌었는지 보는 데 쓴다. */
export async function readTextFile(target: string, signal: AbortSignal): Promise<{ decoded: DecodedText | null; truncated: boolean; modified: string | null }> {
  const response = await fetch(contentUrl(target), { signal, headers: { Range: `bytes=0-${TEXT_VIEWER_BYTES - 1}` }, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "이 파일을 읽을 권한이 없습니다." : response.status === 404 ? "파일이 없습니다." : "파일을 읽지 못했습니다.");
  const total = Number(/\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "")?.[1] ?? "0");
  return { decoded: decodeTextAs(new Uint8Array(await response.arrayBuffer())), truncated: total > TEXT_VIEWER_BYTES, modified: response.headers.get("X-File-Modified") };
}

/** 저장 실패. code가 FILE_CHANGED면 연 뒤에 다른 곳에서 파일이 바뀐 것이다. */
export class SaveError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
/** 뷰어에서 고친 글을 그 파일에 쓴다. modified가 null이면 그 사이 바뀌었어도 덮어쓴다. */
export async function saveTextFile(target: string, bytes: Uint8Array, modified: string | null): Promise<SaveResult> {
  let response: Response;
  try { response = await fetch("/api/v1/files/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: target, data: toBase64(bytes), modified }) }); }
  catch { throw new SaveError("Relay 서버에 연결할 수 없습니다.", "NETWORK"); }
  const data = await response.json().catch(() => null) as (SaveResult & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !data) throw new SaveError(data?.error?.message ?? `저장하지 못했습니다(HTTP ${response.status}).`, data?.error?.code ?? "HTTP");
  return data;
}

/** PDF 미리 보기가 첫 쪽을 그리는 상한. 더 큰 파일은 아이콘만 보인다. */
export const PDF_PREVIEW_BYTES = 64 * 1024 * 1024;
export async function readBytes(target: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(contentUrl(target), { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "이 파일을 읽을 권한이 없습니다." : "파일을 읽지 못했습니다.");
  return new Uint8Array(await response.arrayBuffer());
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (error) {
    if (error instanceof TypeError) throw new Error("Relay 서버에 연결할 수 없습니다.", { cause: error });
    throw error;
  }
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}
export const statPath = (target: string, signal?: AbortSignal) => getJson<FileInfo>(`/api/v1/files/stat?path=${encodeURIComponent(target)}`, signal);
/** 클립보드의 항목을 destination 폴더에 붙여 넣는다. 서버는 덮어쓰지 않고, 항목마다 성공·실패를 돌려준다. */
export const pasteItems = (sources: string[], destination: string, mode: PasteMode) => postJson<PasteResult>("/api/v1/files/paste", { sources, destination, mode });
/** Windows는 휴지통으로 옮기고(recycled), 그 밖에는 바로 지운다. */
export const deleteItems = (paths: string[]) => postJson<DeleteResult>("/api/v1/files/delete", { paths });

/** 경로 글자만으로 찾은 상위 폴더. 드라이브 루트(C:\)나 /의 상위는 null(`이 PC`)이다. */
export function parentOf(target: string): string | null {
  const trimmed = target.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (cut < 0 || !trimmed) return null;
  const parent = trimmed.slice(0, cut);
  if (/^[a-z]:$/i.test(parent)) return `${parent}\\`;
  return parent || "/";
}

/** 사이드바·`이 PC`에 쓰는 드라이브 이름. `로컬 디스크 (C:)`처럼 Windows 탐색기와 같은 꼴. */
export const driveName = (drive: Drive) => (drive.path === "/" ? "시스템 디스크" : `${drive.label} (${drive.path.replace(/\\$/, "")})`);
