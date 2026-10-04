import { For, Match, Show, Switch, createSignal } from "solid-js";
import type { Curve, EffectParameter, FloatValue } from "elate-particles";
import { ArrowLeftRight, Check, Minus, Spline, Variable, Waves } from "lucide-static";
import { Icon, NumberField, Popover, Select, Tabs, togglePopover, type PopoverAnchor } from "../../ui";
import { CurveEditor, CurveSparkline } from "./CurveEditor";
import { FLOAT_MODES, convertFloat, floatMode, type FloatMode } from "./values";

const MODE_ICONS: Record<FloatMode, string> = {
  constant: Minus,
  range: ArrowLeftRight,
  curve: Spline,
  rangeCurve: Waves,
  param: Variable,
};

/** Small button that switches a value between its modes. */
export function ModeButton<M extends string>(props: {
  mode: M;
  modes: { value: M; label: string; disabled?: boolean }[];
  icons: Record<M, string>;
  onSelect: (m: M) => void;
}) {
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  return (
    <>
      <button
        type="button"
        title={`Mode: ${props.modes.find((m) => m.value === props.mode)?.label ?? props.mode}`}
        aria-label="Change value mode"
        class={[
          "flex h-7 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          { "bg-accent text-foreground": !!menu() },
        ]}
        onClick={(e) => togglePopover(menu(), setMenu, e)}
      >
        <Icon svg={props.icons[props.mode]} class="size-3" />
      </button>
      <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} onClose={() => setMenu(null)} class="w-52">
        <For each={props.modes}>
          {(m) => (
            <button
              type="button"
              disabled={m.disabled}
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent disabled:opacity-40"
              onClick={() => {
                setMenu(null);
                if (m.value !== props.mode) props.onSelect(m.value);
              }}
            >
              <Icon svg={props.icons[m.value]} class="size-3.5 text-muted-foreground" />
              <span class="flex-1">{m.label}</span>
              <Show when={m.value === props.mode}>
                <Icon svg={Check} class="size-3.5" />
              </Show>
            </button>
          )}
        </For>
      </Popover>
    </>
  );
}

/**
 * FloatValue: constant · random between · curve · random between curves ·
 * parameter. Curves are sampled over the emitter cycle for spawn/init modules
 * and over particle life for update/render modules (`curveAxis` says which).
 */
export function FloatValueField(props: {
  value: FloatValue;
  onChange: (v: FloatValue) => void;
  onCommit?: () => void;
  params: EffectParameter[];
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Label for the curve's t axis ("emitter cycle" / "particle life"). */
  curveAxis?: string;
}) {
  const [pop, setPop] = createSignal<PopoverAnchor | null>(null);
  const [curveTab, setCurveTab] = createSignal<"min" | "max">("max");
  const mode = () => floatMode(props.value);
  const obj = () => props.value as Exclude<FloatValue, number>;
  const step = () => props.step ?? (props.integer ? 1 : 0.01);
  const set = (patch: Record<string, unknown>) => props.onChange({ ...obj(), ...patch } as FloatValue);

  return (
    <div class="flex min-w-0 flex-1 items-start gap-1">
      <ModeButton
        mode={mode()}
        modes={FLOAT_MODES.map((m) => ({ ...m, disabled: m.value === "param" && !props.params.length }))}
        icons={MODE_ICONS}
        onSelect={(m) => {
          props.onChange(convertFloat(props.value, m, props.params));
          props.onCommit?.();
        }}
      />
      <div class="min-w-0 flex-1">
        <Switch>
          <Match when={mode() === "constant"}>
            <NumberField
              value={props.value as number}
              min={props.min}
              max={props.max}
              step={step()}
              integer={props.integer}
              onChange={(v) => props.onChange(v)}
              onCommit={props.onCommit}
            />
          </Match>
          <Match when={mode() === "range"}>
            <div class="grid grid-cols-2 gap-1">
              <NumberField label="min" value={(obj() as { min: number }).min} min={props.min} max={props.max} step={step()} onChange={(v) => set({ min: v })} onCommit={props.onCommit} />
              <NumberField label="max" value={(obj() as { max: number }).max} min={props.min} max={props.max} step={step()} onChange={(v) => set({ max: v })} onCommit={props.onCommit} />
            </div>
          </Match>
          <Match when={mode() === "curve" || mode() === "rangeCurve"}>
            <div class="flex items-center gap-1">
              <button
                type="button"
                aria-label="Edit curve"
                class={["h-7 min-w-0 flex-1 rounded-md border border-input px-1 py-0.5 hover:border-ring dark:bg-input/30", { "border-ring": !!pop() }]}
                onClick={(e) => togglePopover(pop(), setPop, e)}
              >
                <CurveSparkline
                  curves={mode() === "curve" ? [(obj() as { curve: Curve }).curve] : [(obj() as { min: Curve }).min, (obj() as { max: Curve }).max]}
                />
              </button>
              <NumberField
                label="×"
                class="w-[4.5rem] shrink-0"
                value={(obj() as { scale?: number }).scale ?? 1}
                step={0.01}
                onChange={(v) => set({ scale: v })}
                onCommit={props.onCommit}
              />
            </div>
            <Popover open={!!pop()} anchor={pop()?.rect} trigger={pop()?.el} side="left" align="start" onClose={() => setPop(null)} class="p-3">
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium">{mode() === "curve" ? "Curve" : "Random between curves"}</span>
                  <Show when={props.curveAxis}>
                    <span class="text-[10px] text-muted-foreground">t = {props.curveAxis}</span>
                  </Show>
                </div>
                <Show when={mode() === "rangeCurve"}>
                  <Tabs
                    class="w-full"
                    value={curveTab()}
                    onChange={setCurveTab}
                    tabs={[
                      { value: "min", label: "Lower" },
                      { value: "max", label: "Upper" },
                    ]}
                  />
                </Show>
                <Show
                  when={mode() === "curve"}
                  fallback={
                    <CurveEditor
                      curve={(obj() as unknown as Record<string, Curve>)[curveTab()]}
                      ghost={(obj() as unknown as Record<string, Curve>)[curveTab() === "min" ? "max" : "min"]}
                      color={curveTab() === "min" ? "var(--color-amber-400)" : undefined}
                      onChange={(c) => set({ [curveTab()]: c })}
                      onCommit={props.onCommit}
                    />
                  }
                >
                  <CurveEditor curve={(obj() as { curve: Curve }).curve} onChange={(c) => set({ curve: c })} onCommit={props.onCommit} />
                </Show>
              </div>
            </Popover>
          </Match>
          <Match when={mode() === "param"}>
            <div class="flex flex-col gap-1">
              <Select
                class="h-7 text-xs"
                value={(obj() as { name: string }).name}
                options={props.params.map((p) => ({ label: p.name, value: p.name }))}
                onChange={(name) => {
                  set({ name });
                  props.onCommit?.();
                }}
              />
              <div class="grid grid-cols-2 gap-1">
                <NumberField label="×" value={(obj() as { scale?: number }).scale ?? 1} step={0.01} onChange={(v) => set({ scale: v })} onCommit={props.onCommit} />
                <NumberField label="+" value={(obj() as { offset?: number }).offset ?? 0} step={0.01} onChange={(v) => set({ offset: v })} onCommit={props.onCommit} />
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
