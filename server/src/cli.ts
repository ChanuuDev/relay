import "reflect-metadata";
import { createApp } from "./app.js";
import { AuthService } from "./auth/auth.service.js";
import { loadConfig } from "./config.js";
import { openPostgres } from "./db/database.js";

/**
 * 서버 관리 CLI. 컨테이너 안에서 실행한다:
 *   docker compose exec relay-api node dist/cli.js token create --name office-pc
 *   docker compose exec relay-api node dist/cli.js token list
 *   docker compose exec relay-api node dist/cli.js token revoke <토큰 id>
 *   docker compose exec relay-api node dist/cli.js user bootstrap --name <이름>
 * --json을 붙이면 결과를 JSON 한 줄로 낸다. 토큰 원문은 만들 때 한 번만 보인다.
 */
const usage = `사용법:
  node dist/cli.js token create --name <기기명> [--json]
  node dist/cli.js token list [--json]
  node dist/cli.js token revoke <토큰 id> [--json]
  node dist/cli.js user bootstrap [--name <이름>] [--json]`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const [group, command, ...rest] = args.filter((arg) => arg !== "--json");
  const config = loadConfig();
  if (!config.databaseUrl) { console.error("DATABASE_URL이 없습니다."); process.exit(2); }
  const { db, close } = await openPostgres(config.databaseUrl);
  const app = await createApp(db, config, { schedule: false, log: false });
  const auth = app.get(AuthService);
  const out = (value: unknown, human: string) => console.log(json ? JSON.stringify(value) : human);
  try {
    if (group === "user" && command === "bootstrap") {
      const user = await auth.bootstrap(option(rest, "--name") ?? config.bootstrapUser);
      out({ schemaVersion: 1, user }, `${user.created ? "기본 사용자를 만들었습니다" : "이미 사용자가 있습니다"}: ${user.name} (${user.id})`);
      return;
    }
    const user = await auth.defaultUser() ?? await auth.bootstrap(config.bootstrapUser);
    if (group === "token" && command === "create") {
      const name = option(rest, "--name");
      if (!name) { console.error(usage); process.exit(2); }
      const { token, info } = await auth.createToken(user.id, name);
      out({ schemaVersion: 1, token, info }, `토큰을 만들었습니다 (${info.name}, ${info.id}). 이 값은 지금 한 번만 보입니다:\n${token}`);
      return;
    }
    if (group === "token" && command === "list") {
      const items = await auth.listTokens(user.id);
      out({ schemaVersion: 1, items }, items.length ? items.map((t) => `${t.revokedAt ? "폐기" : "유효"}  ${t.id}  ${t.name}  만든 날 ${t.createdAt}  마지막 사용 ${t.lastUsedAt ?? "-"}`).join("\n") : "토큰이 없습니다.");
      return;
    }
    if (group === "token" && command === "revoke") {
      const id = rest[0];
      if (!id) { console.error(usage); process.exit(2); }
      const info = await auth.revokeToken(user.id, id);
      out({ schemaVersion: 1, info }, `토큰을 폐기했습니다: ${info.name} (${info.id})`);
      return;
    }
    console.error(usage);
    process.exit(2);
  } finally {
    await app.close();
    await close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
