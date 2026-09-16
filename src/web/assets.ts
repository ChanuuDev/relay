import html from "./public/index.html" with { type: "text" };
import js from "./generated/app.js" with { type: "text" };
import css from "./generated/style.css" with { type: "text" };

// Bun's ambient *.html type describes HTML bundles, but the explicit text loader returns a string.
export const assets = new Map<string, { body: string; type: string }>([
  ["/icon.svg", { body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#26251e"/><path d="M10 24V8h7a5 5 0 0 1 1 10l5 6h-5l-5-6v6zm3-10h4a1 1 0 0 0 0-2h-4z" fill="#f7f7f4"/></svg>', type: "image/svg+xml" }],
  ["/", { body: html as unknown as string, type: "text/html; charset=utf-8" }],
  ["/app.js", { body: js, type: "text/javascript; charset=utf-8" }],
  ["/style.css", { body: css, type: "text/css; charset=utf-8" }],
]);
