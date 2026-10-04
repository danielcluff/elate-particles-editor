import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Gradient } from "elate-particles";
import { Trash2 } from "lucide-static";
import { ColorPicker, Icon, NumberField } from "../../ui";
import { evalGradient, gradientCss } from "./values";

const W = 288;

type Sel = { kind: "color" | "alpha"; i: number } | null;

/**
 * Unity-style gradient editor: colour stops above the bar, alpha stops below.
 * Click beside the bar to add a stop, drag to move, select to edit.
 */
export function GradientEditor(props: { value: Gradient; onChange: (g: Gradient) => void; onCommit?: () => void; hdr?: boolean }) {
  const colors = createMemo(() => [...props.value.colors].sort((a, b) => a.t - b.t));
  const alphas = createMemo(() => [...props.value.alphas].sort((a, b) => a.t - b.t));
  const [sel, setSel] = createSignal<Sel>({ kind: "color", i: 0 });

  const emit = (patch: Partial<Gradient>) => props.onChange({ ...props.value, colors: colors(), alphas: alphas(), ...patch });
  const round = (t: number) => Math.round(Math.max(0, Math.min(1, t)) * 1000) / 1000;

  let bar!: HTMLDivElement;
  const tAt = (clientX: number) => round((clientX - bar.getBoundingClientRect().left) / bar.getBoundingClientRect().width);

  const moveStop = (kind: "color" | "alpha", i: number, t: number) => {
    if (kind === "color") {
      const list = colors().map((c) => ({ ...c }));
      list[i].t = Math.max(list[i - 1]?.t ?? 0, Math.min(list[i + 1]?.t ?? 1, t));
      emit({ colors: list });
    } else {
      const list = alphas().map((a) => ({ ...a }));
      list[i].t = Math.max(list[i - 1]?.t ?? 0, Math.min(list[i + 1]?.t ?? 1, t));
      emit({ alphas: list });
    }
  };

  const startDrag = (kind: "color" | "alpha", i: number, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSel({ kind, i });
    const move = (ev: PointerEvent) => moveStop(kind, i, tAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.onCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const add = (kind: "color" | "alpha", e: MouseEvent) => {
    const t = tAt(e.clientX);
    const s = evalGradient(props.value, t);
    if (kind === "color") {
      const list = [...colors(), { t, color: s.color }].sort((a, b) => a.t - b.t);
      emit({ colors: list });
      setSel({ kind, i: list.findIndex((c) => c.t === t) });
    } else {
      const list = [...alphas(), { t, a: Math.round(s.a * 1000) / 1000 }].sort((a, b) => a.t - b.t);
      emit({ alphas: list });
      setSel({ kind, i: list.findIndex((a) => a.t === t) });
    }
    props.onCommit?.();
  };

  const remove = () => {
    const s = sel();
    if (!s) return;
    if (s.kind === "color" && colors().length > 1) emit({ colors: colors().filter((_, j) => j !== s.i) });
    else if (s.kind === "alpha" && alphas().length > 1) emit({ alphas: alphas().filter((_, j) => j !== s.i) });
    else return;
    props.onCommit?.();
    setSel(null);
  };

  const selColor = () => {
    const s = sel();
    return s?.kind === "color" ? colors()[s.i] : undefined;
  };
  const selAlpha = () => {
    const s = sel();
    return s?.kind === "alpha" ? alphas()[s.i] : undefined;
  };

  const Marker = (p: { t: number; fill: string; kind: "color" | "alpha"; i: number }) => (
    <button
      type="button"
      aria-label={`${p.kind} stop at ${p.t}`}
      class={[
        "absolute size-3.5 -translate-x-1/2 cursor-grab rounded-[3px] border-2 shadow",
        sel()?.kind === p.kind && sel()?.i === p.i ? "border-foreground ring-2 ring-sky-400/60" : "border-white/80",
      ]}
      style={{ left: `${p.t * 100}%`, background: p.fill, top: p.kind === "color" ? "1px" : undefined, bottom: p.kind === "alpha" ? "1px" : undefined }}
      onPointerDown={(e) => startDrag(p.kind, p.i, e)}
      onClick={(e) => e.stopPropagation()}
    />
  );

  return (
    <div class="flex flex-col gap-2" style={{ width: `${W}px` }}>
      <div class="relative px-2">
        {/* colour stops */}
        <div class="relative h-4 cursor-copy" title="Click to add a colour stop" onClick={(e) => add("color", e)}>
          <For each={colors()}>{(c, i) => <Marker t={c.t} fill={c.color} kind="color" i={i()} />}</For>
        </div>
        <div ref={bar} class="checker relative h-7 overflow-hidden rounded-md border">
          <div class="absolute inset-0" style={{ background: gradientCss(props.value) }} />
        </div>
        {/* alpha stops */}
        <div class="relative h-4 cursor-copy" title="Click to add an alpha stop" onClick={(e) => add("alpha", e)}>
          <For each={alphas()}>
            {(a, i) => {
              const g = () => Math.round(a.a * 255);
              return <Marker t={a.t} fill={`rgb(${g()}, ${g()}, ${g()})`} kind="alpha" i={i()} />;
            }}
          </For>
        </div>
      </div>

      <Switch fallback={<p class="text-[10px] text-muted-foreground">Click above the bar to add a colour stop, below it for alpha.</p>}>
        <Match when={selColor()}>
          {(c) => (
            <div class="flex flex-col gap-2">
              <ColorPicker
                value={c().color}
                onChange={(hex) => {
                  const i = sel()!.i;
                  emit({ colors: colors().map((x, j) => (j === i ? { ...x, color: hex } : x)) });
                }}
                onCommit={props.onCommit}
              />
              <div class="flex items-center gap-1.5">
                <NumberField label="loc" class="flex-1" value={c().t} min={0} max={1} step={0.01} onChange={(t) => moveStop("color", sel()!.i, t)} onCommit={props.onCommit} />
                <RemoveButton disabled={colors().length <= 1} onClick={remove} />
              </div>
            </div>
          )}
        </Match>
        <Match when={selAlpha()}>
          {(a) => (
            <div class="flex items-center gap-1.5">
              <NumberField
                label="alpha"
                class="flex-1"
                value={a().a}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  const i = sel()!.i;
                  emit({ alphas: alphas().map((x, j) => (j === i ? { ...x, a: v } : x)) });
                }}
                onCommit={props.onCommit}
              />
              <NumberField label="loc" class="flex-1" value={a().t} min={0} max={1} step={0.01} onChange={(t) => moveStop("alpha", sel()!.i, t)} onCommit={props.onCommit} />
              <RemoveButton disabled={alphas().length <= 1} onClick={remove} />
            </div>
          )}
        </Match>
      </Switch>

      <Show when={props.hdr !== false}>
        <div class="flex items-center gap-2 border-t pt-2">
          <span class="text-xs text-muted-foreground">HDR intensity</span>
          <NumberField
            class="ml-auto w-24"
            value={props.value.intensity ?? 1}
            min={0}
            step={0.05}
            onChange={(v) => emit({ intensity: v })}
            onCommit={props.onCommit}
          />
        </div>
      </Show>
    </div>
  );
}

function RemoveButton(props: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove stop"
      disabled={props.disabled}
      class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
      onClick={() => props.onClick()}
    >
      <Icon svg={Trash2} class="size-3.5" />
    </button>
  );
}

/** Inline gradient preview bar. */
export function GradientBar(props: { value: Gradient; class?: JSX.ClassValue }) {
  return (
    <div class={["checker relative overflow-hidden rounded-[5px] border", props.class]}>
      <div class="absolute inset-0" style={{ background: gradientCss(props.value) }} />
    </div>
  );
}
