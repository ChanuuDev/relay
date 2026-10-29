import type { ReactNode } from "react";
import { AlertDialog } from "radix-ui";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";

/** 되돌릴 수 없는 일을 하기 전에 묻는 유리 경고창. 처음 초점은 `취소`에 가고, Esc·바깥 클릭은 취소다.
 *  onClose는 어느 쪽으로 닫히든 불리고, 확인이면 그 앞에 onConfirm이 불린다.
 *  닫힌 뒤 초점을 어디로 돌릴지는 onCloseFocus가 정한다(지운 행은 사라지므로 부른 쪽이 고른다). */
export function ConfirmDialog({ open, title, description, confirmLabel, confirmDisabled, icon, onConfirm, onClose, onCloseFocus }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string; confirmDisabled?: boolean; icon?: ReactNode;
  onConfirm: () => void; onClose: () => void; onCloseFocus: () => void;
}) {
  return <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="confirm-overlay" onPointerDown={onClose} />
      <AlertDialog.Content className="confirm-dialog material-menu" onCloseAutoFocus={(event) => { event.preventDefault(); onCloseFocus(); }}>
        <span className="confirm-icon" aria-hidden="true">{icon ?? <Trash2 />}</span>
        <AlertDialog.Title className="confirm-title">{title}</AlertDialog.Title>
        <AlertDialog.Description asChild><div className="confirm-description">{description}</div></AlertDialog.Description>
        <div className="confirm-actions">
          <AlertDialog.Cancel asChild><Button type="button" variant="outline" size="sm">취소</Button></AlertDialog.Cancel>
          <AlertDialog.Action asChild><Button type="button" variant="destructive" size="sm" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button></AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
