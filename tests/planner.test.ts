import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { activityStreaks, bucketActivity, dayKey, fetchHolidayYear, holidayApiRequest, holidaysBetween, holidaysStale, isDate, isDateTime, koreanHolidays, mergedHolidayList,
  msUntilSeoulMidnight, normalizeApiHolidays, parseActivityQuery, parseEvent, parseHolidayApi, parseHolidayQuery, parseTask, placeOnBoard, removeFromBoard, type Task } from "@relay/core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { holidayCachePath, readHolidayCache, startHolidaySync, syncLocalHolidays } from "../src/planner/holidays";
import { handler } from "../src/web/server";
import { loadConfig } from "../src/config";
import { DB_VERSION, openDatabase } from "../src/db/database";
import { HOOK_SUMMARY } from "../src/session/session.service";
import { PlannerStore } from "../src/planner/planner.store";
import { cleanup, fixture, input, temporary } from "./helpers";
import v8Schema from "../src/db/migrations/008_init.sql" with { type: "text" };
import v9Schema from "../src/db/migrations/009_init.sql" with { type: "text" };

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, project: "", memo: "", provider: null, status: "todo", board: false, position: null, notes: [],
  createdAt: 1, updatedAt: 1, completedAt: null, ...extra });

describe("일정 관리 공용 규칙", () => {
  test("날짜·시각은 달력에 있는 값만 받는다", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDateTime("2026-11-09T23:59")).toBe(true);
    expect(isDateTime("2026-11-09T24:00")).toBe(false);
    expect(isDateTime("2026-11-09")).toBe(false);
  });

  test("Task: 모르는 키는 버리고, 첨부 메모 중복을 없애고, 완료 시각은 상태를 따른다", () => {
    const parsed = parseTask({ id: "a", title: "할 일", status: "done", notes: ["m1", "m1", "m2"], updatedAt: 50, extra: true }, "t", 99);
    expect(parsed).toEqual({ id: "a", title: "할 일", project: "", memo: "", provider: null, status: "done", board: false, position: null, notes: ["m1", "m2"],
      createdAt: 99, updatedAt: 50, completedAt: 50 });
    expect(parseTask({ id: "a", status: "doing", completedAt: 5 }, "t", 1).completedAt).toBeNull();
    expect(() => parseTask({ id: "a", provider: "google" }, "t", 1)).toThrow("provider");
    expect(() => parseTask({ id: "a", title: "x".repeat(201) }, "t", 1)).toThrow("너무 깁니다");
    expect(() => parseTask({ id: "bad id" }, "t", 1)).toThrow("올바르지 않습니다");
  });

  test("일정: 종일은 날짜, 시간 일정은 시각이고 끝이 시작보다 앞이면 거부한다", () => {
    expect(parseEvent({ id: "e", allDay: true, start: "2026-11-09", end: "2026-11-10" }, "e", 1)).toMatchObject({ color: "blue", attachments: [], title: "" });
    expect(() => parseEvent({ id: "e", allDay: true, start: "2026-11-09T10:00", end: "2026-11-09T11:00" }, "e", 1)).toThrow("YYYY-MM-DD");
    expect(() => parseEvent({ id: "e", allDay: false, start: "2026-11-09T11:00", end: "2026-11-09T10:00" }, "e", 1)).toThrow("앞일 수 없습니다");
    expect(() => parseEvent({ id: "e", allDay: false, start: "2026-11-09T10:00", end: "2026-11-09T11:00", color: "pink" }, "e", 1)).toThrow("color");
    const attached = parseEvent({ id: "e", allDay: true, start: "2026-11-09", end: "2026-11-09", attachments: [{ kind: "note", id: "n" }, { kind: "task", id: "n" }, { kind: "note", id: "n" }] }, "e", 1);
    expect(attached.attachments).toEqual([{ kind: "note", id: "n" }, { kind: "task", id: "n" }]);
  });

  test("보드: 사이에 끼우면 중간값, 틈이 없거나 순서 없는 카드가 섞이면 칸을 다시 매긴다", () => {
    const tasks = [task("a", { board: true, status: "doing", position: 1 }), task("b", { board: true, status: "doing", position: 2 }), task("c")];
    const [placed] = placeOnBoard(tasks, "c", "doing", 1, 10);
    expect(placed).toMatchObject({ id: "c", board: true, status: "doing", position: 1.5, updatedAt: 10 });
    expect(placeOnBoard(tasks, "c", "doing", 0, 10)[0]!.position).toBe(0);
    expect(placeOnBoard(tasks, "c", "doing", null, 10)[0]!.position).toBe(3);
    const tight = [task("a", { board: true, position: 1 }), task("b", { board: true, position: 1 + 1e-9 }), task("c")];
    expect(placeOnBoard(tight, "c", "todo", 1, 10).map((item) => `${item.id}:${item.position}`)).toEqual(["c:2", "b:3"]);
    const unordered = [task("a", { board: true }), task("c")];
    expect(placeOnBoard(unordered, "c", "todo", 0, 10).map((item) => `${item.id}:${item.position}`)).toEqual(["c:1", "a:2"]);
    // 완료 칸에 놓으면 완료 시각을 남기고, 다시 빼면 지운다. 완료를 보드에서 내리면 할 일로 돌아간다.
    const done = placeOnBoard(tasks, "a", "done", null, 20)[0]!;
    expect(done).toMatchObject({ status: "done", completedAt: 20 });
    expect(placeOnBoard([done], "a", "review", null, 30)[0]).toMatchObject({ status: "review", completedAt: null });
    expect(removeFromBoard([done], "a", 40)[0]).toMatchObject({ board: false, position: null, status: "todo", completedAt: null });
    expect(() => placeOnBoard(tasks, "zzz", "todo", null)).toThrow("Task가 없습니다");
  });

  test("잔디: 시간대 경계로 날을 나누고 연속 기록을 센다", () => {
    // 서울 자정 직전·직후의 UTC 시각은 서로 다른 날이다.
    const rows = [{ at: Date.parse("2026-11-08T14:59:00Z"), sessionId: "s1" }, { at: Date.parse("2026-11-08T15:01:00Z"), sessionId: "s1" },
      { at: Date.parse("2026-11-08T15:02:00Z"), sessionId: "s2" }];
    expect(dayKey(rows[0]!.at, "Asia/Seoul")).toBe("2026-11-08");
    expect(dayKey(rows[1]!.at, "Asia/Seoul")).toBe("2026-11-09");
    const query = parseActivityQuery({ from: "2026-11-01", to: "2026-11-09", tz: "Asia/Seoul" }, { tz: "UTC" });
    expect(bucketActivity(rows, query)).toMatchObject({ total: 3, activeDays: 2, sessions: 2,
      days: [{ date: "2026-11-08", count: 1, sessions: 1 }, { date: "2026-11-09", count: 2, sessions: 2 }] });
    expect(bucketActivity(rows, { ...query, tz: "UTC" }).days).toEqual([{ date: "2026-11-08", count: 3, sessions: 2 }]);
    expect(activityStreaks([{ date: "2026-11-01", count: 1 }, { date: "2026-11-02", count: 2 }, { date: "2026-11-03", count: 1 }, { date: "2026-11-08", count: 1 }], "2026-11-09"))
      .toEqual({ current: 1, longest: 3 });
    expect(parseActivityQuery({}, { tz: "Asia/Seoul", now: Date.parse("2026-11-09T00:00:00Z") })).toMatchObject({ from: "2025-11-10", to: "2026-11-09" });
    expect(() => parseActivityQuery({ tz: "Nowhere/City" }, { tz: "UTC" })).toThrow("IANA");
    expect(() => parseActivityQuery({ from: "2024-01-01", to: "2026-01-01" }, { tz: "UTC" })).toThrow("400일");
  });
});

