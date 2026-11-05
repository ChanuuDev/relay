import { RelayError } from "./errors.js";

/** 폴더와 메모(본문은 Markdown)가 parentId로 트리를 이룬다. null은 최상위다.
 *  position은 형제 사이에서 사용자가 끌어 정한 순서(작을수록 위)다. null이면 순서를 정한 항목 뒤에 폴더 먼저·이름 순으로 놓인다. */
export type NoteItem =
  | { id: string; kind: "folder"; parentId: string | null; name: string; position: number | null; createdAt: number; updatedAt: number }
  | { id: string; kind: "note"; parentId: string | null; title: string; body: string; position: number | null; createdAt: number; updatedAt: number };
export type NoteBatch = { upserts: NoteItem[]; deletes: string[] };
/** 다른 환경으로 옮기는 파일. format은 Relay 메모 파일인지 알아보는 표지다. */
export type NoteExport = { format: typeof EXPORT_FORMAT; schemaVersion: 1; exportedAt: string; items: NoteItem[] };
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

/** 가져오기 병합 규칙: 없으면 넣고, 있으면 가져온 쪽이 더 최근에 고쳤을 때만 바꾸며, 종류가 다르거나 같으면 둔다. */
export function mergeDecision(existing: NoteItem | null, incoming: NoteItem): "add" | "update" | "keep" {
  if (!existing) return "add";
  const same = existing.kind === incoming.kind && existing.parentId === incoming.parentId && existing.position === incoming.position
    && (incoming.kind === "folder" ? (existing as { name: string }).name === incoming.name
      : (existing as { title: string }).title === incoming.title && (existing as { body: string }).body === incoming.body);
  if (existing.kind !== incoming.kind || same || incoming.updatedAt <= existing.updatedAt) return "keep";
  return "update";
}
