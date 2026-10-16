import { RelayError } from "../errors";
import { embedUrl, LIST_ID, VIDEO_ID, type Target } from "./youtube-shared";

/* 유튜브는 플레이어를 넣은 페이지의 Referer가 IP 주소(http://127.0.0.1:포트)이면 광고가 붙는 영상 재생을 거부하고,
   http://localhost:포트는 받아들인다. 그래서 메인 화면이 직접 플레이어를 넣지 않고, localhost 출처로 받은 이 작은 페이지가
   플레이어를 띄운다. 페이지에는 스크립트도 세션 데이터도 없다. */

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** `?v=영상ID&list=재생목록&start=초`를 검사해 재생 대상으로 바꾼다. 허용하지 않는 값은 400. */
export function playerTarget(url: URL): Target {
  for (const key of new Set(url.searchParams.keys())) {
    if (!["v", "list", "start"].includes(key) || url.searchParams.getAll(key).length > 1) throw new RelayError("INVALID_ARGUMENT", `허용하지 않거나 중복된 query key: ${key}`);
  }
  const video = url.searchParams.get("v");
  const list = url.searchParams.get("list");
  const start = url.searchParams.get("start");
  if (video !== null && !VIDEO_ID.test(video)) throw new RelayError("INVALID_ARGUMENT", "영상 ID 형식이 아닙니다.");
  if (list !== null && !LIST_ID.test(list)) throw new RelayError("INVALID_ARGUMENT", "재생목록 ID 형식이 아닙니다.");
  if (start !== null && !/^[1-9]\d{0,6}$/.test(start)) throw new RelayError("INVALID_ARGUMENT", "시작 시각은 초 단위 정수여야 합니다.");
  if (video) return { kind: "video", id: video, ...(list ? { list } : {}), ...(start ? { start: Number(start) } : {}) };
  if (list) return { kind: "playlist", list };
  throw new RelayError("INVALID_ARGUMENT", "v 또는 list가 필요합니다.");
}

export function playerHtml(target: Target): string {
  const title = target.kind === "video" ? "YouTube 영상" : "YouTube 재생목록";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${title}</title>
  <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#000}</style>
</head>
<body>
  <iframe src="${escapeAttribute(embedUrl(target))}" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>
`;
}
