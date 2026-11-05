import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MAX_HISTORY } from "@relay/core";
import { testApp, type TestApp } from "./helpers.js";

describe("원격 계산기 이력 API", () => {
  let t: TestApp;
  beforeEach(async () => { t = await testApp(); });
  afterEach(async () => { await t.close(); });

  test("추가·중복 무시·삭제·전체 삭제", async () => {
    expect((await t.get("/api/v1/calculator/history").expect(200)).body).toEqual({ schemaVersion: 1, items: [] });
    const item = { id: "c1", expression: "1 + 2", result: "3", createdAt: 1000 };
    expect((await t.post("/api/v1/calculator/history", { action: "add", item }).expect(200)).body.added).toBe(true);
    expect((await t.post("/api/v1/calculator/history", { action: "add", item }).expect(200)).body.added).toBe(false);
    await t.post("/api/v1/calculator/history", { action: "add", item: { ...item, id: "c2", createdAt: 2000 } }).expect(200);
    const list = (await t.get("/api/v1/calculator/history").expect(200)).body.items;
    expect(list.map((i: { id: string }) => i.id)).toEqual(["c2", "c1"]);
    expect((await t.post("/api/v1/calculator/history", { action: "delete", id: "c1" }).expect(200)).body.deleted).toBe(1);
    expect((await t.post("/api/v1/calculator/history", { action: "clear" }).expect(200)).body.deleted).toBe(1);
    expect((await t.post("/api/v1/calculator/history", { action: "add", item: { ...item, extra: 1 } })).body.error.code).toBe("INVALID_ARGUMENT");
    expect((await t.post("/api/v1/calculator/history", { action: "nope" })).body.error.code).toBe("INVALID_ARGUMENT");
  });

  test(`최근 ${MAX_HISTORY}건만 남긴다`, async () => {
    for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
      await t.post("/api/v1/calculator/history", { action: "add", item: { id: `c${index}`, expression: `${index}`, result: `${index}`, createdAt: index } }).expect(200);
    }
    const items = (await t.get("/api/v1/calculator/history").expect(200)).body.items as { id: string }[];
    expect(items.length).toBe(MAX_HISTORY);
    expect(items[0].id).toBe(`c${MAX_HISTORY + 4}`);
    expect(items.at(-1)!.id).toBe("c5");
  });
});