describe("대한민국 공휴일 계산", () => {
  /** 그해 공휴일을 「MM-DD 이름」으로. 대체공휴일은 무엇을 대신하는지 괄호로 붙인다. */
  const days = (year: number) => koreanHolidays(year).map((item) => `${item.date.slice(5)} ${item.kind === "substitute" ? `대체(${item.of})` : item.name}`);

  test("2026년: 노동절·제헌절이 공휴일이고, 토·일과 겹친 국경일·부처님 오신 날은 대체공휴일이 생기며, 지방선거일이 임시공휴일이다", () => {
    expect(days(2026)).toEqual(["01-01 신정", "02-16 설날 연휴", "02-17 설날", "02-18 설날 연휴", "03-01 삼일절", "03-02 대체(삼일절)", "05-01 노동절", "05-05 어린이날",
      "05-24 부처님 오신 날", "05-25 대체(부처님 오신 날)", "06-03 지방선거일", "06-06 현충일", "07-17 제헌절", "08-15 광복절", "08-17 대체(광복절)",
      "09-24 추석 연휴", "09-25 추석", "09-26 추석 연휴", "10-03 개천절", "10-05 대체(개천절)", "10-09 한글날", "12-25 기독탄신일"]);
    expect(koreanHolidays(2026).find((item) => item.date === "2026-06-03")?.kind).toBe("temporary");
  });

  test("지난해들의 대체공휴일이 그때 규정대로 나온다", () => {
    const substitutes = (year: number) => days(year).filter((line) => line.includes("대체"));
    // 2021: 국경일 대체공휴일 확대 뒤 광복절·개천절·한글날. 성탄절(토)은 아직 대상이 아니었다.
    expect(substitutes(2021)).toEqual(["08-16 대체(광복절)", "10-04 대체(개천절)", "10-11 대체(한글날)"]);
    // 2022: 추석 연휴가 일요일과 겹치고 한글날이 일요일. 부처님 오신 날·성탄절이 일요일이어도 대상이 아니었다.
    expect(substitutes(2022)).toEqual(["09-12 대체(추석)", "10-10 대체(한글날)"]);
    // 2023: 설 연휴 일요일, 부처님 오신 날(토)은 2023-05-04 확대 뒤라 대체된다.
    expect(substitutes(2023)).toEqual(["01-24 대체(설날)", "05-29 대체(부처님 오신 날)"]);
    // 2024: 설 연휴 일요일, 어린이날 일요일. 2025: 삼일절 토요일, 어린이날과 부처님 오신 날이 같은 날, 추석 연휴 일요일.
    expect(substitutes(2024)).toEqual(["02-12 대체(설날)", "05-06 대체(어린이날)"]);
    expect(substitutes(2025)).toEqual(["03-03 대체(삼일절)", "05-06 대체(어린이날)", "10-08 대체(추석)"]);
    expect(days(2025)).toContain("01-27 임시공휴일");
    expect(days(2025)).toContain("06-03 대통령선거일");
    // 2028: 추석과 개천절이 평일에 겹친다.
    expect(substitutes(2028)).toEqual(["10-05 대체(추석)"]);
    // 2027: 노동절·제헌절도 토요일이면 대체된다.
    expect(substitutes(2027)).toEqual(["02-09 대체(설날)", "05-03 대체(노동절)", "07-19 대체(제헌절)", "08-16 대체(광복절)", "10-04 대체(개천절)", "10-11 대체(한글날)", "12-27 대체(기독탄신일)"]);
  });

  test("음력 공휴일은 윤달을 건너뛰고, 공휴일 제도 변화(한글날·제헌절·식목일)를 따른다", () => {
    // 2020년은 윤4월이 있다. 부처님 오신 날은 평달 4월 8일(4/30)이다.
    expect(days(2020)).toContain("04-30 부처님 오신 날");
    expect(days(2020)).not.toContain("05-30 부처님 오신 날");
    expect(days(2012).some((line) => line.includes("한글날"))).toBe(false);
    expect(days(2013)).toContain("10-09 한글날");
    expect(days(2007)).toContain("07-17 제헌절");
    expect(days(2025).some((line) => line.includes("제헌절"))).toBe(false);
    expect(days(2005)).toContain("04-05 식목일");
    expect(holidaysBetween("2025-12-20", "2026-01-05").map((item) => item.date)).toEqual(["2025-12-25", "2026-01-01"]);
    expect(() => koreanHolidays(1999)).toThrow("2000–2100");
    expect(parseHolidayQuery({}, Date.parse("2026-12-31T16:00:00Z"))).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(() => parseHolidayQuery({ from: "2026-01-01", to: "2029-01-01" })).toThrow("2년");
  });
});

