import { describe, expect, test } from "bun:test";
import { EMPTY, ERRORS, evaluate, formatTokens, formatValue, keyFromKeyboard, keysFromText, MAX_DIGITS, parseShown, press, preview,
  type CalcState, type Finished, type Key } from "../src/web/lib/calculator";

/** 글로 쓴 키 순서. 붙여 넣기 변환은 `=`를 건너뛰므로 끝의 `=`는 따로 누른다. */
const typed = (text: string): Key[] => [...(keysFromText(text.replace(/=$/, "")) ?? []), ...(text.endsWith("=") ? ["=" as Key] : [])];
/** 키를 차례로 누른 뒤의 상태와, 그동안 `=`가 끝낸 계산들. */
function run(keys: Key[] | string, from: CalcState = EMPTY) {
  const list = typeof keys === "string" ? typed(keys) : keys;
  let state = from;
  const finished: Finished[] = [];
  for (const key of list) {
    const step = press(state, key);
    state = step.state;
    if (step.finished) finished.push(step.finished);
  }
  return { state, finished, shown: formatTokens(state.tokens) };
}
const result = (keys: Key[] | string) => run([...(typeof keys === "string" ? typed(keys) : keys), "="]).finished.at(-1)?.result;

describe("calculator engine", () => {
  test("multiplication and division come before addition and subtraction; parentheses first", () => {
    expect(result("2+3*4")).toBe("14");
    expect(result("(2+3)*4")).toBe("20");
    expect(result("10-4/2")).toBe("8");
    expect(result("2*(3+(4-1))/3")).toBe("4");
    expect(result("7/2")).toBe("3.5");
  });

  test("binary floating point noise is rounded away; big and tiny values use exponent form", () => {
    expect(result("0.1+0.2")).toBe("0.3");
    expect(result("1/3")).toBe("0.333333333333");
    expect(result("1.1*3")).toBe("3.3");
    expect(result("999999999*999999999")).toBe("9.99999998e17");
    expect(formatValue(1e-7)).toBe("0.0000001");
    expect(formatValue(-1234567.5)).toBe("−1,234,567.5");
    expect(formatValue(-0)).toBe("0");
  });

  test("percent is a share of the left value after + and −, otherwise a hundredth", () => {
    expect(result("50+10%")).toBe("55");
    expect(result("50-10%")).toBe("45");
    expect(result("50*10%")).toBe("5");
    expect(result("10%")).toBe("0.1");
    expect(result("200/50%")).toBe("400");
  });

  test("the expression and result are recorded as shown, with grouping and real operator signs", () => {
    const { finished, state } = run("1234.5*2-(3+4)=");
    expect(finished).toEqual([{ expression: "1,234.5 × 2 − (3 + 4)", result: "2,462" }]);
    expect(state.done).toMatchObject({ result: "2,462", value: 2462 });
    expect(state.tokens).toEqual([]);
  });

  test("= settles what is unfinished: trailing operators drop, open parentheses close", () => {
    expect(run("5*(2+3").state.tokens.at(-1)).toEqual({ kind: "num", text: "3" });
    expect(run(["5", "×", "(", "2", "+", "3", "="]).finished[0]).toEqual({ expression: "5 × (2 + 3)", result: "25" });
    expect(run(["8", "+", "="]).finished[0]).toEqual({ expression: "8", result: "8" });
    expect(run(["="]).finished).toEqual([]);
    expect(run(["(", "="]).finished).toEqual([]);
  });

  test("division by zero shows an error that the next key clears", () => {
    const failed = run("5/0=").state;
    expect(failed.error).toBe(ERRORS.divide);
    expect(run(["7"], failed).shown).toBe("7");
    expect(run(["back"], failed).state).toEqual(EMPTY);
    expect(() => evaluate([{ kind: "num", text: "1" }, { kind: "op", op: "÷" }, { kind: "num", text: "0" }])).toThrow(ERRORS.divide);
  });

  test("after a result an operator continues from it and a digit starts over", () => {
    const done = run("6*7=").state;
    expect(run(["+", "1", "="], done).finished[0]).toEqual({ expression: "42 + 1", result: "43" });
    expect(run(["5"], done).shown).toBe("5");
    expect(run(["±"], done).shown).toBe("−42");
    expect(run(["%"], done).shown).toBe("42%");
    expect(run(["back"], done).state).toEqual(EMPTY);
  });

  test("typing rules: one decimal point, leading zero, digit limit, replacing operators, implicit multiplication", () => {
    expect(run("0.5.2").shown).toBe("0.52");
    expect(run(".5").shown).toBe("0.5");
    expect(run("007").shown).toBe("7");
    expect(run("1234567").shown).toBe("1,234,567");
    expect(run(Array.from({ length: MAX_DIGITS + 3 }, () => "9" as Key)).state.tokens[0]).toEqual({ kind: "num", text: "9".repeat(MAX_DIGITS) });
    expect(run(["5", "+", "×"]).shown).toBe("5 ×");
    expect(run(["+", "3"]).shown).toBe("0 + 3");
    expect(run(["2", "(", "3", ")", "4"]).shown).toBe("2 × (3) × 4");
    expect(run([")"]).shown).toBe("");
  });

  test("minus starts a negative number at the start, after ( and after × ÷; ± flips the last number", () => {
    expect(result(["−", "5", "+", "2"])).toBe("−3");
    expect(result(["6", "×", "−", "2"])).toBe("−12");
    expect(run(["6", "×", "−", "+"]).shown).toBe("6 +");
    expect(result(["−", "(", "2", "+", "3", ")"])).toBe("−5");
    expect(run(["1", "2", "±"]).shown).toBe("−12");
    expect(run(["1", "2", "±", "±"]).shown).toBe("12");
    expect(run(["3", "+", "±", "4"]).shown).toBe("3 + −4");
  });

  test("backspace removes the last character, then the token", () => {
    expect(run(["1", "2", "+", "3", "4", "back"]).shown).toBe("12 + 3");
    expect(run(["1", "2", "+", "back"]).shown).toBe("12");
    expect(run(["1", "back"]).shown).toBe("");
  });

  test("preview appears only once there is something to calculate", () => {
    expect(preview(run("12").state.tokens)).toBeNull();
    expect(preview(run("12*3+").state.tokens)).toBe("36");
    expect(preview(run("5/0").state.tokens)).toBeNull();
  });

  test("keyboard keys and pasted text map to calculator keys; shown numbers read back", () => {
    expect(["7", ".", ",", "+", "-", "*", "/", "%", "(", ")", "Enter", "=", "Backspace", "Escape", "Delete", "F9", "a", "Tab"]
      .map((key) => keyFromKeyboard({ key }))).toEqual(["7", ".", ".", "+", "−", "×", "÷", "%", "(", ")", "=", "=", "back", "clear", "clear", "±", null, null]);
    expect(keysFromText("1,234.5 × (2 − 1)")).toEqual(["1", "2", "3", "4", ".", "5", "×", "(", "2", "−", "1", ")"]);
    expect(keysFromText("hello")).toBeNull();
    expect(keysFromText("")).toBeNull();
    expect(parseShown("−1,234.5")).toBe("-1234.5");
    expect(parseShown("9.99999998e17")).toBe("9.99999998e17");
    expect(parseShown("오류")).toBeNull();
  });
});
