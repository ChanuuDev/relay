import { readFileSync, statSync } from "node:fs";

/** A transcript past this size is left unread, so a hook stays inside the few seconds its host allows. */
const TRANSCRIPT_LIMIT = 256 * 1024 * 1024;

/**
 * The models a host transcript shows the session running on, in the order they first appear. Claude Code
 * writes each reply with the API message and its model; Codex names the model in each turn's context.
 * Subagent replies and the replies Claude Code makes up itself (`<synthetic>`) are not the session's model.
 * A transcript that is missing, too large or in another shape yields nothing.
 */
export function transcriptModels(file: unknown): string[] {
  if (typeof file !== "string" || !file.endsWith(".jsonl")) return [];
  let text: string;
  try {
    if (statSync(file).size > TRANSCRIPT_LIMIT) return [];
    text = readFileSync(file, "utf8");
  } catch { return []; }
  const models: string[] = [];
  for (const line of text.split("\n")) {
    // Only a line that can name a model is parsed; the rest of a long transcript is passed over.
    if (!line.includes('"model"') || !(line.includes('"type":"assistant"') || line.includes('"type":"turn_context"'))) continue;
    let entry: { type?: unknown; isSidechain?: unknown; message?: { model?: unknown }; payload?: { model?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    const model = entry?.type === "assistant" && entry.isSidechain !== true ? entry.message?.model
      : entry?.type === "turn_context" ? entry.payload?.model : undefined;
    if (typeof model === "string" && model && !model.startsWith("<") && !models.includes(model)) models.push(model);
  }
  return models;
}
