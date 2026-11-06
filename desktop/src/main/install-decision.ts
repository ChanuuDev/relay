/** `relay version --json`이 알려 주는 실행 파일의 빌드 정보. builtAt은 빌드한 시각(ISO)이며, 빌드 시각을 싣기 전의 relay.exe는 이 명령이 없다. */
export type RelayBuild = { version: string; revision: string | null; builtAt: string | null };

/**
 * 앱에 동봉한 relay.exe로 설치된 것을 바꿀지 정한다.
 * - 설치된 것이 없으면 설치한다(install). 내용이 같으면 그대로다(same).
 * - 다르면 동봉한 쪽이 더 나중에 빌드됐을 때만 설치한다. 저장소에서 install-cli.ps1로 다시 설치한 더 새 CLI를
 *   앱의 옛 동봉본으로 되돌리지 않기 위해서다(keep). 빌드 시각을 모르는 설치본은 그보다 옛것이다.
 * - 동봉한 쪽의 빌드 시각을 모르면 어느 쪽이 새것인지 알 수 없으므로 설치된 것을 둔다.
 */
export function installDecision(input: { installed: boolean; same: boolean; installedBuild: RelayBuild | null; bundledBuild: RelayBuild | null }): "install" | "same" | "keep" {
  if (!input.installed) return "install";
  if (input.same) return "same";
  const bundled = time(input.bundledBuild);
  if (bundled === null) return "keep";
  const installed = time(input.installedBuild);
  return installed === null || bundled > installed ? "install" : "keep";
}

const time = (build: RelayBuild | null) => {
  const value = build?.builtAt ? Date.parse(build.builtAt) : Number.NaN;
  return Number.isFinite(value) ? value : null;
};

/** `relay version --json` 출력을 읽는다. 모양이 틀리면 null. */
export function parseBuild(stdout: string): RelayBuild | null {
  try {
    const data = JSON.parse(stdout) as Partial<RelayBuild> & { schemaVersion?: unknown };
    if (data.schemaVersion !== 1 || typeof data.version !== "string") return null;
    return { version: data.version, revision: typeof data.revision === "string" ? data.revision : null, builtAt: typeof data.builtAt === "string" ? data.builtAt : null };
  } catch { return null; }
}
