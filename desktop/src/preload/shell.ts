/// <reference lib="dom" />
import { ipcRenderer } from "electron";

// 본 화면에는 API를 노출하지 않고, 기존 메뉴바가 계산한 색만 기본 창 조작 버튼에 반영한다.
window.addEventListener("DOMContentLoaded", () => {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const sync = () => {
    const value = meta?.content ?? "#1e1e20";
    const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
    const color = rgb ? `#${rgb.slice(1).map(part => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}` : value;
    ipcRenderer.send("window:appearance", { color, dark: document.documentElement.classList.contains("dark") });
  };
  if (meta) new MutationObserver(sync).observe(meta, { attributes: true, attributeFilter: ["content"] });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  sync();
});
