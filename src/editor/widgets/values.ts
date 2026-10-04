// Pure helpers for the value widgets: sampling curves and gradients for
// display, converting FloatValue / ColorValue between modes, one-line summaries.

import { evalCurve, type ColorValue, type Curve, type EffectParameter, type FloatValue, type Gradient } from "elate-particles";
import { hexToRgb, rgbToHex } from "../../ui/color";

export type FloatMode = "constant" | "range" | "curve" | "rangeCurve" | "param";
export type ColorMode = "constant" | "range" | "gradient" | "randomGradient";

export const FLOAT_MODES: { value: FloatMode; label: string }[] = [
  { value: "constant", label: "Constant" },
  { value: "range", label: "Random between" },
  { value: "curve", label: "Curve" },
  { value: "rangeCurve", label: "Random between curves" },
  { value: "param", label: "Parameter" },
];

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "constant", label: "Color" },
  { value: "range", label: "Random between" },
  { value: "gradient", label: "Gradient" },
  { value: "randomGradient", label: "Random from gradient" },
];

// ---------------------------------------------------------------------------
// curves
// ---------------------------------------------------------------------------

export const flatCurve = (v: number): Curve => ({ keys: [{ t: 0, v }, { t: 1, v }], interp: "smooth" });

export function sortedKeys(c: Curve) {
  return [...(c.keys ?? [])].sort((a, b) => a.t - b.t);
}

export function sampleCurve(c: Curve, n = 48): number[] {
  const sorted = { ...c, keys: sortedKeys(c) };
  return Array.from({ length: n }, (_, i) => evalCurve(sorted, i / (n - 1)));
}

export const CURVE_PRESETS: { label: string; curve: Curve }[] = [
  { label: "Constant", curve: flatCurve(1) },
  { label: "Linear up", curve: { keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }], interp: "linear" } },
  { label: "Linear down", curve: { keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }], interp: "linear" } },
  { label: "Ease in", curve: { keys: [{ t: 0, v: 0 }, { t: 0.6, v: 0.2 }, { t: 1, v: 1 }], interp: "smooth" } },
  { label: "Ease out", curve: { keys: [{ t: 0, v: 1 }, { t: 0.4, v: 0.8 }, { t: 1, v: 0 }], interp: "smooth" } },
  { label: "Fade in", curve: { keys: [{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 1, v: 1 }], interp: "smooth" } },
  { label: "Fade out", curve: { keys: [{ t: 0, v: 1 }, { t: 0.7, v: 1 }, { t: 1, v: 0 }], interp: "smooth" } },
  { label: "Pulse", curve: { keys: [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }], interp: "smooth" } },
  { label: "Grow", curve: { keys: [{ t: 0, v: 0.2 }, { t: 1, v: 1 }], interp: "smooth" } },
];

// ---------------------------------------------------------------------------
// floats
// ---------------------------------------------------------------------------

export function floatMode(v: FloatValue): FloatMode {
  return typeof v === "number" ? "constant" : v.kind;
}

/** One number that stands for the value (carried across mode switches). */
export function representative(v: FloatValue): number {
  if (typeof v === "number") return v;
  switch (v.kind) {
    case "range":
      return v.max;
    case "curve":
      return (v.scale ?? 1) * Math.max(...v.curve.keys.map((k) => k.v), 0);
    case "rangeCurve":
      return (v.scale ?? 1) * Math.max(...v.max.keys.map((k) => k.v), 0);
    case "param":
      return (v.scale ?? 1) + (v.offset ?? 0);
  }
}

export function convertFloat(v: FloatValue, mode: FloatMode, params: EffectParameter[]): FloatValue {
  const s = representative(v);
  switch (mode) {
    case "constant":
      return s;
    case "range":
      return typeof v === "object" && v.kind === "range" ? v : { kind: "range", min: s, max: s };
    case "curve":
      if (typeof v === "object" && v.kind === "rangeCurve") return { kind: "curve", curve: structuredClone(v.max), scale: v.scale };
      return { kind: "curve", curve: flatCurve(1), scale: s || 1 };
    case "rangeCurve":
      if (typeof v === "object" && v.kind === "curve")
        return { kind: "rangeCurve", min: { ...v.curve, keys: v.curve.keys.map((k) => ({ t: k.t, v: k.v * 0.5 })) }, max: structuredClone(v.curve), scale: v.scale };
      return { kind: "rangeCurve", min: flatCurve(0.5), max: flatCurve(1), scale: s || 1 };
    case "param":
      return { kind: "param", name: params[0]?.name ?? "", scale: 1, offset: 0 };
  }
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : String(Math.round(n * 100) / 100));

