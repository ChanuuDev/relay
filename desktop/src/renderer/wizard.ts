// 마법사·설정 화면. 모듈이 아닌 평범한 스크립트로 돈다(sandbox 렌더러).
(() => {
  const api = window.relayDesktop;
  const sheet = document.querySelector<HTMLElement>(".sheet")!;
  const subtitle = document.getElementById("subtitle")!;
  const chip = document.getElementById("status-chip")!;
  const errorBox = document.getElementById("error")!;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const urlInput = $<HTMLInputElement>("url"), tokenInput = $<HTMLInputElement>("token"), deviceInput = $<HTMLInputElement>("device");
  const report = $<HTMLOListElement>("report"), remoteNext = $<HTMLElement>("remote-next"), testButton = $<HTMLButtonElement>("test");
  const migrateOutput = $<HTMLPreElement>("migrate-output");
  const facts = $<HTMLDListElement>("facts"), doneLead = $<HTMLElement>("done-lead");
  const autoLaunch = $<HTMLInputElement>("auto-launch"), closeToTray = $<HTMLInputElement>("close-to-tray");

  type Step = "mode" | "remote" | "migrate" | "done";
  const titles: Record<Step, string> = { mode: "기록을 어디에 둘지 고르세요", remote: "원격 서버에 연결합니다", migrate: "기존 기록을 옮길까요?", done: "설정" };
  let config: RelayConfig | null = null;
  let pendingRemote: RemoteConfig | null = null;
  let verified = false;

  function show(step: Step) {
    sheet.dataset.step = step;
    for (const section of document.querySelectorAll<HTMLElement>(".step")) section.hidden = section.dataset.step !== step;
    subtitle.textContent = titles[step];
    errorBox.hidden = true;
  }
  function fail(message: string) { errorBox.textContent = message; errorBox.hidden = false; }
  function busy(button: HTMLButtonElement, on: boolean, label?: string) {
    button.disabled = on;
    if (label) { button.dataset.label ??= button.textContent ?? ""; button.textContent = on ? label : button.dataset.label; }
  }

  async function refreshStatus() {
    try {
      const status = await api.getStatus();
      $("storage-directory").textContent = status.dataDirectory;
      $("remote-status").textContent = status.mode !== "remote" ? "로컬 모드" : status.remote ? `${status.remote.reachable ? `연결됨 (${status.remote.latencyMs ?? 0}ms)` : "연결 끊김"} · 대기 ${status.remote.outbox.pending}건 · 실패 ${status.remote.outbox.failed}건` : "확인 중…";
      $<HTMLButtonElement>("flush-outbox").disabled = status.mode !== "remote";
      chip.hidden = false;
      chip.dataset.state = status.running ? "ok" : "fail";
      chip.textContent = status.running ? `서버 켜짐 · ${status.mode === "remote" ? "원격" : "로컬"}${status.appVersion ? ` · v${status.appVersion}` : ""}` : "서버 꺼짐";
    } catch { chip.hidden = true; }
  }

  function renderFacts() {
    if (!config) return;
    const rows: [string, string][] = [["모드", config.mode === "remote" ? "원격 서버" : "로컬 (이 PC)"]];
    if (config.mode === "remote" && config.remote) rows.push(["서버", config.remote.url], ["이 PC", config.remote.deviceName], ["기기 id", config.remote.deviceId ?? "미등록"]);
    rows.push(["화면 주소", `http://127.0.0.1:${config.webPort}`]);
    facts.replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; return [dt, dd]; }));
    $<HTMLInputElement>("web-port").value = String(config.webPort);
    autoLaunch.checked = config.desktop?.autoLaunch ?? true;
    closeToTray.checked = config.desktop?.closeToTray ?? true;
    $<HTMLInputElement>("keep-server").checked = config.desktop?.keepServerRunning ?? false;
  }

  function renderReport(result: ConnectionReport) {
    report.hidden = false;
    report.replaceChildren(...result.steps.map((step) => {
      const li = document.createElement("li");
      li.dataset.state = step.state;
      const mark = document.createElement("span"); mark.className = "mark"; mark.textContent = step.state === "ok" ? "✓" : step.state === "fail" ? "✕" : step.state === "warn" ? "!" : "–";
      const label = document.createElement("span"); label.className = "label"; label.textContent = step.label;
      const detail = document.createElement("span"); detail.className = "detail"; detail.textContent = step.detail;
      li.append(mark, label, detail);
      return li;
    }));
  }

  // 1. 모드 고르기
  $("card-local").addEventListener("click", async () => {
    try {
      busy($("card-local") as HTMLButtonElement, true);
      config = await api.saveMode({ mode: "local" });
      doneLead.textContent = "로컬 서버로 저장했습니다. 지금 구조 그대로 이 PC에 기록합니다.";
      renderFacts(); show("done"); await refreshStatus();
    } catch (error) { fail((error as Error).message); }
    finally { busy($("card-local") as HTMLButtonElement, false); }
  });
  $("card-remote").addEventListener("click", async () => {
    if (!deviceInput.value) deviceInput.value = config?.remote?.deviceName ?? await api.defaultDeviceName();
    if (config?.remote) { urlInput.value = config.remote.url; tokenInput.value = config.remote.token; }
    show("remote");
    urlInput.focus();
  });

  // 2. 연결 확인
  $<HTMLFormElement>("remote-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true; remoteNext.hidden = true; verified = false;
    busy(testButton, true, "확인 중…");
    try {
      const result = await api.testConnection({ url: urlInput.value, token: tokenInput.value, deviceName: deviceInput.value });
      renderReport(result);
      if (result.ok && result.device) {
        verified = true;
        pendingRemote = { url: result.url, token: tokenInput.value.trim(), deviceId: result.device.id, deviceName: result.device.name };
        remoteNext.hidden = false;
      }
    } catch (error) { fail((error as Error).message); }
    finally { busy(testButton, false); }
  });
  for (const input of [urlInput, tokenInput, deviceInput]) input.addEventListener("input", () => { verified = false; pendingRemote = null; remoteNext.hidden = true; });
  $("to-migrate").addEventListener("click", async () => {
    if (!verified) return;
    show("migrate"); migrateOutput.hidden = false; migrateOutput.textContent = "이 PC의 기록을 확인 중…";
    try { const result = await api.migrate({ dryRun: true }); migrateOutput.textContent = result.output; }
    catch (error) { fail((error as Error).message); }
  });

  // 3. 이전
  async function finishRemote(migrate: boolean) {
    if (!pendingRemote) return;
    const button = $<HTMLButtonElement>(migrate ? "run-migrate" : "skip-migrate");
    busy(button, true, migrate ? "올리는 중…" : "저장 중…");
    try {
      config = await api.saveMode({ mode: "remote", remote: pendingRemote });
      if (migrate) {
        migrateOutput.hidden = false; migrateOutput.textContent = "이 PC의 기록을 올리는 중…";
        const result = await api.migrate({ dryRun: false });
        migrateOutput.textContent = result.output || (result.ok ? "완료" : "실패");
        if (!result.ok) { fail("기록 올리기에 실패했습니다. 다시 시도하거나 이전을 건너뛸 수 있습니다."); return; }
      }
      doneLead.textContent = `원격 서버로 저장했습니다. ${pendingRemote.url}`;
      renderFacts(); show("done"); await refreshStatus();
    } catch (error) { fail((error as Error).message); }
    finally { busy(button, false); }
  }
  $("run-migrate").addEventListener("click", () => void finishRemote(true));
  $("skip-migrate").addEventListener("click", () => void finishRemote(false));

  // 4. 설정
  autoLaunch.addEventListener("change", async () => { config = await api.setDesktop({ autoLaunch: autoLaunch.checked }); });
  $<HTMLInputElement>("keep-server").addEventListener("change", async () => { config = await api.setDesktop({ keepServerRunning: $<HTMLInputElement>("keep-server").checked }); });
  closeToTray.addEventListener("change", async () => { config = await api.setDesktop({ closeToTray: closeToTray.checked }); });
  $("change-mode").addEventListener("click", () => show("mode"));
  $("restart").addEventListener("click", async () => {
    const button = $<HTMLButtonElement>("restart"); busy(button, true, "다시 시작 중…");
    try { await api.restartRelay(); await refreshStatus(); } catch (error) { fail((error as Error).message); } finally { busy(button, false); }
  });
  $("open-main").addEventListener("click", () => void api.openMain());
  for (const back of document.querySelectorAll<HTMLButtonElement>("[data-back]")) back.addEventListener("click", () => show(sheet.dataset.step === "migrate" ? "remote" : "mode"));

  async function maintenance(id: string, action: () => Promise<MigrateResult>) {
    const button = $<HTMLButtonElement>(id); busy(button, true);
    const output = $("maintenance-output"); output.hidden = false; output.textContent = "실행 중…";
    errorBox.hidden = true;
    try { const result = await action(); output.textContent = result.output; if (!result.ok) fail("처리하지 못했습니다. 아래 결과를 확인하세요."); await refreshStatus(); }
    catch (error) { fail((error as Error).message); }
    finally { busy(button, false); }
  }
  $("install-hooks").addEventListener("click", () => void maintenance("install-hooks", () => api.installIntegration("hooks")));
  $("install-skills").addEventListener("click", () => void maintenance("install-skills", () => api.installIntegration("skills")));
  $("flush-outbox").addEventListener("click", () => void maintenance("flush-outbox", () => api.flushOutbox()));
  for (const kind of ["data", "logs"] as const) $(kind === "data" ? "open-storage" : "open-logs").addEventListener("click", () => { void api.openFolder(kind).catch(error => fail((error as Error).message)); });
  $("port-form").addEventListener("submit", async event => {
    event.preventDefault(); const button = $<HTMLButtonElement>("save-port"); busy(button, true);
    errorBox.hidden = true;
    try { config = await api.setPort(Number($<HTMLInputElement>("web-port").value)); renderFacts(); await refreshStatus(); }
    catch (error) { fail((error as Error).message); }
    finally { busy(button, false); }
  });
  api.onStatus(() => void refreshStatus());
  setInterval(() => void refreshStatus(), 3000);

  // 시작: 설정이 있으면 설정 화면, 없으면 모드 고르기
  void (async () => {
    config = await api.getConfig();
    renderFacts();
    show(config.mode ? "done" : "mode");
    await refreshStatus();
  })();
})();
