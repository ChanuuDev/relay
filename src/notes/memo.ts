import { labelOf, plainLine, type NoteItem } from "@relay/core";
import { RelayError } from "../errors";

// `relay memo`가 AI 에이전트에게 메모를 보여 주는 방법. 저장소에서 받은 목록 하나로 트리·찾기·검색을 모두 한다.
// 순서와 이름은 메모 앱 트리와 같다. 쓰기와 고치기는 메모 API(POST /api/v1/notes)가 맡는다.

type Note = Extract<NoteItem, { kind: "note" }>;
/** 메모가 놓인 폴더 경로(최상위부터). */
export type MemoPath = Array<{ id: string; name: string }>;
/** 목록의 한 줄. 본문은 담지 않는다. notes는 폴더 아래(하위 폴더 포함) 메모 수다. */
export type MemoRow = { id: string; kind: NoteItem["kind"]; parentId: string | null; label: string; path: MemoPath; depth: number; updatedAt: number; notes?: number };
export type MemoList = { schemaVersion: 1; revision: number; api: string; folder: { id: string; name: string; path: MemoPath } | null; notes: number; folders: number; items: MemoRow[] };
/** 찾은 항목. item은 메모 API와 같은 모양이라 고친 뒤 그대로 upserts에 넣는다. 폴더는 그 아래 항목을 트리 순서로 함께 담는다. */
export type MemoEntry = { item: NoteItem; path: MemoPath; depth: number };
export type MemoFound = { schemaVersion: 1; revision: number; api: string; item: NoteItem; path: MemoPath; items?: MemoEntry[] };
export type MemoHit = { id: string; kind: NoteItem["kind"]; label: string; path: MemoPath; updatedAt: number; lines: string[] };
export type MemoSearch = { schemaVersion: 1; revision: number; api: string; query: string; total: number; items: MemoHit[] };

const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
const IMAGE_URL = /\/api\/v1\/notes\/images\/[0-9a-f]{64}/g;
/** 찾기에 받는 ID 앞부분의 최소 길이. 이보다 짧으면 겹치기 쉽다. */
const MIN_PREFIX = 6;
const MAX_LINES = 3;
const LINE_WIDTH = 160;

/** 메모 앱 트리와 같은 순서: 끌어 정한 순서(position)가 먼저, 나머지는 폴더 먼저·이름 순(숫자는 크기 순). */
function sorted(list: NoteItem[]) {
  const labels = new Map(list.map((item) => [item.id, labelOf(item)]));
  return list.sort((a, b) => {
    if (a.position !== null || b.position !== null) {
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      if (a.position !== b.position) return a.position - b.position;
    }
    return a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : collator.compare(labels.get(a.id)!, labels.get(b.id)!) || a.createdAt - b.createdAt;
  });
}

const lower = (text: string) => text.toLocaleLowerCase("ko-KR");
/** 그림 주소는 검색하지 않는다(메모 앱 검색과 같다). */
const searchable = (text: string) => lower(text.includes("/api/v1/notes/images/") ? text.replace(IMAGE_URL, "") : text);

export class MemoIndex {
  private byId = new Map<string, NoteItem>();
  private children = new Map<string | null, NoteItem[]>();

  constructor(items: NoteItem[], private revision: number, private api: string) {
    for (const item of items) this.byId.set(item.id, item);
    for (const item of items) {
      // 부모가 없어진 항목은 메모 앱처럼 최상위에 둔다.
      const parent = item.parentId && this.byId.get(item.parentId)?.kind === "folder" ? item.parentId : null;
      const list = this.children.get(parent) ?? [];
      list.push(item);
      this.children.set(parent, list);
    }
    for (const list of this.children.values()) sorted(list);
  }

  /** 최상위부터 parentId까지의 폴더. */
  path(parentId: string | null): MemoPath {
    const path: MemoPath = [];
    const seen = new Set<string>();
    for (let id = parentId; id && !seen.has(id); id = this.byId.get(id)?.parentId ?? null) {
      seen.add(id);
      const folder = this.byId.get(id);
      if (folder?.kind !== "folder") break;
      path.unshift({ id: folder.id, name: folder.name });
    }
    return path;
  }

