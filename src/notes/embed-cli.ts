import type { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOC_STATUSES, DOC_STATUS_NAME, DOC_TYPES, DOC_TYPE_NAME, EMBEDDING_PROMPTS, diagnoseEmbedder, parseCards, parseEmbeddingConfig, parseSearch,
  type DocStatus, type DocType, type EmbeddingConfig, type LinkItem, type NoteMeta, type SearchRequest, type SearchResponse } from "@relay/core";
import { loadConfig, type Config } from "../config";
import { runningDataDirectory } from "../web/control";
import { openDatabase } from "../db/database";
import { invalid, RelayError } from "../errors";
import type { ContextHit } from "../web/lib/graph-context";
import { EmbedderHost, RemoteIndex, cardsText, diagnosisText, loadEmbedding, localIndex, runWorker, saveEmbedding, searchText, statusText, workerText, type IndexApi } from "./embed";
import type { MemoIndex } from "./memo";

// `relay embed …`, `relay memo --search`(순위 검색), `relay memo register`·`meta`. 계산은 @relay/core, 이 PC의 프로세스·파일은 ./embed가 맡고
// 여기에는 명령줄 옵션을 읽어 그 둘을 부르고 결과를 글로 쓰는 일만 둔다.

/** 색인 저장소를 열어 한 가지 일을 하고 닫는다. 원격 모드면 원격 서버의 API를 부른다. */
export async function withIndex<T>(config: Config, action: (api: IndexApi) => Promise<T>): Promise<T> {
  if (config.mode === "remote") return action(new RemoteIndex(config));
  const db = openDatabase(config);
  try { return await action(localIndex(db)); } finally { db.close(); }
}

/** 서버가 이 API를 아직 모른다(옛 원격 서버). */
export const missingApi = (error: unknown) => error instanceof RelayError && error.httpStatus === 404 && error.code !== "NOTE_NOT_FOUND";

/** 메모를 낱말과 뜻으로 찾는다. 이 PC에 relay web이 떠 있으면 그 서버에 맡긴다(임베딩 서버를 띄우고 질의 벡터를 기억하는 일을 그 서버가 한다).
 *  떠 있지 않으면 직접 찾는다: 임베딩 서버가 지금 답하면 질의 벡터를 싣고, 아니면 낱말 검색으로 답한다. */
export async function searchNotes(config: Config, request: SearchRequest): Promise<SearchResponse> {
  const origin = `http://${config.webHost}:${config.webPort}`;
  try {
    // 같은 저장소를 쓰는 서버일 때만 맡긴다(다른 저장소를 --data-dir로 가리킨 명령이 엉뚱한 서버의 메모를 찾지 않게).
    const same = (value: string | null) => value !== null && path.resolve(value).toLowerCase() === path.resolve(config.dataDirectory).toLowerCase();
    if (same(await runningDataDirectory(origin, 400))) {
      const response = await fetch(`${origin}/api/v1/notes/search`, { method: "POST", signal: AbortSignal.timeout(12_000),
        headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(request) });
      if (response.ok) return await response.json() as SearchResponse;
      await response.body?.cancel().catch(() => {});
    }
  } catch { /* 서버가 없거나 답하지 않는다: 직접 찾는다. */ }
  let attached = request;
  try {
    const embedding = loadEmbedding(config.dataDirectory);
    if (embedding && request.mode !== "keyword") {
      const host = new EmbedderHost(embedding);
      const vector = await host.queries.embed(request.query);
      if (vector instanceof Float32Array) attached = await host.attach({ ...request });
    }
  } catch { /* 설정이 잘못됐으면 낱말 검색으로 답한다(relay embed status가 알린다). */ }
  const result = await withIndex(config, (api) => api.search(attached));
  // 검색 API를 모르는 서버가 다른 모양으로 답한 경우도 「없음」으로 본다(부른 쪽이 글자 그대로 찾기로 답한다).
  if (!result || !Array.isArray(result.items)) throw new RelayError("NOT_FOUND", "서버가 검색 API를 지원하지 않습니다.", 3, 404);
  return result;
}

