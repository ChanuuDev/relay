import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { cleanup, root, temporary } from "./helpers";

describe("web server control", () => {
  let dir: string;
  let port: number;
  const index = path.join(root, "src/index.ts");
  const url = () => `http://127.0.0.1:${port}`;
  // web은 --json을 받지 않으므로 평문 출력을 그대로 본다. 훅 설치는 건너뛴다.
  const plain = (args: string[]) => {
    const result = Bun.spawnSync([process.execPath, index, ...args, "--data-dir", dir],
      { cwd: root, env: { ...process.env, RELAY_DATA_DIR: dir, RELAY_SKIP_HOOK_INSTALL: "1" }, stdout: "pipe", stderr: "pipe" });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  /** 이 테스트 프로세스가 띄운 서버에 CLI가 물어야 할 때 쓴다. spawnSync는 기다리는 동안 이 프로세스를 멈춰 세워 그 서버가 답하지 못하고,
   *  CLI는 제한 시간(1.5초)이 다 가도록 기다린다. 기다리지 않고 띄우면 서버가 바로 답한다. */
  const plainAsync = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, index, ...args, "--data-dir", dir],
      { cwd: root, env: { ...process.env, RELAY_DATA_DIR: dir, RELAY_SKIP_HOOK_INSTALL: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  };
  const health = async () => {
    try { return await fetch(`${url()}/api/v1/health`, { signal: AbortSignal.timeout(2000) }); } catch { return null; }
  };
  beforeEach(() => {
    dir = temporary();
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    port = reservation.port!; reservation.stop(true);
  });
  afterEach(async () => {
    // 남은 백그라운드 서버는 테스트가 끝나며 반드시 걷는다.
    const pid = Number((await health())?.headers.get("Relay-Pid"));
    if (pid) try { process.kill(pid); } catch { /* 이미 끝났다 */ }
    cleanup(dir);
  });

  test("--headless keeps serving after the CLI exits and --close stops exactly that server", async () => {
    const started = plain(["web", "--headless", "--port", String(port)]);
    expect(started.code).toBe(0); expect(started.stdout).toBe("");
    expect(started.stderr).toContain(url()); expect(started.stderr).toContain("relay web --close");
    const response = await health();
    expect(response?.status).toBe(200);
    const pid = Number(response!.headers.get("Relay-Pid"));
    expect(pid).toBeGreaterThan(0); expect(pid).not.toBe(process.pid);
    expect(started.stderr).toContain(`PID ${pid}`);
    expect((await response!.json()).databasePath).toContain("relay.db");
    const again = plain(["web", "--headless", "--port", String(port)]);
    expect(again.code).toBe(0); expect(again.stderr).toContain("이미 실행 중"); expect(again.stderr).toContain(`PID ${pid}`);
    const closed = plain(["web", "--close", "--port", String(port)]);
    expect(closed.code).toBe(0); expect(closed.stderr).toContain(`PID ${pid}`);
    expect(await health()).toBeNull();
    const none = plain(["web", "--close", "--port", String(port)]);
    expect(none.code).toBe(0); expect(none.stderr).toContain("실행 중인 Relay 웹 서버가 없습니다");
  }, 30000);

  test("--reload restarts the server on the same port, keeps the running server's store and starts one when none runs", async () => {
    expect(plain(["web", "--headless", "--port", String(port)]).code).toBe(0);
    const first = await health();
    const before = Number(first!.headers.get("Relay-Pid"));
    const store = (await first!.json()).dataDirectory as string;
    // 저장소를 주지 않으면 RELAY_DATA_DIR이 다른 곳을 가리켜도 실행 중인 서버의 저장소를 이어받는다.
    const other = temporary();
    try {
      const result = Bun.spawnSync([process.execPath, index, "web", "--reload", "--port", String(port)],
        { cwd: root, env: { ...process.env, RELAY_DATA_DIR: other, RELAY_SKIP_HOOK_INSTALL: "1" }, stdout: "pipe", stderr: "pipe" });
      const stderr = result.stderr.toString();
      expect(result.exitCode).toBe(0); expect(result.stdout.toString()).toBe("");
      const response = await health();
      const after = Number(response!.headers.get("Relay-Pid"));
      expect(after).toBeGreaterThan(0); expect(after).not.toBe(before);
      expect(stderr).toContain(`다시 시작했습니다: ${url()} (PID ${before} → ${after})`);
      expect((await response!.json()).dataDirectory).toBe(store);
      expect(stderr).toContain(path.join(store, "relay.db"));
    } finally { cleanup(other); }
    // 떠 있는 서버가 없으면 새로 띄운다.
    expect(plain(["web", "--close", "--port", String(port)]).code).toBe(0);
    expect(await health()).toBeNull();
    const fresh = plain(["web", "--reload", "--port", String(port)]);
    expect(fresh.code).toBe(0); expect(fresh.stderr).toContain("실행 중인 서버가 없어 새로 띄웠습니다");
    expect((await health())?.status).toBe(200);
  }, 30000);

  test("open-url starts a background server for a relay://web link and rejects every other link", async () => {
    const started = plain(["open-url", `relay://web?port=${port}`]);
    expect(started.code).toBe(0); expect(started.stdout).toBe("");
    expect(started.stderr).toContain(`${url()} (백그라운드`); expect(started.stderr).toContain("relay web --close");
    const response = await health();
    expect(response?.status).toBe(200);
    const pid = Number(response!.headers.get("Relay-Pid"));
    expect(pid).toBeGreaterThan(0); expect(started.stderr).toContain(`PID ${pid}`);
    const again = plain(["open-url", `relay://web/?port=${port}`]);
    expect(again.code).toBe(0); expect(again.stderr).toContain("이미 실행 중"); expect(again.stderr).toContain(`PID ${pid}`);
    expect(plain(["web", "--close", "--port", String(port)]).code).toBe(0);
    // 다른 사이트도 relay:// 링크를 열 수 있으므로 web 호스트와 포트 범위 밖은 모두 거절한다.
    for (const bad of ["relay://evil?port=7474", `http://127.0.0.1:${port}/`, "relay://web?port=80", "relay://web?port=abc", "relay://web/x", "not a url"]) {
      const result = plain(["open-url", bad]);
      expect(result.code, bad).toBe(2); expect(result.stderr, bad).toStartWith("INVALID_ARGUMENT:");
    }
    expect(await health()).toBeNull();
  }, 30000);

  test("--close leaves a foreign server alone and option conflicts fail before anything runs", async () => {
    const foreign = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("other") });
    try {
      const close = await plainAsync(["web", "--close", "--port", String(port)]);
      expect(close.code).toBe(6); expect(close.stderr).toStartWith("SERVER_FOREIGN:");
      expect(await (await fetch(`${url()}/`)).text()).toBe("other");
      const headless = await plainAsync(["web", "--headless", "--port", String(port)]);
      expect(headless.code).toBe(6); expect(headless.stderr).toStartWith("PORT_IN_USE:");
      // Relay가 아닌 서버는 --reload도 건드리지 않는다.
      const reload = await plainAsync(["web", "--reload", "--port", String(port)]);
      expect(reload.code).toBe(6); expect(reload.stderr).toStartWith("SERVER_FOREIGN:");
      expect(await (await fetch(`${url()}/`)).text()).toBe("other");
    } finally { foreign.stop(true); }
    for (const args of [["web", "--close", "--headless"], ["web", "--close", "--open"], ["web", "--close", "--reload"]]) {
      const result = plain([...args, "--port", String(port)]);
      expect(result.code).toBe(2); expect(result.stderr).toStartWith("INVALID_ARGUMENT:");
    }
    const json = plain(["web", "--headless", "--json", "--port", String(port)]);
    expect(json.code).toBe(2); expect(JSON.parse(json.stderr).error.code).toBe("INVALID_ARGUMENT");
    expect(await health()).toBeNull();
  }, 30000);
});