  /** rootId 아래 항목을 트리 순서(깊이 우선)로. rootId 자신은 넣지 않는다. */
  private walk(rootId: string | null): Array<{ item: NoteItem; depth: number }> {
    const rows: Array<{ item: NoteItem; depth: number }> = [];
    const seen = new Set<string>();
    const visit = (parentId: string | null, depth: number) => {
      for (const item of this.children.get(parentId) ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push({ item, depth });
        if (item.kind === "folder") visit(item.id, depth + 1);
      }
    };
    visit(rootId, 0);
    return rows;
  }

  private noteCount(folderId: string) { return this.walk(folderId).filter((row) => row.item.kind === "note").length; }

  /** ID 전체 또는 겹치지 않는 앞부분(6자 이상)으로 항목을 찾는다. */
  resolve(raw: string): NoteItem {
    const id = raw.trim();
    if (!id) throw new RelayError("INVALID_ARGUMENT", "찾을 메모 ID를 입력하세요.");
    const exact = this.byId.get(id);
    if (exact) return exact;
    const matches = id.length >= MIN_PREFIX ? [...this.byId.values()].filter((item) => item.id.startsWith(id)) : [];
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new RelayError("INVALID_ARGUMENT", `ID가 ${id}로 시작하는 항목이 ${matches.length}개입니다. ID를 더 길게 입력하세요.`, 2, 400,
      { matches: matches.slice(0, 10).map((item) => item.id) });
    throw new RelayError("NOTE_NOT_FOUND", `메모나 폴더를 찾을 수 없습니다: ${id}. relay memo --list로 ID를 확인하세요.`, 3, 404);
  }

  /** 폴더 트리. folderId를 주면 그 폴더 아래만. */
  list(folderId?: string): MemoList {
    const folder = folderId === undefined ? null : this.resolve(folderId);
    if (folder && folder.kind !== "folder") throw new RelayError("INVALID_ARGUMENT", `폴더 ID가 아닙니다: ${folder.id}. 메모는 relay memo --find로 읽으세요.`);
    const rows = this.walk(folder?.id ?? null);
    const items = rows.map(({ item, depth }): MemoRow => ({
      id: item.id, kind: item.kind, parentId: item.parentId, label: labelOf(item), path: this.path(item.parentId), depth, updatedAt: item.updatedAt,
      ...(item.kind === "folder" ? { notes: this.noteCount(item.id) } : {}),
    }));
    return {
      schemaVersion: 1, revision: this.revision, api: this.api,
      folder: folder ? { id: folder.id, name: labelOf(folder), path: this.path(folder.parentId) } : null,
      notes: items.filter((row) => row.kind === "note").length, folders: items.filter((row) => row.kind === "folder").length, items,
    };
  }

  /** 메모 하나, 또는 폴더와 그 아래 모든 항목(메모 본문 포함). */
  find(id: string): MemoFound {
    const item = this.resolve(id);
    const found: MemoFound = { schemaVersion: 1, revision: this.revision, api: this.api, item, path: this.path(item.parentId) };
    if (item.kind === "folder") found.items = this.walk(item.id).map(({ item: child, depth }) => ({ item: child, path: this.path(child.parentId), depth }));
    return found;
  }

  /** 폴더 이름·메모 제목·본문 검색. 띄어 쓴 낱말이 모두 들어 있어야 맞고, 맞은 줄을 몇 개 보인다. */
  search(query: string): MemoSearch {
    const terms = lower(query).split(/\s+/).filter(Boolean);
    if (!terms.length) throw new RelayError("INVALID_ARGUMENT", "검색어를 입력하세요.");
    const hits: MemoHit[] = [];
    for (const item of this.byId.values()) {
      const text = item.kind === "folder" ? item.name : `${item.title}\n${item.body}`;
      const haystack = searchable(text);
      if (!terms.every((term) => haystack.includes(term))) continue;
      hits.push({ id: item.id, kind: item.kind, label: labelOf(item), path: this.path(item.parentId), updatedAt: item.updatedAt, lines: item.kind === "note" ? matchedLines(item, terms) : [] });
    }
    hits.sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.kind === "note" ? b.updatedAt - a.updatedAt : collator.compare(a.label, b.label)));
    return { schemaVersion: 1, revision: this.revision, api: this.api, query: query.trim(), total: hits.length, items: hits };
  }
}

