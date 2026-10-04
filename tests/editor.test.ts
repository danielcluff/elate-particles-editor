import { describe, expect, it } from "vitest";
import { checkColorValue, checkFloatValue, createEffect, createEmitter } from "elate-particles";
import { plain, previewDoc } from "../src/editor/store";
import { COLOR_MODES, FLOAT_MODES, convertColor, convertFloat, evalGradient, gradientCss } from "../src/editor/widgets/values";

describe("value mode conversion", () => {
  const params = [{ name: "throttle", type: "float" as const, default: 1 }];
  it("every float mode produces a valid FloatValue from every other", () => {
    for (const from of FLOAT_MODES) {
      const start = convertFloat(3, from.value, params);
      for (const to of FLOAT_MODES) expect(checkFloatValue(convertFloat(start, to.value, params)), `${from.value} → ${to.value}`).toBeNull();
    }
  });
  it("keeps the value when switching constant ↔ range", () => {
    expect(convertFloat(4, "range", params)).toEqual({ kind: "range", min: 4, max: 4 });
    expect(convertFloat({ kind: "range", min: 1, max: 5 }, "constant", params)).toBe(5);
  });
  it("every colour mode produces a valid ColorValue from every other", () => {
    for (const from of COLOR_MODES) {
      const start = convertColor("#ff8800", from.value);
      for (const to of COLOR_MODES) expect(checkColorValue(convertColor(start, to.value)), `${from.value} → ${to.value}`).toBeNull();
    }
  });
  it("samples gradients for display", () => {
    const g = { colors: [{ t: 0, color: "#000000" }, { t: 1, color: "#ffffff" }], alphas: [{ t: 0, a: 1 }, { t: 1, a: 0 }] };
    expect(evalGradient(g, 0.5)).toEqual({ color: "#808080", a: 0.5 });
    expect(gradientCss(g)).toContain("rgba(255, 255, 255, 0) 100.00%");
  });
});

describe("previewDoc (solo)", () => {
  const doc = createEffect("fx", { emitter: false });
  const shell = createEmitter("shell");
  const stars = createEmitter("stars");
  const embers = createEmitter("embers");
  const other = createEmitter("other");
  shell.subEmitters = [{ trigger: "death", emitter: stars.id, count: 10 }];
  stars.subEmitters = [{ trigger: "death", emitter: embers.id, count: 1 }];
  doc.emitters.push(shell, stars, embers, other);

  it("returns the document unchanged without a solo", () => {
    expect(previewDoc(doc, null)).toBe(doc);
  });
  it("keeps the soloed emitter and what it drives, hides its sources, disables the rest", () => {
    const p = previewDoc(doc, stars.id);
    const by = (name: string) => p.emitters.find((e) => e.name === name)!;
    expect(by("stars")).toBe(stars);
    expect(by("embers")).toBe(embers);
    expect(by("shell").enabled).not.toBe(false);
    expect(by("shell").renderers.every((r) => r.enabled === false)).toBe(true);
    expect(by("other").enabled).toBe(false);
  });
});

describe("plain", () => {
  it("deep-copies and keeps undefined (it clears fields in setRenderer)", () => {
    const src = { a: { b: [1, { c: 2 }] }, gone: undefined };
    const out = plain(src);
    expect(out).toEqual(src);
    expect("gone" in out).toBe(true);
    expect(out.a).not.toBe(src.a);
  });
});
