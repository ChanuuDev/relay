import { STATUS_LABELS, type SessionUpdate } from "../../../session/session.types";
import type { OfficeSession, Tally } from "./sim";

/** 말풍선 한 줄에 둘 글자 수 */
export const LINE_LENGTH = 24;

export const zoneLabel = (zone: Tally) => (zone === "hall" ? "홀" : zone === "home" ? "퇴근" : STATUS_LABELS[zone]);

/** 컨셉의 `7c2a`처럼 원본 세션 ID 앞 네 글자로 캐릭터를 부른다. */
export const shortId = (session: Pick<OfficeSession, "providerSessionId">) =>
  session.providerSessionId.replace(/[^0-9a-z]/gi, "").slice(0, 4).toLowerCase() || "????";

/** 요약의 첫 줄을 한 줄 길이로 줄인다. */
export function clip(text: string, length = LINE_LENGTH) {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  const flat = line.replace(/\s+/g, " ");
  const chars = Array.from(flat);
  return chars.length > length ? `${chars.slice(0, length - 1).join("").trimEnd()}…` : flat;
}

const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });

/** 오늘 기록은 시:분, 그 전 기록은 월.일로 적는다. */
export function stamp(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return today ? clock.format(date) : day.format(date).replace(/\.\s*$/, "").replace(/\.\s*/g, "/");
}

/** 말풍선에 올릴 기록 이력: 최근 세 건을 오래된 것부터. 이력을 아직 못 받았으면 지금 요약 한 줄. */
export function bubbleLines(session: OfficeSession, updates?: readonly SessionUpdate[], now = new Date()) {
  const items = updates?.length
    ? [...updates].sort((a, b) => a.sequence - b.sequence).slice(-3).map((update) => ({ time: stamp(update.createdAt, now), text: clip(update.summary) }))
    : [{ time: stamp(session.updatedAt, now), text: clip(session.summary) }];
  return items;
}

/** 머리 위 말풍선에 올릴 한마디: 요약 첫 문장에서 꼬리표(진행:, 목표:)를 떼거나 앞머리(…: )만 남겨 짧게 줄인다. */
export function talkLine(summary: string, length = 18) {
  const line = summary.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  let text = line.replace(/\s+/g, " ");
  const labelled = /^([^:：]{1,24})[:：]\s*(.+)$/.exec(text);
  if (labelled) text = Array.from(labelled[1]!.trim()).length >= 5 ? labelled[1]!.trim() : labelled[2]!;
  text = text.split(/(?<=[.!?。])\s|;\s|\s\(\d\)\s/)[0]!.replace(/[.。]$/, "").trim();
  return clip(text, length);
}
