import { RelayError } from "./errors.js";
import { HOLIDAY_YEARS, koreanHolidays, SPECIAL_HOLIDAYS_KNOWN_UNTIL, type Holiday } from "./holidays.js";
import { isDate } from "./planner.js";

// ── 공공 API: 한국천문연구원 특일 정보(공공데이터포털) ───────────
// getRestDeInfo는 관공서 공휴일(대체공휴일·임시공휴일·선거일 포함)을 달마다 돌려준다. 인증키는 공공데이터포털에서 받는다.
// 받은 해는 그 자료를 쓰고, 아직 받지 못했거나 발표되지 않은 해는 holidays.ts의 계산으로 채운다.

export const HOLIDAY_API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
/** 받아 둔 한 해 */
export type HolidayYear = { year: number; syncedAt: string; items: Holiday[] };
export type HolidaySource = { year: number; source: "kasi" | "computed"; syncedAt: string | null };
/** 마지막 동기화 시도(성공·실패). 화면과 API가 상태를 알린다. */
export type HolidaySyncState = { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; configured: boolean };
export type HolidaySyncResult = { schemaVersion: 1; syncedAt: string; years: Array<{ year: number; count: number; stored: boolean }> };

const pad = (value: number) => String(value).padStart(2, "0");
/** 공휴일 API의 거절은 늘 502다. 401로 넘기면 브라우저 모드 화면이 Relay 로그인이 만료된 것으로 알고 로그아웃한다. */
const apiError = (message: string) => new RelayError("HOLIDAY_API_ERROR", message, 5, 502);

/** 한 달 요청 주소. 인증키는 공공데이터포털의 Encoding 키(%가 든 것)면 그대로, Decoding 키면 인코딩해 붙인다. */
export function holidayApiRequest(base: string, key: string, year: number, month: number) {
  const encoded = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
  return `${base}?serviceKey=${encoded}&solYear=${year}&solMonth=${pad(month)}&numOfRows=100&pageNo=1&_type=json`;
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim() ?? "";

/** 응답 한 건을 해석해 공휴일(isHoliday=Y)만 돌려준다. item은 여러 건이면 배열, 한 건이면 객체, 없으면 빈 문자열로 온다.
 *  인증키 오류는 JSON(OpenAPI_ServiceResponse) 또는 XML로 오므로 둘 다 오류로 바꾼다. */
export function parseHolidayApi(text: string, status = 200): Array<{ date: string; name: string }> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = undefined; }
  const rows: Array<{ locdate: unknown; dateName: unknown; isHoliday: unknown }> = [];
  if (data && typeof data === "object") {
    const gateway = (data as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } } }).OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gateway) throw apiError(`공휴일 API가 거절했습니다: ${gateway.returnAuthMsg ?? ""} ${gateway.errMsg ?? ""}`.trim());
    const response = (data as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown } } }).response;
    if (!response?.header) throw apiError("공휴일 API 응답 형식을 알 수 없습니다.");
    if (response.header.resultCode !== "00") throw apiError(`공휴일 API 오류: ${response.header.resultCode} ${response.header.resultMsg ?? ""}`.trim());
    const items = response.body?.items;
    const item = items && typeof items === "object" ? (items as { item?: unknown }).item : undefined;
    for (const row of item === undefined || item === null ? [] : Array.isArray(item) ? item : [item]) rows.push(row as typeof rows[number]);
  } else {
    if (/<(OpenAPI_ServiceResponse|cmmMsgHeader)>/.test(text)) throw apiError(`공휴일 API가 거절했습니다: ${tag(text, "returnAuthMsg")} ${tag(text, "errMsg")}`.trim());
    const code = tag(text, "resultCode");
    if (!code) throw apiError(status >= 400 ? `공휴일 API가 HTTP ${status}로 답했습니다.` : "공휴일 API 응답 형식을 알 수 없습니다.");
    if (code !== "00") throw apiError(`공휴일 API 오류: ${code} ${tag(text, "resultMsg")}`.trim());
    for (const match of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) rows.push({ locdate: tag(match[1]!, "locdate"), dateName: tag(match[1]!, "dateName"), isHoliday: tag(match[1]!, "isHoliday") });
  }
  const result: Array<{ date: string; name: string }> = [];
  for (const row of rows) {
    if (row?.isHoliday !== "Y") continue;
    const digits = String(row.locdate ?? "");
    const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const name = String(row.dateName ?? "").trim();
    if (/^\d{8}$/.test(digits) && isDate(date) && name) result.push({ date, name });
  }
  return result;
}

const NAMES: Record<string, string> = { "1월1일": "신정", "부처님오신날": "부처님 오신 날", "석가탄신일": "부처님 오신 날" };

