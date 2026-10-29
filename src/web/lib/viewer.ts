import { create } from "zustand";
import { useDesktop } from "./desktop-store";
import { viewerKind, type FileEntry, type ViewerKind } from "./files";

/** 뷰어 창에 열린 문서. folder의 같은 종류 항목(siblings)으로 이전·다음을 오간다. */
export type ViewerDoc = { path: string; name: string; kind: ViewerKind; size: number | null; modified: string | null };

type State = {
  doc: ViewerDoc | null;
  siblings: ViewerDoc[];
  /** 파일 탐색기에서 두 번 누른 항목을 연다. 같은 폴더의 같은 종류 파일이 이전·다음 목록이 된다. */
  open: (entry: FileEntry, around?: FileEntry[]) => void;
  /** 이전·다음으로 옮긴다. 끝에서는 멈춘다. */
  step: (delta: number) => void;
  /** 지워졌거나 옮겨진 항목은 목록에서 뺀다. 열려 있던 문서면 닫는다. */
  forget: (paths: string[]) => void;
};

/** 다른 문서로 넘어가기 전에 물어볼 곳(고친 글을 저장하지 않은 편집기). true면 지금은 넘어가지 않고, 동의하면 proceed를 부른다. */
let leaveGuard: ((proceed: () => void) => boolean) | null = null;
export function guardLeave(guard: (proceed: () => void) => boolean) {
  leaveGuard = guard;
  return () => { if (leaveGuard === guard) leaveGuard = null; };
}
const leave = (go: () => void) => { if (!leaveGuard?.(go)) go(); };

const docOf = (entry: FileEntry, kind: ViewerKind): ViewerDoc => ({ path: entry.path, name: entry.name, kind, size: entry.size, modified: entry.modified });

export const useViewer = create<State>((set, get) => ({
  doc: null,
  siblings: [],
  open: (entry, around = []) => {
    const kind = viewerKind(entry);
    if (!kind) return;
    const siblings = around.filter((item) => viewerKind(item) === kind).map((item) => docOf(item, kind));
    const doc = siblings.find((item) => item.path === entry.path) ?? docOf(entry, kind);
    const current = get().doc;
    const go = () => { set({ doc, siblings: siblings.length ? siblings : [doc] }); useDesktop.getState().open("viewer"); };
    // 같은 문서를 다시 열면 고치던 글이 그대로 남는다. 바뀐 파일을 다시 읽을 때만 묻는다.
    if (current?.path === doc.path && current.modified === doc.modified) go(); else leave(go);
  },
  step: (delta) => {
    const { doc, siblings } = get();
    if (!doc) return;
    const at = siblings.findIndex((item) => item.path === doc.path);
    const next = siblings[at + delta];
    if (next) leave(() => set({ doc: next }));
  },
  forget: (paths) => {
    const { doc, siblings } = get();
    const gone = new Set(paths.map((path) => path.toLowerCase()));
    const kept = siblings.filter((item) => !gone.has(item.path.toLowerCase()));
    if (kept.length === siblings.length) return;
    set({ siblings: kept, doc: doc && gone.has(doc.path.toLowerCase()) ? null : doc });
  },
}));
