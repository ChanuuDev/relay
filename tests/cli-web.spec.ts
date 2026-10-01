import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { binary, spawnEnv } from "./web-helpers";

/** 실행 파일 자체로 백그라운드 서버를 띄우고 끈다. 컴파일된 relay.exe는 자기 자신을 다시 불러야 하므로 소스 실행과 따로 확인한다. */
test("relay.exe web --headless는 명령이 끝난 뒤에도 서비스하고 --close가 그 서버를 끝낸다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "relay-headless-"));
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const run = (args: string[]) => spawnSync(binary, [...args, "--data-dir", dir, "--port", String(port)],
    { cwd: dir, encoding: "utf8", timeout: 20000, env: spawnEnv, windowsHide: true });
  try {
    const started = run(["web", "--headless"]);
    expect(started.status, started.stderr).toBe(0);
    expect(started.stdout).toBe("");
    expect(started.stderr).toContain(url);
    expect(started.stderr).toContain("relay web --close");
    const health = await fetch(`${url}/api/v1/health`);
    expect(health.status).toBe(200);
    const pid = Number(health.headers.get("relay-pid"));
    expect(pid).toBeGreaterThan(0);
    expect(started.stderr).toContain(`PID ${pid}`);
    expect((await health.json()).schemaVersion).toBe(1);
    const closed = run(["web", "--close"]);
    expect(closed.status, closed.stderr).toBe(0);
    expect(closed.stderr).toContain(`PID ${pid}`);
    await expect(fetch(`${url}/api/v1/health`)).rejects.toThrow();
  } finally {
    run(["web", "--close"]);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
