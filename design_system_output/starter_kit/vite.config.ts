import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // gsap·framer-motion·radix를 한 덩어리로 묶는 데모라 경고 한도만 올린다. 실제 앱은 화면 단위로 나눠 불러온다.
  build: { chunkSizeWarningLimit: 900 },
});