/** 특일 정보 API 응답 한 달치(JSON). rows가 하나면 item을 객체로, 없으면 빈 문자열로 준다(실제 API와 같다). */
const kasi = (rows: Array<[string, string]>) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: {
  items: rows.length === 0 ? "" : rows.length === 1 ? { item: { dateKind: "01", dateName: rows[0]![1], isHoliday: "Y", locdate: Number(rows[0]![0]), seq: 1 } }
    : { item: rows.map(([date, name], index) => ({ dateKind: "01", dateName: name, isHoliday: "Y", locdate: date, seq: index + 1 })) },
  numOfRows: 100, pageNo: 1, totalCount: rows.length } } });
/** 2026년 10월에 실제에 없는 임시공휴일(10/30)을 하나 더한 가짜 특일 정보 */
const fakeMonth = (year: number, month: number) => (year !== 2026 ? [] : month === 10
  ? [[`20261003`, "개천절"], [`20261005`, "대체공휴일"], [`20261009`, "한글날"], [`20261030`, "임시공휴일"]] as Array<[string, string]>
  : month === 1 ? [["20260101", "1월1일"]] as Array<[string, string]> : []);
const fakeFetch = (calls: string[] = []) => (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  calls.push(url.search);
  return new Response(kasi(fakeMonth(Number(url.searchParams.get("solYear")), Number(url.searchParams.get("solMonth")))), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

describe("공휴일 공공 API(한국천문연구원 특일 정보)", () => {
  test("요청 주소: Decoding 키는 인코딩하고 Encoding 키는 그대로 쓴다", () => {
    expect(holidayApiRequest("https://api.test/getRestDeInfo", "a+b/c=", 2026, 3)).toBe("https://api.test/getRestDeInfo?serviceKey=a%2Bb%2Fc%3D&solYear=2026&solMonth=03&numOfRows=100&pageNo=1&_type=json");
    expect(holidayApiRequest("https://api.test/x", "a%2Bb", 2026, 12)).toContain("serviceKey=a%2Bb&solYear=2026&solMonth=12");
  });

  test("응답: 여러 건·한 건·없음·쉬는 날 아님을 가리고, 인증키 오류(JSON·XML)는 오류로 바꾼다", () => {
    expect(parseHolidayApi(kasi([["20261003", "개천절"], ["20261005", "대체공휴일"]]))).toEqual([{ date: "2026-10-03", name: "개천절" }, { date: "2026-10-05", name: "대체공휴일" }]);
    expect(parseHolidayApi(kasi([["20260101", "1월1일"]]))).toEqual([{ date: "2026-01-01", name: "1월1일" }]);
    expect(parseHolidayApi(kasi([]))).toEqual([]);
    const notHoliday = JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: { locdate: 20260505, dateName: "어린이날", isHoliday: "N" } } } } });
    expect(parseHolidayApi(notHoliday)).toEqual([]);
    const gateway = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnAuthMsg: "등록되지 않은 서비스키", returnReasonCode: "30" } } });
    expect(() => parseHolidayApi(gateway, 401)).toThrow("등록되지 않은 서비스키");
    expect(() => parseHolidayApi("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"))
      .toThrow("LIMITED_NUMBER");
    expect(() => parseHolidayApi(JSON.stringify({ response: { header: { resultCode: "22", resultMsg: "LIMITED" } } }))).toThrow("22 LIMITED");
    expect(parseHolidayApi("<response><header><resultCode>00</resultCode></header><body><items><item><dateName>설날</dateName><isHoliday>Y</isHoliday><locdate>20260217</locdate></item></items></body></response>"))
      .toEqual([{ date: "2026-02-17", name: "설날" }]);
  });

  test("이름과 종류를 맞추고(신정·부처님 오신 날·선거일), 대체공휴일이 대신하는 공휴일은 계산에서 찾는다", () => {
    expect(normalizeApiHolidays(2026, [{ date: "2026-01-01", name: "1월1일" }, { date: "2026-05-24", name: "부처님오신날" }, { date: "2026-05-25", name: "대체공휴일" },
      { date: "2026-06-03", name: "전국동시지방선거" }, { date: "2026-06-03", name: "전국동시지방선거" }, { date: "2027-01-01", name: "1월1일" }])).toEqual([
      { date: "2026-01-01", name: "신정", kind: "holiday" }, { date: "2026-05-24", name: "부처님 오신 날", kind: "holiday" },
      { date: "2026-05-25", name: "대체공휴일", kind: "substitute", of: "부처님 오신 날" }, { date: "2026-06-03", name: "전국동시지방선거", kind: "temporary" },
    ]);
  });

  test("한 해를 열두 달 차례로 받고, 받아 둔 해는 그 자료를, 없는 해는 계산을 쓴다", async () => {
    const calls: string[] = [];
    const items = await fetchHolidayYear(2026, { key: "k", base: "https://api.test/getRestDeInfo", fetch: fakeFetch(calls) });
    expect(calls).toHaveLength(12);
    expect(items.map((item) => `${item.date} ${item.name}`)).toEqual(["2026-01-01 신정", "2026-10-03 개천절", "2026-10-05 대체공휴일", "2026-10-09 한글날", "2026-10-30 임시공휴일"]);
    const synced = (year: number) => (year === 2026 ? { year, syncedAt: "2026-11-11T00:00:00.000Z", items } : null);
    const list = mergedHolidayList({ from: "2026-10-01", to: "2027-01-31" }, synced);
    expect(list.sources).toEqual([{ year: 2026, source: "kasi", syncedAt: "2026-11-11T00:00:00.000Z" }, { year: 2027, source: "computed", syncedAt: null }]);
    expect(list.items.map((item) => item.date)).toEqual(["2026-10-03", "2026-10-05", "2026-10-09", "2026-10-30", "2027-01-01"]);
    expect(holidaysStale(synced, Date.parse("2026-11-11T12:00:00Z"))).toBe(false);
    expect(holidaysStale(synced, Date.parse("2026-11-12T12:00:00Z"))).toBe(true);
    expect(holidaysStale(() => null, Date.parse("2026-11-11T12:00:00Z"))).toBe(true);
  });

  test("다음 서울 00시까지 남은 시간", () => {
    expect(msUntilSeoulMidnight(Date.parse("2026-11-10T14:59:00Z"))).toBe(60_000); // 서울 23:59
    expect(msUntilSeoulMidnight(Date.parse("2026-11-10T15:00:00Z"))).toBe(86_400_000); // 서울 00:00 정각이면 하루 뒤
    expect(msUntilSeoulMidnight(Date.parse("2026-11-10T03:00:00Z"))).toBe(12 * 3_600_000); // 서울 정오
  });

  test("로컬 동기화: 받아 holidays.json에 두고, 인증키 오류면 이유를 남기며 받아 둔 자료는 지우지 않는다", async () => {
    const f = fixture();
    try {
      const config = { ...f.config, holidayApiKey: "k", holidayApiUrl: "https://api.test/getRestDeInfo" };
      const result = await syncLocalHolidays(config, Date.parse("2026-11-11T00:00:05+09:00"), fakeFetch());
      expect(result.years).toEqual([{ year: 2026, count: 5, stored: true }, { year: 2027, count: 0, stored: false }]);
      expect(readHolidayCache(config).years["2026"]?.items).toHaveLength(5);
      const refused = (async () => new Response(JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: "등록되지 않은 서비스키" } } }), { status: 401 })) as unknown as typeof fetch;
      await expect(syncLocalHolidays(config, Date.now(), refused)).rejects.toThrow("등록되지 않은 서비스키");
      const cache = readHolidayCache(config);
      expect(cache.state.lastError).toContain("등록되지 않은 서비스키");
      expect(cache.years["2026"]?.items).toHaveLength(5);
      await expect(syncLocalHolidays(f.config)).rejects.toThrow("holidayApiKey");
    } finally { f.close(); }
  });

  test("로컬 스케줄러: 자료가 없으면 켤 때 곧 받고, 인증키가 없거나 원격 모드면 아무것도 하지 않는다", async () => {
    const f = fixture();
    try {
      const config = { ...f.config, holidayApiKey: "k", holidayApiUrl: "https://api.test/getRestDeInfo" };
      startHolidaySync({ ...f.config }).stop();
      startHolidaySync({ ...config, mode: "remote" as const }).stop();
      expect(existsSync(holidayCachePath(config))).toBe(false);
      const job = startHolidaySync(config, { send: fakeFetch(), startDelayMs: 0 });
      try {
        await Bun.sleep(300);
        expect(readHolidayCache(config).state.lastSuccessAt).not.toBeNull();
      } finally { job.stop(); }
    } finally { f.close(); }
  });
});

