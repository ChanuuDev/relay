/** 메인·프리로드·마법사 화면이 함께 쓰는 모양. relay.exe의 config.json(schemaVersion 2)과 같다. */

export type Mode = "local" | "remote";

export interface RemoteConfig {
  /** https://relay.example.com 처럼 스킴을 포함한 주소. 끝 /는 없다. */
  url: string;
  token: string;
  deviceId: string | null;
  deviceName: string;
}

export interface DesktopConfig {
  /** 로그인 때 트레이로 조용히 시작 */
  autoLaunch: boolean;
  /** 창을 닫으면 종료하지 않고 트레이로 */
  keepServerRunning?: boolean; closeToTray: boolean;
}

export interface RelayConfig {
  schemaVersion: 1 | 2;
  webHost?: "127.0.0.1";
  webPort: number;
  retentionDays: number;
  mode?: Mode;
  remote?: RemoteConfig;
  desktop?: DesktopConfig;
}

export type StepState = "ok" | "fail" | "skip" | "warn";
export interface TestStep { id: "reach" | "identity" | "auth" | "device" | "clock"; label: string; state: StepState; detail: string }
export interface ConnectionReport {
  ok: boolean;
  url: string;
  steps: TestStep[];
  latencyMs: number | null;
  server?: { appVersion: string; apiVersion: number; build: string; files: boolean; time: string };
  user?: { name: string; tokenName: string };
  device?: { id: string; name: string; created: boolean };
}

export interface RemoteStatus { reachable: boolean; latencyMs?: number; outbox: { pending: number; failed: number } }

export interface RelayStatus {
  dataDirectory: string;
  remote: RemoteStatus | null;
  /** relay.exe 웹 서버가 응답하는지 */
  running: boolean;
  /** 이 앱이 띄운 것이 아니라 이미 돌고 있던 서버인지 */
  external: boolean;
  url: string;
  pid: number | null;
  mode: Mode | null;
  remoteUrl: string | null;
  appVersion: string | null;
  build: string | null;
  /** 설치된 relay.exe 경로 */
  exe: string | null;
}

export interface MigrateResult { ok: boolean; output: string }

/** 메인 → 화면 */
export interface DesktopApi {
  getConfig(): Promise<RelayConfig>;
  setPort(port: number): Promise<RelayConfig>;
  installIntegration(kind: "hooks" | "skills"): Promise<MigrateResult>;
  flushOutbox(): Promise<MigrateResult>;
  openFolder(kind: "data" | "logs"): Promise<void>;
  /** 모드를 저장하고 relay.exe를 다시 띄운다. 원격이면 remote가 있어야 한다. */
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
