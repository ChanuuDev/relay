/** 브라우저(YouTube 창)와 서버(플레이어 래퍼 페이지)가 함께 쓰는 유튜브 재생 대상과 플레이어 주소. */
export type Target =
  | { kind: "video"; id: string; list?: string; start?: number }
  | { kind: "playlist"; list: string };

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const LIST_ID = /^[A-Za-z0-9_-]{2,128}$/;
/** 추적 쿠키를 줄이는 플레이어 도메인. 래퍼 페이지의 CSP `frame-src`와 함께 바꾼다. */
export const EMBED_ORIGIN = "https://www.youtube-nocookie.com";
/** 메인 화면이 iframe으로 넣는, localhost 출처의 플레이어 래퍼 경로. */
export const PLAYER_PATH = "/youtube/player";

/** 유튜브 내장 플레이어 주소. */
export function embedUrl(target: Target): string {
  const params = new URLSearchParams({ autoplay: "1", rel: "0", playsinline: "1" });
  if (target.kind === "playlist") { params.set("list", target.list); return `${EMBED_ORIGIN}/embed/videoseries?${params}`; }
  if (target.list) params.set("list", target.list);
  if (target.start) params.set("start", String(target.start));
  return `${EMBED_ORIGIN}/embed/${target.id}?${params}`;
}

/** 래퍼 페이지에 넘기는 query. 순서는 v → list → start. */
export function playerQuery(target: Target): URLSearchParams {
  const params = new URLSearchParams();
  if (target.kind === "video") {
    params.set("v", target.id);
    if (target.list) params.set("list", target.list);
    if (target.start) params.set("start", String(target.start));
  } else params.set("list", target.list);
  return params;
}
