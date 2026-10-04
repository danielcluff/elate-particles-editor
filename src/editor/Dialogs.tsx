import { For, Show, createSignal, snapshot, useContext } from "solid-js";
import { Check, Copy } from "lucide-static";
import { Button, Dialog, Icon, Kbd, ThemedPortal } from "../ui";
import { HostContext, effectMcpUrl } from "./host";
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
      <McpDialog />
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

function McpDialog() {
  const host = useContext(HostContext);
  const url = effectMcpUrl(host) ?? "";
  const json = JSON.stringify({ mcpServers: { "elate-particles": { type: "http", url } } }, null, 2);
  return (
    <Dialog
      open={ui.dialog() === "mcp"}
      onClose={ui.closeDialog}
      title="Connect an agent (MCP)"
      description="Agents act on the effect open in your editor tab: edits show up live, with undo, and they can take screenshots of the preview."
      class="max-w-xl"
    >
      <div class="space-y-4 text-sm">
        <div>
          <div class="mb-1.5 font-medium">Claude Code</div>
          <CopyBlock text={`claude mcp add --transport http elate-particles ${url}`} />
        </div>
        <div>
          <div class="mb-1.5 font-medium">Any MCP client (HTTP)</div>
          <CopyBlock text={json} />
        </div>
        <div>
          <div class="mb-1.5 font-medium">stdio-only clients</div>
          <CopyBlock text={`ELATE_MCP_URL=${url} npx elate-particles-mcp`} />
          <p class="mt-1.5 text-xs text-muted-foreground">Proxies stdio to this server; keep it running.</p>
        </div>
      </div>
    </Dialog>
  );
}

function CopyBlock(props: { text: string }) {
  const [copied, setCopied] = createSignal(false);
  return (
    <div class="flex items-start gap-1 rounded-md border bg-muted/50">
      <pre class="thin-scroll min-w-0 flex-1 overflow-x-auto p-3 font-mono text-xs whitespace-pre select-text">{props.text}</pre>
      <button
        type="button"
        aria-label="Copy"
        class="mt-2 mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() =>
          void navigator.clipboard.writeText(props.text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        <Icon svg={copied() ? Check : Copy} class="size-3.5" />
      </button>
    </div>
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