/** 검색 결과를 맥락 묶음의 씨앗으로. */
export const toHits = (result: SearchResponse): ContextHit[] => result.items.map((item) => {
  const match = item.matches.find((entry) => entry.score !== undefined) ?? item.matches[0];
  return { id: item.noteId, score: item.score, terms: item.terms, semantic: item.scores.semantic !== undefined,
    ...(match ? { heading: match.headingPath, lines: [match.lineStart, match.lineEnd] as [number, number] } : {}) };
});

/** 그래프에 그릴 의미 연결. 색인이 없거나 서버가 모르면 빈 목록이다. */
export async function semanticLinks(config: Config): Promise<LinkItem[]> {
  try { return (await withIndex(config, (api) => api.links())).items; } catch { return []; }
}

// ── Git 문서 등록 ─────────────────────────────────────────

function git(cwd: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore", timeout: 3000 });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch { return null; }
}

/** 파일이 든 Git 저장소의 이름·저장소 안 경로·커밋. 저장소 이름은 origin 주소의 마지막 마디(없으면 폴더 이름)만 쓰고, 계정·호스트는 남기지 않는다. */
export function gitSource(file: string): { sourceRepo: string; sourcePath: string; sourceCommit?: string } | null {
  if (process.env.RELAY_NO_GIT === "1") return null;
  const directory = path.dirname(file);
  const top = git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  const relative = path.relative(path.resolve(top), file).split(path.sep).join("/");
  if (!relative || relative.startsWith("..")) return null;
  const remote = git(directory, ["remote", "get-url", "origin"]) ?? "";
  const name = (remote.replace(/[\\/]+$/, "").split(/[\\/:]/).pop() ?? "").replace(/\.git$/i, "") || path.basename(top);
  const commit = git(directory, ["rev-parse", "HEAD"]);
  const clean = (value: string) => value.replace(/\s+/g, "-").replace(/\\/g, "/").slice(0, 300);
  return { sourceRepo: clean(name), sourcePath: clean(relative), ...(commit && /^[0-9a-f]{7,64}$/i.test(commit) ? { sourceCommit: commit.slice(0, 12) } : {}) };
}

/** 파일 머리의 YAML 머리말(`---` 사이의 `키: 값`)에서 문서 정보를 읽는다. 본문은 건드리지 않고 그대로 등록한다. */
export function frontmatter(body: string): { title?: string; type?: string; status?: string; project?: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  const out: Record<string, string> = {};
  for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (pair) out[pair[1]!.toLowerCase()] = pair[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { ...(out.title ? { title: out.title } : {}), ...(out.type ?? out.doc_type ? { type: out.type ?? out.doc_type } : {}), ...(out.status ?? out.doc_status ? { status: out.status ?? out.doc_status } : {}),
    ...(out.project ? { project: out.project } : {}) };
}

const docType = (value: string | undefined, fallback: DocType): DocType => {
  if (value === undefined) return fallback;
  if (!DOC_TYPES.includes(value as DocType)) invalid(`--type: ${DOC_TYPES.join(" | ")} 중 하나를 입력하세요.`);
  return value as DocType;
};
const docStatus = (value: string | undefined): DocStatus | null | undefined => {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (!DOC_STATUSES.includes(value as DocStatus)) invalid(`--status: ${DOC_STATUSES.join(" | ")} | none 중 하나를 입력하세요.`);
  return value as DocStatus;
};
const metaText = (meta: NoteMeta) => [`${DOC_TYPE_NAME[meta.docType]}${meta.docStatus ? `(${DOC_STATUS_NAME[meta.docStatus]})` : ""}`, meta.project ? `프로젝트 ${meta.project}` : "",
  meta.sourceRepo ? `출처 ${meta.sourceRepo}:${meta.sourcePath}${meta.sourceCommit ? `@${meta.sourceCommit}` : ""}` : "", meta.supersededBy ? `새 문서 ${meta.supersededBy}` : ""].filter(Boolean).join(" · ");

type Tools = { asciiJson: (value: unknown) => string; memoIndex: (config: Config) => Promise<MemoIndex> };
const write = (command: Command, tools: Tools, data: unknown, text: string): void => void process.stdout.write(command.optsWithGlobals().json ? `${tools.asciiJson(data)}\n` : text.replace(/\n*$/, "\n"));
const whole = (value: string | undefined, name: string, min: number, max: number, fallback: number) => {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) invalid(`${name}: ${min}~${max} 사이의 정수를 입력하세요.`);
  return number;
};
const split = (value: string | undefined) => value?.split(",").map((item) => item.trim()).filter(Boolean);

