import katex from "katex";

/* 메모·뷰어의 수식($…$, $$…$$, ```math)을 MathML로 바꾸는 묶음. 수식을 처음 그릴 때만 받는다(/katex.js).
   KaTeX의 HTML 출력은 글자 위치를 인라인 style로 잡아 CSP(style-src 'self')에 막히므로, 브라우저가 직접 그리는 MathML만 쓴다. */

export function toMathML(tex: string, display: boolean): string {
  return katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: true, strict: "ignore", trust: false, maxSize: 50, maxExpand: 500 });
}
