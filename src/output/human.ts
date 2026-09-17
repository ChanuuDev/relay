import type { Session, SessionUpdate } from "../session/session.types";
import { projectName } from "../web/lib/format";
import { clip, dim, localTime, pad, paint, terminalWidth, width, wrap } from "./terminal";

const GAP = 2;
const PROVIDER_COLORS: Record<string, string> = { openai: "32", anthropic: "33", xai: "35" };
const providerColor = (s: Session) => Object.hasOwn(PROVIDER_COLORS, s.provider) ? PROVIDER_COLORS[s.provider]! : "36";

interface Column {
  title: string;
  value: (s: Session) => string;
  flex?: number;
  drop?: number;
  color?: (s: Session) => string;
}

// Identity columns always stay; the rest leave in `drop` order when the terminal is narrow.
// The project is the folder name only: a hook-recorded session is often named after it, so the full
// path would repeat the name column, and the detail view still shows the whole working directory.
const COLUMNS: Column[] = [
  { title: "이름", value: s => s.sessionName ?? "(이름 없음)", flex: 10, color: () => "1;36" },
  { title: "프로젝트", value: s => projectName(s.workingDirectory), drop: 4 },
  { title: "Provider/Agent", value: s => `${s.provider}/${s.agent}`, drop: 3, color: providerColor },
  { title: "Agent Session ID", value: s => s.providerSessionId, color: () => "94" },
  { title: "생성", value: s => localTime(s.createdAt), drop: 2, color: () => "90" },
  { title: "갱신", value: s => localTime(s.updatedAt), drop: 2, color: () => "90" },
  { title: "요약", value: s => s.summary, flex: 20, drop: 1 },
];

// Measure and clip plain text first; leave padding outside ANSI spans for trimEnd.
function cell(text: string, size: number, color: string) {
  const value = clip(text, size);
  return paint(value, color) + " ".repeat(Math.max(0, size - width(value)));
}

/** A rendered line and the session it belongs to, so the interactive view can point at a row. */
export interface Line { text: string; owner?: Session }
const plain = (texts: string[]): Line[] => texts.map(text => ({ text }));

function table(items: Session[], space: number): Line[] {
  const columns = [...COLUMNS];
  const natural = new Map(columns.map(c => [c, Math.max(width(c.title), ...items.map(i => width(clip(c.value(i), 200))))]));
  const least = (c: Column) => Math.min(c.flex ?? Number.MAX_SAFE_INTEGER, natural.get(c)!, 44);
  const used = () => columns.reduce((sum, c) => sum + least(c), 0) + (columns.length - 1) * GAP;
  while (used() > space && columns.some(c => c.drop)) {
    const [victim] = columns.filter(c => c.drop).sort((a, b) => a.drop! - b.drop!);
    columns.splice(columns.indexOf(victim), 1);
  }
  const size = new Map(columns.map(c => [c, least(c)]));
  let spare = Math.max(0, space - used());
  const flexible = columns.filter(c => c.flex);
  for (const [index, column] of flexible.entries()) {
    const share = index === flexible.length - 1 ? spare : Math.floor(spare * 0.4);
    const grow = Math.max(0, Math.min(share, natural.get(column)! - size.get(column)!));
    size.set(column, size.get(column)! + grow);
    spare -= grow;
  }
  const line = (cells: string[]) => cells.join(" ".repeat(GAP)).trimEnd();
  const rule = columns.reduce((sum, c) => sum + size.get(c)!, 0) + (columns.length - 1) * GAP;
  return [
    ...plain([line(columns.map(c => cell(c.title, size.get(c)!, "1;36"))), dim("-".repeat(Math.min(rule, space)))]),
    ...items.map(item => ({ owner: item, text: line(columns.map(column => cell(column.value(item), size.get(column)!, column.color?.(item) ?? ""))) })),
  ];
}

