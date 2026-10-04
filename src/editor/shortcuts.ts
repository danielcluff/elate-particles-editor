import type { Playback } from "./playback";
import type { Editor } from "./store";

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Space", label: "Play / pause" },
  { keys: "R", label: "Restart" },
  { keys: ".", label: "Step one frame" },
  { keys: "F", label: "Frame the effect" },
  { keys: "⌘Z", label: "Undo" },
  { keys: "⇧⌘Z / ⌘Y", label: "Redo" },
  { keys: "⌘S", label: "Save now" },
  { keys: "Drag a value's label", label: "Scrub it (Shift: ×10)" },
  { keys: "Double-click a curve", label: "Add a key" },
];

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function installShortcuts(ed: Editor, pb: Playback): () => void {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (typing(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) ed.redo();
      else ed.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      if (typing(e.target)) return;
      e.preventDefault();
      ed.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void ed.save();
      return;
    }
    if (mod || e.altKey || typing(e.target)) return;
    // keys only when nothing focusable is handling them (menus, curve editor)
    if ((e.target as HTMLElement | null)?.closest?.("[role=menu], svg[tabindex]")) return;
    if (e.key === " ") {
      e.preventDefault();
      pb.toggle();
    } else if (e.key === "r" || e.key === "R") pb.restart();
    else if (e.key === ".") pb.step();
    else if (e.key === "f" || e.key === "F") pb.frame();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
