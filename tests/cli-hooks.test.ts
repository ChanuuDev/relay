import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanup, cli, root, temporary } from "./helpers";

describe("CLI hooks", () => {
  let dir: string;
  beforeEach(() => { dir = temporary(); });
  afterEach(() => cleanup(dir));

  test("session start hook gives Codex/Claude recording context and never fails the host session", () => {
    const hook = (payload: string, extra: Record<string, string> = {}, alias = "claude", ...flags: string[]) => {
      // The host session of this test run must not leak into the payload fallback.
      const env: Record<string, string | undefined> = {
        ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, GROK_SESSION_ID: undefined, ...extra,
      };
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", alias, ...flags, "--data-dir", dir],
        { cwd: root, env, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe" });
      return { code: result.exitCode, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString() };
    };
    const context = (result: ReturnType<typeof hook>): string => {
      expect(result.code).toBe(0); expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout);
      expect(Object.keys(output)).toEqual(["hookSpecificOutput"]);
      expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(output.hookSpecificOutput.additionalContext).toBeString();
      return output.hookSpecificOutput.additionalContext;
    };
    const started = hook(JSON.stringify({ session_id: "hook-session", cwd: root, hook_event_name: "SessionStart", session_source: "startup" }));
    const prompt = context(started);
    for (const instruction of ["첫 작업 전에 relay-session 스킬을 읽고", "명령을 추측하지 않는다", "relay --help로 확인",
      "실제 세션 ID만 사용", "기존 기록을 먼저 확인해 없을 때만 생성", "continue로 출처를 연결", "중간 작업 내용 또한 Relay 도구로 기록",
      "update로 갱신", "relay가 없거나 기록에 실패하면 한 줄로 알리고 원래 작업을 계속"]) expect(prompt).toContain(instruction);
    expect(prompt).toContain(JSON.stringify({ provider: "anthropic", agent: "claude-code", sessionId: "hook-session" }));
    const stored = cli(dir, ["show", "hook-session"]).data.session;
    expect(stored.provider).toBe("anthropic"); expect(stored.agent).toBe("claude-code");
    expect(stored.sessionName).toBe(path.basename(root)); expect(stored.status).toBeNull();
    // The hook has seconds at most, so it records without reading the working tree.
    expect(stored.git).toBeNull();
    expect(stored.summary).toBe("세션 첫 기록 (훅 자동 기록)");
    // Resume fires the hook again with the same payload and must not duplicate history or fail.
    expect(context(hook(JSON.stringify({ session_id: "hook-session", cwd: root, session_source: "resume" })))).toBe(prompt);
    expect(cli(dir, ["show", "hook-session", "--history"]).data.updates.length).toBe(1);
    // Subagents and unusable payloads stay silent instead of breaking the session.
    for (const payload of [{ session_id: "sub", agent_id: "agent-1" }, { session_id: "sub", subagentType: "explore" },
      { session_id: "sub", subagent_type: "explore" }]) expect(hook(JSON.stringify(payload)).stdout).toBe("{}");
    for (const payload of ["", "not json", "[]", "null", "42", JSON.stringify({ cwd: root })]) {
      const result = hook(payload);
      expect(result.code).toBe(0); expect(result.stdout).toBe("{}");
    }
    expect(hook(JSON.stringify({ session_id: "unknown-host" }), {}, "unknown").stdout).toBe("{}");
    // Another host's environment must never be mistaken for this host's actual session id.
    expect(hook("{}", { CLAUDE_CODE_SESSION_ID: "other-host" }, "codex").stdout).toBe("{}");
    expect(cli(dir, ["list"]).data.page.total).toBe(1);
    // A host that omits the id from the payload is still recorded from its session environment variable.
    expect(hook("{}", { CLAUDE_CODE_SESSION_ID: "env-session" }).code).toBe(0);
    expect(cli(dir, ["show", "env-session"]).data.session.providerSessionId).toBe("env-session");
    const grok = hook(JSON.stringify({ sessionId: "grok-payload", cwd: root }), {}, "grok");
    expect(grok.code).toBe(0); expect(grok.stdout).toBe("{}");
    expect(cli(dir, ["show", "grok-payload", "--provider", "xai"]).data.session.agent).toBe("grok");
    expect(hook("{}", { CLAUDE_CODE_SESSION_ID: "other-host", GROK_SESSION_ID: "grok-env-session" }, "grok").code).toBe(0);
    expect(cli(dir, ["show", "grok-env-session", "--provider", "xai"]).data.session.provider).toBe("xai");
    expect(context(hook("{}", { CODEX_THREAD_ID: "codex-env-session" }, "codex")))
      .toContain(JSON.stringify({ provider: "openai", agent: "codex", sessionId: "codex-env-session" }));
    expect(cli(dir, ["show", "codex-env-session", "--provider", "openai"]).data.session.agent).toBe("codex");
    // A payload id takes precedence over the host environment and is passed through unchanged.
    const givenId = "host's thread; keep literal";
    expect(context(hook(JSON.stringify({ thread_id: givenId }), { CODEX_THREAD_ID: "codex-env-session" }, "codex")))
      .toContain(JSON.stringify({ provider: "openai", agent: "codex", sessionId: givenId }));
    expect(cli(dir, ["show", givenId, "--provider", "openai"]).data.session.providerSessionId).toBe(givenId);
    // Even when the store cannot be opened, the host gets one valid, non-blocking response.
    writeFileSync(path.join(dir, "config.json"), "not json");
    expect(context(hook(JSON.stringify({ session_id: "store-failed" }), {}, "codex"))).toContain("relay가 없거나 기록에 실패하면");
    const failedEnd = hook(JSON.stringify({ session_id: "hook-session" }), {}, "claude", "--end");
    expect(failedEnd.code).toBe(0); expect(failedEnd.stdout).toBe("{}"); expect(failedEnd.stderr).toBe("");
  }, 15000);

  test("a session started again after compaction gets the read-back guidance; the compaction note counts each compaction", () => {
    const hook = (payload: Record<string, unknown>, alias = "claude", ...flags: string[]) => {
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", alias, ...flags, "--data-dir", dir],
        { cwd: root, env: { ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, GROK_SESSION_ID: undefined },
          stdin: Buffer.from(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0); expect(result.stderr.toString()).toBe("");
      return JSON.parse(result.stdout.toString());
    };
    const started = hook({ session_id: "compacted", cwd: root, source: "startup" });
    expect(started.hookSpecificOutput.additionalContext).toContain("첫 작업 전에 relay-session 스킬을 읽고");
    expect(started.hookSpecificOutput.additionalContext).not.toContain("압축되어");
    cli(dir, ["update", "--session-id", "compacted", "--summary", "작업 중"]);
    // The compaction hook answers with nothing and never touches the context or its time.
    const before = cli(dir, ["show", "compacted", "--history"]).data;
    expect(before.session.compaction).toBeNull();
    expect(hook({ session_id: "compacted", cwd: root, trigger: "auto" }, "claude", "--compact")).toEqual({});
    expect(hook({ session_id: "compacted", cwd: root, trigger: "manual" }, "claude", "--compact")).toEqual({});
    const after = cli(dir, ["show", "compacted", "--history"]).data;
    expect(after.session.compaction.count).toBe(2); expect(after.session.compaction.trigger).toBe("manual");
    expect(after.session.updatedAt).toBe(before.session.updatedAt); expect(after.updates).toEqual(before.updates);
    // Claude and Codex start the session again after compacting: the guidance now says to read the record back.
    for (const [alias, payload] of [["claude", { session_id: "compacted", cwd: root, source: "compact" }],
      ["codex", { session_id: "compacted", cwd: root, source: "compact" }]] as const) {
      const again = hook(payload, alias);
      const context: string = again.hookSpecificOutput.additionalContext;
      expect(context).toContain("컨텍스트가 압축되어"); expect(context).toContain("relay show"); expect(context).toContain("update");
      expect(context).not.toContain("첫 작업 전에");
      expect(context).toContain(JSON.stringify({ ...(alias === "claude" ? { provider: "anthropic", agent: "claude-code" } : { provider: "openai", agent: "codex" }), sessionId: "compacted" }));
    }
    expect(cli(dir, ["show", "compacted", "--provider", "anthropic", "--history"]).data.updates.length).toBe(2);
    // A compaction note for a session the store does not know is silently dropped.
    expect(hook({ session_id: "unknown", trigger: "auto" }, "claude", "--compact")).toEqual({});
    expect(cli(dir, ["show", "unknown"]).code).toBe(3);
  });

  test("Cursor sessions are recorded from the conversation id and workspace root, and answered in Cursor's shape", () => {
    const hook = (payload: Record<string, unknown>, ...flags: string[]) => {
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", "cursor", ...flags, "--data-dir", dir],
        { cwd: dir, env: { ...process.env, CLAUDE_CODE_SESSION_ID: "other-host" }, stdin: Buffer.from(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0); expect(result.stderr.toString()).toBe("");
      return JSON.parse(result.stdout.toString());
    };
    const started = hook({ conversation_id: "chat-1", session_id: "chat-1", generation_id: "gen-1", hook_event_name: "sessionStart", workspace_roots: [root], cursor_version: "2.0" });
    expect(Object.keys(started)).toEqual(["additional_context"]);
    expect(started.additional_context).toContain("relay-session 스킬");
    expect(started.additional_context).toContain(JSON.stringify({ provider: "cursor", agent: "cursor-agent", sessionId: "chat-1" }));
    const stored = cli(dir, ["show", "chat-1", "--provider", "cursor"]).data.session;
    expect(stored.agent).toBe("cursor-agent"); expect(stored.workingDirectory).toBe(root.replaceAll("\\", "/"));
    expect(stored.sessionName).toBe(path.basename(root));
    // The conversation id wins over a session id that differs, and the host environment of another tool is never used.
    expect(hook({ conversation_id: "chat-2", session_id: "other", workspace_roots: [root] }).additional_context).toContain('"sessionId":"chat-2"');
    expect(hook({ workspace_roots: [root] })).toEqual({});
    expect(cli(dir, ["list", "--provider", "cursor"]).data.page.total).toBe(2);
    cli(dir, ["update", "--session-id", "chat-1", "--provider", "cursor", "--summary", "Cursor 작업"]);
    expect(hook({ conversation_id: "chat-1", trigger: "auto" }, "--compact")).toEqual({});
    expect(cli(dir, ["show", "chat-1", "--provider", "cursor"]).data.session.compaction.count).toBe(1);
    expect(hook({ conversation_id: "chat-1", reason: "user_close" }, "--end")).toEqual({});
    expect(cli(dir, ["show", "chat-1", "--provider", "cursor"]).data.session.endReason).toBe("user_close");
    // An untouched Cursor record is dropped on close like any other host's.
    expect(hook({ conversation_id: "chat-2", reason: "completed" }, "--end")).toEqual({});
    expect(cli(dir, ["show", "chat-2", "--provider", "cursor"]).code).toBe(3);
    expect(cli(dir, ["latest", "cursor"]).data.session.providerSessionId).toBe("chat-1");
    expect(cli(dir, ["--cursor"]).data.session.agent).toBe("cursor-agent");
    const handoff = cli(dir, ["handoff", "chat-1", "--provider", "cursor", "--shell", "bash"]).data.markdown;
    expect(handoff).toContain("agent --resume 'chat-1'");
  });

  test("Antigravity (gemini alias) records google/antigravity sessions, resolves shortcuts, and uses ANTIGRAVITY_CONVERSATION_ID in hooks", () => {
    expect(cli(dir, ["record", "--provider", "google", "--agent", "antigravity", "--session-id", "ag-1", "--session-name", "Gemini 작업", "--summary", "첫 기록", "--cwd", root]).code).toBe(0);
    expect(cli(dir, ["latest", "gemini"]).data.session).toMatchObject({ provider: "google", agent: "antigravity", providerSessionId: "ag-1" });
    expect(cli(dir, ["--gemini"]).data.session.agent).toBe("antigravity");
    const handoff = cli(dir, ["handoff", "ag-1", "--provider", "google", "--shell", "bash"]).data.markdown as string;
    expect(handoff).toContain("- Agent: google / antigravity");
    expect(handoff).not.toContain("원본 세션 재개");
    const hookResult = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", "gemini", "--data-dir", dir],
      { cwd: root, env: { ...process.env, ANTIGRAVITY_CONVERSATION_ID: "ag-env-1", CLAUDE_CODE_SESSION_ID: "other" }, stdin: Buffer.from(JSON.stringify({ cwd: root })), stdout: "pipe", stderr: "pipe" });
    expect(hookResult.exitCode).toBe(0);
    expect(cli(dir, ["show", "ag-env-1", "--provider", "google"]).data.session).toMatchObject({ provider: "google", agent: "antigravity" });
  });

  test("session end hook closes a session with context, removes an untouched automatic record, and stays silent otherwise", () => {
    const hook = (payload: string, alias = "claude", ...flags: string[]) => {
      const env: Record<string, string | undefined> = {
        ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, GROK_SESSION_ID: undefined,
      };
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", alias, ...flags, "--data-dir", dir],
        { cwd: root, env, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe" });
      return { code: result.exitCode, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString() };
    };
    const start = (id: string, alias = "claude") => hook(JSON.stringify({ session_id: id, cwd: root }), alias);
    const end = (payload: Record<string, unknown>, alias = "claude") => hook(JSON.stringify(payload), alias, "--end");

    start("worked"); start("idle"); start("grok-idle", "grok");
    cli(dir, ["update", "--session-id", "worked", "--summary", "작업 맥락"]);
    const closed = end({ session_id: "worked", cwd: root, hook_event_name: "SessionEnd", reason: "prompt_input_exit" });
    expect(closed.code).toBe(0); expect(closed.stdout).toBe("{}"); expect(closed.stderr).toBe("");
    const stored = cli(dir, ["show", "worked", "--history"]).data;
    expect(stored.session.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored.session.endReason).toBe("prompt_input_exit");
    expect(stored.updates.length).toBe(2);
    // Only the automatic first record was there: the session leaves the list instead of lingering.
    expect(end({ session_id: "idle", cwd: root, reason: "other" }).code).toBe(0);
    expect(cli(dir, ["show", "idle"]).data.error.code).toBe("SESSION_NOT_FOUND");
    // The alias decides the provider: a Claude end never touches the Grok record of the same id.
    expect(end({ session_id: "grok-idle" }).code).toBe(0);
    expect(cli(dir, ["show", "grok-idle", "--provider", "xai"]).data.session.summary).toBe("세션 첫 기록 (훅 자동 기록)");
    expect(end({ sessionId: "grok-idle" }, "grok").code).toBe(0);
    expect(cli(dir, ["list"]).data.page.total).toBe(1);
    // Subagent teardown, unknown sessions and unusable payloads are ignored without failing the host.
    for (const payload of [{ session_id: "worked", agent_id: "agent-1" }, { session_id: "worked", subagentType: "explore" },
      { session_id: "never-recorded" }, { cwd: root }]) {
      const result = end(payload);
      expect(result.code).toBe(0); expect(result.stdout).toBe("{}");
    }
    for (const payload of ["", "not json", "[]"]) expect(hook(payload, "claude", "--end").code).toBe(0);
    expect(cli(dir, ["show", "worked"]).data.session.endReason).toBe("prompt_input_exit");
    // A reason the host sends is kept in the form the record accepts; control characters never reach the store.
    expect(end({ session_id: "worked", reason: "  clear\n\tsession " + "x".repeat(300) }).code).toBe(0);
    const reason = cli(dir, ["show", "worked"]).data.session.endReason as string;
    expect(reason.startsWith("clear session x")).toBe(true); expect(reason.length).toBe(200);
    expect(end({ session_id: "worked", reason: "" }).code).toBe(0);
    expect(cli(dir, ["show", "worked"]).data.session.endReason).toBeNull();
    // Starting the same session again reopens it; the end hook then closes it once more.
    expect(start("worked").code).toBe(0);
    expect(cli(dir, ["show", "worked"]).data.session.endedAt).toBeNull();
    expect(end({ session_id: "worked", reason: "logout" }).code).toBe(0);
    expect(cli(dir, ["show", "worked"]).data.session.endReason).toBe("logout");
  }, 20000);

  test("hooks fill the model list from the host's payload and transcript, so the agent never has to name it", () => {
    const hook = (payload: Record<string, unknown>, alias = "claude", ...flags: string[]) => {
      const result = Bun.spawnSync([process.execPath, path.join(root, "src/index.ts"), "hook", alias, ...flags, "--data-dir", dir],
        { cwd: root, env: { ...process.env, CLAUDE_CODE_SESSION_ID: undefined, CODEX_THREAD_ID: undefined, GROK_SESSION_ID: undefined },
          stdin: Buffer.from(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0); expect(result.stderr.toString()).toBe("");
      return JSON.parse(result.stdout.toString());
    };
    const transcript = path.join(dir, "claude.jsonl");
    const reply = (model: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ parentUuid: null, isSidechain: false, type: "assistant", message: { model, id: "msg", type: "message", role: "assistant", content: [] }, ...extra });
    const user = JSON.stringify({ type: "user", message: { role: "user", content: 'see {"type":"assistant","model":"quoted-model"}' } });
    // Claude Code names no model when a session starts, so a fresh session has none yet.
    hook({ session_id: "claude-m", cwd: root, source: "startup", transcript_path: transcript });
    expect(cli(dir, ["show", "claude-m"]).data.session.model).toBeNull();
    writeFileSync(transcript, [user, reply("claude-opus-5-5"), "not json", reply("<synthetic>"),
      reply("claude-haiku-5-5", { isSidechain: true }), reply("claude-opus-5-5")].join("\n") + "\n");
    cli(dir, ["update", "--session-id", "claude-m", "--summary", "작업 중"]);
    const before = cli(dir, ["show", "claude-m", "--history"]).data;
    // A switch answers with nothing; the list keeps the model that answered so far, then the one switched to.
    expect(hook({ session_id: "claude-m", cwd: root, transcript_path: transcript, hook_event_name: "PostModelSwitch",
      from_model: "claude-sonnet-5-5", to_model: "claude-fable-5-1", source: "command" }, "claude", "--model-switch")).toEqual({});
    const switched = cli(dir, ["show", "claude-m", "--history"]).data;
    expect(switched.session.model).toBe("claude-opus-5-5, claude-fable-5-1");
    expect(switched.session.updatedAt).toBe(before.session.updatedAt); expect(switched.updates).toEqual(before.updates);
    writeFileSync(transcript, readFileSync(transcript, "utf8") + reply("claude-fable-5-1") + "\n" + reply("claude-opus-5-5") + "\n");
    expect(hook({ session_id: "claude-m", cwd: root, transcript_path: transcript, reason: "prompt_input_exit" }, "claude", "--end")).toEqual({});
    const ended = cli(dir, ["show", "claude-m"]).data.session;
    expect(ended.model).toBe("claude-opus-5-5, claude-fable-5-1"); expect(ended.endReason).toBe("prompt_input_exit");
    // Resuming records the session again without a model; the gathered list is kept and the end no longer holds.
    hook({ session_id: "claude-m", cwd: root, source: "resume", transcript_path: transcript });
    const resumed = cli(dir, ["show", "claude-m"]).data.session;
    expect(resumed.model).toBe("claude-opus-5-5, claude-fable-5-1"); expect(resumed.endedAt).toBeNull();
    // A switch in a session the store does not know creates nothing.
    expect(hook({ session_id: "claude-unknown", to_model: "claude-opus-5-5" }, "claude", "--model-switch")).toEqual({});
    expect(cli(dir, ["show", "claude-unknown"]).code).toBe(3);

    // Codex names its model on every event and in each turn's context.
    hook({ session_id: "codex-m", cwd: root, source: "startup", model: "gpt-6.1-sol" }, "codex");
    expect(cli(dir, ["show", "codex-m"]).data.session.model).toBe("gpt-6.1-sol");
    const rollout = path.join(dir, "rollout.jsonl");
    writeFileSync(rollout, [{ type: "session_meta", payload: { model: "ignored" } }, { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
      { type: "turn_context", payload: { model: "gpt-6.1-mini" } }].map(line => JSON.stringify(line)).join("\n"));
    expect(hook({ session_id: "codex-m", cwd: root, transcript_path: rollout, model: "gpt-6.1-max", trigger: "auto" }, "codex", "--compact")).toEqual({});
    const codex = cli(dir, ["show", "codex-m"]).data.session;
    expect(codex.model).toBe("gpt-6.1-sol, gpt-6.1-mini, gpt-6.1-max"); expect(codex.compaction.count).toBe(1);
    // Cursor names the model in every payload as well.
    expect(hook({ conversation_id: "cursor-m", workspace_roots: [root], model: "composer-2" }, "cursor")).toHaveProperty("additional_context");
    expect(cli(dir, ["show", "cursor-m", "--provider", "cursor"]).data.session.model).toBe("composer-2");
  }, 20000);
});
