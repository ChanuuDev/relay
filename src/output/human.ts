import type { ChainNode, Session, SessionUpdate } from "../session/session.types";
import { compactionLabel, gitLabel, projectName, statusLabel } from "../web/lib/format";
import { resumeCommand } from "../web/lib/resume-command";
import { clip, dim, localTime, pad, paint, shortTime, terminalWidth, width, wrap } from "./terminal";

const GAP = 2;
const PROVIDER_COLORS: Record<string, string> = { openai: "32", anthropic: "33", xai: "35", cursor: "97" };
const providerColor = (s: { provider: string }) => Object.hasOwn(PROVIDER_COLORS, s.provider) ? PROVIDER_COLORS[s.provider]! : "36";
const STATUS_COLORS: Record<string, string> = { working: "36", blocked: "31", handoff: "33", done: "32" };
const statusColor = (s: { status: Session["status"] }) => s.status ? STATUS_COLORS[s.status] ?? "" : "2";
/** The declared state plus the pin, or nothing when neither is on record. */
const stateCell = (s: Pick<Session, "status" | "pinned">) => [s.status ? statusLabel(s.status) : "", s.pinned ? "고정" : ""].filter(Boolean).join(" ");

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
  { title: "프로젝트", value: s => projectName(s.workingDirectory), drop: 5 },
  // The provider is carried by the colour, so the cell holds only the agent name.
  { title: "Agent", value: s => s.agent, drop: 4, color: providerColor },
  { title: "상태", value: stateCell, drop: 3, color: statusColor },
  { title: "Agent Session ID", value: s => s.providerSessionId, color: () => "94" },
  { title: "생성", value: s => shortTime(s.createdAt), drop: 2, color: () => "90" },
  { title: "갱신", value: s => shortTime(s.updatedAt), drop: 2, color: () => "90" },
  // No end column: hosts are often closed without a SessionEnd hook, so it would read "in progress"
  // for nearly every row. The detail view still shows the end time when one was recorded.
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

/** A linked session as the API briefs it; a caller may know no more than its id. */
type Brief = Partial<Pick<Session, "provider" | "agent" | "providerSessionId" | "sessionName" | "summary" | "status">>;
interface Detail {
  session: Session; parentSession?: Brief | null; children?: Brief[]; childrenPage?: { total: number };
  updates?: SessionUpdate[]; updatesPage?: { total: number }; chain?: ChainNode[];
}

const title = (s: Brief) => s.sessionName ?? "이름 없는 세션";
const heading = (text: string, note?: string) => paint(text, "1;36") + (note ? `  ${dim(note)}` : "");

/** Coloured pieces on one line, each cut to what is left of the budget so the line never overflows. */
function inline(parts: [string, string?][], space: number, gap = " ".repeat(GAP)): string {
  const shown: string[] = [];
  let room = space;
  for (const [text, color] of parts) {
    const piece = clip(text, room);
    if (!piece) break;
    shown.push(paint(piece, color ?? ""));
    room -= width(piece) + width(gap);
  }
  return shown.join(gap);
}

function relation(linked: Brief, space: number): string[] {
  const parts: [string, string?][] = [[title(linked), "1;36"]];
  if (linked.provider) parts.push([linked.provider, providerColor({ provider: linked.provider })]);
  if (linked.providerSessionId) parts.push([linked.providerSessionId, "94"]);
  if (linked.status) parts.push([statusLabel(linked.status), STATUS_COLORS[linked.status] ?? ""]);
  return [`    ${inline(parts, space - 4)}`, ...wrap(linked.summary ?? "", space - 6).filter(Boolean).map(text => `      ${text}`)];
}