describe("일정 관리 로컬 저장소와 HTTP API", () => {
  let f: ReturnType<typeof fixture>;
  let send: (url: string, init?: RequestInit) => Promise<Response>;
  const origin = "http://127.0.0.1:7474";
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) => send(route, {
    method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });
  beforeEach(() => {
    f = fixture();
    const handle = handler(f.service, f.config, { planner: new PlannerStore(f.db) });
    send = async (url, init = {}) => handle(new Request(`${origin}${url}`, { ...init, headers: { host: "127.0.0.1:7474", ...init.headers } }));
  });
  afterEach(() => f.close());

  test("Task·일정 저장, ETag 304, 필터, 같은 출처만 쓰기", async () => {
    expect(await (await send("/api/v1/tasks")).json()).toEqual({ schemaVersion: 1, revision: 0, items: [] });
    const saved = await post("/api/v1/tasks", { upserts: [task("a", { provider: "anthropic" }), task("b", { status: "done", project: "relay" })], deletes: [] });
    expect(await saved.json()).toEqual({ schemaVersion: 1, revision: 1 });
    const list = await send("/api/v1/tasks");
    expect(list.headers.get("etag")).toBe('"1"');
    expect((await list.json()).items.map((item: Task) => item.id)).toEqual(["a", "b"]);
    expect((await send("/api/v1/tasks", { headers: { "if-none-match": '"1"' } })).status).toBe(304);
    expect((await (await send("/api/v1/tasks?provider=anthropic")).json()).items.map((item: Task) => item.id)).toEqual(["a"]);
    expect((await (await send("/api/v1/tasks?project=relay&status=done")).json()).items.map((item: Task) => item.id)).toEqual(["b"]);
    expect((await send("/api/v1/tasks?nope=1")).status).toBe(400);
    // 다른 출처나 Origin 없는 쓰기는 거부한다.
    expect((await post("/api/v1/tasks", { upserts: [task("c")] }, { origin: "http://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post("/api/v1/tasks", { upserts: [task("c", { status: "later" as never })] })).status).toBe(400);
    await post("/api/v1/events", { upserts: [{ id: "e1", allDay: false, start: "2026-11-09T10:00", end: "2026-11-09T11:00", title: "회의",
      attachments: [{ kind: "task", id: "a" }], createdAt: 5, updatedAt: 5 }] });
    const events = await (await send("/api/v1/events?from=2026-11-01&to=2026-11-30")).json();
    expect(events).toMatchObject({ revision: 2, items: [{ id: "e1", allDay: false, start: "2026-11-09T10:00", color: "blue", attachments: [{ kind: "task", id: "a" }] }] });
    expect((await (await send("/api/v1/events?from=2026-12-01")).json()).items).toEqual([]);
    expect((await send("/api/v1/events", { method: "PUT" })).status).toBe(405);
  });

  test("업무 보드 API: 칸에 놓기·내리기·완료 비우기, 바뀐 것이 없으면 저장 번호도 그대로", async () => {
    await post("/api/v1/tasks", { upserts: [task("a", { createdAt: 1 }), task("b", { createdAt: 2 })] });
    expect((await (await send("/api/v1/board")).json()).inventory.map((item: Task) => item.id)).toEqual(["b", "a"]);
    expect(await (await post("/api/v1/board", { action: "place", id: "a", status: "review" })).json()).toEqual({ schemaVersion: 1, revision: 2, changed: 1 });
    await post("/api/v1/board", { action: "place", id: "b", status: "review", index: 0 });
    const board = await (await send("/api/v1/board")).json();
    expect(board.columns[2]).toMatchObject({ status: "review", label: "검토" });
    expect(board.columns[2].items.map((item: Task) => item.id)).toEqual(["b", "a"]);
    expect(await (await post("/api/v1/board", { action: "remove", id: "zzz" })).json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    await post("/api/v1/board", { action: "place", id: "a", status: "done" });
    expect((await (await post("/api/v1/board", { action: "clear-done" })).json()).changed).toBe(1);
    expect(await (await post("/api/v1/board", { action: "clear-done" })).json()).toEqual({ schemaVersion: 1, revision: 5, changed: 0 });
    expect((await send("/api/v1/board?x=1")).status).toBe(400);
  });

  test("잔디 API: 에이전트 기록을 날마다 세고 훅 자동 기록은 빼며, 세션이 지워져도 남는다", async () => {
    f.service.record(input("hooked", { summary: HOOK_SUMMARY }));
    f.service.update("hooked", "첫 작업");
    f.service.record(input("claude", { provider: "anthropic", agent: "claude-code" }));
    const tz = "Asia/Seoul";
    const today = dayKey(Date.now(), tz);
    const year = await (await send(`/api/v1/activity?tz=${tz}`)).json();
    expect(year).toMatchObject({ schemaVersion: 1, tz, to: today, total: 2, activeDays: 1, sessions: 2, days: [{ date: today, count: 2, sessions: 2 }] });
    expect((await (await send(`/api/v1/activity?tz=${tz}&provider=anthropic`)).json()).total).toBe(1);
    const day = await (await send(`/api/v1/activity/day?date=${today}&tz=${tz}`)).json();
    expect(day.sessions.map((session: { providerSessionId: string }) => session.providerSessionId).sort()).toEqual(["claude", "hooked"]);
    f.db.query("DELETE FROM sessions WHERE provider_session_id = 'claude'").run();
    expect((await (await send(`/api/v1/activity?tz=${tz}`)).json()).total).toBe(2);
    expect((await (await send(`/api/v1/activity/day?date=${today}&tz=${tz}`)).json()).sessions.find((session: { deleted: boolean }) => session.deleted))
      .toMatchObject({ provider: "anthropic", agent: "claude-code", providerSessionId: null });
    expect((await send("/api/v1/activity/day")).status).toBe(400);
    // 공휴일 API: 받아 둔 자료가 없으면 계산으로 답한다.
    const holidays = await (await send("/api/v1/holidays?year=2026")).json();
    expect(holidays).toMatchObject({ schemaVersion: 1, from: "2026-01-01", to: "2026-12-31", knownUntil: "2026-12-31", sources: [{ year: 2026, source: "computed", syncedAt: null }],
      sync: { configured: false, lastError: null } });
    expect(holidays.items).toContainEqual({ date: "2026-10-05", name: "대체공휴일", kind: "substitute", of: "개천절" });
    expect((await send("/api/v1/holidays?year=1990")).status).toBe(400);
    // 받아 둔 해(holidays.json)는 그 자료를 쓴다.
    writeFileSync(holidayCachePath(f.config), JSON.stringify({ schemaVersion: 1, state: {}, years: { "2026": { year: 2026, syncedAt: "2026-11-11T00:00:00.000Z",
      items: [{ date: "2026-10-30", name: "임시공휴일", kind: "temporary" }] } } }));
    const synced = await (await send("/api/v1/holidays?from=2026-10-01&to=2026-10-31")).json();
    expect(synced.items).toEqual([{ date: "2026-10-30", name: "임시공휴일", kind: "temporary" }]);
    expect(synced.sources[0]).toMatchObject({ source: "kasi" });
    // 인증키가 없으면 즉시 동기화는 409이고, GET으로는 부를 수 없다.
    expect((await post("/api/v1/holidays/sync", {})).status).toBe(409);
    expect((await send("/api/v1/holidays/sync")).status).toBe(405);
    expect(JSON.parse(readFileSync(holidayCachePath(f.config), "utf8")).years["2026"].items).toHaveLength(1);
    expect((await send("/api/v1/activity", { method: "POST", headers: { origin, "content-type": "application/json" } })).status).toBe(405);
  });

  test("일정 관리 저장소가 없으면 쓰기 경로가 열리지 않는다", async () => {
    const handle = handler(f.service, f.config);
    const response = await handle(new Request(`${origin}/api/v1/tasks`, { method: "POST", body: "{}", headers: { host: "127.0.0.1:7474", origin, "content-type": "application/json" } }));
    expect(response.status).toBe(405);
  });
});

describe("스키마 v8 → v9", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));

  test("일정 관리 표를 더하고, 지금까지의 에이전트 기록을 잔디 로그로 옮기며, 새 스키마와 같아진다", () => {
    const db = new Database(path.join(dir, "relay.db"));
    db.exec(v8Schema);
    db.exec("PRAGMA user_version = 8");
    const at = "2026-10-01T00:00:00.000Z";
    db.query(`INSERT INTO sessions (id, provider, agent, provider_session_id, working_directory, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("ses_old", "openai", "codex", "old", dir, "맥락", at, at);
    db.query("INSERT INTO session_updates (id, session_id, sequence, summary, created_at) VALUES (?, ?, ?, ?, ?)").run("u1", "ses_old", 1, HOOK_SUMMARY, at);
    db.query("INSERT INTO session_updates (id, session_id, sequence, summary, created_at) VALUES (?, ?, ?, ?, ?)").run("u2", "ses_old", 2, "작업", at);
    db.close();
    const fresh = new Database(":memory:");
    fresh.exec(v9Schema);
    const schemaOf = (target: Database) => target.query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const writer = openDatabase(loadConfig(dir));
    try {
      expect(writer.query("PRAGMA user_version").get()).toEqual({ user_version: DB_VERSION });
      expect(schemaOf(writer)).toEqual(schemaOf(fresh));
      expect(writer.query("SELECT session_id, provider, agent, created_at FROM activity_log").all()).toEqual([{ session_id: "ses_old", provider: "openai", agent: "codex", created_at: at }]);
      const store = new PlannerStore(writer);
      expect(store.applyTasks({ upserts: [task("t")], deletes: [] }).revision).toBe(1);
      expect(writer.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { writer.close(); fresh.close(); }
  });
});
