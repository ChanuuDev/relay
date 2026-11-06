import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type supertest from "supertest";
import { testApp, type TestApp } from "./helpers.js";

/** supertest 요청은 then/end를 불러야 떠난다. 응답을 기다리지 않고 먼저 보내 둔다. */
const start = (request: supertest.Test) => new Promise<supertest.Response>((resolve, reject) => request.end((error, response) => (error ? reject(error) : resolve(response))));
const headerValue = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("PC 파일 중계", () => {
  let t: TestApp;
  let device: string;
  beforeEach(async () => {
    t = await testApp();
    device = (await t.post("/api/v1/devices/register", { name: "office-pc", platform: "win32" }).expect(200)).body.device.id;
  });
  afterEach(async () => { await t.close(); });

  const poll = (wait = 5) => start(t.get(`/api/v1/agent/next?wait=${wait}`).set("X-Relay-Device", device));
  const online = async () => {
    for (let index = 0; index < 50; index += 1) {
      const items = (await t.get("/api/v1/pcs").expect(200)).body.items as { id: string; online: boolean }[];
      if (items.find((item) => item.id === device)?.online) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("PC가 연결되지 않았습니다.");
  };
  const reply = (id: string, status: number, headers: Record<string, string>, body: string) => t.raw.post(`/api/v1/agent/reply/${id}`)
    .set("Authorization", `Bearer ${t.token}`).set("X-Relay-Device", device).set("Content-Type", "application/octet-stream")
    .set("X-Relay-Status", String(status)).set("X-Relay-Headers", headerValue(headers)).send(Buffer.from(body));

  test("브라우저 요청을 기다리던 PC에 넘기고, PC가 흘려보낸 응답을 허용한 헤더만 붙여 돌려준다", async () => {
    const waiting = poll();
    await online();
    const browsing = start(t.get(`/api/v1/pcs/${device}/files?path=${encodeURIComponent("C:\\Users")}`).set("Range", "bytes=0-9"));
    const job = (await waiting).body.job as { id: string; method: string; path: string; query: string; headers: Record<string, string>; body: string | null };
    expect(job).toMatchObject({ method: "GET", path: "/api/v1/files", query: `path=${encodeURIComponent("C:\\Users")}`, headers: { range: "bytes=0-9" }, body: null });
    await reply(job.id, 200, { "content-type": "application/json; charset=utf-8", "x-evil": "1", etag: '"7"' }, JSON.stringify({ schemaVersion: 1, path: "C:\\Users" })).expect(204);
    const response = await browsing;
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ schemaVersion: 1, path: "C:\\Users" });
    expect(response.headers.etag).toBe('"7"');
    expect(response.headers["x-evil"]).toBeUndefined();
    // 끝난 요청에 다시 답할 수 없다.
    await reply(job.id, 200, {}, "again").expect(404);
  });

  test("저장 같은 쓰기는 JSON 본문을 그대로 넘기고, PC가 준 오류 상태도 그대로 돌려준다", async () => {
    const waiting = poll();
    await online();
    const saving = start(t.post(`/api/v1/pcs/${device}/files/save`, { path: "C:\\a.txt", data: "aGk=", modified: null }));
    const job = (await waiting).body.job as { id: string; method: string; path: string; body: string };
    expect(job.method).toBe("POST");
    expect(job.path).toBe("/api/v1/files/save");
    expect(JSON.parse(job.body)).toEqual({ path: "C:\\a.txt", data: "aGk=", modified: null });
    await reply(job.id, 409, { "content-type": "application/json" }, JSON.stringify({ schemaVersion: 1, error: { code: "CONFLICT", message: "바뀜" } })).expect(204);
    const response = await saving;
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  test("기다리는 PC가 없으면 바로 알리고, 모르는 기기·기기 없는 대기·밖의 경로는 막는다", async () => {
    const offline = await t.get(`/api/v1/pcs/${device}/files/places`);
    expect(offline.status).toBe(503);
    expect(offline.body.error.code).toBe("PC_OFFLINE");
    expect((await t.get("/api/v1/pcs").expect(200)).body.items[0]).toMatchObject({ id: device, name: "office-pc", online: false });
    expect((await t.get("/api/v1/pcs/dev_unknown/files/places")).status).toBe(404);
    expect((await t.get("/api/v1/agent/next?wait=0")).status).toBe(400);
    expect((await t.get("/api/v1/agent/next?wait=99").set("X-Relay-Device", device)).status).toBe(400);
    expect((await t.get(`/api/v1/pcs/${device}/files/open`)).status).toBe(404);
    expect((await t.raw.get(`/api/v1/pcs/${device}/files/places`)).status).toBe(401);
    // 아무 요청도 없으면 PC의 대기는 204로 끝난다.
    expect((await t.get("/api/v1/agent/next?wait=0").set("X-Relay-Device", device)).status).toBe(204);
  });
});
