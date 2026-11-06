import { RelayError } from "./errors.js";

/** 폴더와 메모(본문은 Markdown)가 parentId로 트리를 이룬다. null은 최상위다.
 *  position은 형제 사이에서 사용자가 끌어 정한 순서(작을수록 위)다. null이면 순서를 정한 항목 뒤에 폴더 먼저·이름 순으로 놓인다. */
export type NoteItem =
  | { id: string; kind: "folder"; parentId: string | null; name: string; position: number | null; createdAt: number; updatedAt: number }
  | { id: string; kind: "note"; parentId: string | null; title: string; body: string; position: number | null; createdAt: number; updatedAt: number };
export type NoteBatch = { upserts: NoteItem[]; deletes: string[] };
/** 다른 환경으로 옮기는 파일. format은 Relay 메모 파일인지 알아보는 표지다. images는 메모가 가리키는 그림이며, 그림이 없으면 키를 넣지 않는다. */
export type NoteExport = { format: typeof EXPORT_FORMAT; schemaVersion: 1; exportedAt: string; items: NoteItem[]; images?: NoteImageExport[] };
/** 가져오기 결과. kept는 같거나 이 환경 쪽이 더 최근이라 그대로 둔 항목 수다. */
export type NoteImportResult = { schemaVersion: 1; revision: number; added: number; updated: number; kept: number };
export type NoteList = { schemaVersion: 1; revision: number; items: NoteItem[] };
export type NoteApplied = { schemaVersion: 1; revision: number };

export const MAX_NAME = 200;
export const MAX_BODY = 200_000;
export const EXPORT_FORMAT = "relay-notes";
/** 한 번에 받는 항목 수. 브라우저는 고친 항목만 모아 보내므로 넉넉하다. */
export const MAX_NOTE_BATCH = 5000;
/** 가져오기 한 번에 받는 항목 수. 내보낸 파일 하나를 통째로 받는다. */
export const MAX_NOTE_IMPORT = 50_000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

const time = (value: unknown, fallback: number) =>
  (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
const str = (value: unknown, max: number, field: string) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RelayError("INVALID_ARGUMENT", `${field}은(는) 문자열이어야 합니다.`);
  if (value.length > max) throw new RelayError("INVALID_ARGUMENT", `${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};
const position = (value: unknown, field: string) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RelayError("INVALID_ARGUMENT", `${field}은(는) 숫자나 null이어야 합니다.`);
  return value;
};
export const noteId = (value: unknown, field: string) => {
  if (typeof value !== "string" || !ID.test(value)) throw new RelayError("INVALID_ARGUMENT", `${field}이(가) 올바르지 않습니다.`);
  return value;
};

/** 브라우저가 보낸 저장 묶음을 검사해 모양을 고정한다. 틀리면 아무것도 쓰지 않고 거부한다. */
export function parseBatch(raw: unknown, now = Date.now()): NoteBatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RelayError("INVALID_ARGUMENT", "저장 묶음은 객체여야 합니다.");
  const { upserts = [], deletes = [] } = raw as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) throw new RelayError("INVALID_ARGUMENT", "upserts와 deletes는 배열이어야 합니다.");
  if (upserts.length + deletes.length > MAX_NOTE_BATCH) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_NOTE_BATCH}개까지 저장합니다.`);
  const items = upserts.map((value, index) => parseNoteItem(value, `upserts[${index}]`, now));
  return { upserts: items, deletes: deletes.map((value, index) => noteId(value, `deletes[${index}]`)) };
}

/** 항목 하나의 모양을 고정한다. field는 오류에 보일 위치다. */
export function parseNoteItem(value: unknown, field: string, now: number): NoteItem {
  if (!value || typeof value !== "object") throw new RelayError("INVALID_ARGUMENT", `${field}는 객체여야 합니다.`);
  const entry = value as Record<string, unknown>;
  const itemId = noteId(entry.id, `${field}.id`);
  const parentId = entry.parentId === null || entry.parentId === undefined ? null : noteId(entry.parentId, `${field}.parentId`);
  if (parentId === itemId) throw new RelayError("INVALID_ARGUMENT", "항목을 제 안에 넣을 수 없습니다.");
  const createdAt = time(entry.createdAt, now);
  const updatedAt = time(entry.updatedAt, now);
  const order = position(entry.position, `${field}.position`);
  if (entry.kind === "folder") return { id: itemId, kind: "folder", parentId, name: str(entry.name, MAX_NAME, "폴더 이름").trim() || "새 폴더", position: order, createdAt, updatedAt };
  if (entry.kind === "note") return { id: itemId, kind: "note", parentId, title: str(entry.title, MAX_NAME, "제목"), body: str(entry.body, MAX_BODY, "본문"), position: order, createdAt, updatedAt };
  throw new RelayError("INVALID_ARGUMENT", `${field}.kind는 folder 또는 note여야 합니다.`);
}

