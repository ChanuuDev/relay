/* 수식을 MathML로 그린다. KaTeX 묶음(/katex.js)은 수식을 처음 그릴 때 받고, 같은 수식은 다시 바꾸지 않는다. */

const KATEX_URL = "/katex.js";
type Katex = { toMathML: (tex: string, display: boolean) => string };
let loading: Promise<Katex> | null = null;
const cache = new Map<string, string>();

function load(): Promise<Katex> {
  loading ??= (import(/* 런타임 주소라 묶지 않는다 */ KATEX_URL) as Promise<Katex>).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}

/** 수식을 MathML 문자열로 바꾼다. 문법이 틀리면 KaTeX의 오류 문구로 거부한다. */
export async function renderMath(tex: string, display: boolean): Promise<string> {
  const key = `${display ? "D" : "I"}\n${tex}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let katex: Katex;
  try { katex = await load(); } catch { throw new Error("수식 도구를 불러오지 못했습니다."); }
  const html = katex.toMathML(tex, display);
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}

/** 이미 불러왔다면 바로(동기로) 바꾼다. 글자를 칠 때 깜빡이지 않게 쓴다. */
export function renderMathNow(tex: string, display: boolean): string | null {
  return cache.get(`${display ? "D" : "I"}\n${tex}`) ?? null;
}

/** KaTeX 오류 문구에서 앞말을 걷어 낸다. */
export const mathError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^KaTeX parse error:\s*/, "").slice(0, 300);
