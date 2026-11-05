export interface TestStep { id: "reach" | "identity" | "auth" | "device" | "clock"; label: string; state: "ok" | "fail" | "skip" | "warn"; detail: string }
export interface ConnectionReport {
  ok: boolean; url: string; steps: TestStep[]; latencyMs: number | null;
  server?: { appVersion: string; apiVersion: number; build: string; files: boolean; time: string };
  user?: { name: string; tokenName: string };
  device?: { id: string; name: string; created: boolean };
}

export function normalizeRemoteUrl(input: string, allowHttp = false): string {
  const value = input.trim();
  if (!value) throw new Error("서버 주소를 입력하세요.");
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new Error("서버 주소 형식이 올바르지 않습니다."); }
  if ((url.protocol !== "https:" && !(allowHttp && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) || url.search || url.hash || url.username || url.password) throw new Error("인증 정보·query가 없는 https:// 주소를 입력하세요.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

const TIMEOUT_MS = 5000;
/** 서버 시각과 이만큼 어긋나면 경고한다. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MIN_API_VERSION = 1;

/** fetch 실패를 사용자가 읽을 수 있는 말로. */
function describeFailure(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";
  const name = (error as { name?: string })?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return "시간 초과: 5초 안에 응답이 없습니다. 주소와 방화벽을 확인하세요.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS 실패: 이 호스트 이름을 찾을 수 없습니다.";
  if (code === "ECONNREFUSED") return "연결 거부: 서버가 꺼져 있거나 포트가 닫혀 있습니다.";
  if (code === "ECONNRESET") return "연결이 끊겼습니다. 서버의 nginx·relay-api 상태를 확인하세요.";
  if (/CERT|certificate|TLS|SSL|self[- ]signed/i.test(code + (cause?.message ?? "") + ((error as Error)?.message ?? ""))) return "인증서 오류: HTTPS 인증서를 확인할 수 없습니다.";
  return `연결 실패: ${(error as Error)?.message ?? String(error)}`;
}

/**
 * 연결 확인 테스트. 단계별 결과를 돌려주며 어느 단계에서 막혔는지 보여 준다.
 * 1) DNS·TCP·TLS와 health 2) 서버 정체(kind·apiVersion) 3) 토큰(whoami) 4) 기기 등록 5) 시각 차이
 */
export async function testRemoteConnection(input: { url: string; token: string; deviceName: string; register?: boolean }, options: { allowHttp?: boolean; platform?: string } = {}): Promise<ConnectionReport> {
  const steps: TestStep[] = [];
  const push = (step: TestStep) => { steps.push(step); return step; };
  let url: string;
  try { url = normalizeRemoteUrl(input.url, options.allowHttp); }
  catch (error) { return { ok: false, url: input.url, steps: [{ id: "reach", label: "주소", state: "fail", detail: (error as Error).message }], latencyMs: null }; }
  const token = input.token.trim();
  const report: ConnectionReport = { ok: false, url, steps, latencyMs: null };

  // 1) 닿는가
  const started = Date.now();
  let health: Response;
  try { health = await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual", headers: { Accept: "application/json" } }); }
  catch (error) { push({ id: "reach", label: "서버에 닿기", state: "fail", detail: describeFailure(error) }); return report; }
  report.latencyMs = Date.now() - started;
  if (health.status === 502 || health.status === 503) { push({ id: "reach", label: "서버에 닿기", state: "fail", detail: `nginx는 응답하지만 relay-api가 꺼져 있습니다 (HTTP ${health.status}).` }); return report; }
  if (!health.ok) { push({ id: "reach", label: "서버에 닿기", state: "fail", detail: `HTTP ${health.status}` }); return report; }
  push({ id: "reach", label: "서버에 닿기", state: "ok", detail: `${report.latencyMs}ms` });

  // 2) Relay 원격 서버인가
  let body: { schemaVersion?: unknown; kind?: unknown; apiVersion?: unknown; appVersion?: unknown; build?: unknown; files?: unknown; time?: unknown } | null = null;
  try { body = await health.json() as Record<string, unknown>; } catch { /* 아래에서 거른다 */ }
  if (!body || body.schemaVersion !== 1 || body.kind !== "relay-remote") { push({ id: "identity", label: "Relay 서버 확인", state: "fail", detail: "Relay 원격 서버의 응답이 아닙니다. 주소를 확인하세요." }); return report; }
  const apiVersion = typeof body.apiVersion === "number" ? body.apiVersion : 0;
  if (apiVersion < MIN_API_VERSION) { push({ id: "identity", label: "Relay 서버 확인", state: "fail", detail: `서버 API ${apiVersion}은(는) 너무 낮습니다(필요 ${MIN_API_VERSION}).` }); return report; }
  report.server = { appVersion: String(body.appVersion ?? "?"), apiVersion, build: String(body.build ?? "?"), files: body.files === true, time: String(body.time ?? "") };
  push({ id: "identity", label: "Relay 서버 확인", state: "ok", detail: `Relay ${report.server.appVersion} (build ${report.server.build})${report.server.files ? " · 원격 파일 사용 가능" : ""}` });

  // 5) 시각 차이 (토큰과 무관하므로 먼저)
  const serverTime = Date.parse(report.server.time);
  if (Number.isNaN(serverTime)) push({ id: "clock", label: "시각", state: "skip", detail: "서버 시각을 읽지 못했습니다." });
  else {
    const skew = Math.abs(serverTime - Date.now());
    push({ id: "clock", label: "시각", state: skew > CLOCK_SKEW_MS ? "warn" : "ok", detail: skew > CLOCK_SKEW_MS ? `PC와 서버 시각이 ${Math.round(skew / 60000)}분 어긋납니다.` : `차이 ${Math.round(skew / 1000)}초` });
  }

  // 3) 토큰
  if (!token) { push({ id: "auth", label: "토큰", state: "fail", detail: "API 토큰을 입력하세요." }); push({ id: "device", label: "기기 등록", state: "skip", detail: "" }); return report; }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
  try {
    const who = await fetch(`${url}/api/v1/auth/whoami`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers });
    if (who.status === 401) { push({ id: "auth", label: "토큰", state: "fail", detail: "토큰이 올바르지 않거나 폐기되었습니다." }); push({ id: "device", label: "기기 등록", state: "skip", detail: "" }); return report; }
    if (!who.ok) { push({ id: "auth", label: "토큰", state: "fail", detail: `HTTP ${who.status}` }); return report; }
    const me = await who.json() as { user: { name: string }; token: { name: string } };
    report.user = { name: me.user.name, tokenName: me.token.name };
    push({ id: "auth", label: "토큰", state: "ok", detail: `${me.user.name} · 토큰 ${me.token.name}` });
  } catch (error) { push({ id: "auth", label: "토큰", state: "fail", detail: describeFailure(error) }); return report; }

  // 4) 기기 등록
  if (input.register === false) push({ id: "device", label: "기기 등록", state: "skip", detail: "확인만 합니다." });
  else {
    try {
      const registered = await fetch(`${url}/api/v1/devices/register`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS), headers,
        body: JSON.stringify({ name: input.deviceName.trim() || "내 PC", platform: options.platform ?? "unknown" }) });
      if (!registered.ok) throw new Error(`HTTP ${registered.status}`);
      const data = await registered.json() as { device: { id: string; name: string }; created: boolean };
      report.device = { id: data.device.id, name: data.device.name, created: data.created };
      push({ id: "device", label: "기기 등록", state: "ok", detail: `${data.device.name} (${data.created ? "새로 등록" : "이미 등록됨"})` });
    } catch (error) { push({ id: "device", label: "기기 등록", state: "fail", detail: describeFailure(error) }); return report; }
  }

  report.ok = steps.every((step) => step.state !== "fail");
  return report;
}
