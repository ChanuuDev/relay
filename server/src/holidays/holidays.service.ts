import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { inArray } from "drizzle-orm";
import { fetchHolidayYear, HOLIDAY_API_URL, holidaySyncYears, holidaysStale, mergedHolidayList, parseHolidayYear, RelayError, type HolidaySyncResult,
  type HolidaySyncState, type HolidayYear } from "@relay/core";
import { CONFIG } from "../app.tokens.js";
import type { ServerConfig } from "../config.js";
import { DB, schema, type Db } from "../db/database.js";

const { holidayYears } = schema;

/** 공휴일: 한국천문연구원 특일 정보(공공데이터포털)를 매일 서울 00:00에 받아 holiday_years에 두고, 받지 못한 해는 계산으로 채운다.
 *  인증키(HOLIDAY_API_KEY)가 없으면 받지 않고 계산만 쓴다. 공휴일은 모든 사용자에게 같으므로 사용자별로 나누지 않는다. */
@Injectable()
export class HolidaysService implements OnModuleInit {
  private readonly logger = new Logger("holidays");
  private state: HolidaySyncState;
  private running: Promise<HolidaySyncResult> | null = null;

  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: ServerConfig) {
    this.state = { lastAttemptAt: null, lastSuccessAt: null, lastError: null, configured: Boolean(config.holidayApiKey) };
  }

  /** 켤 때 올해 자료가 없거나 하루 넘게 지났으면 곧바로 한 번 받는다(기동을 막지 않는다). */
  onModuleInit() {
    if (!this.config.holidayApiKey) return;
    void this.stored().then((years) => {
      if (holidaysStale((year) => years.get(year) ?? null)) return this.sync("startup");
    }).catch((error: Error) => this.logger.warn(`공휴일 동기화 실패(startup): ${error.message}`));
  }

  /** 매일 서울 00:00 */
  @Cron("0 0 0 * * *", { timeZone: "Asia/Seoul", name: "holiday-sync" })
  async nightly() {
    if (!this.config.holidayApiKey) return;
    try { await this.sync("nightly"); } catch (error) { this.logger.warn(`공휴일 동기화 실패(nightly): ${(error as Error).message}`); }
  }

  private async stored(years?: number[]): Promise<Map<number, HolidayYear>> {
    const rows = years ? await this.db.select().from(holidayYears).where(inArray(holidayYears.year, years)) : await this.db.select().from(holidayYears);
    const map = new Map<number, HolidayYear>();
    for (const row of rows) {
      const parsed = parseHolidayYear({ year: row.year, syncedAt: row.syncedAt.toISOString(), items: row.items });
      if (parsed) map.set(row.year, parsed);
    }
    return map;
  }

  async list(query: { from: string; to: string }) {
    const years: number[] = [];
    for (let year = Number(query.from.slice(0, 4)); year <= Number(query.to.slice(0, 4)); year++) years.push(year);
    const stored = await this.stored(years);
    return mergedHolidayList(query, (year) => stored.get(year) ?? null, this.state);
  }

  /** 지금 받아 온다. 동시에 부르면 하던 것을 기다린다. 받은 해가 비어 있으면(아직 발표 전) 있던 자료를 지우지 않는다. */
  sync(reason = "manual"): Promise<HolidaySyncResult> {
    if (!this.config.holidayApiKey) {
      return Promise.reject(new RelayError("HOLIDAY_API_KEY_MISSING", "공휴일 API 인증키가 없습니다. 서버 환경 변수 HOLIDAY_API_KEY에 공공데이터포털 인증키를 넣으세요.", 2, 409));
    }
    this.running ??= this.run(reason).finally(() => { this.running = null; });
    return this.running;
  }

  private async run(reason: string): Promise<HolidaySyncResult> {
    const at = new Date();
    this.state = { ...this.state, lastAttemptAt: at.toISOString() };
    try {
      const years: HolidaySyncResult["years"] = [];
      for (const year of holidaySyncYears(at.getTime())) {
        const items = await fetchHolidayYear(year, { key: this.config.holidayApiKey!, base: this.config.holidayApiUrl ?? HOLIDAY_API_URL });
        if (items.length) {
          await this.db.insert(holidayYears).values({ year, items, syncedAt: at })
            .onConflictDoUpdate({ target: holidayYears.year, set: { items, syncedAt: at } });
        }
        years.push({ year, count: items.length, stored: items.length > 0 });
      }
      this.state = { ...this.state, lastSuccessAt: at.toISOString(), lastError: null };
      this.logger.log(`공휴일 동기화(${reason}): ${years.map((item) => `${item.year}년 ${item.count}일`).join(", ")}`);
      return { schemaVersion: 1, syncedAt: at.toISOString(), years };
    } catch (error) {
      this.state = { ...this.state, lastError: error instanceof RelayError ? error.message : "공휴일을 받아 오지 못했습니다." };
      throw error;
    }
  }
}
