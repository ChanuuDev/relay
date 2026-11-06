/* Markdown 안의 원문 HTML을 GitHub처럼 허용한 태그·속성만 남겨 다시 만든다.
   문자열을 innerHTML로 넣지 않고, 떼어 둔 문서(DOMParser)에서 읽은 뒤 허용한 것만 새 요소로 옮긴다.
   style·class·on* 속성과 스크립트·틀·양식은 버리고, 주소는 http(s)·mailto·#·상대 주소만 받는다. */

/** 문서 해석 맥락. resolve는 상대 주소를 실제 주소로 바꾼다(파일 뷰어는 그 파일 옆의 파일을 가리키게 한다). */
export type MarkdownContext = {
  resolve?: (url: string, kind: "image" | "link") => string | null;
  /** 상대 주소 링크를 누르면 부른다(파일 뷰어는 그 파일을 연다). 없으면 새 창으로 연다. */
  openLink?: (url: string) => void;
};

const TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "picture", "pre", "q", "rp", "rt",
  "ruby", "s", "samp", "small", "source", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt",
  "u", "ul", "var", "wbr",
]);
/** 내용째 버리는 태그. 그 밖의 모르는 태그는 껍데기만 벗기고 안의 글은 남긴다. */
const DROP = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "template", "noscript", "form", "input", "button", "select",
  "textarea", "option", "link", "meta", "base", "svg", "math", "canvas", "audio", "video", "track", "head", "title"]);
const COMMON = ["align", "dir", "lang", "title", "valign", "id", "name"];
const ATTRS: Record<string, string[]> = {
  a: ["href"], img: ["src", "alt", "width", "height", "srcset", "border", "hspace", "vspace"], source: ["srcset", "media", "type", "width", "height"],
  td: ["colspan", "rowspan", "width", "nowrap"], th: ["colspan", "rowspan", "width", "nowrap", "scope"], table: ["border", "cellpadding", "cellspacing", "width", "summary"],
  col: ["span", "width"], colgroup: ["span", "width"], ol: ["start", "type", "reversed"], ul: ["type"], li: ["value"], details: ["open"], time: ["datetime"],
  q: ["cite"], blockquote: ["cite"], del: ["cite", "datetime"], ins: ["cite", "datetime"], hr: ["width", "size", "noshade"], p: [], div: [],
};
const SIZE = /^\d{1,4}(?:\.\d+)?%?$/;

/** 사용자가 쓴 id·name은 화면의 id와 부딪히지 않게 앞에 붙인다. `#이름` 링크는 이 앞말을 붙여 찾는다. */
export const ANCHOR_PREFIX = "md-";

/** 주소를 검사한다. 위험한 스킴은 null. 상대 주소는 resolve에 맡긴다. */
export function safeUrl(raw: string, kind: "image" | "link", context: MarkdownContext = {}): string | null {
  const url = raw.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!url) return null;
  if (url.startsWith("#")) return kind === "link" ? url : null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "http" || scheme === "https" || (kind === "link" && scheme === "mailto")) return url;
    // blob:은 이 화면이 만든 미리 보기(올리는 중인 그림)뿐이다.
    if (scheme === "blob" && kind === "image") return url;
    return null;
  }
  if (url.startsWith("//")) return `https:${url}`;
  // 이 서버의 주소(메모 그림 등)는 그대로, 나머지 상대 주소는 문서 위치에 맞춘다.
  if (url.startsWith("/api/")) return url;
  return context.resolve ? context.resolve(url, kind) : url;
}

/** <picture>의 prefers-color-scheme 소스는 화면 테마(밝게·어둡게)를 따라 고른다. 브라우저에 맡기면 운영체제 설정을 따른다. */
function pickPicture(picture: Element, dark: boolean): string | null {
  for (const source of Array.from(picture.querySelectorAll(":scope > source"))) {
    const media = source.getAttribute("media") ?? "";
    const wants = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(media)?.[1]?.toLowerCase();
    if (wants && (wants === "dark") === dark) return (source.getAttribute("srcset") ?? "").trim().split(/\s+/)[0] ?? null;
  }
  return null;
}

