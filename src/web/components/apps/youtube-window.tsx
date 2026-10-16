import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, House, ListVideo, LoaderCircle, RotateCw, Search, TriangleAlert, X } from "lucide-react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { Window } from "../desktop/window";
import { WindowTitleBar } from "../desktop/window-title-bar";
import { AppIcon } from "../desktop/app-icons";
import { useDesktop } from "../../lib/desktop-store";
import { canonicalUrl, displayUrl, fetchTitle, keyOf, playerUrl, searchUrl, thumbnailUrl, useYouTube, type Page, type Recent, type Target } from "../../lib/youtube";

const HOME: Page = { kind: "home" };
const label = (entry: Recent) => entry.title ?? displayUrl(entry.target);
const openExternal = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

/** 유튜브를 크롬처럼 창 안에서 연다. 상단바 주소창에 영상·재생목록 주소를 넣으면 내장 플레이어가 재생한다. */
export function YouTubeWindow() {
  const page = useYouTube((state) => state.pages[state.index] ?? HOME);
  const canBack = useYouTube((state) => state.index > 0);
  const canForward = useYouTube((state) => state.index < state.pages.length - 1);
  const reloadKey = useYouTube((state) => state.reloadKey);
  const error = useYouTube((state) => state.error);
  const recent = useYouTube((state) => state.recent);
  const { go, open, home, back, forward, reload, dismissError, setTitle, removeRecent, clearRecent } = useYouTube.getState();
  const focused = useDesktop((state) => state.focused === "youtube");
  const [address, setAddress] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const addressRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameKey = page.kind === "home" ? "" : `${keyOf(page)}:${reloadKey}`;
  const loading = frameKey !== "" && loadedKey !== frameKey;

  // 주소창은 보고 있는 페이지를 따른다.
  useEffect(() => { setAddress(page.kind === "home" ? "" : displayUrl(page)); }, [page]);
  // 크롬의 새 탭처럼, 앞에 있는 창의 시작 페이지에서는 주소창에 초점을 둔다.
  useEffect(() => {
    if (!focused || page.kind !== "home") return;
    const frame = requestAnimationFrame(() => addressRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [focused, page]);
  // 영상 제목은 oEmbed로 읽어 최근 목록에 남긴다.
  useEffect(() => {
    if (page.kind !== "video") return;
    if (useYouTube.getState().recent.find((entry) => keyOf(entry.target) === keyOf(page))?.title) return;
    const controller = new AbortController();
    void fetchTitle(page, controller.signal).then((title) => { if (title) setTitle(page, title); });
    return () => controller.abort();
  }, [page, setTitle]);
  // 플레이어 안을 누르면 창이 앞으로 온다. iframe은 포인터 이벤트를 바깥으로 보내지 않으므로 초점 이동으로 알아챈다.
  useEffect(() => {
    const onBlur = () => { if (frameRef.current && document.activeElement === frameRef.current) useDesktop.getState().focus("youtube"); };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (go(address)) addressRef.current?.blur();
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setAddress(page.kind === "home" ? "" : displayUrl(page));
    if (page.kind !== "home") event.currentTarget.blur();
  }
  const external = page.kind === "home" ? null : canonicalUrl(page);

  return <Window id="youtube" bodyClassName="browser-body" header={
    <WindowTitleBar id="youtube" right={
      <Button type="button" variant="ghost" size="icon-sm" className="browser-external" aria-label="YouTube에서 열기" title="YouTube에서 열기"
        disabled={!external} onClick={() => external && openExternal(external)}><ExternalLink aria-hidden="true" /></Button>}>
      <form className="browser-chrome" onSubmit={submit}>
        <div className="browser-nav" role="group" aria-label="탐색">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="뒤로" title="뒤로" disabled={!canBack} onClick={back}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="앞으로" title="앞으로" disabled={!canForward} onClick={forward}><ChevronRight aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="새로 고침" title="새로 고침" disabled={page.kind === "home"} onClick={reload}><RotateCw aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="시작 페이지" title="시작 페이지" onClick={home}><House aria-hidden="true" /></Button>
        </div>
        <InputGroup className="address-field">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput id="youtube-address" ref={addressRef} value={address} onKeyDown={onKey} onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => { setAddress(event.target.value); if (error !== null) dismissError(); }}
            placeholder="유튜브 주소 또는 영상 ID" aria-label="주소" aria-invalid={error !== null || undefined}
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" enterKeyHint="go" maxLength={2048} />
          {address && <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="주소 지우기" onClick={() => { setAddress(""); addressRef.current?.focus(); }}><X aria-hidden="true" /></InputGroupButton>
          </InputGroupAddon>}
        </InputGroup>
      </form>
    </WindowTitleBar>}>
    {error !== null && <div className="browser-notice" role="alert">
      <TriangleAlert aria-hidden="true" />
      <span>유튜브 영상·재생목록 주소나 영상 ID만 창 안에서 열 수 있습니다.</span>
      <Button type="button" size="xs" variant="secondary" onClick={() => openExternal(searchUrl(error))}>YouTube에서 검색</Button>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="알림 닫기" onClick={dismissError}><X aria-hidden="true" /></Button>
    </div>}
    {page.kind === "home"
      ? <StartPage recent={recent} onOpen={open} onRemove={removeRecent} onClear={clearRecent} />
      : <div className="browser-viewport">
        {loading && <div className="browser-loading" role="status"><LoaderCircle aria-hidden="true" /><span>YouTube 불러오는 중…</span></div>}
        <iframe key={frameKey} ref={frameRef} className="browser-frame" src={playerUrl(page)} title={page.kind === "video" ? "YouTube 영상" : "YouTube 재생목록"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
          onLoad={() => setLoadedKey(frameKey)} />
      </div>}
  </Window>;
}

/** 크롬의 새 탭처럼 안내와 최근 본 항목을 보여 주는 시작 페이지. */
function StartPage({ recent, onOpen, onRemove, onClear }: {
  recent: Recent[]; onOpen: (target: Target) => void; onRemove: (target: Target) => void; onClear: () => void;
}) {
  return <div className="start-page">
    <div className="start-hero">
      <AppIcon app="youtube" size={72} />
      <h3>YouTube</h3>
      <p>영상이나 재생목록 주소를 위 주소창에 붙여넣으면 이 창 안에서 바로 재생합니다. <code>youtu.be</code> 짧은 주소나 영상 ID만 넣어도 됩니다.</p>
    </div>
    {recent.length > 0 && <section className="recent-section" aria-labelledby="recent-heading">
      <div className="recent-head"><h4 id="recent-heading">최근 본 항목</h4><Button type="button" variant="ghost" size="xs" onClick={onClear}>모두 지우기</Button></div>
      <ul className="recent-grid">
        {recent.map((entry) => <li key={keyOf(entry.target)} className="recent-tile">
          <button type="button" className="recent-open" title={label(entry)} onClick={() => onOpen(entry.target)}>
            {entry.target.kind === "video"
              ? <img className="recent-thumb" src={thumbnailUrl(entry.target.id)} alt="" loading="lazy" decoding="async" draggable={false} />
              : <span className="recent-thumb recent-playlist" aria-hidden="true"><ListVideo /></span>}
            <span className="recent-caption">{label(entry)}</span>
          </button>
          <button type="button" className="recent-remove" aria-label={`${label(entry)} 지우기`} onClick={() => onRemove(entry.target)}><X aria-hidden="true" /></button>
        </li>)}
      </ul>
    </section>}
  </div>;
}
