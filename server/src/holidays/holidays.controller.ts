import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { parseHolidayQuery, RelayError } from "@relay/core";
import { HolidaysService } from "./holidays.service.js";

/** 대한민국 관공서 공휴일·대체공휴일·선거일·임시공휴일. 공공 API로 받아 둔 해는 그 자료, 나머지는 계산이다. */
@Controller("api/v1/holidays")
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== "string") throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
      values[key] = value;
    }
    return this.holidays.list(parseHolidayQuery(values));
  }

  /** 지금 받아 온다(평소에는 매일 서울 00:00에 받는다). */
  @Post("sync")
  @HttpCode(200)
  sync(@Body() _body: unknown, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "공휴일 동기화는 query를 받지 않습니다.");
    return this.holidays.sync();
  }
}
