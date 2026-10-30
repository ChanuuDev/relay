import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { FileEntry } from "../../lib/files";

export type RenameEntry = Pick<FileEntry, "path" | "name" | "kind">;

/**
 * 이름 자리에 뜨는 이름 바꾸기 입력. Enter면 바꾸고 Esc면 그만두며, 다른 곳을 누르면 그대로 바꾼다. 파일은 확장자 앞까지만 골라 둔다.
 * 한글을 조합하는 중의 Enter는 조합을 끝낼 뿐이다. 입력 안의 키·클릭은 목록으로 올려 보내지 않는다(Backspace가 상위 폴더로, 글자가 이름 찾기로 가지 않게).
 */
export function RenameField({ entry, onDone }: { entry: RenameEntry; onDone: (name: string | null, focus: boolean) => Promise<boolean> }) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [value, setValue] = useState(entry.name);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function finish(name: string | null, focus: boolean) {
    if (settled.current) return;
    settled.current = true;
    if (await onDone(name, focus)) return;
    settled.current = false;
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return <input ref={ref} className="files-rename" value={value} aria-label={`‘${entry.name}’의 새 이름`} spellCheck={false} autoComplete="off" maxLength={255}
    onChange={(event) => setValue(event.target.value)} onBlur={() => void finish(value, false)}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); void finish(value, true); }
      else if (event.key === "Escape") { event.preventDefault(); void finish(null, true); }
    }}
    onMouseDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop} />;
}