/** `relay memo --search`의 순위 검색. mode가 exact가 아닐 때 부른다. 옛 서버라 검색 API가 없으면 null(부른 쪽이 글자 그대로 찾기로 답한다). */
export async function rankedSearch(config: Config, query: string, o: { mode?: string; type?: string; status?: string; project?: string; history?: boolean; limit?: string }) {
  const mode = o.mode ?? "hybrid";
  if (mode !== "hybrid" && mode !== "keyword" && mode !== "semantic") invalid("--mode: hybrid | keyword | semantic | exact 중 하나를 입력하세요.");
  const request = parseSearch({ query, mode, limit: whole(o.limit, "--limit", 1, 50, 10),
    filters: { ...(o.project ? { project: o.project } : {}), ...(split(o.type) ? { docType: split(o.type) } : {}), ...(split(o.status) ? { docStatus: split(o.status) } : {}), ...(o.history ? { includeHistory: true } : {}) } });
  let result: SearchResponse;
  try { result = await searchNotes(config, request); } catch (error) { if (missingApi(error)) return null; throw error; }
  const api = `http://${config.webHost}:${config.webPort}`;
  // 예전 출력과 이어지도록 id·label도 함께 싣는다.
  return { data: { ...result, api, items: result.items.map((item) => ({ id: item.noteId, label: item.title, ...item })) }, text: searchText(result) };
}

/** 윗 명령(relay memo)과 이름이 같은 옵션의 값. 하위 명령에 준 것이 먼저다. */
function shared(command: Command, own: { type?: string; status?: string; project?: string }) {
  const merged = command.optsWithGlobals() as { type?: string; status?: string; project?: string };
  const pick = (key: "type" | "status" | "project") => own[key] ?? merged[key];
  return { ...(pick("type") !== undefined ? { type: pick("type") } : {}), ...(pick("status") !== undefined ? { status: pick("status") } : {}), ...(pick("project") !== undefined ? { project: pick("project") } : {}) };
}

