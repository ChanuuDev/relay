// Terminal text measured in display columns: Korean and other East Asian characters occupy two.
function isWide(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) || (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd);
}

export function width(text: string): number {
  let total = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x0300 && code <= 0x036f)) continue;
    total += isWide(code) ? 2 : 1;
  }
  return total;
}

/** Cuts to a display-column budget without touching the spacing that keeps table columns aligned. */
export function head(text: string, max: number): string {
  let result = "";
  let used = 0;
  for (const character of text) {
    const size = width(character);
    if (used + size > max) break;
    result += character;
    used += size;
  }
  return result;
}

/** Single-line cell text: collapses whitespace and marks the cut with ASCII dots to keep columns aligned. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  if (width(flat) <= max) return flat;
  return max <= 3 ? head(flat, max) : `${head(flat, max - 3)}...`;
}

export function pad(text: string, size: number): string {
  return text + " ".repeat(Math.max(0, size - width(text)));
}

export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/[ \t]+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= max) { line = candidate; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (width(rest) > max) {
        // A single wide character can be broader than the budget; emit it anyway so the loop always advances.
        const piece = head(rest, max) || [...rest][0]!;
        lines.push(piece);
        rest = rest.slice(piece.length);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

// Colour follows the NO_COLOR convention and stays off when the output is redirected.
const colored = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0" &&
  (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));
export function paint(text: string, code: string): string {
  return colored && code ? `\x1b[${code}m${text}\x1b[0m` : text;
}
export const dim = (text: string) => paint(text, "2");
const two = (value: number) => String(value).padStart(2, "0");
const clock = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`;

/** Table cells read `26.09.17 18:00`: a two-digit year and dots keep both timestamp columns on a narrow terminal. */
export function shortTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${two(at.getFullYear() % 100)}.${two(at.getMonth() + 1)}.${two(at.getDate())} ${clock(at)}`;
}

/** Stored timestamps are ISO 8601 UTC; people read them in local time, so detail views also state the offset. */
export function localTime(iso: string, exact = false): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${clock(at)}`;
  if (!exact) return stamp;
  const offset = -at.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  return `${stamp}:${two(at.getSeconds())} ${sign}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
}

export function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns || 120, 60), 200);
}
