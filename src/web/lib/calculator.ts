/** 계산기 엔진. 입력은 토큰 배열로 쌓고, `=`에서 곱셈·나눗셈을 먼저 하는 식으로 계산한다(eval은 쓰지 않는다).
 *  화면·이력에는 천 단위 구분과 − × ÷ 기호로 보인다. DOM에 기대지 않아 단위 테스트에서 그대로 쓴다. */

export type Operator = "+" | "−" | "×" | "÷";
export type Token =
  /** 숫자. text는 입력한 그대로("-12.50", "0."). locked는 계산 결과·이력에서 가져온 값이라, 숫자를 이어 치면 새 숫자로 바뀐다. */
  | { kind: "num"; text: string; locked?: boolean }
  | { kind: "op"; op: Operator }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "percent" };
export type Key = `${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | "." | Operator | "(" | ")" | "%" | "±" | "=" | "back" | "clear";

/** 마지막 계산. 다음 입력이 연산자면 결과에 이어 계산하고, 숫자면 새로 시작한다. */
export type Done = { expression: string; result: string; value: number };
export type CalcState = { tokens: Token[]; done: Done | null; error: string | null };
/** `=`가 끝낸 계산. 화면이 이력에 남긴다. */
export type Finished = { expression: string; result: string };

export const EMPTY: CalcState = { tokens: [], done: null, error: null };
/** 숫자 하나에 칠 수 있는 자릿수(부호·소수점 제외). */
export const MAX_DIGITS = 15;
/** 결과의 유효 숫자. 0.1 + 0.2 같은 이진 부동소수점의 끝자리 오차를 걷어 낸다. */
const PRECISION = 12;

export const ERRORS = { divide: "0으로 나눌 수 없습니다", overflow: "값이 너무 큽니다", invalid: "식이 올바르지 않습니다" } as const;
class CalcError extends Error {}

const OPERATORS: Operator[] = ["+", "−", "×", "÷"];
export const isOperator = (key: string): key is Operator => (OPERATORS as string[]).includes(key);
const digits = (text: string) => text.replace(/[^0-9]/g, "").length;
const complete = (token: Token | undefined) => token !== undefined &&
  ((token.kind === "num" && /\d/.test(token.text)) || token.kind === "close" || token.kind === "percent");
const depth = (tokens: Token[]) => tokens.reduce((sum, token) => sum + (token.kind === "open" ? 1 : token.kind === "close" ? -1 : 0), 0);

/** 계산한 값을 이어 쓸 숫자 글자로. 지수 표기가 필요한 크기는 그대로 둔다. */
function plain(value: number) {
  const rounded = Number(value.toPrecision(PRECISION));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 입력 중인 숫자 글자를 화면 표기로: 정수부 천 단위 구분, 음수는 −, 소수부는 친 그대로. */
export function formatNumberText(text: string) {
  if (/e/i.test(text)) return text.replace(/^-/, "−");
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** 계산한 값의 화면 표기. 아주 크거나 작으면 지수로 쓴다. */
export function formatValue(value: number) {
  if (!Number.isFinite(value)) throw new CalcError(ERRORS.overflow);
  const rounded = Number(value.toPrecision(PRECISION));
  if (rounded === 0) return "0";
  const size = Math.abs(rounded);
  if (size >= 1e15 || size < 1e-9) return rounded.toExponential(PRECISION - 4).replace(/\.?0+e/, "e").replace("e+", "e").replace(/^-/, "−");
  return formatNumberText(String(rounded).includes("e") ? rounded.toFixed(20).replace(/\.?0+$/, "") : String(rounded));
}

export function formatTokens(tokens: Token[]) {
  let out = "";
  for (const token of tokens) {
    if (token.kind === "num") out += formatNumberText(token.text);
    else if (token.kind === "op") out += ` ${token.op} `;
    else if (token.kind === "open") out += "(";
    else if (token.kind === "close") out += ")";
    else out += "%";
  }
  return out.trim();
}

/** 화면 표기("−1,234.5")를 이어 쓸 숫자 글자("-1234.5")로. 숫자가 아니면 null. */
export function parseShown(text: string): string | null {
  const raw = text.replace(/,/g, "").replace(/−/g, "-").trim();
  return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) && Number.isFinite(Number(raw)) ? raw : null;
}

/** `=` 앞에서 끝이 덜 된 입력(뒤에 남은 연산자·여는 괄호·부호만 친 숫자)을 걷어 내고 닫히지 않은 괄호를 닫는다. */
function settle(tokens: Token[]) {
  const out = [...tokens];
  while (out.length && !complete(out.at(-1))) out.pop();
  for (let open = depth(out); open > 0; open--) out.push({ kind: "close" });
  return out;
}

/** expr := term (± term)* · term := factor (×÷ factor)* · factor := primary %* · primary := 숫자 | ( expr )
 *  덧셈·뺄셈 바로 뒤의 `b%`는 왼쪽 값의 b%다(50 + 10% = 55). 그 밖의 %는 100으로 나눈다(50 × 10% = 5). */
export function evaluate(input: Token[]): number {
  const tokens = settle(input);
  if (!tokens.length) throw new CalcError(ERRORS.invalid);
  let at = 0;
  const peek = () => tokens[at];
  function primary(): number {
    const token = tokens[at++];
    if (token?.kind === "num") {
      const value = Number(token.text);
      if (!Number.isFinite(value)) throw new CalcError(ERRORS.invalid);
      return value;
    }
    if (token?.kind === "open") {
      const value = expr();
      if (tokens[at++]?.kind !== "close") throw new CalcError(ERRORS.invalid);
      return value;
    }
    throw new CalcError(ERRORS.invalid);
  }
  function factor(): { value: number; percent?: number } {
    let value = primary();
    let percent: number | undefined;
    while (peek()?.kind === "percent") { at++; percent = value; value /= 100; }
    return { value, percent };
  }
  function term(): { value: number; percent?: number } {
    const first = factor();
    let value = first.value;
    let single = true;
    for (let token = peek(); token?.kind === "op" && (token.op === "×" || token.op === "÷"); token = peek()) {
      at++;
      single = false;
      const right = factor().value;
      if (token.op === "÷" && right === 0) throw new CalcError(ERRORS.divide);
      value = token.op === "×" ? value * right : value / right;
    }
    return { value, percent: single ? first.percent : undefined };
  }
  function expr(): number {
    let value = term().value;
    for (let token = peek(); token?.kind === "op" && (token.op === "+" || token.op === "−"); token = peek()) {
      at++;
      const right = term();
      const amount = right.percent !== undefined ? value * right.percent / 100 : right.value;
      value = token.op === "+" ? value + amount : value - amount;
    }
    return value;
  }
  const value = expr();
  if (at !== tokens.length) throw new CalcError(ERRORS.invalid);
  if (!Number.isFinite(value)) throw new CalcError(ERRORS.overflow);
  return value;
}

/** 입력 중인 식의 미리 보기. 연산이 하나라도 있고 계산이 될 때만 결과를 준다. */
export function preview(tokens: Token[]): string | null {
  if (!tokens.some((token) => token.kind === "op" || token.kind === "percent")) return null;
  try { return formatValue(evaluate(tokens)); } catch { return null; }
}

/** 괄호 하나짜리 키(`( )`)가 누를 괄호. 닫을 괄호가 있고 앞이 값이면 닫고, 아니면 연다. */
export function smartParen(state: CalcState): "(" | ")" {
  return !state.done && !state.error && depth(state.tokens) > 0 && complete(state.tokens.at(-1)) ? ")" : "(";
}

/** 결과(또는 이력에서 고른 값)로 다시 시작하는 입력. */
export function fromValue(text: string): Token[] {
  return [{ kind: "num", text, locked: true }];
}

/** 이력에서 고른 결과(화면 표기)를 넣는다. 연산자·여는 괄호 뒤면 이어 붙이고, 아니면 그 값으로 새로 시작한다. */
export function insertValue(state: CalcState, shown: string): CalcState {
  const text = parseShown(shown);
  if (text === null) return state;
  const last = state.tokens.at(-1);
  if (!state.done && !state.error && (last?.kind === "op" || last?.kind === "open")) return { tokens: [...state.tokens, { kind: "num", text, locked: true }], done: null, error: null };
  return { tokens: fromValue(text), done: null, error: null };
}

/** 키 하나를 누른 뒤의 상태. `=`가 계산을 끝내면 finished에 이력으로 남길 식과 결과를 준다. */
export function press(state: CalcState, key: Key): { state: CalcState; finished?: Finished } {
  if (key === "clear") return { state: EMPTY };
  // 오류가 보이는 동안에는 지우기만 받고, 다른 키는 새로 시작한다.
  const base: CalcState = state.error ? EMPTY : state;
  if (state.error && (key === "back" || key === "=")) return { state: EMPTY };
  const continued = base.done ? fromValue(plain(base.done.value)) : null;
  const tokens = [...base.tokens];
  const last = tokens.at(-1);
  const next = (list: Token[]): { state: CalcState } => ({ state: { tokens: list, done: null, error: null } });

  if (/^\d$/.test(key)) {
    if (base.done) return next([{ kind: "num", text: key }]);
    if (last?.kind === "num" && !last.locked) {
      if (digits(last.text) >= MAX_DIGITS) return { state: base };
      const text = last.text === "0" ? key : last.text === "-0" ? `-${key}` : last.text + key;
      return next([...tokens.slice(0, -1), { kind: "num", text }]);
    }
    if (last?.kind === "num") return next([...tokens.slice(0, -1), { kind: "num", text: key }]);
    if (last?.kind === "close" || last?.kind === "percent") return next([...tokens, { kind: "op", op: "×" }, { kind: "num", text: key }]);
    return next([...tokens, { kind: "num", text: key }]);
  }
  if (key === ".") {
    if (base.done) return next([{ kind: "num", text: "0." }]);
    if (last?.kind === "num" && !last.locked) {
      if (last.text.includes(".") || /e/i.test(last.text)) return { state: base };
      return next([...tokens.slice(0, -1), { kind: "num", text: last.text === "-" ? "-0." : `${last.text}.` }]);
    }
    if (last?.kind === "num") return next([...tokens.slice(0, -1), { kind: "num", text: "0." }]);
    if (last?.kind === "close" || last?.kind === "percent") return next([...tokens, { kind: "op", op: "×" }, { kind: "num", text: "0." }]);
    return next([...tokens, { kind: "num", text: "0." }]);
  }
  if (isOperator(key)) {
    if (continued) return next([...continued, { kind: "op", op: key }]);
    // 빼기는 숫자 앞에 오면 음수의 부호가 된다(처음, 여는 괄호 뒤, × ÷ 뒤).
    const negative = key === "−" && (!last || last.kind === "open" || (last.kind === "op" && (last.op === "×" || last.op === "÷")));
    if (negative) return next([...tokens, { kind: "num", text: "-" }]);
    if (!last) return next([{ kind: "num", text: "0" }, { kind: "op", op: key }]);
    if (last.kind === "open") return { state: base };
    if (last.kind === "num" && last.text === "-") {
      // 부호만 친 숫자를 걷어 내고, 앞이 연산자면 그 연산자를 바꾼다.
      const rest = tokens.slice(0, -1);
      const before = rest.at(-1);
      if (before?.kind === "op") return next([...rest.slice(0, -1), { kind: "op", op: key }]);
      return before ? next(rest) : next([{ kind: "num", text: "0" }, { kind: "op", op: key }]);
    }
    if (last.kind === "op") return next([...tokens.slice(0, -1), { kind: "op", op: key }]);
    return next([...tokens, { kind: "op", op: key }]);
  }
  if (key === "(") {
    if (base.done) return next([{ kind: "open" }]);
    // 부호만 친 숫자 뒤의 괄호는 −1 × ( 로, 값 뒤의 괄호는 곱하기로 잇는다.
    if (last?.kind === "num" && last.text === "-") return next([...tokens.slice(0, -1), { kind: "num", text: "-1" }, { kind: "op", op: "×" }, { kind: "open" }]);
    if (complete(last)) return next([...tokens, { kind: "op", op: "×" }, { kind: "open" }]);
    return next([...tokens, { kind: "open" }]);
  }
  if (key === ")") {
    if (base.done || depth(tokens) <= 0 || !complete(last)) return { state: base };
    return next([...tokens, { kind: "close" }]);
  }
  if (key === "%") {
    if (continued) return next([...continued, { kind: "percent" }]);
    return complete(last) ? next([...tokens, { kind: "percent" }]) : { state: base };
  }
  if (key === "±") {
    if (base.done) return next(fromValue(plain(-base.done.value)));
    if (last?.kind === "num") {
      const text = last.text.startsWith("-") ? last.text.slice(1) : `-${last.text}`;
      if (!text) return next(tokens.slice(0, -1));
      return next([...tokens.slice(0, -1), { kind: "num", text, locked: last.locked }]);
    }
    if (!last || last.kind === "op" || last.kind === "open") return next([...tokens, { kind: "num", text: "-" }]);
    return { state: base };
  }
  if (key === "back") {
    if (base.done) return { state: EMPTY };
    if (last?.kind === "num" && !last.locked && last.text.length > 1) return next([...tokens.slice(0, -1), { kind: "num", text: last.text.slice(0, -1) }]);
    return next(tokens.slice(0, -1));
  }
  // "="
  if (base.done || !tokens.length) return { state: base };
  const settled = settle(tokens);
  if (!settled.length) return { state: base };
  const expression = formatTokens(settled);
  try {
    const value = evaluate(settled);
    const result = formatValue(value);
    return { state: { tokens: [], done: { expression, result, value }, error: null }, finished: { expression, result } };
  } catch (error) {
    return { state: { tokens: settled, done: null, error: error instanceof CalcError ? error.message : ERRORS.invalid } };
  }
}

/** 키보드 키 → 계산기 키. 해당이 없으면 null. */
export function keyFromKeyboard(event: Pick<KeyboardEvent, "key">): Key | null {
  const { key } = event;
  if (/^\d$/.test(key)) return key as Key;
  switch (key) {
    case ".": case ",": case "Decimal": return ".";
    case "+": return "+";
    case "-": case "−": return "−";
    case "*": case "x": case "X": case "×": return "×";
    case "/": case "÷": return "÷";
    case "%": return "%";
    case "(": return "(";
    case ")": return ")";
    case "Enter": case "=": return "=";
    case "Backspace": return "back";
    case "Escape": case "Delete": return "clear";
    case "F9": return "±";
    default: return null;
  }
}

/** 붙여 넣은 글("12 × (3 + 4)", "1,234.5")을 키 순서로. 계산기 글자가 아니면 null. */
export function keysFromText(text: string): Key[] | null {
  const cleaned = text.trim().replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\s+/g, "");
  if (!cleaned || cleaned.length > 500 || !/^[0-9.+\-−*/×÷x%()=]+$/i.test(cleaned)) return null;
  const keys: Key[] = [];
  for (const char of cleaned) {
    const key = keyFromKeyboard({ key: char });
    if (!key || key === "=") continue;
    keys.push(key);
  }
  return keys.length ? keys : null;
}
