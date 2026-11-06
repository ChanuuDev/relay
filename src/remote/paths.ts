/** 원격 파일 경로 표기. 로컬 중계(relay.exe 원격 모드)와 브라우저 모드가 함께 쓴다. 브라우저에서도 돌므로 서버 전용 모듈을 가져오지 않는다. */
export const REMOTE_PREFIX = "remote:";

/** 원격 서버의 경로(`/문서/a.txt`)를 화면에서 쓰는 표기(`remote:/문서/a.txt`)인지 본다. */
export const remotePath = (value: unknown): value is string => typeof value === "string" && value.startsWith(REMOTE_PREFIX + "/");

const PATH_KEYS = ["path", "parent", "from", "to", "home", "target", "destination", "sources", "paths", "done"];

/** 원격 경로를 로컬 경로와 구분해 뷰어·즐겨찾기·클립보드에도 출처가 남는다. encode는 서버 응답을 화면 표기로, 아니면 화면 표기를 서버 경로로 바꾼다. */
export function paths(value: unknown, encode: boolean, key = ""): unknown {
  if (typeof value === "string" && PATH_KEYS.includes(key)) {
    return encode ? value.startsWith("/") ? REMOTE_PREFIX + value : value : remotePath(value) ? value.slice(REMOTE_PREFIX.length) : value;
  }
  if (Array.isArray(value)) return value.map(item => paths(item, encode, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, paths(v, encode, k)]));
  return value;
}