/** The line of work from its first session to its last, each session under the one it took over from. */
function chain(items: ChainNode[], space: number, truncated = false): string[] {
  const lines = items.flatMap(node => {
    const indent = "  ".repeat(node.depth + 1);
    const parts: [string, string?][] = [[node.current ? "▶" : "·", node.current ? "1;33" : "2"], [title(node), node.current ? "1;33" : "1;36"],
      [node.agent, providerColor(node)], [node.providerSessionId, "94"], [shortTime(node.updatedAt), "90"]];
    if (node.status) parts.push([statusLabel(node.status), STATUS_COLORS[node.status] ?? ""]);
    if (node.pinned) parts.push(["고정", "35"]);
    return [`${indent}${inline(parts, space - width(indent), " ")}`,
      ...wrap(node.summary, Math.max(8, space - width(indent) - 4)).slice(0, 2).map(text => `${indent}  ${dim(text)}`)];
  });
  return truncated ? [...lines, dim(`  ${CHAIN_NOTE}`)] : lines;
}
const CHAIN_NOTE = "흐름이 길어 일부만 표시합니다.";

/** The browser's detail panel in text: heading, summary, session information, history, then connections. */
function detail(data: Detail, space: number): Line[] {
  const s = data.session;
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const fields: [string, string, string?][] = [
    ["Provider / Agent", `${s.provider} / ${s.agent}`, providerColor(s)],
    ["모델", s.model ?? "미기록"],
    ["작업 상태", stateCell(s) || "미기록", s.status || s.pinned ? statusColor(s) : "2"],
    ["Git", gitLabel(s.git), s.git ? "" : "2"],
    ["컨텍스트 압축", compactionLabel(s.compaction), s.compaction ? "33" : "2"],
    ["작업 경로", s.workingDirectory, "94"],
    ["최초 기록", localTime(s.createdAt, true), "90"],
    ["마지막 갱신", localTime(s.updatedAt, true), "90"],
    ["세션 종료", s.endedAt ? `${localTime(s.endedAt, true)}${s.endReason ? ` · ${s.endReason}` : ""}` : "기록 없음", s.endedAt ? "90" : "2"],
    ["Agent Session ID", s.providerSessionId, "94"],
    ["Relay 내부 ID", s.id, "90"],
    ["재개 명령", resumeCommand(s, shell) ?? "이 도구의 재개 명령은 모릅니다", resumeCommand(s, shell) ? "" : "2"],
  ];
  const label = Math.max(...fields.map(([name]) => width(name)));
  const children = data.children ?? [];
  const childCount = data.childrenPage?.total ?? children.length;
  const flow = data.chain ?? [];
  return [
    paint(clip(title(s), space), "1;36"),
    inline([[s.agent, providerColor(s)], ["·", "2"], [projectName(s.workingDirectory)],
      ...(s.status ? [["·", "2"], [statusLabel(s.status), statusColor(s)]] as [string, string?][] : []),
      ...(s.pinned ? [["·", "2"], ["고정", "35"]] as [string, string?][] : [])], space, " "),
    dim("-".repeat(space)),
    heading("최근 작업 요약"),
    ...wrap(s.summary, space - 2).map(text => `  ${text}`),
    dim("  작업을 이어가기 전, 실제 프로젝트 파일도 확인하세요."),
    "",
    heading("세션 정보"),
    ...fields.map(([name, value, color]) => `  ${dim(pad(name, label))}${" ".repeat(GAP)}${paint(clip(value, space - label - GAP - 2), color ?? "")}`),
    ...(data.updates ? [
      "",
      heading(`기록 이력 (${data.updatesPage?.total ?? data.updates.length}건)`, "최신 기록부터"),
      ...data.updates.flatMap(update => [
        `  ${paint(`#${update.sequence}`, "36")} ${paint(localTime(update.createdAt), "90")}${update.status ? ` ${paint(statusLabel(update.status), STATUS_COLORS[update.status] ?? "")}` : ""}`,
        ...wrap(update.summary, space - 6).map(text => `      ${text}`),
      ]),
      ...(data.updates.length ? [] : [dim("  현재 페이지에 이력이 없습니다.")]),
    ] : []),
    ...(flow.length > 1 ? ["", heading(`세션 흐름 (${flow.length}건)`, "처음 세션부터"), ...chain(flow, space)] : []),
    "",
    heading(`세션 연결 (${childCount + (data.parentSession ? 1 : 0)}건)`),
    paint("  이전 세션", "36"),
    ...(data.parentSession ? relation(data.parentSession, space) : [dim("    최초 세션 · 이전 연결 없음")]),
    paint("  현재 세션", "36"),
    `    ${paint(clip(title(s), space - 4), "1;36")}`,
    paint(`  이어받은 세션 (${childCount}건)`, "36"),
    ...(children.length ? children.flatMap(child => relation(child, space)) : [dim("    이어받은 세션 없음")]),
  ].map(text => ({ text, owner: s }));
}

