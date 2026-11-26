import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Embedder, QueryEmbedder, SemanticIndex, embeddingModelName, modelKey, type IndexCache, type IndexDeps } from "@relay/core";
import { CONFIG } from "../app.tokens.js";
import type { ServerConfig } from "../config.js";
import { DB, type Db } from "../db/database.js";
import { PgIndexPort } from "./index.port.js";
import { NotesService } from "./notes.service.js";

/** 사용자마다 쥐는 캐시의 수. 1인 서버라 넉넉하고, 넘치면 가장 오래 안 쓴 것부터 버린다. */
const MAX_CACHED_USERS = 8;

/** 메모 의미 검색. 엔진은 로컬 서버와 같은 @relay/core의 SemanticIndex이고, 여기서는 사용자별 저장소와 캐시(낱말 색인·조각 벡터)를 이어 준다.
 *  임베딩 계산은 서버가 하지 않는다: 색인은 임베딩 서버가 있는 PC의 워커가 받아 가서 올리고, 검색 질의의 벡터도 그 PC가 실어 보낸다.
 *  RELAY_EMBED_URL을 두면(사설망·터널) 벡터 없이 온 질의를 서버가 직접 임베딩하고, 닿지 않으면 곧바로 낱말 검색으로 답한다. */
@Injectable()
export class NotesIndexService {
  private readonly caches = new Map<string, IndexCache>();
  private readonly deps: IndexDeps;

  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) config: ServerConfig, private readonly notes: NotesService) {
    const embedding = config.embedding ?? null;
    const queries = embedding ? new QueryEmbedder(new Embedder(embedding)) : null;
    const key = embedding ? modelKey(embeddingModelName(embedding), embedding.dimensions, embedding.prompt) : null;
    this.deps = {
      sha256: (text) => createHash("sha256").update(text).digest("hex"), now: () => Date.now(), id: () => randomUUID(),
      ...(queries ? { embedQuery: async (query, model) => (model.key === key ? queries.embed(query) : { failed: "model_mismatch" as const }) } : {}),
    };
  }

  engine(userId: string): SemanticIndex {
    let cache = this.caches.get(userId);
    this.caches.delete(userId);
    if (!cache) { cache = {}; if (this.caches.size >= MAX_CACHED_USERS) this.caches.delete(this.caches.keys().next().value!); }
    this.caches.set(userId, cache);
    return new SemanticIndex(new PgIndexPort(this.db, userId, this.notes), this.deps, cache);
  }
}
