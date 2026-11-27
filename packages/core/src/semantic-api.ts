import { RelayError } from "./errors.js";
import { noteId as checkId } from "./notes.js";
import { parseCards, parseCommit, parseDismiss, parseFail, parseLease, parseMeta, parseProbe, parseRegister, parseReindex, parseSearch } from "./semantic.js";
import type { SemanticIndex } from "./semantic-index.js";

// 의미 검색 API의 경로와 요청 검사. 로컬 서버와 원격 서버가 이 함수 하나로 같은 경로·같은 검사·같은 응답을 낸다.
//   POST /api/v1/notes/search                         하이브리드·낱말·의미 검색 (읽기 전용이라 POST여도 멱등 키를 쓰지 않는다)
//   GET  /api/v1/notes/index-status[?noteId=]         색인 상태
//   POST /api/v1/notes/reindex                        다시 색인
//   POST /api/v1/notes/index-jobs/lease|commit|fail   색인 워커: 받아 가기 → 벡터 올리기 / 실패 알리기
//   POST /api/v1/notes/index-jobs/probe               질의 벡터마다 가장 가까운 메모의 점수(바닥값을 재는 데 쓴다, 읽기 전용)
//   POST /api/v1/notes/index-models/activate          검색에 쓸 모델 바꾸기
//   GET  /api/v1/notes/semantic-links                 그래프에 그릴 의미 연결
//   GET  /api/v1/notes/<id>/suggestions               메모 하나의 연결 제안과 근거 절
//   POST /api/v1/notes/<id>/suggestions/<대상>/dismiss  제안 거절
//   GET  /api/v1/notes/cards[?limit=]                 의미 카드가 필요한 메모  ·  ?noteId=: 그 메모의 카드  ·  POST: 카드 저장
//   GET  /api/v1/notes/meta                           문서 유형·상태  ·  POST: 고치기
//   POST /api/v1/notes/register-doc                   Git 설계서·결정 기록 등록

const ID = "[A-Za-z0-9_-]{1,100}";
export const INDEX_API = new RegExp(`^/api/v1/notes/(search|index-status|reindex|index-jobs/(?:lease|commit|fail|probe)|index-models/activate|semantic-links|cards|meta|register-doc|${ID}/suggestions(?:/${ID}/dismiss)?)$`);
/** 응답이 커질 수 있는 경로(조각 글·벡터)와 읽기 전용 POST. 멱등 키로 응답을 보관하지 않는다. */
export const INDEX_API_NO_REPLAY = /^\/api\/v1\/notes\/(search|index-jobs\/(?:lease|commit|fail|probe))$/;
/** 벡터를 실어 보내는 커밋의 본문 상한. */
export const MAX_INDEX_BODY_BYTES = 8 * 1024 * 1024;

const SUGGEST = new RegExp(`^(${ID})/suggestions(?:/(${ID})/dismiss)?$`);

/** 색인 API 요청 하나를 처리한다. 경로가 아니면 undefined, 메서드가 틀리면 METHOD_NOT_ALLOWED. query는 주소의 ?뒤 값들이다. */
export async function serveIndex(index: SemanticIndex, method: string, pathname: string, query: Record<string, unknown>, body: unknown): Promise<unknown> {
  const route = INDEX_API.exec(pathname)?.[1];
  if (route === undefined) return undefined;
  const allow = (expected: "GET" | "POST" | "GET, POST") => {
    if (!expected.split(", ").includes(method)) throw new RelayError("METHOD_NOT_ALLOWED", "지원하지 않는 HTTP 메서드입니다.", 2, 405, { allow: expected });
  };
  const keys = (allowed: string[]) => {
    for (const key of Object.keys(query)) if (!allowed.includes(key)) throw new RelayError("INVALID_ARGUMENT", `모르는 query: ${key}`);
  };
  const posted = () => { allow("POST"); keys([]); return body; };
  switch (route) {
    case "search": return index.search(parseSearch(posted()));
    case "index-status": {
      allow("GET"); keys(["noteId"]);
      return index.status(query.noteId === undefined ? undefined : checkId(query.noteId, "noteId"));
    }
    case "reindex": return index.reindex(parseReindex(posted()));
    case "index-jobs/lease": return index.lease(parseLease(posted()));
    case "index-jobs/commit": return index.commit(parseCommit(posted()));
    case "index-jobs/fail": return index.fail(parseFail(posted()));
    case "index-jobs/probe": return index.probe(parseProbe(posted()));
    case "index-models/activate": {
      const value = posted() as { modelKey?: unknown } | null;
      if (!value || typeof value !== "object" || typeof value.modelKey !== "string" || !value.modelKey || value.modelKey.length > 200) throw new RelayError("INVALID_ARGUMENT", "modelKey를 보내세요.");
      return index.activate(value.modelKey);
    }
    case "semantic-links": allow("GET"); keys([]); return index.links();
    case "cards": {
      allow("GET, POST");
      if (method === "POST") { keys([]); const cards = parseCards(body); return index.cardsSave(cards.author, cards.cards); }
      keys(["limit", "noteId"]);
      if (query.noteId !== undefined) return index.card(checkId(query.noteId, "noteId"));
      const limit = query.limit === undefined ? 10 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RelayError("INVALID_ARGUMENT", "limit은 1~100 사이의 정수여야 합니다.");
      return index.cardsPending(limit);
    }
    case "meta": allow("GET, POST"); keys([]); return method === "POST" ? index.setMeta(parseMeta(body)) : index.metaList();
    case "register-doc": return index.register(parseRegister(posted()));
    default: {
      const [, id, target] = SUGGEST.exec(route)!;
      if (target === undefined) { allow("GET"); keys([]); return index.suggestions(id!); }
      allow("POST"); keys([]);
      const pair = parseDismiss({ a: id, b: target });
      return index.dismiss(pair.a, pair.b);
    }
  }
}
