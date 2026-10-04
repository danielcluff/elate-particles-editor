import { For, Match, Show, Switch as SwitchFlow, createSignal } from "solid-js";
import type { Curve, EffectParameter, Gradient, ParamDef } from "elate-particles";
import { ColorPicker, Input, NumberField, Popover, Select, Slider, Switch, togglePopover, type PopoverAnchor } from "../../ui";
import { ColorValueField } from "./ColorValueField";
import { CurveEditor, CurveSparkline } from "./CurveEditor";
import { FloatValueField } from "./FloatValueField";
import { GradientBar, GradientEditor } from "./GradientEditor";

/** A ParamDef, or the same shape for emitter / renderer fields the editor describes itself. */
export type FieldDef = Pick<ParamDef, "key" | "label" | "description" | "min" | "max" | "step" | "unit" | "options" | "showIf"> & {
  /** ParamDef types, plus "color": a plain #hex (renderer fields). */
  type: ParamDef["type"] | "color";
  default?: unknown;
  /** Placeholder for optional string fields. */
  placeholder?: string;
};

export interface FieldProps {
  def: FieldDef;
  value: unknown;
  /** A continuous edit (merged into one undo step until onCommit). */
  onChange: (v: unknown) => void;
  onCommit: () => void;
  params: EffectParameter[];
  curveAxis?: string;
}

/** Label + widget row. */
export function FieldRow(props: { label: string; title?: string; unit?: string; children: unknown; top?: boolean }) {
  return (
    <div class={["flex min-w-0 gap-2", props.top ? "items-start" : "items-center"]}>
      <label class={["w-[5.5rem] shrink-0 truncate text-[11px] text-muted-foreground", { "pt-1.5": !!props.top }]} title={props.title ?? props.label}>
        {props.label}
        <Show when={props.unit}>
          <span class="ml-0.5 text-muted-foreground/60">{props.unit}</span>
        </Show>
      </label>
      <div class="flex min-w-0 flex-1 items-center">{props.children as never}</div>
    </div>
  );
}

const VEC = ["x", "y", "z"];

/** One schema-driven field: the widget for its param type. Custom modules get a UI from their schema alone. */
export function ParamField(props: FieldProps) {
  const [pop, setPop] = createSignal<PopoverAnchor | null>(null);
  const d = () => props.def;
  const commitNow = (v: unknown) => {
    props.onChange(v);
    props.onCommit();
  };
  const tall = () => ["floatValue", "colorValue", "vec3"].includes(d().type) || (d().type === "float" && d().min !== undefined && d().max !== undefined);
  return (
    <FieldRow label={d().label} title={d().description} unit={d().unit} top={tall()}>
      <SwitchFlow fallback={<span class="text-[11px] text-muted-foreground italic">{JSON.stringify(props.value)}</span>}>
        <Match when={d().type === "floatValue"}>
          <FloatValueField
            value={(props.value ?? 0) as never}
            params={props.params}
            min={d().min}
            max={d().max}
            step={d().step}
            curveAxis={props.curveAxis}
            onChange={props.onChange}
            onCommit={props.onCommit}
          />
        </Match>
        <Match when={d().type === "colorValue"}>
          <ColorValueField value={(props.value ?? "#ffffff") as never} curveAxis={props.curveAxis} onChange={props.onChange} onCommit={props.onCommit} />
        </Match>
        <Match when={d().type === "float" || d().type === "int"}>
          <div class="flex w-full flex-col gap-1">
            <NumberField
              value={Number(props.value ?? 0)}
              integer={d().type === "int"}
              min={d().min}
              max={d().max}
              step={d().step ?? (d().type === "int" ? 1 : 0.01)}
              onChange={props.onChange}
              onCommit={props.onCommit}
            />
            <Show when={d().type === "float" && d().min !== undefined && d().max !== undefined}>
              <Slider value={Number(props.value ?? 0)} min={d().min!} max={d().max!} step={d().step} onChange={(v) => props.onChange(v)} />
            </Show>
          </div>
        </Match>
        <Match when={d().type === "bool"}>
          <Switch checked={Boolean(props.value)} label={d().label} onChange={commitNow} />
        </Match>
        <Match when={d().type === "enum"}>
          <Select class="h-7 text-xs" value={String(props.value ?? "")} options={d().options ?? []} onChange={commitNow} />
        </Match>
        <Match when={d().type === "string"}>
          <Input
            class="h-7 text-xs"
            placeholder={d().placeholder}
            value={String(props.value ?? "")}
            onInput={(e) => props.onChange(e.currentTarget.value)}
            onBlur={() => props.onCommit()}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Match>
        <Match when={d().type === "vec3"}>
          <div class="grid w-full grid-cols-3 gap-1">
            <For each={VEC}>
              {(axis, i) => (
                <NumberField
                  label={axis}
                  value={Number((props.value as number[] | undefined)?.[i()] ?? 0)}
                  step={d().step ?? 0.01}
                  onChange={(v) => {
                    const next = [...((props.value as number[]) ?? [0, 0, 0])];
                    next[i()] = v;
                    props.onChange(next);
                  }}
                  onCommit={props.onCommit}
                />
              )}
            </For>
          </div>
        </Match>
        <Match when={d().type === "color"}>
          <button
            type="button"
            aria-label="Edit colour"
            class="h-7 w-full rounded-md border border-input"
            style={{ background: String(props.value ?? "#ffffff") }}
            onClick={(e) => togglePopover(pop(), setPop, e)}
          />
          <Popover open={!!pop()} anchor={pop()?.rect} trigger={pop()?.el} side="left" onClose={() => setPop(null)} class="w-56 p-3">
            <ColorPicker value={String(props.value ?? "#ffffff")} onChange={props.onChange} onCommit={props.onCommit} />
          </Popover>
        </Match>
        <Match when={d().type === "curve"}>
          <button
            type="button"
            aria-label="Edit curve"
            class="h-7 w-full rounded-md border border-input px-1 py-0.5 hover:border-ring dark:bg-input/30"
            onClick={(e) => togglePopover(pop(), setPop, e)}
          >
            <CurveSparkline curves={[props.value as Curve]} />
          </button>
          <Popover open={!!pop()} anchor={pop()?.rect} trigger={pop()?.el} side="left" onClose={() => setPop(null)} class="p-3">
            <CurveEditor curve={props.value as Curve} onChange={props.onChange} onCommit={props.onCommit} />
          </Popover>
        </Match>
        <Match when={d().type === "gradient"}>
          <button type="button" aria-label="Edit gradient" class="h-7 w-full" onClick={(e) => togglePopover(pop(), setPop, e)}>
            <GradientBar value={props.value as Gradient} class="h-full w-full" />
          </button>
          <Popover open={!!pop()} anchor={pop()?.rect} trigger={pop()?.el} side="left" onClose={() => setPop(null)} class="p-3">
            <GradientEditor value={props.value as Gradient} onChange={props.onChange} onCommit={props.onCommit} />
          </Popover>
        </Match>
      </SwitchFlow>
    </FieldRow>
  );
}

/** Should this field show, given its `showIf` and the other values? */
export function fieldVisible(def: FieldDef, get: (key: string) => unknown): boolean {
  return !def.showIf || def.showIf.values.includes(get(def.showIf.key));
}
