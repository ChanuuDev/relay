import { describe, expect, test } from "bun:test";
import { parseExcludedRanges, parseLaunchUrl, portFailure, reservedPortRange } from "../src/web/control";

const NETSH = `
프로토콜 tcp 포트 제외 범위

시작 포트    끝 포트
----------    --------
      2180        2279
      7462        7561
     50000       50059     *

* - 관리 포트 제외입니다.
`;

describe("Web server control", () => {
  test("parseExcludedRanges reads netsh ranges and marks administered ones", () => {
    expect(parseExcludedRanges(NETSH)).toEqual([
      { start: 2180, end: 2279, administered: false },
      { start: 7462, end: 7561, administered: false },
      { start: 50000, end: 50059, administered: true },
    ]);
    expect(parseExcludedRanges("")).toEqual([]);
  });

  test("portFailure explains a port inside a dynamic Windows reservation and keeps the plain error otherwise", () => {
    // 65535는 어떤 예약 범위에도 들지 않으므로 원래 오류가 그대로 나온다.
    const plain = portFailure(65535, "PORT_IN_USE", "포트가 사용 중입니다.");
    expect(plain.code).toBe("PORT_IN_USE"); expect(plain.exitCode).toBe(6);
    const range = reservedPortRange(65535);
    expect(range).toBeNull();
  });

  test("parseLaunchUrl accepts only relay://web with a user port", () => {
    expect(parseLaunchUrl("relay://web")).toEqual({ port: 7474 });
    expect(parseLaunchUrl("relay://web/?port=7593")).toEqual({ port: 7593 });
    for (const bad of ["relay://evil", "relay://web/x", "relay://web?port=80", "relay://web?port=70000", "relay://web?port=x", "http://web", "nope"]) {
      expect(() => parseLaunchUrl(bad), bad).toThrow();
    }
  });
});