function copy(source: Element, target: HTMLElement, context: MarkdownContext, override?: string | null) {
  const tag = source.tagName.toLowerCase();
  const allowed = new Set([...COMMON, ...(ATTRS[tag] ?? [])]);
  for (const { name, value } of Array.from(source.attributes)) {
    const key = name.toLowerCase();
    if (!allowed.has(key)) continue;
    if (key === "href") {
      const href = safeUrl(value, "link", context);
      if (!href) continue;
      target.setAttribute("href", href);
      if (!href.startsWith("#")) { target.setAttribute("target", "_blank"); target.setAttribute("rel", "noopener noreferrer nofollow"); }
      continue;
    }
    if (key === "src") {
      const src = safeUrl(override ?? value, "image", context);
      if (src) target.setAttribute("src", src);
      continue;
    }
    if (key === "srcset") {
      // 고르기 쉬운 첫 주소만 쓴다(1x).
      const first = value.trim().split(/\s+/)[0] ?? "";
      const src = safeUrl(first, "image", context);
      if (src) target.setAttribute("srcset", src);
      continue;
    }
    if ((key === "width" || key === "height" || key === "hspace" || key === "vspace" || key === "border") && !SIZE.test(value.trim())) continue;
    if (key === "id" || key === "name") { const id = value.trim(); if (id) target.setAttribute(key, ANCHOR_PREFIX + id); continue; }
    target.setAttribute(key, value);
  }
  if (tag === "img") {
    target.setAttribute("loading", "lazy");
    target.setAttribute("decoding", "async");
    if (override && !target.hasAttribute("src")) { const src = safeUrl(override, "image", context); if (src) target.setAttribute("src", src); }
  }
}

function build(nodes: ArrayLike<Node>, parent: Node, context: MarkdownContext, dark: boolean, picture: string | null = null) {
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent ?? "")); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (!TAGS.has(tag)) { build(element.childNodes, parent, context, dark, picture); continue; }
    // 테마를 따르는 <source>는 버리고, 고른 주소를 <img>에 넣는다.
    if (tag === "source" && /prefers-color-scheme/i.test(element.getAttribute("media") ?? "")) continue;
    const target = document.createElement(tag === "center" ? "div" : tag);
    if (tag === "center") target.setAttribute("align", "center");
    copy(element, target, context, tag === "img" ? picture : null);
    build(element.childNodes, target, context, dark, tag === "picture" ? pickPicture(element, dark) : picture);
    parent.appendChild(target);
  }
}

/** 원문 HTML을 허용 목록대로 다시 만든 조각. 문서에 넣어도 스크립트·인라인 스타일이 실행되지 않는다. */
export function renderSafeHtml(html: string, context: MarkdownContext = {}, dark = document.documentElement.classList.contains("dark")): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const fragment = document.createDocumentFragment();
  build(parsed.body.childNodes, fragment, context, dark);
  return fragment;
}

/** 주석만 있거나 보이는 것이 없는 HTML인가. 편집기에서는 작은 표시만 보이고, 읽기 화면에서는 숨긴다. */
export function isInvisibleHtml(html: string) {
  const stripped = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim();
  return !stripped;
}

/** 태그를 걷어 낸 글(접기 제목처럼 글만 받는 곳에 쓴다). */
export function htmlText(html: string) {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** 문서의 상대 주소를 기준 파일 경로에 맞춰 푼다. Windows 경로(\)와 원격 경로(remote:/…)를 모두 받는다. */
export function joinPath(file: string, relative: string): string | null {
  const clean = relative.split(/[?#]/)[0]!;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  if (!decoded) return null;
  const windows = /^[a-z]:\\/i.test(file) || (file.includes("\\") && !file.startsWith("remote:"));
  const separator = windows ? "\\" : "/";
  const parts = file.split(/[\\/]/);
  parts.pop();
  const root = parts.length ? parts[0]! : "";
  for (const piece of decoded.replace(/^\.\//, "").split(/[\\/]/)) {
    if (!piece || piece === ".") continue;
    if (piece === "..") { if (parts.length > 1) parts.pop(); continue; }
    parts.push(piece);
  }
  if (!parts.length) parts.push(root);
  return parts.join(separator);
}
