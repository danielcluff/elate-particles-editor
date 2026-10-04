import { createSignal } from "solid-js";

// Transient editor UI state shared between panels and dialogs.

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
}

export type DialogName = "json" | "shortcuts" | null;

const [toasts, setToasts] = createSignal<Toast[]>([]);
const [dialog, setDialog] = createSignal<DialogName>(null);
let toastId = 0;

export const ui = {
  toasts,
  toast: (message: string, kind: Toast["kind"] = "info") => {
    const t = { id: ++toastId, message, kind };
    setToasts((l) => [...l, t]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== t.id)), 3500);
  },
  dialog,
  openDialog: (d: DialogName) => setDialog(d),
  closeDialog: () => setDialog(null),
};
