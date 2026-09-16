import { ListFilter, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { navigate, useUI } from "../lib/store";

export function Filters() {
  const draft = useUI((state) => state.draft);
  const setDraft = useUI((state) => state.setDraft);
  const advanced = useUI((state) => state.advanced);
  const setAdvanced = useUI((state) => state.setAdvanced);
  return <form className="filters" onSubmit={(event) => {
    event.preventDefault(); const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) if (value.trim()) next.set(key, value.trim());
    navigate(`/?${next}`);
  }}><FieldGroup className="filter-main"><Field className="search-field"><FieldLabel htmlFor="search" className="sr-only">검색</FieldLabel><InputGroup><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput id="search" value={draft.q} onChange={(event) => setDraft({ q: event.target.value })} placeholder="세션 이름, 요약, ID로 검색" maxLength={4000} aria-keyshortcuts="/" /><InputGroupAddon align="inline-end"><kbd className="search-shortcut" aria-hidden="true">/</kbd></InputGroupAddon></InputGroup></Field>
      <Field className="provider-field"><FieldLabel htmlFor="provider" className="sr-only">Provider</FieldLabel><Input id="provider" list="providers" value={draft.provider} onChange={(event) => setDraft({ provider: event.target.value })} placeholder="모든 Provider" maxLength={64} /><datalist id="providers"><option value="openai" /><option value="anthropic" /><option value="xai" /></datalist></Field>
      <Button type="button" variant={advanced ? "secondary" : "outline"} aria-expanded={advanced} aria-controls="advanced-filters" onClick={() => setAdvanced(!advanced)}><ListFilter data-icon="inline-start" />상세 필터{(draft.agent || draft.cwd) && <span className="filter-indicator" />}</Button>
      <Button type="submit"><Search data-icon="inline-start" />검색</Button>
    </FieldGroup>
    {advanced && <FieldGroup id="advanced-filters" className="advanced-filters"><Field><FieldLabel htmlFor="agent">Agent</FieldLabel><Input id="agent" placeholder="전체 · codex, claude-code 등" value={draft.agent} maxLength={64} onChange={(event) => setDraft({ agent: event.target.value })} /></Field><Field className="path-filter"><FieldLabel htmlFor="cwd">프로젝트 경로</FieldLabel><Input id="cwd" placeholder="프로젝트의 전체 절대경로" value={draft.cwd} onChange={(event) => setDraft({ cwd: event.target.value })} /></Field><Field><FieldLabel htmlFor="limit">표시 개수</FieldLabel><NativeSelect id="limit" value={draft.limit} onChange={(event) => setDraft({ limit: event.target.value })}>{[20, 50, 100].map((limit) => <NativeSelectOption key={limit} value={limit}>{limit}개</NativeSelectOption>)}</NativeSelect></Field><Button variant="ghost" type="button" onClick={() => navigate("/")}>초기화</Button></FieldGroup>}
  </form>;
}
