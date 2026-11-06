/* 메모의 Mermaid 다이어그램을 그린다. 실제로 그리는 일은 숨은 틀(/mermaid-frame.html)이 하고, 여기서는 그 틀을 띄워 코드를 보내고
   돌려받은 SVG를 blob: 주소로 바꿔 <img>에 넣게 한다. mermaid 묶음(약 5MB)은 다이어그램을 처음 그릴 때 그 틀이 받는다. */

export const MERMAID_FRAME_PATH = "/mermaid-frame.html";
/** 틀이 준비되기를 기다리는 시간. mermaid 묶음을 처음 받는 시간을 포함한다. */
const READY_MS = 30_000;
/** 같은 코드·테마를 다시 그리지 않도록 남겨 두는 그림 수. */
const CACHE_SIZE = 48;

export type Diagram = { url: string; width: number; height: number };
type Pending = { resolve: (value: { svg: string; width: number; height: number }) => void; reject: (error: Error) => void };

let frame: Promise<HTMLIFrameElement> | null = null;
let nextId = 0;
const waiting = new Map<number, Pending>();
const cache = new Map<string, Promise<Diagram>>();

export const isDark = () => document.documentElement.classList.contains("dark");

/** 숨은 틀을 한 번만 띄운다. 준비되지 않으면 걷어 내고 다음 요청 때 다시 띄운다. */
function host(): Promise<HTMLIFrameElement> {
  frame ??= new Promise<HTMLIFrameElement>((resolve, reject) => {
    const element = document.createElement("iframe");
    element.className = "mermaid-frame";
    element.title = "Mermaid 다이어그램 렌더러";
    element.tabIndex = -1;
    element.setAttribute("aria-hidden", "true");
    const fail = (message: string) => {
      clearTimeout(timer);
      window.removeEventListener("message", listen);
      element.remove();
      frame = null;
      for (const [id, entry] of waiting) { waiting.delete(id); entry.reject(new Error(message)); }
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("다이어그램 도구를 불러오지 못했습니다."), READY_MS);
    function listen(event: MessageEvent) {
      if (event.source !== element.contentWindow || event.origin !== location.origin) return;
      const data = event.data as { type?: string; id?: number; svg?: string; width?: number; height?: number; error?: string } | null;
      if (data?.type === "ready") { clearTimeout(timer); resolve(element); return; }
      if (data?.type !== "result" || typeof data.id !== "number") return;
      const entry = waiting.get(data.id);
      if (!entry) return;
      waiting.delete(data.id);
      if (typeof data.svg === "string" && typeof data.width === "number" && typeof data.height === "number") entry.resolve({ svg: data.svg, width: data.width, height: data.height });
      else entry.reject(new Error(data.error || "다이어그램을 그리지 못했습니다."));
    }
    window.addEventListener("message", listen);
    element.addEventListener("error", () => fail("다이어그램 도구를 불러오지 못했습니다."));
    element.src = MERMAID_FRAME_PATH;
    document.body.append(element);
  });
  return frame;
}

async function draw(code: string, dark: boolean): Promise<Diagram> {
  const target = await host();
  const id = ++nextId;
  const result = await new Promise<{ svg: string; width: number; height: number }>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    target.contentWindow?.postMessage({ type: "render", id, code, dark }, location.origin);
  });
  return { url: URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })), width: result.width, height: result.height };
}

/** 코드를 그림으로 그린다. 같은 코드·테마는 마지막으로 그린 그림을 다시 쓴다. 문법이 틀리면 mermaid의 오류 문구로 거부한다. */
export function renderDiagram(code: string, dark = isDark()): Promise<Diagram> {
  const key = `${dark ? "dark" : "light"}\n${code}`;
  const known = cache.get(key);
  if (known) { cache.delete(key); cache.set(key, known); return known; }
  const job = draw(code, dark);
  cache.set(key, job);
  // 틀린 코드는 고치는 중이므로 남겨 두지 않는다.
  job.catch(() => { if (cache.get(key) === job) cache.delete(key); });
  while (cache.size > CACHE_SIZE) {
    const [oldest, entry] = cache.entries().next().value!;
    cache.delete(oldest);
    // 이미 화면에 그려진 그림은 주소를 풀어도 그대로 보인다.
    void entry.then((diagram) => URL.revokeObjectURL(diagram.url), () => {});
  }
  return job;
}

/** 화면 테마(밝게·어둡게)가 바뀌면 알린다. 다이어그램은 테마 색으로 다시 그린다. */
export function onThemeChange(listener: () => void) {
  let dark = isDark();
  const observer = new MutationObserver(() => { if (isDark() !== dark) { dark = isDark(); listener(); } });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** 도구 단추로 넣는 예시. 바로 고쳐 쓸 수 있게 흔한 흐름도로 둔다. */
export const DIAGRAM_SAMPLE = "flowchart LR\n  A[아이디어] --> B{검토}\n  B -- 좋음 --> C[작업]\n  B -- 보완 --> A\n  C --> D((완료))";
