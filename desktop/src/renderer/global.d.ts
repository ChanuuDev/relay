// 프리로드가 노출한 API. shared/types.ts와 같은 모양을 화면 쪽에서 다시 선언한다(화면 스크립트는 모듈이 아니라 import를 쓸 수 없다).
type Mode = "local" | "remote";
interface RemoteConfig { url: string; token: string; deviceId: string | null; deviceName: string }
interface DesktopConfig { autoLaunch: boolean; keepServerRunning?: boolean; closeToTray: boolean }
interface RelayConfig { schemaVersion: 1 | 2; webPort: number; retentionDays: number; mode?: Mode; remote?: RemoteConfig; desktop?: DesktopConfig }
type StepState = "ok" | "fail" | "skip" | "warn";
interface TestStep { id: string; label: string; state: StepState; detail: string }
interface ConnectionReport {
  ok: boolean; url: string; steps: TestStep[]; latencyMs: number | null;
  server?: { appVersion: string; apiVersion: number; build: string; files: boolean; time: string };
  user?: { name: string; tokenName: string };
  device?: { id: string; name: string; created: boolean };
}
interface RelayStatus { dataDirectory: string; remote: { reachable: boolean; latencyMs?: number; outbox: { pending: number; failed: number } } | null; running: boolean; external: boolean; url: string; pid: number | null; mode: Mode | null; remoteUrl: string | null; appVersion: string | null; build: string | null; exe: string | null }
interface MigrateResult { ok: boolean; output: string }
interface DesktopApi {
  getConfig(): Promise<RelayConfig>;
  setPort(port: number): Promise<RelayConfig>;
  installIntegration(kind: "hooks" | "skills"): Promise<MigrateResult>;
  flushOutbox(): Promise<MigrateResult>;
  openFolder(kind: "data" | "logs"): Promise<void>;
  saveMode(input: { mode: Mode; remote?: RemoteConfig }): Promise<RelayConfig>;
  testConnection(input: { url: string; token: string; deviceName: string }): Promise<ConnectionReport>;
  getStatus(): Promise<RelayStatus>;
  restartRelay(): Promise<RelayStatus>;
  migrate(input: { dryRun: boolean }): Promise<MigrateResult>;
  setDesktop(input: Partial<DesktopConfig>): Promise<RelayConfig>;
  openMain(): Promise<void>;
  defaultDeviceName(): Promise<string>;
  onStatus(listener: (status: RelayStatus) => void): () => void;
}
interface Window { relayDesktop: DesktopApi }
