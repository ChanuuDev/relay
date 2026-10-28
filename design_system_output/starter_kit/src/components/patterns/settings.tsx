import type { ReactNode } from "react";

/** 설정 그룹 카드: 반투명 바탕(배경 82%) · 10px 모서리 · 11px/600 자간 .06em 제목 */
export function SettingsGroup({ title, id, children, note }: { title: string; id?: string; children: ReactNode; note?: ReactNode }) {
  return <section className="settings-group" id={id}>
    <h3>{title}</h3>{children}{note ? <p className="settings-note">{note}</p> : null}
  </section>;
}

/** 설정 행: 120px 라벨 열 + 값. htmlFor를 주면 라벨이 컨트롤과 연결된다. */
export function SettingsRow({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return <div className="settings-row">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}<div>{children}</div></div>;
}
