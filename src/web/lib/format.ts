export const projectName = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || path;
export function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "미기록";
}
export function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`;
  return timestamp(value);
}
export const quote = (value: string, shell: "powershell" | "bash") =>
  "'" + (shell === "powershell" ? value.replaceAll("'", "''") : value.replaceAll("'", "'\"'\"'")) + "'";
