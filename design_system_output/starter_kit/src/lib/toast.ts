import { create } from "zustand";

export type ToastTone = "success" | "info" | "error";
type Toast = { id: number; text: string; tone: ToastTone };

/** 화면 아래 가운데 유리 알약 토스트 하나. 새 알림이 오면 바꿔 끼운다. 3초 뒤 사라진다(components/patterns/toaster.tsx). */
export const useToast = create<{ toast: Toast | null; show: (text: string, tone?: ToastTone) => void; clear: (id: number) => void }>((set) => ({
  toast: null,
  show: (text, tone = "success") => set({ toast: { id: Date.now(), text, tone } }),
  clear: (id) => set((state) => (state.toast?.id === id ? { toast: null } : state)),
}));

export const toast = (text: string, tone?: ToastTone) => useToast.getState().show(text, tone);

/** 클립보드 복사 + 결과 토스트. */
export async function copyText(text: string, label = "복사했습니다") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("복사할 수 없습니다. 브라우저 권한을 확인하세요.", "error"); }
}
