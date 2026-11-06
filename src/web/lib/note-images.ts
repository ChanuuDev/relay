import { create } from "zustand";
import { MAX_IMAGE_BYTES, NOTE_IMAGES_PATH, type NoteImage } from "@relay/core";

/* 메모에 붙이는 그림. 붙여넣기·끌어 놓기·도구 단추로 고른 그림을 Relay 서버에 올리고, 본문에는 돌려받은 주소만 남긴다. */

/** 서버가 그대로 받는 형식. 이 밖의 그림(BMP·SVG 등)은 PNG로 바꿔 올린다. */
const STORED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml";
const MB = MAX_IMAGE_BYTES / 1024 / 1024;

/** 편집기에서 생긴 안내(그림을 올리지 못함 등). 메모 창 아래 안내로 보인다. */
export const useNoteAlert = create<{ alert: { text: string; at: number } | null; say: (text: string) => void; clear: () => void }>((set) => ({
  alert: null,
  say: (text) => set({ alert: { text, at: Date.now() } }),
  clear: () => set({ alert: null }),
}));

/** 클립보드·끌어 놓은 자료에서 그림 파일만 고른다.
 *  엑셀·워드처럼 글과 그 글을 찍은 그림을 함께 넣는 앱이 있으므로, 글(text/plain)이 함께 있으면 글을 붙여 넣게 그림을 고르지 않는다.
 *  브라우저의 "이미지 복사"처럼 글이 없거나, 주소·그림 파일 이름(탐색기에서 복사한 파일) 한 줄뿐이면 그림을 쓴다. */
export function imageFilesOf(data: DataTransfer | null, preferText = true): File[] {
  if (!data) return [];
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    for (const item of Array.from(data.items)) if (item.kind === "file" && item.type.startsWith("image/")) { const file = item.getAsFile(); if (file) files.push(file); }
  }
  if (!files.length || !preferText) return files;
  const text = data.getData("text/plain").trim();
  return !text || /^https?:\/\/\S+$/.test(text) || /^[^\n]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(text) ? files : [];
}

/** 서버가 받지 않는 형식은 브라우저가 그릴 수 있으면 PNG로 바꾼다. */
async function storable(file: Blob): Promise<Blob> {
  if (STORED.has(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1;
    canvas.height = image.naturalHeight || 1;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error();
    return png;
  } catch { throw new Error("이 형식의 그림은 넣을 수 없습니다. PNG·JPEG·GIF·WebP로 저장해 넣어 주세요."); }
  finally { URL.revokeObjectURL(url); }
}

const base64Of = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
  reader.onerror = () => reject(new Error("그림을 읽지 못했습니다."));
  reader.readAsDataURL(blob);
});

/** 그림 한 장을 서버에 올리고 본문에 넣을 주소를 돌려준다. 같은 그림은 서버에 한 번만 남는다. */
export async function uploadImage(file: Blob): Promise<string> {
  const blob = await storable(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`그림은 ${MB}MB까지 넣을 수 있습니다.`);
  let response: Response;
  try {
    response = await fetch(NOTE_IMAGES_PATH, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: await base64Of(blob) }) });
  } catch { throw new Error("Relay 서버에 연결할 수 없습니다."); }
  if (!response.ok) {
    let message = `서버가 그림을 받지 않았습니다(${response.status}).`;
    try { const data = await response.json() as { error?: { message?: unknown } }; if (typeof data.error?.message === "string") message = data.error.message; } catch { /* 기본 문구를 쓴다. */ }
    throw new Error(message);
  }
  return (await response.json() as NoteImage).url;
}

/** 그림을 올리지 못했을 때 보일 문구. */
export const uploadFailure = (error: unknown, count = 1) =>
  `${count > 1 ? "그림 일부를" : "그림을"} 넣지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류입니다."}`;

/** Markdown 원문에 넣는 그림 한 줄. */
export const imageMarkdown = (url: string) => `![](${url})`;