/** `relay memo register`·`relay memo meta`. */
export function memoDocCommands(memo: Command, tools: Tools) {
  memo.command("register <file>").description("Git 설계서·결정 기록(Markdown 파일)을 메모로 등록하거나 고침. 같은 저장소·경로를 다시 올리면 같은 메모를 고쳐 링크가 끊기지 않음. 본문은 파일 그대로 둠")
    .option("--type <type>", "문서 유형: memo | knowledge | design(기본) | decision")
    .option("--status <status>", "문서 상태: draft | adopted | superseded | none (설계서·결정 기록의 기본은 draft)")
    .option("--project <name>", "프로젝트 이름(검색에서 프로젝트로 좁힐 때 씀)")
    .option("--title <text>", "제목(없으면 파일 머리말의 title, 첫 # 제목, 파일 이름 순)")
    .option("--supersedes <id>", "이 문서가 대신하는 옛 문서의 메모 ID(옛 문서는 「대체됨」이 되고 검색에서 이 문서를 알림)")
    .option("--folder <id>", "새로 만들 때 넣을 폴더 ID")
    .option("--note <id>", "Git 저장소 밖의 파일을 이미 있는 메모에 덮어쓸 때 그 메모 ID")
    .action(async (file: string, own: { type?: string; status?: string; project?: string; title?: string; supersedes?: string; folder?: string; note?: string }, c: Command) => {
      // --type·--status·--project는 relay memo --search에도 있는 이름이라 commander가 윗 명령의 옵션으로 읽는다. 합쳐진 값에서 꺼낸다.
      const o = { ...own, ...shared(c, own) };
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const target = path.resolve(file);
      let body: string;
      try { body = readFileSync(target, "utf8").replace(/^﻿/, ""); } catch { throw new RelayError("FILE_NOT_FOUND", `파일을 읽을 수 없습니다: ${target}`, 3, 404); }
      const head = frontmatter(body);
      const index = o.supersedes !== undefined || o.folder !== undefined || o.note !== undefined ? await tools.memoIndex(config) : null;
      const idOf = (raw: string | undefined) => (raw === undefined ? undefined : index!.resolve(raw).id);
      const source = gitSource(target);
      const type = docType(o.type ?? (DOC_TYPES.includes(head.type as DocType) ? head.type : undefined), "design");
      const status = docStatus(o.status ?? (DOC_STATUSES.includes(head.status as DocStatus) ? head.status : undefined));
      const title = (o.title ?? head.title ?? "").trim() || (/^\s{0,3}#\s+\S/m.test(body) ? undefined : path.basename(target).replace(/\.(md|markdown|txt)$/i, ""));
      const result = await withIndex(config, (api) => api.register({ body, docType: type, ...(status !== undefined ? { docStatus: status } : {}), ...(title ? { title } : {}),
        ...(o.project ?? head.project ? { project: (o.project ?? head.project)!.trim() } : {}), ...(source ?? {}),
        ...(idOf(o.note) ? { noteId: idOf(o.note) } : {}), ...(idOf(o.supersedes) ? { supersedes: idOf(o.supersedes) } : {}), ...(idOf(o.folder) ? { folderId: idOf(o.folder) } : {}) }));
      const word = result.action === "created" ? "새 메모로 등록했습니다" : result.action === "updated" ? "메모를 새 내용으로 고쳤습니다" : "바뀐 내용이 없어 그대로 두었습니다";
      write(c, tools, { ...result, ...(source ? { source } : {}) }, [`${word}: ${path.basename(target)} · ${DOC_TYPE_NAME[type]} · 메모 ID: ${result.noteId}`,
        source ? `- 출처: ${source.sourceRepo}:${source.sourcePath}${source.sourceCommit ? `@${source.sourceCommit}` : ""}` : "- Git 저장소 밖의 파일이라 출처를 적지 않았습니다(다시 올릴 때는 --note로 이 메모 ID를 주세요).",
        result.superseded ? `- 옛 문서 ${result.superseded}은(는) 「대체됨」으로 바꿨습니다.` : ""].filter(Boolean).join("\n"));
    });
  memo.command("meta [id]").description("메모의 문서 유형·상태·프로젝트·대체 관계를 보거나 고침(본문은 건드리지 않음). ID 없이 부르면 문서 정보가 있는 메모 목록")
    .option("--type <type>", "memo | knowledge | design | decision").option("--status <status>", "draft | adopted | superseded | none")
    .option("--project <name>", "프로젝트 이름(빈 값은 \"\")").option("--superseded-by <id>", "이 문서를 대신하는 새 문서의 메모 ID (none이면 지움)")
    .action(async (id: string | undefined, own: { type?: string; status?: string; project?: string; supersededBy?: string }, c: Command) => {
      const o = { ...own, ...shared(c, own) };
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const index = await tools.memoIndex(config);
      if (id === undefined) {
        const list = await withIndex(config, (api) => api.metaList());
        const label = (noteId: string) => { try { return index.find(noteId).item.kind === "note" ? (index.find(noteId).item as { title: string }).title || noteId : noteId; } catch { return noteId; } };
        return write(c, tools, list, list.items.length ? [`문서 정보가 있는 메모 ${list.items.length}개`, "", ...list.items.map((meta) => `- ${label(meta.noteId)} · ${metaText(meta)} · ID: ${meta.noteId}`)].join("\n")
          : "문서 정보가 있는 메모가 없습니다. relay memo register <파일>이나 relay memo meta <ID> --type …으로 붙입니다.");
      }
      const noteId = index.resolve(id).id;
      const changes = { ...(o.type !== undefined ? { docType: docType(o.type, "memo") } : {}), ...(o.status !== undefined ? { docStatus: docStatus(o.status) } : {}),
        ...(o.project !== undefined ? { project: o.project.trim() } : {}), ...(o.supersededBy !== undefined ? { supersededBy: o.supersededBy === "none" ? null : index.resolve(o.supersededBy).id } : {}) };
      if (!Object.keys(changes).length) {
        const meta = (await withIndex(config, (api) => api.metaList())).items.find((item) => item.noteId === noteId);
        return write(c, tools, { schemaVersion: 1, meta: meta ?? null }, meta ? `${metaText(meta)} · ID: ${noteId}` : `문서 정보가 없습니다(일반 메모). ID: ${noteId}`);
      }
      const result = await withIndex(config, (api) => api.setMeta({ noteId, ...changes }));
      write(c, tools, result, `문서 정보를 고쳤습니다: ${metaText(result.meta)} · ID: ${noteId}`);
    });
}

/** `relay embed …`: 의미 색인과 임베딩 서버. */
export function embedCommands(program: Command, tools: Tools) {
  const embed = program.command("embed").description("메모 의미 검색의 색인과 임베딩 서버: 상태·설정·자가 진단·색인 실행·의미 카드 (relay-embedding 스킬 참고)");
  const need = (config: Config): EmbeddingConfig => loadEmbedding(config.dataDirectory)
    ?? (() => { throw new RelayError("INVALID_CONFIG", "이 PC에 임베딩 설정이 없습니다. relay embed setup으로 임베딩 서버를 잇습니다(relay-embedding 스킬 참고)."); })();

  embed.command("status").description("의미 색인이 어디까지 됐는지: 준비·대기·실패한 메모 수, 쓰는 모델, 색인 워커, 의미 카드")
    .option("--note <id>", "메모 하나의 상태")
    .action(async (o: { note?: string }, c: Command) => {
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const noteId = o.note === undefined ? undefined : (await tools.memoIndex(config)).resolve(o.note).id;
      const status = await withIndex(config, (api) => api.status(noteId));
      let embedding: EmbeddingConfig | null = null, problem = "";
      try { embedding = loadEmbedding(config.dataDirectory); } catch (error) { problem = (error as Error).message; }
      // 설정에 든 API 키는 내보내지 않는다.
      const shown = embedding ? { ...embedding, ...(embedding.apiKey ? { apiKey: "(설정됨)" } : {}) } : null;
      write(c, tools, { ...status, embedding: shown }, `${statusText(status, embedding)}${problem ? `\n! ${problem}` : ""}`);
    });

  embed.command("setup").description("이 PC의 임베딩 서버를 잇고 자가 진단을 거쳐 저장. `--` 뒤에 서버를 띄우는 명령을 적으면 필요할 때 띄우고 쉬면 끔")
    .option("--url <url>", "임베딩 서버 주소 (예: http://127.0.0.1:18434)").option("--model <name>", "서버에 보낼 모델 이름")
    .option("--dimensions <number>", "저장할 차원(모델이 더 길게 주면 앞에서부터 이만큼만 씀)")
    .option("--prompt <kind>", `입력 머리말: ${Object.keys(EMBEDDING_PROMPTS).join(" | ")} (KURE-v3·Nemotron·E5는 e5, EmbeddingGemma는 gemma, 기본 plain)`)
    .option("--style <style>", "요청 모양: openai(/v1/embeddings, 기본) | ollama(/api/embed)")
    .option("--name <name>", "색인에 적을 모델 이름(없으면 --model)").option("--api-key-env <variable>", "API 키가 든 환경 변수 이름(호스팅 서비스)")
    .option("--context <tokens>", "Ollama에 넘길 컨텍스트 길이(기본 8192)").option("--batch <number>", "한 번에 보낼 글 수(기본 16)")
    .option("--idle <minutes>", "직접 띄운 서버를 이만큼 쓰지 않으면 끔(기본 10, 0이면 끄지 않음)").option("--no-auto", "relay web이 색인 워커를 스스로 돌리지 않게 함")
    .option("--force", "자가 진단에 실패해도 저장").option("--remove", "임베딩 설정을 지움")
    .allowExcessArguments(true)
    .action(async (o: { url?: string; model?: string; dimensions?: string; prompt?: string; style?: string; name?: string; apiKeyEnv?: string; context?: string; batch?: string; idle?: string; auto?: boolean; force?: boolean; remove?: boolean }, c: Command) => {
      const config = loadConfig(c.optsWithGlobals().dataDir);
      if (o.remove) { saveEmbedding(config, null); return write(c, tools, { schemaVersion: 1, removed: true }, "임베딩 설정을 지웠습니다. 검색은 낱말 검색으로 답합니다."); }
      if (!o.url || !o.model || !o.dimensions) invalid("--url, --model, --dimensions를 주세요. 예: relay embed setup --url http://127.0.0.1:18434 --model kure-v3 --dimensions 1024 --prompt e5 -- llama-server -hf mradermacher/KURE-v3-GGUF:Q8_0 --embeddings --pooling mean -c 8192 --port 18434");
      const key = o.apiKeyEnv === undefined ? undefined : process.env[o.apiKeyEnv]?.trim() || invalid(`환경 변수 ${o.apiKeyEnv}가 비어 있습니다.`);
      const launch = c.args.length ? c.args : undefined;
      const embedding = parseEmbeddingConfig({ url: o.url, model: o.model, dimensions: Number(o.dimensions), ...(o.prompt ? { prompt: o.prompt } : {}), ...(o.style ? { style: o.style } : {}),
        ...(o.name ? { name: o.name } : {}), ...(key ? { apiKey: key } : {}), ...(o.context ? { contextTokens: Number(o.context) } : {}), ...(o.batch ? { batch: Number(o.batch) } : {}),
        ...(o.idle !== undefined ? { idleMinutes: Number(o.idle) } : {}), ...(o.auto === false ? { auto: false } : {}), ...(launch ? { launch } : {}) });
      const host = new EmbedderHost(embedding);
      try {
        if (!(await host.ensure(180_000))) throw new RelayError("EMBEDDING_FAILED", `임베딩 서버가 답하지 않습니다: ${embedding.url}. ${launch ? "띄우는 명령과 모델 경로를 확인하세요(모델을 처음 받는 중이면 다 받은 뒤 다시 실행하세요)." : "서버를 먼저 켜거나 `--` 뒤에 띄우는 명령을 적으세요."}`, 5, 502);
        const diagnosis = await diagnoseEmbedder(host.embedder);
        if (!diagnosis.ok && !o.force) {
          process.stdout.write(c.optsWithGlobals().json ? `${tools.asciiJson({ schemaVersion: 1, saved: false, diagnosis })}\n` : `${diagnosisText(diagnosis, embedding)}\n\n저장하지 않았습니다. 설정을 고치거나, 그래도 쓰려면 --force를 붙이세요.\n`);
          process.exitCode = 1;
          return;
        }
        const saved = { ...embedding, floor: diagnosis.floor };
        saveEmbedding(config, saved);
        write(c, tools, { schemaVersion: 1, saved: true, diagnosis, embedding: { ...saved, ...(saved.apiKey ? { apiKey: "(설정됨)" } : {}) } },
          `${diagnosisText(diagnosis, saved)}\n\n임베딩 설정을 저장했습니다. relay web이 떠 있으면 다시 띄운 뒤(relay web --reload) 스스로 색인하고, 지금 돌리려면 relay embed run을 실행합니다.`);
      } finally { host.stop(); }
    });

  embed.command("doctor").description("임베딩 서버 자가 진단: 같은 뜻의 글(한국어끼리, 영어 질의와 한국어 글)이 다른 주제의 글보다 가깝게 나오는지")
    .action(async (_o: unknown, c: Command) => {
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const embedding = need(config);
      const host = new EmbedderHost(embedding);
      try {
        if (!(await host.ensure(180_000))) throw new RelayError("EMBEDDING_FAILED", `임베딩 서버가 답하지 않습니다: ${embedding.url}`, 5, 502);
        const diagnosis = await diagnoseEmbedder(host.embedder);
        write(c, tools, { schemaVersion: 1, diagnosis }, diagnosisText(diagnosis, embedding));
        if (!diagnosis.ok) process.exitCode = 1;
      } finally { host.stop(); }
    });

  embed.command("run").description("대기 중인 메모를 지금 색인(임베딩 서버가 꺼져 있고 띄우는 명령이 있으면 띄움). relay web이 떠 있으면 평소에는 스스로 돎")
    .option("--limit <number>", "이번에 색인할 메모 수(기본은 남은 것 모두)").option("--note <id>", "이 메모를 벡터부터 새로 계산").option("--watch", "끝난 뒤에도 20초마다 다시 봄(Ctrl+C로 멈춤)")
    .action(async (o: { limit?: string; note?: string; watch?: boolean }, c: Command) => {
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const host = new EmbedderHost(need(config));
      const maxNotes = o.limit === undefined ? undefined : whole(o.limit, "--limit", 1, 100_000, 0);
      const noteId = o.note === undefined ? undefined : (await tools.memoIndex(config)).resolve(o.note).id;
      try {
        if (noteId) await withIndex(config, (api) => api.reindex({ scope: "note", noteId }));
        for (;;) {
          const report = await withIndex(config, (api) => runWorker(api, host, { ...(maxNotes ? { maxNotes } : {}) }));
          if (!o.watch) { write(c, tools, { schemaVersion: 1, ...report }, workerText(report)); if (report.offline) process.exitCode = 1; return; }
          if (report.notes || report.failed || report.offline) process.stdout.write(`${workerText(report)}\n`);
          await new Promise((resolve) => setTimeout(resolve, report.offline ? 60_000 : 20_000));
        }
      } finally { host.stop(); }
    });

  embed.command("reindex").description("다시 색인하게 함: --failed는 실패한 메모를 다시 시도, --note·--all은 벡터를 버리고 새로 계산")
    .option("--failed", "실패한 메모").option("--note <id>", "메모 하나").option("--all", "모든 메모")
    .action(async (o: { failed?: boolean; note?: string; all?: boolean }, c: Command) => {
      if ([o.failed, o.note !== undefined, o.all].filter(Boolean).length !== 1) invalid("--failed, --note <ID>, --all 중 하나를 지정하세요.");
      const config = loadConfig(c.optsWithGlobals().dataDir);
      const noteId = o.note === undefined ? undefined : (await tools.memoIndex(config)).resolve(o.note).id;
      const result = await withIndex(config, (api) => api.reindex(noteId ? { scope: "note", noteId } : { scope: o.all ? "all" : "failed" }));
      write(c, tools, result, `메모 ${result.queued}개를 다시 색인하게 했습니다. relay web의 색인 워커가 이어서 계산합니다(지금 돌리려면 relay embed run).`);
    });

  embed.command("activate <modelKey>").description("검색에 쓸 임베딩 모델을 바꿈(다른 모델의 색인은 지움). 새 모델로 모든 메모를 색인한 뒤에 씀")
    .action(async (key: string, _o: unknown, c: Command) => {
      const result = await withIndex(loadConfig(c.optsWithGlobals().dataDir), (api) => api.activate(key));
      write(c, tools, result, `검색에 쓰는 모델을 ${result.activeModelKey}(으)로 바꿨습니다.`);
    });

  embed.command("cards").description("의미 카드: 에이전트가 메모를 읽고 쓰는 한 줄 요약·같은 뜻의 다른 말·이 메모가 답하는 질문. 인자 없이 부르면 카드가 필요한 메모를 보임")
    .option("--limit <number>", "보일 메모 수(1~100, 기본 5)").option("--save <file>", "카드 JSON 파일을 저장(-는 표준 입력)")
    .action(async (o: { limit?: string; save?: string }, c: Command) => {
      const config = loadConfig(c.optsWithGlobals().dataDir);
      if (o.save === undefined) {
        const pending = await withIndex(config, (api) => api.cardsPending(whole(o.limit, "--limit", 1, 100, 5)));
        return write(c, tools, pending, cardsText(pending));
      }
      let raw: unknown;
      try { raw = JSON.parse((o.save === "-" ? readFileSync(0, "utf8") : readFileSync(path.resolve(o.save), "utf8")).replace(/^﻿/, "")); }
      catch { throw new RelayError("INVALID_ARGUMENT", "카드 JSON을 읽을 수 없습니다. 파일 경로와 JSON 모양을 확인하세요."); }
      const cards = parseCards(raw);
      const result = await withIndex(config, (api) => api.cardsSave(cards.author, cards.cards));
      const reasons = { not_found: "없는 메모", changed: "읽은 뒤에 메모가 바뀜" } as const;
      write(c, tools, result, [`의미 카드 ${result.saved}개를 저장했습니다.`, ...result.skipped.map((item) => `- 건너뜀: ${item.noteId} (${reasons[item.reason]})`),
        result.saved ? "카드의 요약은 임베딩 조각의 머리말에 들어가므로, 그 메모는 색인 워커가 다시 임베딩합니다." : ""].filter(Boolean).join("\n"));
    });
  return embed;
}