function card(session: Session, extra: [string, string][], space: number): Line[] {
  const title = clip(session.sessionName ?? "(이름 없음)", space);
  const fields: [string, string, string?][] = [
    ["Agent Session ID", session.providerSessionId, "94"],
    ["Relay 내부 ID", session.id, "90"],
    ["Provider", `${session.provider} / ${session.agent}`, providerColor(session)],
    ["Model", session.model ?? "미기록"],
    ["Project", session.workingDirectory, "94"],
    ["최초 기록", localTime(session.createdAt, true), "90"],
    ["갱신", localTime(session.updatedAt, true), "90"],
    ...extra,
  ];
  const label = Math.max(...fields.map(([name]) => width(name)));
  return [
    paint(title, "1;36"),
    dim("-".repeat(space)),
    ...fields.map(([name, value, color]) => `${dim(pad(name, label))}  ${paint(clip(value, space - label - GAP), color ?? "")}`),
    "",
    paint("요약", "1;36"),
    ...wrap(session.summary, space - 2).map(text => `  ${text}`),
  ].map(text => ({ text, owner: session }));
}

function history(session: Session, updates: SessionUpdate[], total: number, space: number): Line[] {
  return ["", paint(`기록 이력 (${total}건)`, "1;36"), ...updates.flatMap(update => [
    `  ${paint(`#${update.sequence}`, "36")} ${paint(localTime(update.createdAt), "90")}`,
    ...wrap(update.summary, space - 6).map(text => `      ${text}`),
  ])].map(text => ({ text, owner: session }));
}

const HOOK_STATUS: Record<string, string> = {
  added: "등록함", updated: "갱신함", unchanged: "이미 등록됨", skipped: "건너뜀",
};

/** Lines plus their owning session; `human` is the same output flattened for a non-interactive terminal. */

export function render(value: unknown, space = terminalWidth()): Line[] {
  const data = value as {
    session?: Session; items?: Session[]; page?: { total: number; offset: number };
    parentSession?: { providerSessionId: string }; children?: { providerSessionId: string }[];
    childrenPage?: { total: number }; updates?: SessionUpdate[]; updatesPage?: { total: number };
    scope?: { cwd: string | null }; binDirectory?: string; executable?: string;
    wrappers?: { path: string; status: string }[];
    hosts?: { host?: string; path: string; status: string; detail?: string }[];
  };
  if (data.hosts && data.binDirectory) {
    const row = (label: string, status: string, file: string, detail?: string) =>
      `${label}  ${HOOK_STATUS[status] ?? status}  ${file}${detail ? `  (${detail})` : ""}`;
    return plain([
      `실행 파일  ${data.executable ?? ""}`,
      `훅 래퍼    ${data.binDirectory}`,
      ...((data.wrappers ?? []).map(wrapper => row("래퍼", wrapper.status, wrapper.path))),
      ...(data.hosts.map(host => row(host.host ?? "host", host.status, host.path, host.detail))),
    ]);
  }
  if (data.items) {
    if (data.items.some(item => typeof item?.providerSessionId !== "string")) return plain([JSON.stringify(value, null, 2)]);
    const footer = `${paint(`총 ${data.page?.total ?? data.items.length}건`, "36")} ${dim(`· offset ${data.page?.offset ?? 0}`)}`;
    if (!data.items.length) return plain([dim("조회된 세션이 없습니다."), footer]);
    return [...table(data.items, space), ...plain([footer])];
  }
  if (data.session) {
    const children = data.children ?? [];
    return [
      ...(data.scope ? plain(wrap(`조회 범위: ${data.scope.cwd ?? "전체 프로젝트"}`, space)) : []),
      ...card(data.session, [
        ...(data.parentSession ? [["Parent", data.parentSession.providerSessionId] as [string, string]] : []),
        ...(children.length ? [[`Children`, `${data.childrenPage?.total ?? children.length}건 · ` +
          children.map(child => child.providerSessionId).join(", ")] as [string, string]] : []),
      ], space),
      ...(data.updates ? history(data.session, data.updates, data.updatesPage?.total ?? data.updates.length, space) : []),
    ];
  }
  return plain([JSON.stringify(value, null, 2)]);
}

export function human(value: unknown, space = terminalWidth()): string {
  return render(value, space).map(line => line.text).join("\n");
}
