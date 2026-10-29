import { create } from "zustand";

/** 설치한 relay가 Windows에 등록한 `relay://` 링크. 이 화면의 포트로 백그라운드 서버를 켠다(`relay open-url`). */
export const serverLaunchUrl = () => `relay://web?port=${location.port || "7474"}`;
/** 등록은 설치 스크립트가 Windows에만 한다. 다른 OS에서는 자동으로 열지 않고 단추로만 연다. */
export const canAutoLaunch = () => /Win/i.test(navigator.platform);
/** 자동 시도 사이의 최소 간격. 브라우저 확인 창이 되풀이해 뜨지 않게 한다. */
export const AUTO_LAUNCH_INTERVAL = 60_000;
let lastAuto = 0;

export type Launch = { url: string; at: number; manual: boolean };
export const useLaunch = create<{ launch: Launch | null }>(() => ({ launch: null }));

/** 외부 프로토콜 링크는 화면을 떠나지 않고 등록한 앱만 깨운다. 등록이 없으면 아무 일도 일어나지 않는다. */
export function launchServer(manual: boolean) {
  const url = serverLaunchUrl();
  document.documentElement.dataset.serverLaunch = url;
  useLaunch.setState({ launch: { url, at: Date.now(), manual } });
  location.assign(url);
}

/** 서버에 닿지 못한 화면이 스스로 서버를 켠다. 가려진 탭이거나 방금 시도했으면 건너뛴다. */
export function autoLaunchServer(): boolean {
  if (!canAutoLaunch() || document.hidden || Date.now() - lastAuto < AUTO_LAUNCH_INTERVAL - 1000) return false;
  lastAuto = Date.now();
  launchServer(false);
  return true;
}
