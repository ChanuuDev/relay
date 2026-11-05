/** The note a session hook stores before the agent has said anything about the work. */
export const HOOK_SUMMARY = "세션 첫 기록 (훅 자동 기록)";

/** How many sessions a chain lists before it stops; a store this deep is beyond what anyone reads. */
export const CHAIN_LIMIT = 200;

export const PROVIDERS = {
  codex: { provider: "openai", agent: "codex" },
  claude: { provider: "anthropic", agent: "claude-code" },
  grok: { provider: "xai", agent: "grok" },
  cursor: { provider: "cursor", agent: "cursor-agent" },
} as const;
export type ProviderAlias = keyof typeof PROVIDERS;
export const ALIASES = Object.keys(PROVIDERS) as ProviderAlias[];

/** The longest model list a record keeps; a name that would push past it is left off. */
export const MODELS_LIMIT = 200;

/**
 * The models a session ran on, as one line in the order they were first seen: `claude-opus-5-5, claude-fable-5-1`.
 * A name already listed keeps its place; one that is blank, holds the separator or would not fit is left off.
 */
export function withModels(current: string | null, added: readonly unknown[]): string | null {
  const names = current ? current.split(",").map(name => name.trim()).filter(Boolean) : [];
  for (const value of added) {
    const name = typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]+/g, "").trim() : "";
    if (!name || name.includes(",") || names.includes(name) || [...names, name].join(", ").length > MODELS_LIMIT) continue;
    names.push(name);
  }
  return names.length ? names.join(", ") : null;
}