/** API 자료를 화면·API의 공휴일 모양으로 바꾼다. 대체공휴일이 무엇을 대신하는지는 API가 알려 주지 않으므로 계산 결과에서 찾는다. */
export function normalizeApiHolidays(year: number, rows: Array<{ date: string; name: string }>): Holiday[] {
  const computed = year >= HOLIDAY_YEARS.min && year <= HOLIDAY_YEARS.max ? koreanHolidays(year) : [];
  const seen = new Set<string>();
  const items: Holiday[] = [];
  for (const row of rows) {
    if (!row.date.startsWith(`${year}-`)) continue;
    const name = NAMES[row.name.replace(/\s+/g, "")] ?? row.name;
    let item: Holiday;
    if (name.includes("대체")) {
      const of = computed.find((other) => other.date === row.date && other.kind === "substitute")?.of;
      item = { date: row.date, name: "대체공휴일", kind: "substitute", ...(of ? { of } : {}) };
    } else item = { date: row.date, name, kind: name.includes("선거") || name.includes("임시") ? "temporary" : "holiday" };
    const key = `${item.date}|${item.name}`;
    if (!seen.has(key)) { seen.add(key); items.push(item); }
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 한 해를 열두 달 차례로 받아 온다. 아직 발표되지 않은 해는 빈 배열이다. */
export async function fetchHolidayYear(year: number, options: { key: string; base?: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<Holiday[]> {
  const send = options.fetch ?? fetch;
  const rows: Array<{ date: string; name: string }> = [];
  for (let month = 1; month <= 12; month++) {
    let response: Response;
    try { response = await send(holidayApiRequest(options.base ?? HOLIDAY_API_URL, options.key, year, month), { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) }); }
    catch { throw apiError("공휴일 API에 연결하지 못했습니다."); }
    rows.push(...parseHolidayApi(await response.text(), response.status));
  }
  return normalizeApiHolidays(year, rows);
}

/** 동기화할 해: 서울 기준 올해와 내년 */
export const holidaySyncYears = (now = Date.now()) => {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date(now)));
  return [year, year + 1];
};

/** 다음 서울 00:00까지 남은 ms(0이면 하루 뒤). 서울은 서머타임이 없어 UTC+9로 셈한다. */
export function msUntilSeoulMidnight(now = Date.now()) {
  const day = 86_400_000, offset = 9 * 3_600_000;
  const passed = (now + offset) % day;
  return passed === 0 ? day : day - passed;
}

/** 받아 둔 자료가 다시 받을 만큼 오래됐는지: 올해 자료가 없거나 마지막 성공이 하루 넘게 지났다. */
export function holidaysStale(synced: (year: number) => HolidayYear | null, now = Date.now()) {
  const current = synced(holidaySyncYears(now)[0]!);
  return !current || now - Date.parse(current.syncedAt) > 86_400_000;
}

/** from~to의 공휴일. 받아 둔 해는 그 자료를, 없는 해는 계산을 쓰고, 해마다 출처를 밝힌다. */
export function mergedHolidayList(query: { from: string; to: string }, synced: (year: number) => HolidayYear | null, sync?: HolidaySyncState):
  { schemaVersion: 1; from: string; to: string; knownUntil: string; items: Holiday[]; sources: HolidaySource[]; sync?: HolidaySyncState } {
  const first = Number(query.from.slice(0, 4)), last = Number(query.to.slice(0, 4));
  if (first < HOLIDAY_YEARS.min || last > HOLIDAY_YEARS.max) throw new RelayError("INVALID_ARGUMENT", `공휴일은 ${HOLIDAY_YEARS.min}–${HOLIDAY_YEARS.max}년만 봅니다.`);
  const items: Holiday[] = [];
  const sources: HolidaySource[] = [];
  for (let year = first; year <= last; year++) {
    const stored = synced(year);
    const list = stored && stored.items.length ? stored.items : koreanHolidays(year);
    sources.push(stored && stored.items.length ? { year, source: "kasi", syncedAt: stored.syncedAt } : { year, source: "computed", syncedAt: null });
    for (const item of list) if (item.date >= query.from && item.date <= query.to) items.push(item);
  }
  return { schemaVersion: 1, from: query.from, to: query.to, knownUntil: SPECIAL_HOLIDAYS_KNOWN_UNTIL, items, sources, ...(sync ? { sync } : {}) };
}

/** 저장할 때와 읽을 때 같은 모양을 지키도록 받아 둔 한 해를 검사한다(깨진 캐시는 버린다). */
export function parseHolidayYear(raw: unknown): HolidayYear | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { year?: unknown; syncedAt?: unknown; items?: unknown };
  if (typeof value.year !== "number" || typeof value.syncedAt !== "string" || !Array.isArray(value.items)) return null;
  const items = value.items.filter((item): item is Holiday => Boolean(item) && typeof item === "object" && isDate((item as Holiday).date)
    && typeof (item as Holiday).name === "string" && ["holiday", "substitute", "temporary"].includes((item as Holiday).kind));
  return { year: value.year, syncedAt: value.syncedAt, items };
}
