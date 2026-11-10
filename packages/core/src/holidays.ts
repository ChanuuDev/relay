import { RelayError } from "./errors.js";
import { addDays, daysBetween, isDate, weekdayOf } from "./planner.js";

// ── 대한민국 관공서 공휴일 ─────────────────────────────────
// 근거: 「공휴일에 관한 법률」, 「관공서의 공휴일에 관한 규정」(대통령령 제36290호, 2026-05-11 시행).
// 양력 공휴일과 음력 공휴일(설·부처님 오신 날·추석)은 계산하고, 대체공휴일은 제3조 규칙을 시행 시기별로 적용한다.
// 임기만료 선거일과 정부가 수시로 지정하는 임시공휴일은 계산할 수 없으므로 확인된 날짜를 표(SPECIAL_HOLIDAYS)로 둔다.

export type HolidayKind = "holiday" | "substitute" | "temporary";
/** 공휴일 하루. kind: holiday(법정 공휴일) · substitute(대체공휴일) · temporary(선거일·임시공휴일). of는 대체공휴일이 대신하는 공휴일 이름이다. */
export type Holiday = { date: string; name: string; kind: HolidayKind; of?: string };
export type HolidayList = { schemaVersion: 1; from: string; to: string; knownUntil: string; items: Holiday[] };

/** 확인된 선거일·임시공휴일. 새로 지정되면 여기에 더한다. */
export const SPECIAL_HOLIDAYS: ReadonlyArray<{ date: string; name: string }> = [
  { date: "2000-04-13", name: "국회의원선거일" }, { date: "2002-06-13", name: "지방선거일" }, { date: "2002-07-01", name: "임시공휴일" },
  { date: "2002-12-19", name: "대통령선거일" }, { date: "2004-04-15", name: "국회의원선거일" }, { date: "2006-05-31", name: "지방선거일" },
  { date: "2007-12-19", name: "대통령선거일" }, { date: "2008-04-09", name: "국회의원선거일" }, { date: "2010-06-02", name: "지방선거일" },
  { date: "2012-04-11", name: "국회의원선거일" }, { date: "2012-12-19", name: "대통령선거일" }, { date: "2014-06-04", name: "지방선거일" },
  { date: "2015-08-14", name: "임시공휴일" }, { date: "2016-04-13", name: "국회의원선거일" }, { date: "2016-05-06", name: "임시공휴일" },
  { date: "2017-05-09", name: "대통령선거일" }, { date: "2017-10-02", name: "임시공휴일" }, { date: "2018-06-13", name: "지방선거일" },
  { date: "2020-04-15", name: "국회의원선거일" }, { date: "2020-08-17", name: "임시공휴일" }, { date: "2022-03-09", name: "대통령선거일" },
  { date: "2022-06-01", name: "지방선거일" }, { date: "2023-10-02", name: "임시공휴일" }, { date: "2024-04-10", name: "국회의원선거일" },
  { date: "2024-10-01", name: "임시공휴일" }, { date: "2025-01-27", name: "임시공휴일" }, { date: "2025-06-03", name: "대통령선거일" },
  { date: "2026-06-03", name: "지방선거일" },
];
/** 선거일·임시공휴일 표를 확인한 마지막 날. 이후의 임시공휴일은 지정되는 대로 표에 더한다. */
export const SPECIAL_HOLIDAYS_KNOWN_UNTIL = "2026-12-31";
/** 계산을 보장하는 해. 이 밖의 해는 거부한다(공휴일 제도가 크게 달랐거나 음력 계산을 확인하지 않았다). */
export const HOLIDAY_YEARS = { min: 2000, max: 2100 } as const;

/** 대체공휴일 규칙: weekend는 토·일과 겹치면, sunday는 일요일과 겹치면 대체한다. 시행일(since) 전에는 적용하지 않는다. */
type Rule = { weekend?: "weekend" | "sunday"; overlap: boolean; since: string } | null;
type Base = { date: string; name: string; rule: Rule; special?: boolean };

const NATIONAL_SINCE = "2021-08-04"; // 국경일 대체공휴일 확대(「공휴일에 관한 법률」 시행 전 규정 개정)
const SEOL_CHUSEOK_SINCE = "2014-01-01"; // 설·추석·어린이날 대체공휴일 도입
const BUDDHA_XMAS_SINCE = "2023-05-04"; // 부처님 오신 날·기독탄신일 대체공휴일 확대
const LABOR_SINCE = "2026-05-01"; // 노동절 공휴일 지정
const CONSTITUTION_SINCE = "2026-05-11"; // 제헌절 공휴일 재지정

