import { For, Show, useContext } from "solid-js";
import { snapshot } from "solid-js";
import { Button, Dialog, Kbd, ThemedPortal } from "../ui";
import { SHORTCUTS } from "./shortcuts";
import { EditorContext } from "./store";
import { ui } from "./ui-state";

export function Dialogs() {
  const ed = useContext(EditorContext);
  const json = () => JSON.stringify(snapshot(ed.state.doc), null, 2);
  return (
    <>
      <Dialog open={ui.dialog() === "json"} onClose={ui.closeDialog} title="Effect JSON" description="The document the runtime loads (*.fx.json)." class="max-w-2xl">
        <pre class="thin-scroll max-h-[60vh] overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed select-text">{json()}</pre>
        <div class="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(json()).then(() => ui.toast("Copied", "success"))}
          >
            Copy
          </Button>
        </div>
      </Dialog>
      <Dialog open={ui.dialog() === "shortcuts"} onClose={ui.closeDialog} title="Keyboard shortcuts">
        <div class="flex flex-col gap-2">
          <For each={SHORTCUTS}>
            {(s) => (
              <div class="flex items-center justify-between gap-4 text-sm">
                <span>{s.label}</span>
                <Kbd>{s.keys}</Kbd>
              </div>
            )}
          </For>
        </div>
      </Dialog>
    </>
  );
}

export function Toasts() {
  return (
    <ThemedPortal>
      <div class="pointer-events-none fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
        <For each={ui.toasts()}>
          {(t) => (
            <div
              class={[
                "pointer-events-auto max-w-md rounded-md border px-3 py-2 text-xs shadow-lg",
                t.kind === "error"
                  ? "border-red-500/40 bg-red-950/90 text-red-100"
                  : t.kind === "success"
                    ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                    : "bg-popover text-popover-foreground",
              ]}
            >
              <Show when={t.message}>{t.message}</Show>
            </div>
          )}
        </For>
      </div>
    </ThemedPortal>
  );
}
