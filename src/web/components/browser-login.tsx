import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Eye, EyeOff, Info, LoaderCircle, LockKeyhole } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Wallpaper } from "./desktop/wallpaper";
import { LoginError, verifyLogin } from "../lib/browser-mode";
import type { Credentials } from "../lib/remote-api";
import { useUI } from "../lib/store";
import { isDark, watchSystemTheme } from "../lib/theme";

/** 브라우저 모드의 첫 화면. 발급받은 토큰과 접속할 Relay 주소를 받아 확인한 뒤 넘긴다. 저장(암호화)은 onLogin이 한다. */
export function BrowserLogin({ notice, onLogin }: { notice?: string; onLogin: (credentials: Credentials) => Promise<void> }) {
  const theme = useUI((state) => state.theme);
  const [dark, setDark] = useState(() => isDark(theme));
  const [url, setUrl] = useState(() => location.origin);
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field: LoginError["field"] } | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDark(isDark(theme));
    if (theme !== "system") return;
    return watchSystemTheme(() => setDark(isDark("system")));
  }, [theme]);
  useEffect(() => { tokenRef.current?.focus(); }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await onLogin(await verifyLogin(url, token));
    } catch (failure) {
      const field = failure instanceof LoginError ? failure.field : "form";
      setError({ message: failure instanceof Error ? failure.message : "로그인하지 못했습니다.", field });
      setBusy(false);
      requestAnimationFrame(() => (field === "url" ? urlRef : tokenRef).current?.focus());
    }
  }

  const invalid = (field: LoginError["field"]) => (error?.field === field ? true : undefined);
  return <div className="desktop login-screen" data-shell="login">
    <Wallpaper dark={dark} />
    <main className="login-card material-chrome" aria-labelledby="login-title">
      <div className="login-brand">
        <img src="/icons/app-192.png" alt="" width={64} height={64} />
        <h1 id="login-title">Relay</h1>
        <p>발급받은 토큰으로 원격 Relay에 연결합니다.</p>
      </div>
      {notice && <p className="login-notice" role="status"><Info aria-hidden="true" />{notice}</p>}
      <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="login-field">
          <label htmlFor="login-url">Relay 주소</label>
          <Input id="login-url" ref={urlRef} name="url" type="url" inputMode="url" autoComplete="url" spellCheck={false} autoCapitalize="off"
            value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://relay.example.com" aria-invalid={invalid("url")}
            aria-describedby={error?.field === "url" ? "login-error" : undefined} disabled={busy} />
        </div>
        <div className="login-field">
          <label htmlFor="login-token">토큰</label>
          <div className="login-secret">
            <Input id="login-token" ref={tokenRef} name="token" type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false} autoCapitalize="off"
              value={token} onChange={(event) => setToken(event.target.value)} placeholder="발급받은 토큰 붙여 넣기" aria-invalid={invalid("token")}
              aria-describedby={error?.field === "token" ? "login-error" : undefined} disabled={busy} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={reveal ? "토큰 가리기" : "토큰 보기"} aria-pressed={reveal}
              onClick={() => setReveal((value) => !value)} disabled={busy}>{reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button>
          </div>
        </div>
        {error && <p id="login-error" className="login-error" role="alert">{error.message}</p>}
        <Button type="submit" className="login-submit" disabled={busy}>
          {busy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />확인 중…</> : "연결"}
        </Button>
      </form>
      <p className="login-foot"><LockKeyhole aria-hidden="true" /><span>토큰은 이 브라우저에만 암호화해 저장합니다. 공용 PC라면 다 쓴 뒤 로그아웃하세요.</span></p>
    </main>
  </div>;
}
