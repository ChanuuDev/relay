import { RelayError } from "./errors.js";

/** 끝낸 계산 하나. 식과 결과는 화면에 보인 그대로(천 단위 구분, × ÷ − 기호) 남긴다. */
export type Calculation = { id: string; expression: string; result: string; createdAt: number };
/** 화면이 보내는 이력 변경 한 건. add는 같은 id를 다시 보내도 한 번만 남는다(보내지 못해 다시 보낸 경우). */
export type HistoryAction = { action: "add"; item: Calculation } | { action: "delete"; id: string } | { action: "clear" };
export type CalculationList = { schemaVersion: 1; items: Calculation[] };
export type CalculationApplied = { schemaVersion: 1; added: boolean } | { schemaVersion: 1; deleted: number };

/** 남기는 계산 수. 넘으면 오래된 것부터 지운다. */
export const MAX_HISTORY = 500;
export const MAX_EXPRESSION = 1000;
export const MAX_RESULT = 100;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

const invalid = (message: string): never => { throw new RelayError("INVALID_ARGUMENT", message); };
const id = (value: unknown, field: string) => (typeof value === "string" && ID.test(value) ? value : invalid(`${field}이(가) 올바르지 않습니다.`));
const str = (value: unknown, max: number, field: string) => {
  if (typeof value !== "string" || !value.trim()) return invalid(`${field}은(는) 비어 있지 않은 문자열이어야 합니다.`);
  if (value.length > max) return invalid(`${field}이(가) 너무 깁니다(최대 ${max}자).`);
  return value;
};

/** 화면이 보낸 변경을 검사해 모양을 고정한다. 동작마다 받는 키가 정해져 있고, 틀리면 아무것도 쓰지 않고 거부한다. */
export function parseHistoryAction(raw: unknown, now = Date.now()): HistoryAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("본문은 { action } 객체여야 합니다.");
  const value = raw as Record<string, unknown>;
  const only = (...keys: string[]) => {
    for (const key of Object.keys(value)) if (key !== "action" && !keys.includes(key)) invalid(`허용하지 않는 키: ${key}`);
  };
  switch (value.action) {
    case "add": {
      only("item");
      const item = value.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) return invalid("item은 객체여야 합니다.");
      const entry = item as Record<string, unknown>;
      for (const key of Object.keys(entry)) if (!["id", "expression", "result", "createdAt"].includes(key)) invalid(`허용하지 않는 키: item.${key}`);
      const createdAt = typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) && entry.createdAt >= 0 ? Math.floor(entry.createdAt) : now;
      return { action: "add", item: { id: id(entry.id, "item.id"), expression: str(entry.expression, MAX_EXPRESSION, "식"), result: str(entry.result, MAX_RESULT, "결과"), createdAt } };
    }
    case "delete":
      only("id");
      return { action: "delete", id: id(value.id, "id") };
    case "clear":
      only();
      return { action: "clear" };
    default:
      return invalid("action: add | delete | clear 중 하나를 입력하세요.");
  }
}
