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

const docOf = (entry: FileEntry, kind: ViewerKind): ViewerDoc => ({ path: entry.path, name: entry.name, kind, size: entry.size, modified: entry.modified });

export const useViewer = create<State>((set, get) => ({
  doc: null,
  siblings: [],
  open: (entry, around = []) => {
    const kind = viewerKind(entry);
    if (!kind) return;
    const siblings = around.filter((item) => viewerKind(item) === kind).map((item) => docOf(item, kind));
    const doc = siblings.find((item) => item.path === entry.path) ?? docOf(entry, kind);
    set({ doc, siblings: siblings.length ? siblings : [doc] });
    useDesktop.getState().open("viewer");
  },
  step: (delta) => {
    const { doc, siblings } = get();
    if (!doc) return;
    const at = siblings.findIndex((item) => item.path === doc.path);
    const next = siblings[at + delta];
    if (next) set({ doc: next });
  },
  forget: (paths) => {
    const { doc, siblings } = get();
    const gone = new Set(paths.map((path) => path.toLowerCase()));
    const kept = siblings.filter((item) => !gone.has(item.path.toLowerCase()));
    if (kept.length === siblings.length) return;
    set({ siblings: kept, doc: doc && gone.has(doc.path.toLowerCase()) ? null : doc });
  },
}));
