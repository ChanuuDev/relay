import mermaid from "mermaid";

/* Mermaid 다이어그램을 그리는 숨은 틀(/mermaid-frame.html)의 스크립트. 메인 화면과 따로 묶어, 다이어그램을 처음 그릴 때만 받는다.
   mermaid는 SVG 안에 <style>과 style 속성을 넣고 그 글꼴로 글자 크기를 잰다. 메인 화면의 CSP(style-src 'self')는 그것을 막으므로
   인라인 스타일을 허용한 이 틀에서 그리고, 완성된 SVG 문자열만 메인 화면에 돌려준다. 메인 화면은 그것을 <img>로 보여 준다. */

/** 그림(<img>) 안에서는 웹 글꼴을 쓸 수 없으므로 재는 곳과 보이는 곳이 같은 시스템 글꼴을 쓴다. */
const FONT = '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

/** 메모 창의 강조색(민트)과 카드 바탕에 맞춘 색. 나머지 색은 mermaid의 base 테마가 이 값에서 이끌어 낸다. */
const LIGHT = {
  background: "#f8f8fa", fontFamily: FONT, fontSize: "16px",
  primaryColor: "#e2f4ee", primaryBorderColor: "#52b29a", primaryTextColor: "#1d1d1f",
  secondaryColor: "#e7edfb", secondaryBorderColor: "#7f9bdc", secondaryTextColor: "#1d1d1f",
  tertiaryColor: "#f0f0f3", tertiaryBorderColor: "#c7c7cc", tertiaryTextColor: "#1d1d1f",
  mainBkg: "#e2f4ee", nodeBorder: "#52b29a", textColor: "#1d1d1f", titleColor: "#1d1d1f", lineColor: "#8e8e93",
  clusterBkg: "#f0f0f3", clusterBorder: "#d1d1d6", edgeLabelBackground: "#f8f8fa",
  noteBkgColor: "#fff5d1", noteBorderColor: "#dcbc52", noteTextColor: "#1d1d1f",
  actorBkg: "#e2f4ee", actorBorder: "#52b29a", actorTextColor: "#1d1d1f", actorLineColor: "#aeaeb2",
  signalColor: "#6e6e73", signalTextColor: "#1d1d1f", labelBoxBkgColor: "#e2f4ee", labelBoxBorderColor: "#52b29a", labelTextColor: "#1d1d1f",
};
const DARK = {
  darkMode: true, background: "#232326", fontFamily: FONT, fontSize: "16px",
  primaryColor: "#1b3a33", primaryBorderColor: "#3dd0aa", primaryTextColor: "#f5f5f7",
  secondaryColor: "#242b3f", secondaryBorderColor: "#7393e6", secondaryTextColor: "#f5f5f7",
  tertiaryColor: "#2c2c30", tertiaryBorderColor: "#4a4a4f", tertiaryTextColor: "#f5f5f7",
  mainBkg: "#1b3a33", nodeBorder: "#3dd0aa", textColor: "#f5f5f7", titleColor: "#f5f5f7", lineColor: "#8e8e93",
  clusterBkg: "#2a2a2e", clusterBorder: "#46464b", edgeLabelBackground: "#232326",
  noteBkgColor: "#3a3320", noteBorderColor: "#a88d3a", noteTextColor: "#f5f5f7",
  actorBkg: "#1b3a33", actorBorder: "#3dd0aa", actorTextColor: "#f5f5f7", actorLineColor: "#636366",
  signalColor: "#a1a1a6", signalTextColor: "#f5f5f7", labelBoxBkgColor: "#1b3a33", labelBoxBorderColor: "#3dd0aa", labelTextColor: "#f5f5f7",
};

type Request = { type: "render"; id: number; code: string; dark: boolean };
let theme: boolean | null = null;
let count = 0;
/** mermaid는 그리는 동안 전역 상태를 쓰므로 한 번에 하나씩 그린다. */
let queue: Promise<void> = Promise.resolve();

const reply = (message: Record<string, unknown>) => window.parent.postMessage(message, location.origin);

/** 그림으로 보일 때 크기가 정해지도록 viewBox 크기를 width·height로 박고, 틀 너비에 맞춘 max-width는 걷어 낸다. */
function sized(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("다이어그램을 그리지 못했습니다.");
  const [, , width = 0, height = 0] = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (!(width > 0 && height > 0)) throw new Error("다이어그램 크기를 알 수 없습니다.");
  root.setAttribute("width", String(Math.ceil(width)));
  root.setAttribute("height", String(Math.ceil(height)));
  (root as unknown as SVGSVGElement).style.removeProperty("max-width");
  return { svg: new XMLSerializer().serializeToString(root), width: Math.ceil(width), height: Math.ceil(height) };
}

/** 문법 오류는 앞 몇 줄만 보인다(mermaid의 오류는 기대한 기호 목록까지 길게 늘어놓는다). */
function reason(error: unknown) {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "다이어그램을 그리지 못했습니다.";
  return text.split("\n").slice(0, 4).join("\n").slice(0, 600);
}

async function render({ id, code, dark }: Request) {
  try {
    if (theme !== dark) {
      mermaid.initialize({
        startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "base", themeVariables: dark ? DARK : LIGHT,
        fontFamily: FONT, flowchart: { curve: "basis", padding: 14 }, sequence: { mirrorActors: false },
      });
      theme = dark;
    }
    const { svg } = await mermaid.render(`relay-diagram-${++count}`, code);
    reply({ type: "result", id, ...sized(svg) });
  } catch (error) {
    reply({ type: "result", id, error: reason(error) });
  } finally {
    // 그리다 실패하면 mermaid가 재던 요소를 남길 수 있다.
    document.body.replaceChildren();
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data as Partial<Request> | null;
  if (data?.type !== "render" || typeof data.id !== "number" || typeof data.code !== "string") return;
  const request: Request = { type: "render", id: data.id, code: data.code, dark: Boolean(data.dark) };
  queue = queue.then(() => render(request));
});
reply({ type: "ready" });
