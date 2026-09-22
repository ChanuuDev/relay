import { useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { ListFilter, Search, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { collapseHeight, expandHeight, popIn } from "../lib/motion";
import { navigate, useUI } from "../lib/store";

/** 창 상단바의 툴바 컨트롤과 상세 필터 행을 하나의 폼으로 묶는다(Enter 제출). */
export function SessionFiltersForm({ children }: { children: ReactNode }) {
  const draft = useUI((state) => state.draft);
  const setDraft = useUI((state) => state.setDraft);
  const advanced = useUI((state) => state.advanced);
  const [mounted, setMounted] = useState(advanced);
  const rowRef = useRef<HTMLDivElement>(null);
  const was = useRef({ advanced, mounted });

  // F1 상세 필터 행: 펼침은 height 0→auto, 접힘은 트윈이 끝난 뒤 언마운트.
  useGSAP(() => {
    const previous = was.current.advanced;
    was.current.advanced = advanced;
    if (previous === advanced) return;
    if (advanced) { mounted ? expandHeight(rowRef.current) : setMounted(true); return; }
    void collapseHeight(rowRef.current).then(() => { if (!useUI.getState().advanced) setMounted(false); });
  }, { dependencies: [advanced] });
  useGSAP(() => {
    const previous = was.current.mounted;
    was.current.mounted = mounted;
    if (mounted && !previous) expandHeight(rowRef.current);
  }, { dependencies: [mounted] });

  return <form className="sessions-header" onSubmit={(event) => {
    event.preventDefault(); const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) if (value.trim()) next.set(key, value.trim());
    navigate(`/?${next}`);
  }}>
    {children}
    {mounted && <FieldGroup id="advanced-filters" className="advanced-filters material-chrome" ref={rowRef}>
      <Field><FieldLabel htmlFor="agent">Agent</FieldLabel><Input id="agent" placeholder="전체 · codex, claude-code 등" value={draft.agent} maxLength={64} onChange={(event) => setDraft({ agent: event.target.value })} /></Field>
      <Field className="path-filter"><FieldLabel htmlFor="cwd">프로젝트 경로</FieldLabel><Input id="cwd" placeholder="프로젝트의 전체 절대경로" value={draft.cwd} onChange={(event) => setDraft({ cwd: event.target.value })} /></Field>
      <Field className="limit-filter"><FieldLabel htmlFor="limit">표시 개수</FieldLabel><NativeSelect id="limit" size="sm" value={draft.limit} onChange={(event) => setDraft({ limit: event.target.value })}>{[20, 50, 100].map((limit) => <NativeSelectOption key={limit} value={limit}>{limit}개</NativeSelectOption>)}</NativeSelect></Field>
      <Button variant="ghost" size="sm" type="button" onClick={() => navigate("/")}>초기화</Button>
    </FieldGroup>}
  </form>;
}

export function FilterControls() {
  const draft = useUI((state) => state.draft);
  const setDraft = useUI((state) => state.setDraft);
  const advanced = useUI((state) => state.advanced);
  const setAdvanced = useUI((state) => state.setAdvanced);
  return <>
    <Field className="search-field"><FieldLabel htmlFor="search" className="sr-only">검색</FieldLabel>
      <InputGroup><InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput id="search" value={draft.q} onChange={(event) => setDraft({ q: event.target.value })} placeholder="세션 이름, 요약, ID로 검색" maxLength={4000} aria-keyshortcuts="/" />
        <InputGroupAddon align="inline-end"><kbd className="search-shortcut" aria-hidden="true">/</kbd></InputGroupAddon></InputGroup></Field>
    <Field className="provider-field"><FieldLabel htmlFor="provider" className="sr-only">Provider</FieldLabel>
      <Input id="provider" list="providers" value={draft.provider} onChange={(event) => setDraft({ provider: event.target.value })} placeholder="모든 Provider" maxLength={64} />
      <datalist id="providers"><option value="openai" /><option value="anthropic" /><option value="xai" /></datalist></Field>
    <Button type="button" size="sm" variant={advanced ? "secondary" : "outline"} aria-expanded={advanced} aria-controls="advanced-filters" onClick={() => setAdvanced(!advanced)}>
      <ListFilter data-icon="inline-start" />상세 필터{(draft.agent || draft.cwd) && <span className="filter-indicator" />}</Button>
    <Button type="submit" size="sm"><Search data-icon="inline-start" />검색</Button>
  </>;
}

export function FilterChips({ params, activeFilters }: { params: URLSearchParams; activeFilters: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<string[]>(activeFilters);

  // F2 새로 붙은 칩만 튀어 들어온다(제거는 즉시).
  useGSAP(() => {
    const previous = seen.current;
    seen.current = activeFilters;
    for (const key of activeFilters) if (!previous.includes(key)) popIn(ref.current?.querySelector(`[data-chip="${key}"]`));
  }, { dependencies: [activeFilters.join("\u0000")] });

  if (!activeFilters.length) return null;
  return <div className="filter-chips material-chrome" role="group" aria-label="적용된 필터" ref={ref}>
    {activeFilters.map((key) => <Badge variant="secondary" key={key} data-chip={key}>{params.get(key)}
      <button type="button" aria-label={`${key} 필터 해제`} onClick={() => {
        const next = new URLSearchParams(params); next.delete(key); next.delete("offset"); navigate(`/?${next}`);
      }}><X /></button></Badge>)}
    <Button type="button" variant="ghost" size="xs" onClick={() => navigate("/")}>전체 초기화</Button>
  </div>;
}
