import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { RelayError, holidayList, parseActivityDayQuery, parseActivityQuery, parseBoardAction, parseEventBatch, parseEventFilter, parseHolidayQuery, parseTaskBatch,
  parseTaskFilter } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { PlannerService } from "./planner.service.js";

/** query를 키 하나에 값 하나로 읽는다(같은 키를 두 번 주면 거부). */
const single = (query: Record<string, unknown>) => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== "string") throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
    result[key] = value;
  }
  return result;
};
const noQuery = (query: Record<string, unknown>, what: string) => {
  if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", `${what}은(는) query를 받지 않습니다.`);
};
/** 원격 서버는 시간대를 모를 수 있으므로(화면은 늘 tz를 보낸다) 기본은 서버 시간대다. */
const serverZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** ETag가 저장 번호(revision)라 바뀌지 않았으면 304로 본문 없이 답한다. */
async function tagged<T extends { revision: number }>(response: Response, ifNoneMatch: string | undefined, revision: Promise<number>, load: () => Promise<T>) {
  const tag = `"${await revision}"`;
  if (ifNoneMatch === tag) { response.status(304).setHeader("ETag", tag).end(); return; }
  const data = await load();
  response.setHeader("ETag", `"${data.revision}"`).json(data);
}

@Controller("api/v1/tasks")
export class TasksController {
  constructor(private readonly planner: PlannerService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() response: Response) {
    const filter = parseTaskFilter(single(query));
    await tagged(response, ifNoneMatch, this.planner.revision(auth.userId), () => this.planner.tasks(auth.userId, filter));
  }

  @Post()
  @HttpCode(200)
  save(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "Task 저장");
    return this.planner.applyTasks(auth.userId, parseTaskBatch(body));
  }
}

@Controller("api/v1/board")
export class BoardController {
  constructor(private readonly planner: PlannerService) {}

  @Get()
  async view(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() response: Response) {
    noQuery(query, "업무 보드");
    await tagged(response, ifNoneMatch, this.planner.revision(auth.userId), () => this.planner.board(auth.userId));
  }

  @Post()
  @HttpCode(200)
  act(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "보드 동작");
    return this.planner.applyBoard(auth.userId, parseBoardAction(body));
  }
}

@Controller("api/v1/events")
export class EventsController {
  constructor(private readonly planner: PlannerService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() response: Response) {
    const filter = parseEventFilter(single(query));
    await tagged(response, ifNoneMatch, this.planner.revision(auth.userId), () => this.planner.events(auth.userId, filter));
  }

  @Post()
  @HttpCode(200)
  save(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    noQuery(query, "일정 저장");
    return this.planner.applyEvents(auth.userId, parseEventBatch(body));
  }
}

/** 대한민국 관공서 공휴일·대체공휴일·선거일·임시공휴일. 계산이라 저장소를 쓰지 않는다. */
@Controller("api/v1/holidays")
export class HolidaysController {
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return holidayList(parseHolidayQuery(single(query)));
  }
}

@Controller("api/v1/activity")
export class ActivityController {
  constructor(private readonly planner: PlannerService) {}

  /** 잔디: 날마다 남긴 세션 기록 수 */
  @Get()
  days(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.planner.activity(auth.userId, parseActivityQuery(single(query), { tz: serverZone() }));
  }

  /** 그날 기록한 세션 */
  @Get("day")
  day(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.planner.activityDay(auth.userId, parseActivityDayQuery(single(query), { tz: serverZone() }));
  }
}
