import { Show, createEffect, onSettled, untrack, useContext } from "solid-js";
import { EffectPreview } from "./preview";
import { PlaybackContext } from "./playback";
import { ShadersContext } from "./shaders";
import { EditorContext, previewDoc } from "./store";

/** Debounce for re-registering the effect while values are being dragged. */
const APPLY_DELAY = 30;

/**
 * The full-bleed live viewport behind the panels. `freeArea` is the element
 * marking the space between the panels; the camera centres on it.
 */
export function Viewport(props: { freeArea: () => HTMLElement | undefined }) {
  const ed = useContext(EditorContext);
  const pb = useContext(PlaybackContext);
  const shaders = useContext(ShadersContext);
  let host!: HTMLDivElement;
  let preview: EffectPreview | undefined;
  let applyTimer: number | undefined;

  const apply = () => {
    clearTimeout(applyTimer);
    if (!preview || !pb.state.ready) return;
    try {
      const doc = ed.plainDoc();
      shaders.ensure(doc);
      preview.setDoc(previewDoc(doc, ed.state.solo));
    } catch (err) {
      console.error(err);
    }
  };

  onSettled(() => {
    pb.setApply(apply);
    preview = new EffectPreview(host, { shaders: shaders.resolve });
    shaders.setOnChange((id) => preview?.refreshShader(id));
    // coming back from the shader editor: pick up edited shaders
    const onFocus = () => void shaders.checkForEdits();
    window.addEventListener("focus", onFocus);
    if (import.meta.env?.DEV) (window as unknown as { __elatePreview: unknown }).__elatePreview = preview;
    preview.ready
      .then(() => {
        pb.attach(preview!);
        preview!.applySettings(untrack(() => ({ ...ed.state.doc.preview })));
        preview!.setParams(untrack(() => ({ ...ed.state.params })));
        apply();
      })
      .catch((err) => pb.fail(err instanceof Error ? err.message : String(err)));

    // keep the camera centred between the floating panels
    const insets = () => {
      const free = props.freeArea();
      if (!free || !preview) return;
      const a = host.getBoundingClientRect();
      const b = free.getBoundingClientRect();
      preview.setInsets({ left: b.left - a.left, right: a.right - b.right, top: b.top - a.top, bottom: a.bottom - b.bottom });
    };
    const ro = new ResizeObserver(insets);
    ro.observe(host);
    const free = props.freeArea();
    if (free) ro.observe(free);
    insets();

    return () => {
      clearTimeout(applyTimer);
      window.removeEventListener("focus", onFocus);
      shaders.setOnChange(() => {});
      ro.disconnect();
      pb.detach();
      preview?.dispose();
      preview = undefined;
    };
  });

  // document edits and solo → re-register (debounced while dragging)
  createEffect(
    () => [ed.version(), ed.state.solo, pb.state.ready] as const,
    () => {
      clearTimeout(applyTimer);
      applyTimer = window.setTimeout(apply, APPLY_DELAY);
    },
  );
  createEffect(
    () => [JSON.stringify(ed.state.doc.preview ?? {}), pb.state.ready] as const,
    ([json, ready]) => {
      if (preview && ready) preview.applySettings(JSON.parse(json));
    },
  );
  createEffect(
    () => JSON.stringify(ed.state.params),
    (json) => preview?.setParams(JSON.parse(json)),
  );

  return (
    <div class="absolute inset-0">
      <div ref={host} class="absolute inset-0" />
      <Show when={!pb.state.ready && !pb.state.error}>
        <div class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Initializing WebGPU…</div>
      </Show>
      <Show when={pb.state.error}>
        <div class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-destructive">{pb.state.error}</div>
      </Show>
    </div>
  );
}

/** Particles · draws · CPU ms · fps, over the viewport. */
export function StatsOverlay() {
  const pb = useContext(PlaybackContext);
  const ed = useContext(EditorContext);
  const soloName = () => ed.state.doc.emitters.find((e) => e.id === ed.state.solo)?.name;
  return (
    <div class="pointer-events-none flex items-center gap-2 font-mono text-[10px] text-white/60 tabular-nums [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
      <span>{pb.state.particles.toLocaleString()} particles</span>
      <span class="text-white/30">·</span>
      <span>{pb.state.drawCalls} draws</span>
      <Show when={pb.state.lights}>
        <span class="text-white/30">·</span>
        <span>{pb.state.lights} lights</span>
      </Show>
      <span class="text-white/30">·</span>
      <span>{pb.state.updateMs.toFixed(2)} ms</span>
      <span class="text-white/30">·</span>
      <span>{Math.round(pb.state.fps)} fps</span>
      <Show when={pb.state.backend}>
        <span class="text-white/30">·</span>
        <span class="tracking-widest uppercase">{pb.state.backend}</span>
      </Show>
      <Show when={soloName()}>
        <span class="rounded bg-amber-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-black [text-shadow:none]">SOLO {soloName()}</span>
      </Show>
    </div>
  );
}
