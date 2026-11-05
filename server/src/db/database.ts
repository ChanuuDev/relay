import { Global, Module, type DynamicModule } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export { schema };
/** 로컬 테스트(PGlite)와 운영(node-postgres)이 같은 질의를 쓰도록 공통 상위 타입으로 다룬다. 트랜잭션도 같은 타입이다. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DB = Symbol("RELAY_DB");

/** 마이그레이션 SQL 폴더. dist/db/database.js에서도 server/drizzle을 가리킨다. */
export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** 운영 DB: DATABASE_URL로 풀을 열고 마이그레이션을 적용한다. */
export async function openPostgres(databaseUrl: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, close: () => pool.end() };
}

/** 테스트 DB: 메모리 PGlite에 같은 마이그레이션을 적용한다. */
export async function openPglite(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** 사용자 한 명의 쓰기를 직렬화한다. SQLite의 BEGIN IMMEDIATE 대신 트랜잭션 범위 advisory lock을 쓴다. */
export async function lockUser(tx: Db, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

export const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
export const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(db: Db): DynamicModule {
    return { module: DatabaseModule, providers: [{ provide: DB, useValue: db }], exports: [DB] };
  }
}
