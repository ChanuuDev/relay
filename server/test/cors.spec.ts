import { afterEach, describe, expect, test } from "vitest";
import { RelayError } from "@relay/core";
import { parseCorsOrigins } from "../src/config.js";
import { testApp, type TestApp } from "./helpers.js";

const WEB = "https://relay-web.example.com";

describe("브라우저 모드 CORS", () => {
  let t: TestApp | undefined;
  afterEach(async () => { await t?.close(); t = undefined; });

  test("허용한 출처만 사전 요청에 답하고 응답 헤더를 연다", async () => {
    t = await testApp({ corsOrigins: [WEB] });
    const preflight = await t.raw.options("/api/v1/notes").set("Origin", WEB).set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization, content-type").expect(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(WEB);
    expect(preflight.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    const list = await t.get("/api/v1/notes").set("Origin", WEB).expect(200);
    expect(list.headers["access-control-allow-origin"]).toBe(WEB);
    expect(list.headers["access-control-expose-headers"]).toContain("ETag");
    // 토큰이 없으면 CORS 헤더가 있어도 인증은 그대로 막는다.
    const denied = await t.raw.get("/api/v1/notes").set("Origin", WEB).expect(401);
    expect(denied.headers["access-control-allow-origin"]).toBe(WEB);
    const other = await t.get("/api/v1/notes").set("Origin", "https://evil.example.com").expect(200);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const otherPreflight = await t.raw.options("/api/v1/notes").set("Origin", "https://evil.example.com").set("Access-Control-Request-Method", "POST");
    expect(otherPreflight.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("설정이 없으면 CORS를 열지 않는다", async () => {
    t = await testApp();
    const response = await t.get("/api/v1/notes").set("Origin", WEB).expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("RELAY_CORS_ORIGINS는 출처 형식만 받는다", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins(` ${WEB}/ , ${WEB}, http://localhost:5173`)).toEqual([WEB, "http://localhost:5173"]);
    for (const bad of ["relay-web.example.com", "http://relay-web.example.com", `${WEB}/path`, "*"]) {
      expect(() => parseCorsOrigins(bad)).toThrow(RelayError);
    }
  });
});
