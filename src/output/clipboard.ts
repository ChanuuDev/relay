// Session text stays local: it only reaches the platform clipboard tool over stdin, or the
// terminal itself through OSC 52. Nothing is written to disk and no network call is made.

/** `copied` was confirmed by the platform tool; `requested` was handed to the terminal and cannot be confirmed. */
export type CopyResult = "copied" | "requested" | "failed";

// Windows PowerShell decodes stdin with the console code page, so read the raw handle as UTF-8
// instead; otherwise Korean summaries reach the clipboard as mojibake.
const POWERSHELL_READ = "$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), " +
  "[Text.Encoding]::UTF8); Set-Clipboard -Value $reader.ReadToEnd()";

// clip.exe returns in ~15ms where starting PowerShell costs about a second, and it reads UTF-8
// correctly even under a legacy console code page. Set RELAY_CLIPBOARD=powershell if a machine
// pastes the text mangled; a UTF-16 byte order mark is not an option because clip.exe keeps it.
const TOOLS: Record<string, string[]> = {
  clip: ["clip.exe"],
  powershell: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_READ],
  pbcopy: ["pbcopy"],
  "wl-copy": ["wl-copy"],
  xclip: ["xclip", "-selection", "clipboard"],
  xsel: ["xsel", "--clipboard", "--input"],
};

function tools(): string[][] {
  const chosen = process.env.RELAY_CLIPBOARD;
  if (chosen && Object.hasOwn(TOOLS, chosen)) return [TOOLS[chosen]!];
  const order = process.platform === "win32" ? ["clip", "powershell"] :
    process.platform === "darwin" ? ["pbcopy"] : ["wl-copy", "xclip", "xsel"];
  return order.map(name => TOOLS[name]!);
}

async function pipe(command: string[], text: string): Promise<boolean> {
  let child;
  try { child = Bun.spawn(command, { stdin: Buffer.from(text, "utf8"), stdout: "ignore", stderr: "ignore" }); }
  catch { return false; }
  // xclip keeps owning the selection after reading; never let a clipboard tool stall the view.
  const timer = setTimeout(() => child.kill(), 3000);
  try { return await child.exited === 0; }
  catch { return false; }
  finally { clearTimeout(timer); }
}

/** Terminal-native clipboard write; works over SSH but the terminal may silently ignore it. */
function osc52(text: string): boolean {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  // Terminals cap the payload; a truncated clipboard is worse than a clear failure.
  if (!process.stdout.isTTY || encoded.length > 100_000) return false;
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
}

export async function copyToClipboard(text: string): Promise<CopyResult> {
  for (const command of tools()) if (await pipe(command, text)) return "copied";
  return osc52(text) ? "requested" : "failed";
}
