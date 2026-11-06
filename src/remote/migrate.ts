import type { Config } from "../config";
import { openDatabase } from "../db/database";
import { SessionRepository } from "../session/session.repository";
import { SessionService } from "../session/session.service";
import { NoteStore } from "../notes/notes.store";
import { CalculatorStore } from "../calculator/calculator.store";
import { RemoteClient } from "./client";
import type { ImportRequest } from "@relay/core";

/** 로컬 DB는 읽기 전용 스냅샷으로 남긴다. 부모 세션을 먼저 보내고 이력은 소유 세션 뒤에 보낸다. */
export async function migrate(config: Config, dryRun: boolean) {
  const db = openDatabase(config, true);
  try {
    const data = db.transaction(() => {
      const service = new SessionService(new SessionRepository(db));
      const sessions = service.repo.rows("", [], Number.MAX_SAFE_INTEGER, 0);
      const updates = db.query(`SELECT id, session_id AS sessionId, sequence, summary, status, created_at AS createdAt FROM session_updates ORDER BY session_id, sequence`).all() as NonNullable<ImportRequest["updates"]>;
      const exported = new NoteStore(db).exportAll();
      const calculations = new CalculatorStore(db).list().items;
      return { sessions, updates, notes: exported.items, calculations, images: exported.images ?? [] };
    }).deferred();
    const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
    if (dryRun) return { schemaVersion: 1, dryRun: true, counts };
    const client = new RemoteClient(config, 10 * 60_000);
    const results: unknown[] = [];
    // 세션을 모두 넣은 뒤 연결을 다시 적용해 묶음 경계의 부모·자식 관계도 보존한다.
    for (const key of ["sessions", "sessions", "updates", "notes", "calculations"] as const) {
      const rows = data[key];
      for (let offset = 0; offset < rows.length; offset += 1000) {
        results.push(await client.json("/api/v1/import", { [key]: rows.slice(offset, offset + 1000) }, crypto.randomUUID()));
      }
    }
    // 메모가 가리키는 그림은 한 장씩 올린다. id가 내용의 해시라 다시 올려도 한 장만 남는다.
    for (const image of data.images) results.push(await client.json("/api/v1/notes/images", { data: image.data }, crypto.randomUUID()));
    return { schemaVersion: 1, dryRun: false, counts, results };
  } finally { db.close(); }
}
