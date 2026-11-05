import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { copyName, errorFromBody, itemName, MAX_FILE_BATCH, MAX_UPLOAD_BYTES, type Listing, type PasteResult } from "@relay/core";
import { RelayError } from "../errors";
import { RemoteClient } from "./client";
const isRemote = (value: string) => value.startsWith("remote:/");
const plain = (value: string) => isRemote(value) ? value.slice(7) : value;
const join = (base: string, name: string) => isRemote(base) ? `remote:${path.posix.join(plain(base), name)}` : path.join(base, name);

/** 출처를 오가는 복사도 바이트를 메모리에 모으지 않고 스트리밍한다. 성공한 항목만 잘라내기 원본에서 지운다. */
export async function transfer(client: RemoteClient, body: unknown): Promise<PasteResult> {
  const value = body as { sources?: unknown; destination?: unknown; mode?: unknown } | null;
  if (!value || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > MAX_FILE_BATCH || !value.sources.every(source => typeof source === "string") || typeof value.destination !== "string" || !["copy", "cut"].includes(String(value.mode))) throw new RelayError("INVALID_ARGUMENT", "sources·destination·mode를 확인하세요.");
  const destination = value.destination;
  const mode = value.mode as "copy" | "cut";
  const done: PasteResult["done"] = [], failed: PasteResult["failed"] = [];
  const remoteList = (target: string) => client.json<Listing>("/api/v1/files?path=" + encodeURIComponent(plain(target)));
  async function copy(source: string, target: string, depth = 0): Promise<void> {
    if (depth > 100) throw new RelayError("INVALID_ARGUMENT", "폴더 깊이가 너무 깊습니다.");
    if (isRemote(source)) {
      const info = await client.json<{ kind: string; link: boolean; size: number }>("/api/v1/files/stat?path=" + encodeURIComponent(plain(source)));
      if (info.link) throw new RelayError("FORBIDDEN", "출처 간 복사에서는 링크를 지원하지 않습니다.", 2, 403);
      if (info.kind === "directory") {
        mkdirSync(target);
        const listing = await remoteList(source);
        if (listing.truncated) throw new RelayError("INVALID_ARGUMENT", "항목이 너무 많아 전체를 복사할 수 없습니다.");
        for (const entry of listing.entries) await copy("remote:" + entry.path, path.join(target, itemName(entry.name)), depth + 1);
      } else {
        if (info.size > MAX_UPLOAD_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", "파일은 256MB까지 전송할 수 있습니다.", 2, 413);
        const response = await client.fetch("/api/v1/files/content?path=" + encodeURIComponent(plain(source)));
        if (!response.ok || !response.body) throw new RelayError("REMOTE_UNREACHABLE", "원격 파일을 읽지 못했습니다.", 7, 502);
        await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(target, { flags: "wx" }));
      }
    } else {
      const stats = lstatSync(source);
      if (stats.isSymbolicLink()) throw new RelayError("FORBIDDEN", "출처 간 복사에서는 링크를 지원하지 않습니다.", 2, 403);
      if (stats.isDirectory()) {
        const result = await client.json<{ path: string }>("/api/v1/files/mkdir", { parent: path.posix.dirname(plain(target)), name: path.posix.basename(plain(target)) });
        for (const entry of readdirSync(source)) await copy(path.join(source, entry), "remote:" + path.posix.join(result.path, itemName(entry)), depth + 1);
      } else {
        if (!stats.isFile() || stats.size > MAX_UPLOAD_BYTES) throw new RelayError("PAYLOAD_TOO_LARGE", "일반 파일은 256MB까지 전송할 수 있습니다.", 2, 413);
        const response = await client.fetch("/api/v1/files/content?path=" + encodeURIComponent(plain(target)), {
          method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(stats.size) }, body: Readable.toWeb(createReadStream(source)) as unknown as ReadableStream });
        if (!response.ok) throw errorFromBody(await response.json(), response.status);
      }
    }
  }
  for (const source of value.sources as string[]) {
    let target: string | undefined;
    try {
      if ((!isRemote(source) && (!path.isAbsolute(source) || path.parse(source).root === path.resolve(source))) || (!isRemote(destination) && !path.isAbsolute(destination))) throw new RelayError("INVALID_ARGUMENT", "절대 경로의 항목을 선택하세요. 드라이브 전체는 옮길 수 없습니다.");
      if (isRemote(source) === isRemote(destination)) throw new RelayError("INVALID_ARGUMENT", "출처 간 전송에만 사용하세요.");
      const names = isRemote(destination) ? new Set((await remoteList(destination)).entries.map(entry => entry.name)) : null;
      const name = copyName(itemName(isRemote(source) ? path.posix.basename(plain(source)) : path.basename(source)), candidate => names ? names.has(candidate) : existsSync(join(destination, candidate)));
      target = join(destination, name);
      await copy(source, target);
      if (mode === "cut") {
        if (isRemote(source)) {
          const result = await client.json<{ failed: unknown[] }>("/api/v1/files/delete", { paths: [plain(source)] });
          if (result.failed.length) throw new RelayError("FILE_ERROR", "복사는 완료했지만 원본을 삭제하지 못했습니다.", 5, 500);
        } else rmSync(source, { recursive: true });
      }
      done.push({ from: source, to: target });
    } catch (error) { failed.push({ path: source, message: error instanceof RelayError ? error.message : "파일을 전송하지 못했습니다. 일부 복사본이 남아 있을 수 있습니다." }); }
  }
  return { schemaVersion: 1, mode, done, failed };
}
