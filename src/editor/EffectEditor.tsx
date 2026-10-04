import { Show, createRenderEffect, createSignal, onSettled, snapshot, untrack, useContext } from "solid-js";
import { normalizeEffect, type EffectDoc } from "elate-particles";
import type { EffectHost } from "../host";
import { rootClass, setTheme, type Theme } from "../ui/theme";
import { AIChat } from "./AIChat";
import { ChatContext, createChat } from "./ai-chat";
import { connectBridge } from "./bridge-client";
import { Dialogs, Toasts } from "./Dialogs";
import { EmitterList } from "./EmitterList";
import { HostContext } from "./host";
import { PlaybackContext, createPlayback } from "./playback";
import { installShortcuts } from "./shortcuts";
import { ShadersContext, createShaders } from "./shaders";
import { StackPanel } from "./Stack";
import { EditorContext, createEditor } from "./store";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { ui } from "./ui-state";
import { StatsOverlay, Viewport } from "./Viewport";

export interface EffectEditorProps {
  host: EffectHost;
  /** Effect to load through `host.projects.load`. Changes are saved back through `host.projects.save`. */
  projectId?: string;
  /** Or: an in-memory document that is edited but never saved (demos). */
  doc?: EffectDoc;
  theme?: Theme;
}

/**
 * The full effect editor. It fills its nearest positioned ancestor, so give
 * the container a size (and `position: relative`).
 */
export function EffectEditor(props: EffectEditorProps) {
  const [doc, setDoc] = createSignal<EffectDoc | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createRenderEffect(
    () => props.theme ?? "dark",
    (t) => void setTheme(t),
  );

  onSettled(() => {
    const given = untrack(() => props.doc);
    if (given) return void setDoc(normalizeEffect(structuredClone(given)));
    const id = untrack(() => props.projectId);
    if (!id) return void setError("No effect given");
    untrack(() => props.host)
      .projects.load(id)
      .then((d) => setDoc(normalizeEffect(d)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  });

  return (
    <HostContext value={untrack(() => props.host)}>
      <div class={`${rootClass()} absolute inset-0 overflow-hidden bg-background text-foreground`}>
        <Show
          when={doc()}
          keyed
          fallback={
            <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
              {error() ? <div class="text-destructive">{error()}</div> : "Loading effect…"}
            </div>
          }
        >
          {(d) => <EditorShell doc={d} persist={!untrack(() => props.doc)} />}
        </Show>
      </div>
    </HostContext>
  );
}

function EditorShell(props: { doc: EffectDoc; persist: boolean }) {
  const host = useContext(HostContext);
  const ed = createEditor(untrack(() => props.doc), { save: untrack(() => props.persist) ? (doc) => host.projects.save(doc) : undefined });
  const pb = createPlayback();
  const chat = createChat(ed, host);
  const shaders = createShaders(host);
  void shaders.refreshList();
  let freeArea: HTMLDivElement | undefined;
  if (import.meta.env?.DEV) (window as unknown as { __elate: unknown }).__elate = { ed, pb, ui, chat };

  onSettled(() => {
    const offKeys = installShortcuts(ed, pb, () =>
      chat.setState((d) => {
        d.open = !(d.open && !d.minimized);
        d.minimized = false;
      }),
    );
    const offBridge = untrack(() => props.persist) ? connectBridge(ed, pb, host) : () => {};
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (ed.state.saveState === "unsaved" || ed.state.saveState === "saving") {
        void ed.save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);

    // thumbnails for the host's effect list: at most every 10 s, only after edits
    let thumbVersion = -1;
    const thumbTimer = window.setInterval(async () => {
      if (!ed.persist || !pb.preview || !pb.state.ready) return;
      const v = ed.version();
      if (v === thumbVersion) return;
      thumbVersion = v;
      try {
        ed.setThumbnail(await pb.preview.capture());
      } catch {
        // ignore (e.g. lost device)
      }
    }, 10000);

    return () => {
      offKeys();
      offBridge();
      clearInterval(thumbTimer);
      window.removeEventListener("beforeunload", beforeUnload);
      // disposal runs inside an owned scope: no reactive writes here
      setTimeout(() => void ed.save());
    };
  });

  const saveJson = () => {
    const blob = new Blob([JSON.stringify(snapshot(ed.state.doc), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ed.state.doc.name.replace(/[^\w-]+/g, "_") || "effect"}.fx.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const loadJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const next = normalizeEffect(JSON.parse(await file.text()));
        ed.replaceDoc(next);
        ui.toast(`Loaded "${next.name}"`, "success");
      } catch (err) {
        ui.toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    input.click();
  };

  return (
    <EditorContext value={ed}>
      <PlaybackContext value={pb}>
      <ChatContext value={chat}>
      <ShadersContext value={shaders}>
        {/* like tsl-graph: the viewport fills the window and the panels float over it */}
        <div class="absolute inset-0 overflow-hidden">
          <Viewport freeArea={() => freeArea} />
          <div class="pointer-events-none absolute inset-4 flex gap-2">
            <div class="relative h-full shrink-0 *:pointer-events-auto">
              <EmitterList />
            </div>
            <div class="relative flex min-w-0 flex-1 flex-col gap-2">
              <div class="pointer-events-auto">
                <TopBar onSaveJson={saveJson} onLoadJson={loadJson} />
              </div>
              {/* the free area between the panels: the camera centres on it */}
              <div ref={freeArea} class="relative min-h-0 flex-1">
                <AIChat />
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="px-1">
                  <StatsOverlay />
                </div>
                <Timeline />
              </div>
            </div>
            <div class="pointer-events-auto flex w-80 shrink-0 flex-col">
              <StackPanel />
            </div>
          </div>
        </div>
        <Dialogs />
        <Toasts />
      </ShadersContext>
      </ChatContext>
      </PlaybackContext>
    </EditorContext>
  );
}
