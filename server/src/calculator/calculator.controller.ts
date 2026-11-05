import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { RelayError, parseHistoryAction } from "@relay/core";
import { Auth, type AuthContext } from "../common/decorators.js";
import { CalculatorService } from "./calculator.service.js";

@Controller("api/v1/calculator/history")
export class CalculatorController {
  constructor(private readonly calculator: CalculatorService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "계산 이력은 query를 받지 않습니다.");
    return this.calculator.list(auth.userId);
  }

  @Post()
  @HttpCode(200)
  apply(@Auth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new RelayError("INVALID_ARGUMENT", "계산 이력 저장은 query를 받지 않습니다.");
    return this.calculator.apply(auth.userId, parseHistoryAction(body));
  }
}
