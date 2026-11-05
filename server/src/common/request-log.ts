import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const logger = new Logger("http");

/** 메서드·경로·상태·소요 시간만 남긴다. 토큰·본문·query 값은 남기지 않는다. */
export function requestLog(request: Request, response: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  response.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    const line = `${request.method} ${request.path} ${response.statusCode} ${ms.toFixed(1)}ms`;
    if (response.statusCode >= 500) logger.error(line);
    else if (response.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });
  next();
}
