import { useEffect, useState } from "react";
import { DesktopDemo } from "./demo/desktop-demo";
import { PageDemo } from "./demo/page-demo";

/** 견본 두 가지: 기본은 데스크톱형(메뉴바·창·Dock), #page는 페이지형(유리 사이드바 + 불투명 본문).
 *  새 프로젝트에서는 이 파일에서 데모를 걷어 내고 자기 화면을 렌더한다(README §6). */
export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.startsWith("#page") ? <PageDemo /> : <DesktopDemo />;
}
