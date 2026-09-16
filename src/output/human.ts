import type { Session, SessionUpdate } from "../session/session.types";
import { bold, clip, dim, localTime, pad, paint, STATUS_COLOR, terminalWidth, width, wrap } from "./terminal";

const GAP = 2;

interface Column {
  title: string;
  value: (s: Session) => string;
  flex?: number;
  drop?: number;
  color?: (s: Session) => string;
}

// Identity columns always stay; the rest leave in `drop` order when the terminal is narrow.
const COLUMNS: Column[] = [
  { title: "상태", value: s => s.status, color: s => STATUS_COLOR[s.status] ?? "" },
  { title: "이름", value: s => s.sessionName ?? "(이름 없음)", flex: 10 },
  { title: "Provider/Agent", value: s => `${s.provider}/${s.agent}`, drop: 3 },
  { title: "Session ID", value: s => s.providerSessionId },
  { title: "갱신", value: s => localTime(s.updatedAt), drop: 2 },
  { title: "요약", value: s => s.summary, flex: 20, drop: 1 },
];

function table(items: Session[], space: number): string[] {
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
    line(columns.map(c => bold(pad(c.title, size.get(c)!)))),
    dim("-".repeat(Math.min(rule, space))),
    ...items.map(item => line(columns.map(column => {
      const cell = pad(clip(column.value(item), size.get(column)!), size.get(column)!);
      return column.color ? paint(cell, column.color(item)) : cell;
    }))),
  ];
}

function card(session: Session, extra: [string, string][], space: number): string[] {
  const badge = paint(session.status, STATUS_COLOR[session.status] ?? "");
  const title = clip(session.sessionName ?? "(이름 없음)", Math.max(10, space - width(session.status) - GAP));
  const fields: [string, string][] = [
    ["Session ID", session.providerSessionId],
    ["Relay ID", session.id],
    ["Provider", `${session.provider} / ${session.agent}`],
    ["Model", session.model ?? "미기록"],
    ["Project", session.workingDirectory],
    ["시작", localTime(session.startedAt, true)],
    ["갱신", localTime(session.updatedAt, true)],
    ...(session.endedAt ? [["종료", localTime(session.endedAt, true)] as [string, string]] : []),
    ...extra,
  ];
  const label = Math.max(...fields.map(([name]) => width(name)));
  return [
    `${bold(title)}  ${badge}`,
    dim("-".repeat(space)),
    ...fields.map(([name, value]) => `${dim(pad(name, label))}  ${clip(value, space - label - GAP)}`),
    "",
    bold("요약"),
    ...wrap(session.summary, space - 2).map(text => `  ${text}`),
  ];
}

function history(updates: SessionUpdate[], total: number, space: number): string[] {
  return ["", bold(`진행 이력 (${total}건)`), ...updates.flatMap(update => [
    `  ${dim(`#${update.sequence}`)} ${pad(update.type, 8)} ${dim(localTime(update.createdAt))}`,
    ...wrap(update.summary, space - 6).map(text => `      ${text}`),
  ])];
}

export function human(value: unknown, space = terminalWidth()): string {
  const data = value as {
    session?: Session; items?: Session[]; page?: { total: number; offset: number };
    parentSession?: { providerSessionId: string }; children?: { providerSessionId: string }[];
    childrenPage?: { total: number }; updates?: SessionUpdate[]; updatesPage?: { total: number };
  };
  if (data.items) {
    if (data.items.some(item => typeof item?.providerSessionId !== "string")) return JSON.stringify(value, null, 2);
    const footer = dim(`총 ${data.page?.total ?? data.items.length}건 · offset ${data.page?.offset ?? 0}`);
    if (!data.items.length) return [dim("조회된 세션이 없습니다."), footer].join("\n");
    return [...table(data.items, space), footer].join("\n");
  }
  if (data.session) {
    const children = data.children ?? [];
    return [
      ...card(data.session, [
        ...(data.parentSession ? [["Parent", data.parentSession.providerSessionId] as [string, string]] : []),
        ...(children.length ? [[`Children`, `${data.childrenPage?.total ?? children.length}건 · ` +
          children.map(child => child.providerSessionId).join(", ")] as [string, string]] : []),
      ], space),
      ...(data.updates ? history(data.updates, data.updatesPage?.total ?? data.updates.length, space) : []),
    ].join("\n");
  }
  return JSON.stringify(value, null, 2);
}
