// Session text stays local: it only reaches the platform clipboard tool over stdin, or the
// terminal itself through OSC 52. Nothing is written to disk and no network call is made.

/** `copied` was confirmed by the platform tool; `requested` was handed to the terminal and cannot be confirmed. */
export type CopyResult = "copied" | "requested" | "failed";

// Windows PowerShell decodes stdin with the console code page, so read the raw handle as UTF-8
// instead; otherwise Korean summaries reach the clipboard as mojibake.
const POWERSHELL_READ = "$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), " +
  "[Text.Encoding]::UTF8); Set-Clipboard -Value $reader.ReadToEnd()";

function tools(): string[][] {
  if (process.platform === "win32") return [["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_READ]];
  if (process.platform === "darwin") return [["pbcopy"]];
  return [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
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