const pad = (value: number) => String(value).padStart(2, "0");
/** 내보낼 파일 이름. 이 컴퓨터의 날짜를 붙인다. */
export const exportFileName = (date = new Date()) => `relay-notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;

/** 내보낸 파일을 검사한다. 표지·판이 다르거나 항목 하나라도 틀리면 아무것도 쓰지 않고 거부한다. 같은 id가 거듭 나오면 마지막 것을 쓴다. */
export function parseExport(raw: unknown, now = Date.now()): NoteItem[] {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { format?: unknown; schemaVersion?: unknown; items?: unknown } : null;
  if (data?.format !== EXPORT_FORMAT) throw new RelayError("INVALID_ARGUMENT", "Relay에서 내보낸 메모 파일이 아닙니다.");
  if (data.schemaVersion !== 1) throw new RelayError("INVALID_ARGUMENT", "지원하지 않는 메모 파일 판입니다. Relay를 새 버전으로 바꿔 주세요.");
  if (!Array.isArray(data.items)) throw new RelayError("INVALID_ARGUMENT", "items는 배열이어야 합니다.");
  if (data.items.length > MAX_NOTE_IMPORT) throw new RelayError("INVALID_ARGUMENT", `한 번에 ${MAX_NOTE_IMPORT}개까지 가져옵니다.`);
  const items = new Map<string, NoteItem>();
  data.items.forEach((value, index) => { const item = parseNoteItem(value, `items[${index}]`, now); items.set(item.id, item); });
  return [...items.values()];
}

// ── 메모 그림 ─────────────────────────────────────────────
// 그림은 본문과 따로 저장하고 본문에는 `![](/api/v1/notes/images/<id>)`만 남긴다. id는 내용의 sha256(16진수 64자)이라
// 같은 그림은 한 번만 저장되고, 내보낸 파일을 다른 환경에 합쳐도 서로 부딪히지 않는다.

export const NOTE_IMAGES_PATH = "/api/v1/notes/images";
/** 그림 한 장의 최대 크기(원본 바이트). 4K 화면 캡처 PNG도 들어간다. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 그림 올리기 요청 본문의 상한. base64는 원본의 4/3배라 여유를 둔다. */
export const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024;
export const IMAGE_ID = /^[0-9a-f]{64}$/;
const IMAGE_REF = /\/api\/v1\/notes\/images\/([0-9a-f]{64})(?![0-9a-f])/g;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const noteImageUrl = (id: string) => `${NOTE_IMAGES_PATH}/${id}`;
/** 올린 그림의 응답. url을 본문에 그대로 넣는다. */
export type NoteImage = { schemaVersion: 1; id: string; type: NoteImageType; size: number; url: string };
/** 내보낸 파일에 담는 그림. data는 base64다. */
export type NoteImageExport = { id: string; type: NoteImageType; data: string };
export type NoteImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";

/** 본문이 가리키는 그림 id(겹치지 않게). */
export function imageIdsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(IMAGE_REF)) ids.add(match[1]!);
  return [...ids];
}

/** 파일 머리의 서명으로 그림 형식을 알아낸다. 화면이 보낸 형식은 믿지 않으며, SVG처럼 스크립트를 담을 수 있는 형식은 받지 않는다. */
export function imageTypeOf(bytes: Uint8Array): NoteImageType | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  const text = (offset: number, value: string) => at(offset, ...[...value].map((char) => char.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (text(0, "GIF87a") || text(0, "GIF89a")) return "image/gif";
  if (text(0, "RIFF") && text(8, "WEBP")) return "image/webp";
  if (text(4, "ftyp") && (text(8, "avif") || text(8, "avis"))) return "image/avif";
  return null;
}

/** 그림 한 장을 검사한다. 비었거나 크거나 받지 않는 형식이면 거부한다. */
export function checkImage(bytes: Uint8Array): NoteImageType {
  if (!bytes.length) throw new RelayError("INVALID_ARGUMENT", "그림이 비어 있습니다.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", `그림은 ${MAX_IMAGE_BYTES / 1024 / 1024}MB까지 넣을 수 있습니다.`, 2, 413);
  const type = imageTypeOf(bytes);
  if (!type) throw new RelayError("UNSUPPORTED_MEDIA_TYPE", "PNG·JPEG·GIF·WebP·AVIF 그림만 넣을 수 있습니다.", 2, 415);
  return type;
}

const base64 = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value) throw new RelayError("INVALID_ARGUMENT", `${field}는 base64 문자열이어야 합니다.`);
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new RelayError("PAYLOAD_TOO_LARGE", `그림은 ${MAX_IMAGE_BYTES / 1024 / 1024}MB까지 넣을 수 있습니다.`, 2, 413);
  if (value.length % 4 !== 0 || !BASE64.test(value)) throw new RelayError("INVALID_ARGUMENT", `${field}가 올바른 base64가 아닙니다.`);
  return value;
};

/** 그림 올리기 본문 `{ data: base64 }`를 검사한다. 형식과 크기는 풀어 낸 바이트로 checkImage가 다시 본다. */
export function parseImageUpload(raw: unknown): { data: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RelayError("INVALID_ARGUMENT", "그림 올리기 본문은 객체여야 합니다.");
  const keys = Object.keys(raw);
  if (keys.some((key) => key !== "data")) throw new RelayError("INVALID_ARGUMENT", "그림 올리기 본문은 data만 받습니다.");
  return { data: base64((raw as { data?: unknown }).data, "data") };
}

/** 내보낸 파일의 그림 목록(없어도 된다). id·data 모양만 보고, 내용이 id와 맞는지는 저장소가 해시로 확인한다. */
export function parseExportImages(raw: unknown): Array<{ id: string; data: string }> {
  const images = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { images?: unknown }).images : undefined;
  if (images === undefined) return [];
  if (!Array.isArray(images)) throw new RelayError("INVALID_ARGUMENT", "images는 배열이어야 합니다.");
  if (images.length > MAX_NOTE_IMPORT) throw new RelayError("INVALID_ARGUMENT", `한 번에 그림 ${MAX_NOTE_IMPORT}장까지 가져옵니다.`);
  return images.map((value, index) => {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : null;
    if (!entry || typeof entry.id !== "string" || !IMAGE_ID.test(entry.id)) throw new RelayError("INVALID_ARGUMENT", `images[${index}].id가 올바르지 않습니다.`);
    return { id: entry.id, data: base64(entry.data, `images[${index}].data`) };
  });
}

// ── 이름과 AI 에이전트 참조 ───────────────────────────────
// 메모 앱 트리, `relay memo` CLI, 클립보드 문구가 같은 이름 규칙을 쓴다.

/** 글로 보이지 않는 줄: 코드 울타리, 구분선, 표 구분 줄. */
const SKIP_LINE = /^\s*(?:`{3,}|~{3,}|(?:[-*_]\s*){3,}$|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$)/;
/** Markdown 한 줄에서 문법 기호를 걷어 낸 글. 트리 이름과 카드 미리 보기에 쓴다. */
export function plainLine(line: string) {
  if (SKIP_LINE.test(line)) return "";
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|(?:>\s?)+)/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_]*?\S)[*_](?=$|[^\w*])/g, "$1$2")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}
/** 본문 전체를 나누지 않고 글이 있는 첫 줄만 찾는다(긴 메모에서 입력마다 부른다). */
export function firstLine(text: string) {
  for (let start = 0; start < text.length;) {
    const end = text.indexOf("\n", start);
    const line = plainLine(text.slice(start, end === -1 ? undefined : end));
    if (line) return line;
    if (end === -1) break;
    start = end + 1;
  }
  return "";
}
/** 트리와 카드에 보일 이름. 메모는 제목이 없으면 본문 첫 줄을 쓴다. */
export const labelOf = (item: { kind: "folder"; name: string } | { kind: "note"; title: string; body: string }) =>
  (item.kind === "folder" ? item.name : item.title.trim() || firstLine(item.body).slice(0, 80) || "새 메모");

/** 메모 앱이 「메모 ID 복사」로 클립보드에 넣는 한 줄. AI 에이전트는 이 ID로 `relay memo --find <ID>`를 부른다. */
export const memoReference = (item: { id: string; kind: "folder" | "note" }) =>
  (item.kind === "folder" ? `Relay 메모 폴더를 참조해 주세요. 폴더 ID: ${item.id}` : `Relay 메모를 참조해 주세요. 메모 ID: ${item.id}`);

/** 가져오기 병합 규칙: 없으면 넣고, 있으면 가져온 쪽이 더 최근에 고쳤을 때만 바꾸며, 종류가 다르거나 같으면 둔다. */
export function mergeDecision(existing: NoteItem | null, incoming: NoteItem): "add" | "update" | "keep" {
  if (!existing) return "add";
  const same = existing.kind === incoming.kind && existing.parentId === incoming.parentId && existing.position === incoming.position
    && (incoming.kind === "folder" ? (existing as { name: string }).name === incoming.name
      : (existing as { title: string }).title === incoming.title && (existing as { body: string }).body === incoming.body);
  if (existing.kind !== incoming.kind || same || incoming.updatedAt <= existing.updatedAt) return "keep";
  return "update";
}
