import type { Session } from "../../session/session.types";
import { quote } from "./format";

/** How each host reopens one of its own sessions by id. Tools Relay does not know have no command. */
const RESUME: Record<string, (id: string) => string> = {
  "claude-code": id => `claude --resume ${id}`,
  codex: id => `codex resume ${id}`,
  grok: id => `grok --resume ${id}`,
};

/** The command that reopens the original conversation in its own tool, quoted for the shell it will run in. */
export function resumeCommand(session: Pick<Session, "agent" | "providerSessionId">, shell: "powershell" | "bash"): string | null {
  const build = Object.hasOwn(RESUME, session.agent) ? RESUME[session.agent] : undefined;
  return build ? build(quote(session.providerSessionId, shell)) : null;
}
