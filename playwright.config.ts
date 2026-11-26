import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  // 파일끼리는 함께 돌고, 한 파일 안의 테스트는 차례로 돈다. 테스트마다 저장소·포트·서버가 따로라 서로 닿지 않는다
  // (하나뿐인 클립보드는 tests/web-helpers.ts의 grantClipboard가 차례를 세운다). 느린 PC에서 흔들리면 RELAY_TEST_WORKERS=1로 돌린다.
  fullyParallel: false,
  workers: Number(process.env.RELAY_TEST_WORKERS) || 4,
  timeout: 60000,
  expect: { timeout: 7000 },
  use: { browserName: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["list"]],
});
