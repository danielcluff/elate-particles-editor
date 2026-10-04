import { For, Show, createMemo, createSignal } from "solid-js";
import type { Curve, CurveInterp, CurveKey } from "elate-particles";
import { Trash2 } from "lucide-static";
import { Icon, NumberField, Select } from "../../ui";
import { CURVE_PRESETS, sampleCurve, sortedKeys } from "./values";

const W = 288;
const H = 150;
const PAD = { l: 26, r: 8, t: 8, b: 16 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const INTERPS: { label: string; value: CurveInterp }[] = [
  { label: "Smooth", value: "smooth" },
  { label: "Linear", value: "linear" },
  { label: "Step", value: "step" },
];

function niceRange(values: number[]): [number, number] {
  let lo = Math.min(0, ...values);
  let hi = Math.max(1, ...values);
  if (hi - lo < 1e-6) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  return [lo - (lo < 0 ? pad : 0), hi + pad];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Curve editor: drag keys, double-click to add, right-click (or Delete) to
 * remove. t runs 0..1 (emitter cycle or particle life, depending on use).
 */
export function CurveEditor(props: {
  curve: Curve;
  onChange: (c: Curve) => void;
  onCommit?: () => void;
  /** Drawn faintly behind (the other curve of a "random between curves"). */
  ghost?: Curve;
  /** Colour of the curve line. */
  color?: string;
}) {
  const keys = createMemo(() => sortedKeys(props.curve));
  const [selected, setSelected] = createSignal<number | null>(null);
  // the value axis is frozen while dragging so the curve doesn't rescale under the pointer
  const [frozen, setFrozen] = createSignal<[number, number] | null>(null);
  const range = createMemo(() => frozen() ?? niceRange([...keys().map((k) => k.v), ...(props.ghost?.keys.map((k) => k.v) ?? [])]));

  const x = (t: number) => PAD.l + t * IW;
  const y = (v: number) => {
    const [lo, hi] = range();
    return PAD.t + (1 - (v - lo) / (hi - lo)) * IH;
  };
  const path = (c: Curve) => {
    const s = sampleCurve(c, 96);
    return s.map((v, i) => `${i ? "L" : "M"}${x(i / (s.length - 1)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  };

  const emit = (next: CurveKey[], interp = props.curve.interp) => props.onChange({ ...props.curve, keys: next, interp });
  const setKey = (i: number, patch: Partial<CurveKey>) => {
    const ks = keys().map((k) => ({ ...k }));
    const lo = i > 0 ? ks[i - 1].t : 0;
    const hi = i < ks.length - 1 ? ks[i + 1].t : 1;
    if (patch.t !== undefined) ks[i].t = Math.max(lo, Math.min(hi, patch.t));
    if (patch.v !== undefined) ks[i].v = patch.v;
    emit(ks);
  };
  const removeKey = (i: number) => {
    if (keys().length <= 1) return;
    emit(keys().filter((_, j) => j !== i));
    props.onCommit?.();
    setSelected(null);
  };

  let svg!: SVGSVGElement;
  const toLocal = (e: PointerEvent | MouseEvent) => {
    const r = svg.getBoundingClientRect();
    const [lo, hi] = range();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left - PAD.l) / IW));
    const v = lo + (1 - (e.clientY - r.top - PAD.t) / IH) * (hi - lo);
    return { t, v };
  };

  const startDrag = (i: number, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(i);
    setFrozen(range());
    svg.focus();
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev);
      // snap to 0.01 with shift
      const snap = (n: number) => (ev.shiftKey ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
      setKey(i, { t: snap(p.t), v: snap(p.v) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setFrozen(null);
      props.onCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addAt = (e: MouseEvent) => {
    const p = toLocal(e);
    const ks = [...keys().map((k) => ({ ...k })), { t: Math.round(p.t * 1000) / 1000, v: Math.round(p.v * 1000) / 1000 }].sort((a, b) => a.t - b.t);
    emit(ks);
    props.onCommit?.();
    setSelected(ks.findIndex((k) => k.t === Math.round(p.t * 1000) / 1000));
  };

  const sel = () => {
    const i = selected();
    return i !== null && i < keys().length ? keys()[i] : undefined;
  };

  return (
    <div class="flex flex-col gap-2">
      <svg
        ref={svg}
        width={W}
        height={H}
        tabindex="0"
        class="rounded-md border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onDblClick={addAt}
        onPointerDown={() => setSelected(null)}
        onKeyDown={(e) => {
          const i = selected();
          if ((e.key === "Delete" || e.key === "Backspace") && i !== null) {
            e.preventDefault();
            e.stopPropagation();
            removeKey(i);
          }
        }}
      >
        {/* grid */}
        <For each={[0, 0.25, 0.5, 0.75, 1]}>
          {(t) => <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={PAD.t + IH} stroke="var(--curve-grid)" />}
        </For>
        <For each={[range()[0], (range()[0] + range()[1]) / 2, range()[1]]}>
          {(v) => (
            <>
              <line x1={PAD.l} x2={PAD.l + IW} y1={y(v)} y2={y(v)} stroke="var(--curve-grid)" />
              <text x={PAD.l - 4} y={y(v) + 3} text-anchor="end" class="fill-muted-foreground font-mono text-[8px]">
                {fmt(v)}
              </text>
            </>
          )}
        </For>
        <Show when={range()[0] < 0}>
          <line x1={PAD.l} x2={PAD.l + IW} y1={y(0)} y2={y(0)} stroke="var(--color-muted-foreground)" stroke-opacity="0.35" />
        </Show>
        <text x={PAD.l} y={H - 4} class="fill-muted-foreground font-mono text-[8px]">
          0
        </text>
        <text x={PAD.l + IW} y={H - 4} text-anchor="end" class="fill-muted-foreground font-mono text-[8px]">
          1
        </text>
        <Show when={props.ghost}>{(g) => <path d={path(g())} fill="none" stroke="var(--color-muted-foreground)" stroke-opacity="0.5" stroke-dasharray="3 3" />}</Show>
        <path d={path(props.curve)} fill="none" stroke={props.color ?? "var(--color-sky-400)"} stroke-width="2" />
        <For each={keys()}>
          {(k, i) => (
            <circle
              cx={x(k.t)}
              cy={y(k.v)}
              r={selected() === i() ? 5.5 : 4.5}
              class="cursor-grab"
              fill={selected() === i() ? "var(--color-foreground)" : "var(--color-background)"}
              stroke={props.color ?? "var(--color-sky-400)"}
              stroke-width="2"
              onPointerDown={(e) => startDrag(i(), e)}
              onContextMenu={(e) => {
                e.preventDefault();
                removeKey(i());
              }}
            />
          )}
        </For>
      </svg>
      <div class="flex items-center gap-1.5">
        <Show
          when={sel()}
          fallback={<span class="flex-1 text-[10px] leading-tight text-muted-foreground">Double-click to add a key · right-click removes</span>}
        >
          {(k) => (
            <>
              <NumberField label="t" class="flex-1" value={k().t} min={0} max={1} step={0.01} onChange={(t) => setKey(selected()!, { t })} onCommit={props.onCommit} />
              <NumberField label="v" class="flex-1" value={k().v} step={0.01} onChange={(v) => setKey(selected()!, { v })} onCommit={props.onCommit} />
              <button
                type="button"
                aria-label="Remove key"
                disabled={keys().length <= 1}
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
                onClick={() => removeKey(selected()!)}
              >
                <Icon svg={Trash2} class="size-3.5" />
              </button>
            </>
          )}
        </Show>
      </div>
      <div class="flex items-center gap-1.5">
        <Select
          class="h-7 flex-1 text-xs"
          value={props.curve.interp ?? "linear"}
          options={INTERPS}
          onChange={(v) => {
            emit(keys(), v as CurveInterp);
            props.onCommit?.();
          }}
        />
        <Select
          class="h-7 flex-1 text-xs"
          value=""
          options={[{ label: "Presets…", value: "" }, ...CURVE_PRESETS.map((p, i) => ({ label: p.label, value: String(i) }))]}
          onChange={(v) => {
            if (v === "") return;
            const p = CURVE_PRESETS[Number(v)].curve;
            // keep the curve's current height: presets are shapes 0..1
            const peak = Math.max(...keys().map((k) => Math.abs(k.v)), 0) || 1;
            props.onChange({ keys: p.keys.map((k) => ({ t: k.t, v: Math.round(k.v * peak * 1000) / 1000 })), interp: p.interp });
            props.onCommit?.();
          }}
        />
      </div>
    </div>
  );
}

/** Small read-only plot of one or two curves (inline in a field). */
export function CurveSparkline(props: { curves: Curve[]; class?: string; color?: string }) {
  const SW = 100;
  const SH = 24;
  const range = createMemo(() => niceRange(props.curves.flatMap((c) => c.keys.map((k) => k.v))));
  const points = (c: Curve) => {
    const [lo, hi] = range();
    const s = sampleCurve(c, 40);
    return s.map((v, i) => `${((i / (s.length - 1)) * SW).toFixed(1)},${(2 + (1 - (v - lo) / (hi - lo)) * (SH - 4)).toFixed(1)}`);
  };
  const path = (c: Curve) => "M" + points(c).join(" L");
  // the band between "random between curves"
  const band = () => "M" + [...points(props.curves[1]), ...points(props.curves[0]).reverse()].join(" L") + " Z";
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" class={["h-full w-full", props.class]}>
      <Show when={props.curves.length === 2}>
        <path d={band()} fill={props.color ?? "var(--color-sky-400)"} fill-opacity="0.18" stroke="none" />
      </Show>
      <For each={props.curves}>
        {(c) => <path d={path(c)} fill="none" stroke={props.color ?? "var(--color-sky-400)"} stroke-width="1.5" vector-effect="non-scaling-stroke" />}
      </For>
    </svg>
  );
}