const pad = (value: number) => String(value).padStart(2, "0");
const lunarFormat = new Intl.DateTimeFormat("en-u-ca-dangi", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });

/** 그해 양력 날짜 가운데 한국 음력 month/day(윤달 제외)인 날. 그 해에 없으면 null. */
function lunarDay(year: number, month: number, day: number): string | null {
  // 음력 1/1은 양력 1월 하순~2월, 4/8은 4~6월, 8/15는 9~10월에 온다. 해당 양력 범위만 훑는다.
  const range: Record<number, [string, string]> = { 1: ["01-15", "02-28"], 4: ["04-10", "06-15"], 8: ["08-25", "10-20"] };
  const [from, to] = range[month] ?? ["01-01", "12-31"];
  for (let date = `${year}-${from}`; date <= `${year}-${to}`; date = addDays(date, 1)) {
    const parts = lunarFormat.formatToParts(new Date(`${date}T03:00:00Z`));
    if (parts.find((part) => part.type === "month")?.value === String(month) && parts.find((part) => part.type === "day")?.value === String(day)) return date;
  }
  return null;
}

/** 그해의 법정 공휴일(대체공휴일 전). */
function baseHolidays(year: number): Base[] {
  const day = (month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;
  const national = (date: string, name: string): Base => ({ date, name, rule: { weekend: "weekend", overlap: true, since: NATIONAL_SINCE } });
  const list: Base[] = [{ date: day(1, 1), name: "신정", rule: null }];
  const seol = lunarDay(year, 1, 1);
  if (seol) {
    const rule: Rule = { weekend: "sunday", overlap: true, since: SEOL_CHUSEOK_SINCE };
    list.push({ date: addDays(seol, -1), name: "설날 연휴", rule }, { date: seol, name: "설날", rule }, { date: addDays(seol, 1), name: "설날 연휴", rule });
  }
  list.push(national(day(3, 1), "삼일절"));
  if (year <= 2005) list.push({ date: day(4, 5), name: "식목일", rule: null });
  if (day(5, 1) >= LABOR_SINCE) list.push({ date: day(5, 1), name: "노동절", rule: { weekend: "weekend", overlap: true, since: LABOR_SINCE } });
  list.push({ date: day(5, 5), name: "어린이날", rule: { weekend: "weekend", overlap: true, since: SEOL_CHUSEOK_SINCE } });
  const buddha = lunarDay(year, 4, 8);
  if (buddha) list.push({ date: buddha, name: "부처님 오신 날", rule: { weekend: "weekend", overlap: true, since: BUDDHA_XMAS_SINCE } });
  list.push({ date: day(6, 6), name: "현충일", rule: null });
  if (year <= 2007) list.push({ date: day(7, 17), name: "제헌절", rule: null });
  else if (day(7, 17) >= CONSTITUTION_SINCE) list.push(national(day(7, 17), "제헌절"));
  list.push(national(day(8, 15), "광복절"));
  const chuseok = lunarDay(year, 8, 15);
  if (chuseok) {
    const rule: Rule = { weekend: "sunday", overlap: true, since: SEOL_CHUSEOK_SINCE };
    list.push({ date: addDays(chuseok, -1), name: "추석 연휴", rule }, { date: chuseok, name: "추석", rule }, { date: addDays(chuseok, 1), name: "추석 연휴", rule });
  }
  list.push(national(day(10, 3), "개천절"));
  if (year >= 2013) list.push(national(day(10, 9), "한글날"));
  list.push({ date: day(12, 25), name: "기독탄신일", rule: { weekend: "weekend", overlap: true, since: BUDDHA_XMAS_SINCE } });
  for (const special of SPECIAL_HOLIDAYS) if (special.date.startsWith(`${year}-`)) list.push({ date: special.date, name: special.name, rule: null, special: true });
  return list;
}

const cache = new Map<number, Holiday[]>();

/** 그해의 관공서 공휴일과 대체공휴일(날짜 순). 일요일 자체는 넣지 않는다. */
export function koreanHolidays(year: number): Holiday[] {
  if (!Number.isInteger(year) || year < HOLIDAY_YEARS.min || year > HOLIDAY_YEARS.max) {
    throw new RelayError("INVALID_ARGUMENT", `공휴일은 ${HOLIDAY_YEARS.min}–${HOLIDAY_YEARS.max}년만 계산합니다.`);
  }
  const cached = cache.get(year);
  if (cached) return cached;
  const base = baseHolidays(year);
  const taken = new Set(base.map((item) => item.date));
  const byDate = new Map<string, Base[]>();
  for (const item of base) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  const substitutes: Holiday[] = [];
  // 제3조: 겹친 공휴일마다 그날 다음의 첫 번째 비공휴일(토·일·공휴일·이미 정한 대체공휴일이 아닌 날)을 대체공휴일로 한다.
  for (const [date, items] of [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const weekday = weekdayOf(date);
    const active = (item: Base) => item.rule !== null && date >= item.rule.since;
    const owed: string[] = [];
    for (const item of items) {
      if (!active(item)) continue;
      const weekend = item.rule!.weekend === "weekend" ? weekday === 0 || weekday === 6 : weekday === 0;
      if (weekend) owed.push(item.name);
    }
    if (weekday !== 0 && weekday !== 6 && items.length > 1) {
      // 평일에 둘 이상 겹치면 겹친 수만큼(하나는 그날 쉬므로 하나 뺀다), 규칙이 있는 공휴일 몫으로 대체한다.
      const eligible = items.filter(active).map((item) => item.name);
      owed.push(...eligible.slice(0, Math.min(eligible.length, items.length - 1)));
    }
    let cursor = date;
    for (const name of owed) {
      do cursor = addDays(cursor, 1); while (weekdayOf(cursor) === 0 || weekdayOf(cursor) === 6 || taken.has(cursor));
      taken.add(cursor);
      substitutes.push({ date: cursor, name: "대체공휴일", kind: "substitute", of: name.replace(/ 연휴$/, "") });
    }
  }
  const result = [...base.map((item): Holiday => ({ date: item.date, name: item.name, kind: item.special ? "temporary" : "holiday" })),
    ...substitutes].filter((item) => item.date.startsWith(`${year}-`))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  cache.set(year, result);
  return result;
}

/** from~to(YYYY-MM-DD, 양 끝 포함)의 공휴일 */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const items: Holiday[] = [];
  for (let year = Math.max(HOLIDAY_YEARS.min, Number(from.slice(0, 4))); year <= Math.min(HOLIDAY_YEARS.max, Number(to.slice(0, 4))); year++) {
    for (const item of koreanHolidays(year)) if (item.date >= from && item.date <= to) items.push(item);
  }
  return items;
}

/** 공휴일 API query: year 또는 from·to(최대 2년). 없으면 서울 기준 올해다. */
export function parseHolidayQuery(query: Record<string, string>, now = Date.now()): { from: string; to: string } {
  for (const key of Object.keys(query)) if (!["year", "from", "to"].includes(key)) throw new RelayError("INVALID_ARGUMENT", `허용하지 않는 query key: ${key}`);
  if (query.year !== undefined) {
    if (query.from !== undefined || query.to !== undefined) throw new RelayError("INVALID_ARGUMENT", "year와 from·to는 함께 쓰지 않습니다.");
    if (!/^\d{4}$/.test(query.year)) throw new RelayError("INVALID_ARGUMENT", "year는 네 자리 해여야 합니다.");
    return { from: `${query.year}-01-01`, to: `${query.year}-12-31` };
  }
  if (query.from !== undefined || query.to !== undefined) {
    if (!isDate(query.from) || !isDate(query.to)) throw new RelayError("INVALID_ARGUMENT", "from·to는 YYYY-MM-DD 형식의 날짜여야 합니다.");
    if (query.to < query.from) throw new RelayError("INVALID_ARGUMENT", "to가 from보다 앞일 수 없습니다.");
    if (daysBetween(query.from, query.to) > 731) throw new RelayError("INVALID_ARGUMENT", "공휴일은 한 번에 2년까지 봅니다.");
    return { from: query.from, to: query.to };
  }
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date(now));
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** 공휴일 API 응답 */
export function holidayList(query: { from: string; to: string }): HolidayList {
  const years = [Number(query.from.slice(0, 4)), Number(query.to.slice(0, 4))];
  if (years.some((year) => year < HOLIDAY_YEARS.min || year > HOLIDAY_YEARS.max)) {
    throw new RelayError("INVALID_ARGUMENT", `공휴일은 ${HOLIDAY_YEARS.min}–${HOLIDAY_YEARS.max}년만 계산합니다.`);
  }
  return { schemaVersion: 1, from: query.from, to: query.to, knownUntil: SPECIAL_HOLIDAYS_KNOWN_UNTIL, items: holidaysBetween(query.from, query.to) };
}
