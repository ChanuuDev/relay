import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchHolidayYear, HOLIDAY_API_URL, holidaySyncYears, holidaysStale, mergedHolidayList, msUntilSeoulMidnight, parseHolidayQuery, parseHolidayYear, RelayError,
  type HolidaySyncResult, type HolidaySyncState, type HolidayYear } from "@relay/core";
import { ensureDataDirectory, type Config } from "../config";

// 로컬 모드의 공휴일 동기화. 공공데이터포털 인증키(config.json의 holidayApiKey)가 있으면 매일 서울 00:00에 올해·내년 공휴일을 받아
// 데이터 폴더의 holidays.json에 둔다. 원격 모드는 원격 서버가 같은 일을 하므로 여기서는 하지 않는다.

type Cache = { schemaVersion: 1; years: Record<string, HolidayYear>; state: HolidaySyncState };
const FILE = "holidays.json";
const empty = (configured: boolean): Cache => ({ schemaVersion: 1, years: {}, state: { lastAttemptAt: null, lastSuccessAt: null, lastError: null, configured } });

export const holidayCachePath = (config: Config) => path.join(config.dataDirectory, FILE);

/** 받아 둔 공휴일. 파일이 없거나 깨졌으면 비어 있다. */
export function readHolidayCache(config: Config): Cache {
  const configured = Boolean(config.holidayApiKey);
  try {
    const raw = JSON.parse(readFileSync(holidayCachePath(config), "utf8")) as Partial<Cache>;
    const years: Record<string, HolidayYear> = {};
    for (const [key, value] of Object.entries(raw.years ?? {})) { const year = parseHolidayYear(value); if (year && String(year.year) === key) years[key] = year; }
    const state = raw.state && typeof raw.state === "object" ? raw.state : empty(configured).state;
    return { schemaVersion: 1, years, state: { lastAttemptAt: state.lastAttemptAt ?? null, lastSuccessAt: state.lastSuccessAt ?? null, lastError: state.lastError ?? null, configured } };
  } catch { return empty(configured); }
}

function writeCache(config: Config, cache: Cache) {
  ensureDataDirectory(config);
  const target = holidayCachePath(config);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

/** GET /api/v1/holidays: 받아 둔 해는 공공 API 자료, 나머지는 계산 */
export function localHolidays(config: Config, query: Record<string, string>) {
  const cache = readHolidayCache(config);
  return mergedHolidayList(parseHolidayQuery(query), (year) => cache.years[String(year)] ?? null, cache.state);
}

/** 지금 받아 온다. 받은 해가 비어 있으면(아직 발표 전) 있던 자료를 지우지 않는다. 실패해도 이유를 남기고 다시 던진다. */
export async function syncLocalHolidays(config: Config, now = Date.now(), send: typeof fetch = fetch): Promise<HolidaySyncResult> {
  const key = config.holidayApiKey;
  if (!key) throw new RelayError("HOLIDAY_API_KEY_MISSING", "공휴일 API 인증키가 없습니다. config.json의 holidayApiKey에 공공데이터포털 인증키를 넣으세요.", 2, 409);
  const cache = readHolidayCache(config);
  const at = new Date(now).toISOString();
  cache.state.lastAttemptAt = at;
  try {
    const years: HolidaySyncResult["years"] = [];
    for (const year of holidaySyncYears(now)) {
      const items = await fetchHolidayYear(year, { key, base: config.holidayApiUrl ?? HOLIDAY_API_URL, fetch: send });
      if (items.length) cache.years[String(year)] = { year, syncedAt: at, items };
      years.push({ year, count: items.length, stored: items.length > 0 });
    }
    cache.state.lastSuccessAt = at;
    cache.state.lastError = null;
    writeCache(config, cache);
    return { schemaVersion: 1, syncedAt: at, years };
  } catch (error) {
    cache.state.lastError = error instanceof RelayError ? error.message : "공휴일을 받아 오지 못했습니다.";
    try { writeCache(config, cache); } catch { /* 상태를 남기지 못해도 다음 시도는 한다. */ }
    throw error;
  }
}

/** 매일 서울 00:00에 동기화한다. 켤 때 자료가 없거나 하루 넘게 지났으면 곧바로 한 번 받는다. 인증키가 없거나 원격 모드면 아무것도 하지 않는다. */
export function startHolidaySync(config: Config, options: { send?: typeof fetch; now?: () => number; startDelayMs?: number } = {}) {
  if (config.mode === "remote" || !config.holidayApiKey) return { stop() {} };
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = () => syncLocalHolidays(config, now(), options.send).catch(() => { /* 이유는 holidays.json의 state.lastError에 남는다. */ });
  const nightly = () => {
    if (stopped) return;
    timer = setTimeout(() => { void run().finally(nightly); }, msUntilSeoulMidnight(now()));
    timer.unref?.();
  };
  const cache = readHolidayCache(config);
  if (holidaysStale((year) => cache.years[String(year)] ?? null, now())) {
    const first = setTimeout(() => { if (!stopped) void run(); }, options.startDelayMs ?? 5000);
    first.unref?.();
  }
  nightly();
  return { stop() { stopped = true; clearTimeout(timer); } };
}