export function summarizeFloat(v: unknown): string {
  if (typeof v === "number") return fmt(v);
  if (!v || typeof v !== "object") return "";
  const f = v as Exclude<FloatValue, number>;
  switch (f.kind) {
    case "range":
      return `${fmt(f.min)}–${fmt(f.max)}`;
    case "curve":
      return `curve${f.scale !== undefined && f.scale !== 1 ? ` ×${fmt(f.scale)}` : ""}`;
    case "rangeCurve":
      return `curves${f.scale !== undefined && f.scale !== 1 ? ` ×${fmt(f.scale)}` : ""}`;
    case "param":
      return `@${f.name}`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// colours and gradients
// ---------------------------------------------------------------------------

export function colorMode(v: ColorValue): ColorMode {
  return typeof v === "string" ? "constant" : v.kind;
}

export function lerpHex(a: string, b: string, f: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f);
}

/** Display colour (sRGB hex) and alpha of a gradient at t. */
export function evalGradient(g: Gradient, t: number): { color: string; a: number } {
  const cs = [...g.colors].sort((a, b) => a.t - b.t);
  const as = [...g.alphas].sort((a, b) => a.t - b.t);
  let color = cs[0]?.color ?? "#ffffff";
  if (cs.length && t > cs[0].t) {
    color = cs[cs.length - 1].color;
    for (let i = 1; i < cs.length; i++)
      if (t <= cs[i].t) {
        const span = cs[i].t - cs[i - 1].t;
        color = lerpHex(cs[i - 1].color, cs[i].color, span > 0 ? (t - cs[i - 1].t) / span : 0);
        break;
      }
  }
  let a = as[0]?.a ?? 1;
  if (as.length && t > as[0].t) {
    a = as[as.length - 1].a;
    for (let i = 1; i < as.length; i++)
      if (t <= as[i].t) {
        const span = as[i].t - as[i - 1].t;
        a = as[i - 1].a + (as[i].a - as[i - 1].a) * (span > 0 ? (t - as[i - 1].t) / span : 0);
        break;
      }
  }
  return { color, a };
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
};

/** CSS linear-gradient for a gradient (colour × alpha, sampled at every stop). */
export function gradientCss(g: Gradient, opaque = false): string {
  const ts = [...new Set([0, 1, ...g.colors.map((c) => c.t), ...g.alphas.map((a) => a.t)])].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b);
  const stops = ts.map((t) => {
    const s = evalGradient(g, t);
    return `${rgba(s.color, opaque ? 1 : s.a)} ${(t * 100).toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export const DEFAULT_GRADIENT: Gradient = {
  colors: [
    { t: 0, color: "#ffffff" },
    { t: 1, color: "#ffffff" },
  ],
  alphas: [
    { t: 0, a: 1 },
    { t: 1, a: 0 },
  ],
};

/** The main colour, alpha and intensity a value starts from when switching modes. */
function colorBase(v: ColorValue): { color: string; alpha: number; intensity: number; gradient?: Gradient } {
  if (typeof v === "string") return { color: v, alpha: 1, intensity: 1 };
  switch (v.kind) {
    case "constant":
      return { color: v.color, alpha: v.alpha ?? 1, intensity: v.intensity ?? 1 };
    case "range":
      return { color: v.b, alpha: v.alphaB ?? 1, intensity: v.intensity ?? 1 };
    case "gradient":
    case "randomGradient":
      return { color: v.gradient.colors[0]?.color ?? "#ffffff", alpha: v.gradient.alphas[0]?.a ?? 1, intensity: v.gradient.intensity ?? 1, gradient: v.gradient };
  }
}

export function convertColor(v: ColorValue, mode: ColorMode): ColorValue {
  const b = colorBase(v);
  switch (mode) {
    case "constant":
      return { kind: "constant", color: b.color, alpha: b.alpha, intensity: b.intensity };
    case "range":
      return typeof v === "object" && v.kind === "range" ? v : { kind: "range", a: b.color, b: b.color, alphaA: b.alpha, alphaB: b.alpha, intensity: b.intensity };
    case "gradient":
    case "randomGradient":
      return {
        kind: mode,
        gradient: b.gradient
          ? structuredClone(b.gradient)
          : { colors: [{ t: 0, color: b.color }, { t: 1, color: b.color }], alphas: [{ t: 0, a: b.alpha }, { t: 1, a: b.alpha }], intensity: b.intensity },
      };
  }
}

/** CSS background for a colour value's swatch. */
export function colorCss(v: ColorValue): string {
  if (typeof v === "string") return v;
  switch (v.kind) {
    case "constant":
      return rgba(v.color, v.alpha ?? 1);
    case "range":
      return `linear-gradient(to right, ${rgba(v.a, v.alphaA ?? 1)} 50%, ${rgba(v.b, v.alphaB ?? 1)} 50%)`;
    case "gradient":
    case "randomGradient":
      return gradientCss(v.gradient);
  }
}
