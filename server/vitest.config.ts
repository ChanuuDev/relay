import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS는 생성자 매개변수 타입(decorator metadata)으로 주입하므로 esbuild 대신 SWC로 변환한다.
export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