const HOOK_STATUS: Record<string, string> = {
  added: "등록함", updated: "갱신함", unchanged: "이미 등록됨", skipped: "건너뜀",
};
const SKILL_STATUS: Record<string, string> = {
  added: "설치함", updated: "갱신함", unchanged: "이미 설치됨", skipped: "건너뜀",
};

/** Lines plus their owning session; `human` is the same output flattened for a non-interactive terminal. */

export function render(value: unknown, space = terminalWidth()): Line[] {
  const data = value as Partial<Detail> & {
    items?: Session[]; page?: { total: number; offset: number }; truncated?: boolean; markdown?: string;
    deleted?: boolean; detached?: number;
    scope?: { cwd: string | null }; binDirectory?: string; executable?: string;
    wrappers?: { path: string; status: string }[];
    hosts?: { host?: string; path: string; status: string; detail?: string }[];
    instructions?: { host?: string; path: string; status: string; detail?: string }[];
    skills?: { host: string; path: string; status: string; detail?: string }[];
    skill?: string; targets?: { host: string; path: string; status: string; detail?: string }[];
  };
  const row = (label: string, status: string, file: string, detail?: string, names = HOOK_STATUS) =>
    `${label}  ${names[status] ?? status}  ${file}${detail ? `  (${detail})` : ""}`;
  if (typeof data.markdown === "string") return plain(data.markdown.replace(/\n$/, "").split("\n"));
  if (data.targets && data.skill) {
    return plain([
      `스킬  ${data.skill}`,
      ...data.targets.map(target => row(target.host, target.status, target.path, target.detail, SKILL_STATUS)),
    ]);
  }
  if (data.hosts && data.binDirectory) {
    return plain([
      `실행 파일  ${data.executable ?? ""}`,
      `훅 래퍼    ${data.binDirectory}`,
      ...((data.wrappers ?? []).map(wrapper => row("래퍼", wrapper.status, wrapper.path))),
      ...(data.hosts.map(host => row(host.host ?? "host", host.status, host.path, host.detail))),
      ...((data.instructions ?? []).map(item => row(`${item.host} 시작 안내`, item.status, item.path, item.detail))),
      ...((data.skills ?? []).map(item => row(`${item.host} 스킬`, item.status, item.path, item.detail, SKILL_STATUS))),
    ]);
  }
  // A chain is the session plus its line of work; the rows are places in that line, not a table.
  if (data.session && data.items && data.items.every(item => typeof (item as unknown as ChainNode).depth === "number")) {
    const flow = data.items as unknown as ChainNode[];
    return plain([heading(`세션 흐름 (${flow.length}건)`, "처음 세션부터"), ...chain(flow, space, data.truncated)]);
  }
  if (data.items) {
    if (data.items.some(item => typeof item?.providerSessionId !== "string")) return plain([JSON.stringify(value, null, 2)]);
    const footer = `${paint(`총 ${data.page?.total ?? data.items.length}건`, "36")} ${dim(`· offset ${data.page?.offset ?? 0}`)}`;
    if (!data.items.length) return plain([dim("조회된 세션이 없습니다."), footer]);
    return [...table(data.items, space), ...plain([footer])];
  }
  if (data.session && data.deleted) {
    return plain([`삭제함  ${title(data.session)}  ${data.session.providerSessionId}`,
      ...(data.detached ? [dim(`이어받은 세션 ${data.detached}건의 연결을 끊었습니다.`)] : [])]);
  }
  if (data.session) {
    return [
      ...(data.scope ? plain(wrap(`조회 범위: ${data.scope.cwd ?? "전체 프로젝트"}`, space)) : []),
      ...detail({ ...data, session: data.session }, space),
    ];
  }
  return plain([JSON.stringify(value, null, 2)]);
}

export function human(value: unknown, space = terminalWidth()): string {
  return render(value, space).map(line => line.text).join("\n");
}
