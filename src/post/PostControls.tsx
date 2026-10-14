// Controls for a PostStore: on/off, tone map, exposure, bloom and grade.
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ChevronDown, ChevronRight } from "lucide-static";
import { Icon, Select, Slider, Switch } from "../ui";
import { TONE_MAPPINGS, type PostSettings, type PostStore } from "./settings";

const TONE_LABELS: Record<(typeof TONE_MAPPINGS)[number], string> = { aces: "ACES filmic", agx: "AgX", neutral: "Khronos neutral", reinhard: "Reinhard", none: "None (clipped)" };
type Grade = PostSettings["grade"];
type Bloom = PostSettings["bloom"];
const GRADE: { key: keyof Grade; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: "whiteBalance", label: "White bal.", min: 0, max: 1, step: 0.01, hint: "0 keeps the light's colour cast; 1 renders the illuminant as white" },
  { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01, hint: "Before tone mapping" },
  { key: "contrast", label: "Contrast", min: 0.5, max: 1.6, step: 0.01, hint: "Log-space, around mid grey" },
  { key: "bands", label: "Bands/stop", min: 0, max: 4, step: 0.25, hint: "Painted luminance bands per stop of exposure; 0 is off" },
  { key: "bandMix", label: "Band mix", min: 0, max: 1, step: 0.01, hint: "How much of the banded luminance shows" },
  { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01, hint: "Darkens the corners" },
];
const BLOOM: { key: Exclude<keyof Bloom, "enabled">; label: string; min: number; max: number; step: number }[] = [
  { key: "strength", label: "Strength", min: 0, max: 3, step: 0.01 },
  { key: "radius", label: "Radius", min: 0, max: 1, step: 0.01 },
  { key: "threshold", label: "Threshold", min: 0, max: 4, step: 0.01 },
];

function Row(props: { label: string; hint?: string; value: number; children: JSX.Element }) {
  return (
    <label class="flex items-center gap-2 text-[11px]" title={props.hint}>
      <span class="w-16 shrink-0 text-muted-foreground">{props.label}</span>
      <div class="flex-1">{props.children}</div>
      <span class="w-9 shrink-0 text-right font-mono tabular-nums">{props.value.toFixed(2)}</span>
    </label>
  );
}

/**
 * Post-processing controls. `collapsible` shows only the title and switch until
 * expanded (for panels floating over a viewport); otherwise everything shows.
 */
export function PostControls(props: { store: PostStore; class?: JSX.ClassValue; collapsible?: boolean; note?: string }) {
  const [open, setOpen] = createSignal(!props.collapsible);
  const s = () => props.store.settings();
  const update = (patch: (p: PostSettings) => PostSettings) => props.store.update(patch);
  const grade = (key: keyof Grade, v: number) => update((p) => ({ ...p, grade: { ...p.grade, [key]: v } }));
  const bloom = (patch: Partial<Bloom>) => update((p) => ({ ...p, bloom: { ...p.bloom, ...patch } }));
  return (
    <section aria-label="Preview post-processing" class={["text-xs", props.class]}>
      <div class="flex items-center gap-2 px-3 py-2">
        <Show when={props.collapsible} fallback={<span class="flex-1 font-semibold">Post-processing</span>}>
          <button type="button" class="flex flex-1 items-center gap-1 font-semibold" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen((v) => !v)}>
            <Icon svg={open() ? ChevronDown : ChevronRight} class="size-3.5" /> Post-processing
          </button>
        </Show>
        <Switch label="Post-processing" checked={s().enabled} onChange={(enabled) => update((p) => ({ ...p, enabled }))} />
      </div>
      <Show when={open()}>
        <div class={["space-y-2 border-t px-3 py-2", !s().enabled && "pointer-events-none opacity-50"]}>
          <label class="flex items-center gap-2 text-[11px]">
            <span class="w-16 shrink-0 text-muted-foreground">Tone map</span>
            <Select class="h-7 text-xs" value={s().toneMapping} options={TONE_MAPPINGS.map((t) => ({ value: t, label: TONE_LABELS[t] }))} onChange={(v) => update((p) => ({ ...p, toneMapping: v as PostSettings["toneMapping"] }))} />
          </label>
          <Row label="Exposure" hint="Stops, before tone mapping" value={s().exposure}>
            <Slider value={s().exposure} min={-4} max={4} step={0.05} onChange={(exposure) => update((p) => ({ ...p, exposure }))} />
          </Row>
          <div class="flex items-center justify-between pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Bloom <Switch label="Bloom" checked={s().bloom.enabled} onChange={(enabled) => bloom({ enabled })} />
          </div>
          <div class={["space-y-1.5", !s().bloom.enabled && "pointer-events-none opacity-50"]}>
            <For each={BLOOM}>
              {(b) => (
                <Row label={b.label} value={s().bloom[b.key]}>
                  <Slider value={s().bloom[b.key]} min={b.min} max={b.max} step={b.step} onChange={(v) => bloom({ [b.key]: v })} />
                </Row>
              )}
            </For>
          </div>
          <div class="pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Grade</div>
          <For each={GRADE}>
            {(g) => (
              <Row label={g.label} hint={g.hint} value={s().grade[g.key]}>
                <Slider value={s().grade[g.key]} min={g.min} max={g.max} step={g.step} onChange={(v) => grade(g.key, v)} />
              </Row>
            )}
          </For>
          <button type="button" class="w-full rounded border px-2 py-1 hover:bg-accent" onClick={() => props.store.reset()}>
            Reset to defaults
          </button>
          <Show when={props.note}>{(note) => <p class="text-[10px] text-muted-foreground">{note()}</p>}</Show>
        </div>
      </Show>
    </section>
  );
}
