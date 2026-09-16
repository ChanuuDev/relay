/* Stored values only enter text nodes. This page has no write or shell-execution API. */
const $ = (id) => document.getElementById(id);
const form = $("filters");
let generation = 0;
let timer;
let controller;
let lastSuccess = null;
let connected = false;
let healthNeeded = true;
let storeDirectory = null;
let shell = navigator.platform.startsWith("Win") ? "powershell" : "bash";
const rendered = new Map();

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function button(text, action, key, small = false) {
  const node = el("button", text, small ? "small" : "");
  node.type = "button";
  node.dataset.focus = key;
  node.addEventListener("click", (event) => { event.stopPropagation(); action(); });
  return node;
}
function badge(status) { return el("span", status, `badge ${status}`); }
function stamp(value, utc = false) {
  if (!value) return "미기록";
  const local = new Date(value).toLocaleString(undefined, { timeZoneName: "short" });
  return utc ? `${local}\n${value}` : local;
}
function error(section, message = "") {
  const node = $(`${section}-error`);
  node.textContent = message;
  node.hidden = !message;
}
function replace(id, value, create) {
  const key = JSON.stringify(value);
  if (rendered.get(id) === key) return;
  const root = $(id);
  const focus = root.contains(document.activeElement) ? document.activeElement?.dataset.focus : undefined;
  const scroller = root.querySelector(".table-wrap");
  const left = scroller?.scrollLeft ?? 0;
  const top = window.scrollY;
  root.replaceChildren(...create());
  if (scroller) root.querySelector(".table-wrap")?.scrollTo(left, 0);
  if (focus) [...root.querySelectorAll("[data-focus]")].find(n => n.dataset.focus === focus)?.focus({ preventScroll: true });
  window.scrollTo({ top });
  rendered.set(id, key);
}
function listBack() {
  const raw = new URLSearchParams(location.search).get("back");
  return raw && (raw === "/" || raw.startsWith("/?")) ? raw : "/";
}
function sessionUrl(id) {
  const back = location.pathname === "/" ? location.pathname + location.search : listBack();
  return `/sessions/${encodeURIComponent(id)}?${new URLSearchParams({ back })}`;
}
function link(session) {
  const a = el("a", session.sessionName ?? "(이름 없음)", "session-name");
  a.href = sessionUrl(session.id);
  a.dataset.nav = "";
  a.dataset.focus = `session-${session.id}`;
  return a;
}
function navigate(url) { history.pushState({}, "", url); route(); window.scrollTo(0, 0); }
function pageTo(key, offset) {
  const url = new URL(location.href);
  url.searchParams.set(key, String(offset));
  navigate(url.pathname + url.search);
}
function pager(page, key = "offset") {
  const p = el("div", null, "pager");
  const from = page.total && page.offset < page.total ? page.offset + 1 : 0;
  p.append(el("span", `총 ${page.total}건 · ${from}~${Math.min(page.offset + page.limit, page.total)}건`));
  const controls = el("div", null, "pager-buttons");
  const prev = button("이전", () => pageTo(key, Math.max(0, page.offset - page.limit)), `${key}-prev`);
  const next = button("다음", () => pageTo(key, page.offset + page.limit), `${key}-next`);
  prev.disabled = page.offset === 0;
  next.disabled = page.offset + page.limit >= page.total;
  controls.append(prev, next); p.append(controls); return p;
}
function table(headers) {
  const wrapper = el("div", null, "table-wrap");
  const t = el("table"); const head = el("thead"); const row = el("tr");
  for (const text of headers) { const th = el("th", text); th.scope = "col"; row.append(th); }
  head.append(row); const body = el("tbody"); t.append(head, body); wrapper.append(t);
  return { wrapper, body };
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); $("copy-status").textContent = "복사했습니다."; $("copy-fallback").hidden = true; }
  catch { $("copy-fallback").hidden = false; $("copy-text").value = value; $("copy-text").focus(); $("copy-text").select(); }
}
function quote(value) {
  return shell === "powershell" ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
function renderList(data) {
  replace("list-content", data, () => {
    if (!data.items.length) {
      const filtered = ["q", "status", "provider", "agent", "cwd"].some(k => new URLSearchParams(location.search).has(k));
      return [el("p", data.page.total ? "현재 페이지에 결과가 없습니다. 이전 페이지로 이동하세요." : filtered ? "검색 결과가 없습니다." : "저장된 세션이 없습니다. relay start --help로 기록을 시작하세요.", "empty"), pager(data.page)];
    }
    const { wrapper, body } = table(["세션 이름", "상태", "PROVIDER / AGENT", "모델", "작업 경로", "최신 요약", "갱신 시각", "SESSION ID"]);
    for (const s of data.items) {
      const row = el("tr", null, "session-row");
      row.addEventListener("click", e => { if (!e.target.closest("a,button") && !window.getSelection()?.toString()) navigate(sessionUrl(s.id)); });
      const name = el("td"); const a = link(s); a.classList.add("ellipsis"); a.title = s.sessionName ?? "(이름 없음)"; name.append(a);
      const state = el("td"); state.append(badge(s.status));
      const source = el("td", s.provider); source.append(el("div", s.agent, "secondary"));
      const model = el("td"); model.append(el("div", s.model ?? "미기록", "ellipsis"));
      const cwd = el("td"); const path = el("div", s.workingDirectory, "ellipsis mono"); path.title = s.workingDirectory; cwd.append(path);
      const summary = el("td"); const short = el("div", s.summary, "ellipsis"); short.title = s.summary; summary.append(short);
      const updated = el("td", stamp(s.updatedAt), "secondary"); updated.title = s.updatedAt;
      const id = el("td"); const text = el("div", s.providerSessionId, "ellipsis mono"); text.title = s.providerSessionId;
      id.append(text, button("복사", () => copy(s.providerSessionId), `copy-${s.id}`, true));
      row.append(name, state, source, model, cwd, summary, updated, id); body.append(row);
    }
    return [wrapper, pager(data.page)];
  });
}
function renderDetail(data) {
  replace("detail-content", data, () => {
    const s = data.session;
    const panel = el("div", null, "panel"); const heading = el("div", null, "detail-heading");
    const title = el("div"); title.append(el("h2", s.sessionName ?? "(이름 없음)"), badge(s.status));
    const actions = el("div", null, "actions");
    const select = el("select"); select.setAttribute("aria-label", "조회 명령 셸"); select.dataset.focus = "shell";
    for (const [value, label] of [["powershell", "PowerShell"], ["bash", "Bash"]]) {
      const opt = el("option", label); opt.value = value; select.append(opt);
    }
    select.value = shell; select.addEventListener("change", () => { shell = select.value; });
    actions.append(button("Session ID 복사", () => copy(s.providerSessionId), "copy-id"), select,
      button("조회 명령 복사", () => {
        if (!storeDirectory) { $("copy-status").textContent = "저장소를 확인할 수 없습니다. 연결 후 새로고침해 주세요."; return; }
        copy(`relay show ${quote(s.providerSessionId)} --provider ${quote(s.provider)} --data-dir ${quote(storeDirectory)} --json`);
      }, "copy-command"));
    heading.append(title, actions); panel.append(heading);
    const fields = [["Provider Session ID", s.providerSessionId], ["Relay 내부 ID", s.id], ["Provider / Agent", `${s.provider} / ${s.agent}`],
      ["모델", s.model ?? "미기록"], ["작업 경로", s.workingDirectory], ["기록 시작", stamp(s.startedAt, true)],
      ["마지막 갱신", stamp(s.updatedAt, true)], ["종료 시각", stamp(s.endedAt, true)]];
    const dl = el("dl"); for (const [label, value] of fields) dl.append(el("dt", label), el("dd", value)); panel.append(dl);
    const work = el("div", null, "panel"); work.append(el("h2", "최근 작업 요약"), el("div", s.summary, "summary"));
    work.append(el("p", "요약은 참고 정보입니다. 작업 재개 전 실제 프로젝트 파일을 확인하세요.", "hint"));
    work.append(el("h2", "이전 세션"));
    if (data.parentSession) { work.append(link(data.parentSession), badge(data.parentSession.status)); }
    else work.append(el("p", "최초 세션", "secondary"));
    return [panel, work];
  });
}
function renderChildren(data) {
  replace("children-content", data, () => {
    if (!data.items.length) return [el("p", "이어받은 세션 없음", "secondary"), pager(data.page, "childrenOffset")];
    const list = el("ul", null, "relation");
    for (const s of data.items) { const item = el("li"); item.append(link(s), badge(s.status), el("span", `${s.provider} · ${s.providerSessionId}`, "secondary")); list.append(item); }
    return [list, pager(data.page, "childrenOffset")];
  });
}
function renderUpdates(data) {
  replace("updates-content", data, () => {
    const { wrapper, body } = table(["순번", "기록 시각", "유형", "요약"]);
    for (const u of data.items) {
      const row = el("tr"); const time = el("td", stamp(u.createdAt), "secondary"); time.title = u.createdAt;
      row.append(el("td", `#${u.sequence}`, "mono"), time, el("td", u.type, "mono"), el("td", u.summary, "history-summary")); body.append(row);
    }
    return [data.items.length ? wrapper : el("p", "현재 페이지에 이력이 없습니다.", "secondary"), pager(data.page, "historyOffset")];
  });
}
async function get(url, signal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  if (data.schemaVersion !== 1) throw new Error("지원하지 않는 API 버전입니다.");
  return data;
}
async function refresh() {
  if (controller || document.hidden) return;
  clearTimeout(timer);
  const current = generation;
  const abort = new AbortController(); controller = abort;
  const timeout = setTimeout(() => abort.abort(), 5000);
  const query = new URLSearchParams(location.search);
  const match = /^\/sessions\/([^/]+)$/.exec(location.pathname);
  const jobs = [];
  if (healthNeeded) jobs.push({ section: "global", url: "/api/v1/health", render: data => {
    $("database-path").textContent = `저장소: ${data.databasePath}`; storeDirectory = data.dataDirectory; healthNeeded = false;
  } });
  if (match) {
    const base = `/api/v1/sessions/${match[1]}`;
    jobs.push({ section: "detail", url: base, render: renderDetail },
      { section: "updates", url: `${base}/updates?limit=50&offset=${encodeURIComponent(query.get("historyOffset") ?? "0")}`, render: renderUpdates },
      { section: "children", url: `${base}/children?limit=50&offset=${encodeURIComponent(query.get("childrenOffset") ?? "0")}`, render: renderChildren });
  } else jobs.push({ section: "list", url: `/api/v1/sessions?${query}`, render: renderList });
  try {
    const results = await Promise.allSettled(jobs.map(job => get(job.url, abort.signal)));
    if (generation !== current) return;
    let failed = false;
    results.forEach((result, i) => {
      const job = jobs[i];
      if (result.status === "fulfilled") { job.render(result.value); error(job.section); }
      else {
        failed = true;
        error(job.section, `${job.section === "updates" ? "이력" : job.section === "children" ? "연결 정보" : "조회"} 실패: ${result.reason?.name === "AbortError" ? "응답 시간 초과" : result.reason.message}. 마지막 성공 데이터는 유지됩니다.`);
        const content = $(`${job.section}-content`);
        if (content && !rendered.has(content.id)) content.replaceChildren(el("p", "조회할 수 없습니다. 연결과 입력을 확인해 주세요.", "empty"));
      }
    });
    connected = !failed;
    if (connected) lastSuccess = new Date(); else healthNeeded = true;
    $("connection-state").textContent = connected ? "연결됨 · 3초마다 자동 조회" : "연결 끊김 또는 조회 오류 · 재시도 중";
    $("connection-state").classList.toggle("offline", !connected);
    $("last-success").textContent = `마지막 성공 조회 ${lastSuccess ? lastSuccess.toLocaleTimeString() : "—"}`;
  } finally {
    clearTimeout(timeout);
    if (controller === abort) controller = null;
    if (generation === current && !document.hidden) timer = setTimeout(refresh, 3000);
  }
}
function cancel() { generation++; clearTimeout(timer); controller?.abort(); controller = null; }
function route() {
  cancel(); rendered.clear();
  const detail = /^\/sessions\/[^/]+$/.test(location.pathname);
  $("list-view").hidden = detail; $("detail-view").hidden = !detail;
  $("page-title").textContent = detail ? "세션 상세" : "세션 기록";
  document.title = detail ? "Relay · 세션 상세" : "Relay · 세션 기록";
  $("back-link").href = listBack();
  for (const section of ["list", "detail", "children", "updates", "global"]) error(section);
  for (const id of ["list-content", "detail-content", "children-content", "updates-content"]) $(id).replaceChildren(el("p", "불러오는 중…", "secondary"));
  const query = new URLSearchParams(location.search);
  for (const name of ["q", "provider", "agent", "cwd", "status", "limit"]) form.elements.namedItem(name).value = query.get(name) ?? (name === "limit" ? "50" : "");
  refresh();
}
form.addEventListener("submit", event => {
  event.preventDefault(); const query = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (String(value).trim()) query.set(key, String(value).trim());
  navigate(`/?${query}`);
});
$("reset").addEventListener("click", () => navigate("/"));
$("refresh").addEventListener("click", () => { cancel(); healthNeeded = true; refresh(); });
document.addEventListener("click", event => {
  const a = event.target.closest("a[data-nav]");
  if (a && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(a.getAttribute("href")); }
});
window.addEventListener("popstate", route);
document.addEventListener("visibilitychange", () => { cancel(); if (!document.hidden) { healthNeeded = true; refresh(); } });
window.addEventListener("pagehide", cancel);
window.addEventListener("pageshow", event => { if (event.persisted) refresh(); });
route();