/** 낱말이 든 본문 줄(서식 기호를 걷고, 길면 낱말 둘레만). */
function matchedLines(note: Note, terms: string[]): string[] {
  const lines: string[] = [];
  for (const raw of note.body.split("\n")) {
    const line = plainLine(raw.replace(IMAGE_URL, ""));
    if (!line) continue;
    const lowered = lower(line);
    const at = terms.map((term) => lowered.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (at === undefined) continue;
    const start = line.length <= LINE_WIDTH ? 0 : Math.max(0, Math.min(at - 40, line.length - LINE_WIDTH));
    lines.push(`${start > 0 ? "…" : ""}${line.slice(start, start + LINE_WIDTH)}${start + LINE_WIDTH < line.length ? "…" : ""}`);
    if (lines.length === MAX_LINES) break;
  }
  return lines;
}

// ── 사람과 에이전트가 읽는 글 ───────────────────────────────

const pad = (value: number) => String(value).padStart(2, "0");
/** 이 컴퓨터 시각으로 `2026-11-06 14:05`. */
export const memoTime = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const where = (path: MemoPath) => (path.length ? path.map((folder) => folder.name).join(" › ") : "최상위");
const kindName = (kind: NoteItem["kind"]) => (kind === "folder" ? "폴더" : "메모");

export function listText(list: MemoList): string {
  const scope = list.folder ? `폴더 ‘${list.folder.name}’ (${where([...list.folder.path, { id: list.folder.id, name: list.folder.name }])})` : "Relay 메모";
  const head = `${scope} · 메모 ${list.notes}개${list.folders ? ` · 폴더 ${list.folders}개` : ""}`;
  if (!list.items.length) return `${head}\n${list.folder ? "이 폴더는 비어 있습니다." : "메모가 없습니다."}`;
  const rows = list.items.map((row) => `${"  ".repeat(row.depth)}- ${row.kind === "folder" ? `[폴더] ${row.label} (메모 ${row.notes ?? 0}개)` : `${row.label} · ${memoTime(row.updatedAt)}`} · ID: ${row.id}`);
  return [head, "", ...rows, "", "메모 읽기: relay memo --find <ID>"].join("\n");
}

function noteBlock(note: Note, path: MemoPath, level: number): string[] {
  const title = labelOf(note);
  return [`${"#".repeat(level)} ${title}`, "", `- 메모 ID: ${note.id}`, `- 위치: ${where(path)}`, `- 수정: ${memoTime(note.updatedAt)}`, "",
    note.body.replace(/\s+$/, "") || "(본문 없음)"];
}

export function findText(found: MemoFound): string {
  const { item } = found;
  // 제목이 없는 메모는 이름을 본문 첫 줄에서 빌리므로, 제목 줄을 따로 붙이면 같은 줄이 두 번 보인다.
  if (item.kind === "note") return `${noteBlock(item, found.path, 1).slice(item.title.trim() ? 0 : 2).join("\n")}\n`;
  const entries = found.items ?? [];
  const notes = entries.filter((entry): entry is MemoEntry & { item: Note } => entry.item.kind === "note");
  const folders = entries.length - notes.length;
  const lines = [`# 폴더: ${item.name}`, "", `- 폴더 ID: ${item.id}`, `- 위치: ${where(found.path)}`,
    `- 담긴 것: 메모 ${notes.length}개${folders ? ` · 하위 폴더 ${folders}개` : ""}`];
  if (!entries.length) return `${[...lines, "", "이 폴더는 비어 있습니다."].join("\n")}\n`;
  lines.push("", "## 목록", "", ...entries.map((entry) => `${"  ".repeat(entry.depth)}- ${entry.item.kind === "folder" ? `[폴더] ${labelOf(entry.item)}` : labelOf(entry.item)} · ID: ${entry.item.id}`));
  for (const entry of notes) lines.push("", "---", "", ...noteBlock(entry.item, entry.path, 2));
  return `${lines.join("\n")}\n`;
}

export function searchText(result: MemoSearch): string {
  if (!result.total) return `‘${result.query}’와 맞는 메모가 없습니다.`;
  const lines = [`‘${result.query}’ 검색 결과 ${result.total}건`, ""];
  for (const hit of result.items) {
    lines.push(`- [${kindName(hit.kind)}] ${hit.label} · ${where(hit.path)}${hit.kind === "note" ? ` · ${memoTime(hit.updatedAt)}` : ""} · ID: ${hit.id}`);
    for (const line of hit.lines) lines.push(`  > ${line}`);
  }
  lines.push("", "메모 읽기: relay memo --find <ID>");
  return lines.join("\n");
}
