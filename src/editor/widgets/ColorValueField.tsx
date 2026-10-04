import { Match, Show, Switch, createSignal } from "solid-js";
import type { ColorValue, Gradient } from "elate-particles";
import { Blend, Dices, Palette, Rainbow } from "lucide-static";
import { ColorPicker, NumberField, Popover, Tabs, togglePopover, type PopoverAnchor } from "../../ui";
import { ModeButton } from "./FloatValueField";
import { GradientBar, GradientEditor } from "./GradientEditor";
import { COLOR_MODES, colorCss, colorMode, convertColor, type ColorMode } from "./values";

const MODE_ICONS: Record<ColorMode, string> = {
  constant: Palette,
  range: Blend,
  gradient: Rainbow,
  randomGradient: Dices,
};

type Constant = { kind: "constant"; color: string; alpha?: number; intensity?: number };
type Range = { kind: "range"; a: string; b: string; alphaA?: number; alphaB?: number; intensity?: number };

function Swatch(props: { css: string; label?: string; active?: boolean; onClick: (e: MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="Edit colour"
      class={["checker relative h-7 min-w-0 flex-1 overflow-hidden rounded-md border border-input hover:border-ring", { "border-ring": !!props.active }]}
      onClick={(e) => props.onClick(e)}
    >
      <span class="absolute inset-0" style={{ background: props.css }} />
      <Show when={props.label}>
        <span class="absolute inset-y-0 right-1 flex items-center font-mono text-[10px] text-white mix-blend-difference">{props.label}</span>
      </Show>
    </button>
  );
}

/** ColorValue: colour · random between two · gradient · random from gradient, with alpha and HDR intensity. */
export function ColorValueField(props: {
  value: ColorValue;
  onChange: (v: ColorValue) => void;
  onCommit?: () => void;
  curveAxis?: string;
}) {
  const [pop, setPop] = createSignal<PopoverAnchor | null>(null);
  const [side, setSide] = createSignal<"a" | "b">("a");
  const mode = () => colorMode(props.value);
  // the "#hex" shorthand becomes a constant object as soon as it's edited
  const constant = (): Constant => (typeof props.value === "string" ? { kind: "constant", color: props.value } : (props.value as Constant));
  const range = () => props.value as Range;
  const gradient = () => (props.value as { gradient: Gradient }).gradient;
  const open = (e: MouseEvent, s?: "a" | "b") => {
    if (s) setSide(s);
    togglePopover(pop(), setPop, e);
  };

  return (
    <div class="flex min-w-0 flex-1 items-start gap-1">
      <ModeButton
        mode={mode()}
        modes={COLOR_MODES}
        icons={MODE_ICONS}
        onSelect={(m) => {
          props.onChange(convertColor(props.value, m));
          props.onCommit?.();
        }}
      />
      <div class="flex min-w-0 flex-1 gap-1">
        <Switch>
          <Match when={mode() === "constant"}>
            <Swatch css={colorCss(props.value)} label={constant().color.toUpperCase()} active={!!pop()} onClick={(e) => open(e)} />
          </Match>
          <Match when={mode() === "range"}>
            <Swatch css={colorCss(range().a)} label="A" active={!!pop() && side() === "a"} onClick={(e) => open(e, "a")} />
            <Swatch css={colorCss(range().b)} label="B" active={!!pop() && side() === "b"} onClick={(e) => open(e, "b")} />
          </Match>
          <Match when={mode() === "gradient" || mode() === "randomGradient"}>
            <button type="button" aria-label="Edit gradient" class="h-7 min-w-0 flex-1" onClick={(e) => open(e)}>
              <GradientBar value={gradient()} class={["h-full w-full", { "border-ring": !!pop() }]} />
            </button>
          </Match>
        </Switch>
      </div>
      <Popover open={!!pop()} anchor={pop()?.rect} trigger={pop()?.el} side="left" align="start" onClose={() => setPop(null)} class="p-3">
        <Switch>
          <Match when={mode() === "constant"}>
            <div class="flex w-56 flex-col gap-2">
              <ColorPicker value={constant().color} onChange={(color) => props.onChange({ ...constant(), color })} onCommit={props.onCommit} />
              <div class="grid grid-cols-2 gap-1">
                <NumberField label="alpha" value={constant().alpha ?? 1} min={0} max={1} step={0.01} onChange={(alpha) => props.onChange({ ...constant(), alpha })} onCommit={props.onCommit} />
                <NumberField label="hdr" value={constant().intensity ?? 1} min={0} step={0.05} onChange={(intensity) => props.onChange({ ...constant(), intensity })} onCommit={props.onCommit} />
              </div>
            </div>
          </Match>
          <Match when={mode() === "range"}>
            <div class="flex w-56 flex-col gap-2">
              <Tabs
                class="w-full"
                value={side()}
                onChange={setSide}
                tabs={[
                  { value: "a", label: "Colour A" },
                  { value: "b", label: "Colour B" },
                ]}
              />
              <ColorPicker
                value={side() === "a" ? range().a : range().b}
                onChange={(hex) => props.onChange({ ...range(), [side()]: hex })}
                onCommit={props.onCommit}
              />
              <div class="grid grid-cols-2 gap-1">
                <NumberField
                  label="alpha"
                  value={(side() === "a" ? range().alphaA : range().alphaB) ?? 1}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => props.onChange({ ...range(), [side() === "a" ? "alphaA" : "alphaB"]: v })}
                  onCommit={props.onCommit}
                />
                <NumberField label="hdr" value={range().intensity ?? 1} min={0} step={0.05} onChange={(intensity) => props.onChange({ ...range(), intensity })} onCommit={props.onCommit} />
              </div>
            </div>
          </Match>
          <Match when={mode() === "gradient" || mode() === "randomGradient"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium">{mode() === "gradient" ? "Gradient" : "Random from gradient"}</span>
                <Show when={mode() === "gradient" && props.curveAxis}>
                  <span class="text-[10px] text-muted-foreground">t = {props.curveAxis}</span>
                </Show>
              </div>
              <GradientEditor
                value={gradient()}
                onChange={(g) => props.onChange({ kind: mode() as "gradient", gradient: g })}
                onCommit={props.onCommit}
              />
            </div>
          </Match>
        </Switch>
      </Popover>
    </div>
  );
}
