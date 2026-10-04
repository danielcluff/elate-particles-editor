// Field schemas for the parts of a document that aren't modules (emitter
// settings, renderers). Same shape as module ParamDefs, so one ParamField
// renders all of them. Dotted keys address nested objects ("lod.maxDistance",
// "trail.points"); `flipbook` is a toggle that creates or drops the object.

import { BUILTIN_MESHES, type RendererType } from "elate-particles";
import type { FieldDef } from "./widgets/ParamField";

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }));
const labelled = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

const BLEND = { key: "blend", label: "Blend", type: "enum", options: opts("additive", "alpha", "premultiplied", "opaque") } as const;
const SORT = {
  key: "sort",
  label: "Sort",
  type: "enum",
  default: "none",
  description: 'Draw order within this renderer. "distance" sorts back to front (alpha smoke).',
  options: labelled([
    ["none", "none"],
    ["distance", "distance"],
    ["oldestOnTop", "oldest on top"],
    ["newestOnTop", "newest on top"],
  ]),
} as const;
const SORT_ORDER: FieldDef = { key: "sortOrder", label: "Sort order", type: "int", default: 0, description: "Draw order between renderers and emitters (higher draws later)." };
const FADES: FieldDef[] = [
  { key: "depthFade", label: "Depth fade", type: "float", default: 0, min: 0, step: 0.01, description: "Soft particles: fade over this many units where particles meet scene geometry (0 = off)." },
  { key: "cameraFade", label: "Camera fade", type: "float", default: 0, min: 0, step: 0.01, description: "Fade particles closer to the camera than this (0 = off)." },
];
const TEXTURE = (shapes = ["texture"]): FieldDef => ({ key: "texture", label: "Texture", type: "string", placeholder: "URL or asset id", showIf: { key: "shape", values: shapes } });

export const EMITTER_FIELDS: FieldDef[] = [
  { key: "duration", label: "Duration", type: "float", default: 2, min: 0.01, step: 0.05, unit: "s", description: "Seconds per cycle." },
  { key: "looping", label: "Loop", type: "bool", default: true },
  { key: "prewarm", label: "Prewarm", type: "bool", default: false, description: "Simulate one cycle on play so a looping emitter starts full.", showIf: { key: "looping", values: [true] } },
  { key: "startDelay", label: "Start delay", type: "float", default: 0, min: 0, step: 0.05, unit: "s" },
  { key: "maxParticles", label: "Max particles", type: "int", default: 500, min: 1, step: 10, description: "Hard capacity; spawns beyond it are dropped." },
  {
    key: "space",
    label: "Space",
    type: "enum",
    options: labelled([
      ["world", "world"],
      ["local", "local (follow effect)"],
    ]),
  },
  {
    key: "sim",
    label: "Simulation",
    type: "enum",
    default: "cpu",
    description: 'Where particles simulate. "gpu" (TSL compute) is for very large emitters; it falls back to the CPU with a warning when unsupported.',
    options: labelled([
      ["cpu", "CPU"],
      ["gpu", "GPU"],
    ]),
  },
  { key: "eventDriven", label: "Event driven", type: "bool", default: false, description: "Only spawn from sub-emitter events." },
  { key: "seed", label: "Seed", type: "int", default: 0, description: "Random seed offset (0 = derived from the id)." },
];

export const LOD_FIELDS: FieldDef[] = [
  { key: "lod.maxDistance", label: "Max distance", type: "float", default: 0, min: 0, step: 1, description: "Stop spawning beyond this camera distance (0 = always)." },
  { key: "lod.minQuality", label: "Min quality", type: "float", default: 0, min: 0, max: 1, step: 0.05, description: "Skip this emitter while the world's quality is below this." },
  { key: "lod.scaleSpawn", label: "Scale spawn", type: "bool", default: true, description: "Thin spawn counts with quality / budget / distance. Turn off for single hero particles." },
];

export const RENDERER_FIELDS: Record<RendererType, FieldDef[]> = {
  sprite: [
    BLEND,
    { key: "shape", label: "Shape", type: "enum", options: opts("softCircle", "circle", "glow", "spark", "ring", "square", "texture") },
    TEXTURE(),
    { key: "flipbook", label: "Flipbook", type: "bool", default: false, showIf: { key: "shape", values: ["texture"] } },
    { key: "flipbook.cols", label: "Columns", type: "int", default: 4, min: 1, showIf: { key: "flipbook", values: [true] } },
    { key: "flipbook.rows", label: "Rows", type: "int", default: 4, min: 1, showIf: { key: "flipbook", values: [true] } },
    {
      key: "flipbook.mode",
      label: "Playback",
      type: "enum",
      default: "overLife",
      options: labelled([
        ["overLife", "over life"],
        ["fps", "fps (loop)"],
        ["random", "random frame"],
      ]),
      showIf: { key: "flipbook", values: [true] },
    },
    { key: "flipbook.fps", label: "FPS", type: "float", default: 12, min: 0, showIf: { key: "flipbook.mode", values: ["fps"] } },
    {
      key: "facing",
      label: "Facing",
      type: "enum",
      options: labelled([
        ["camera", "camera"],
        ["velocity", "velocity (stretched)"],
        ["horizontal", "horizontal"],
      ]),
    },
    { key: "stretch", label: "Stretch", type: "float", default: 0.05, min: 0, step: 0.005, description: "Extra length per unit of speed.", showIf: { key: "facing", values: ["velocity"] } },
    { key: "softness", label: "Softness", type: "float", default: 1, min: 0, step: 0.05 },
    ...FADES,
    { key: "sortGroup", label: "Sort group", type: "string", placeholder: "none", description: "Sprites with the same group draw in one call, sorted together across emitters and effects." },
    SORT,
    SORT_ORDER,
  ],
  mesh: [
    BLEND,
    { key: "mesh", label: "Mesh", type: "enum", options: opts(...BUILTIN_MESHES) },
    {
      key: "orientation",
      label: "Orientation",
      type: "enum",
      options: labelled([
        ["random", "random tumble"],
        ["velocity", "along velocity"],
        ["fixed", "fixed"],
      ]),
    },
    { key: "lit", label: "Lit", type: "bool", default: false },
    { key: "roughness", label: "Roughness", type: "float", default: 0.6, min: 0, max: 1, showIf: { key: "lit", values: [true] } },
    { key: "metalness", label: "Metalness", type: "float", default: 0, min: 0, max: 1, showIf: { key: "lit", values: [true] } },
    { key: "texture", label: "Texture", type: "string", placeholder: "none" },
    SORT,
    SORT_ORDER,
  ],
  ribbon: [
    {
      key: "mode",
      label: "Mode",
      type: "enum",
      default: "emitter",
      options: labelled([
        ["emitter", "emitter strip"],
        ["particle", "trail per particle"],
      ]),
    },
    { key: "trail.points", label: "Trail points", type: "int", default: 16, min: 2, max: 256, showIf: { key: "mode", values: ["particle"] } },
    { key: "trail.minDistance", label: "Min distance", type: "float", default: 0.1, min: 0, step: 0.01, showIf: { key: "mode", values: ["particle"] } },
    { key: "trail.lifetime", label: "Trail life", type: "float", default: 0.5, min: 0.01, step: 0.05, unit: "s", showIf: { key: "mode", values: ["particle"] } },
    { key: "taper", label: "Taper", type: "float", default: 0, min: 0, max: 1 },
    { key: "fade", label: "Fade", type: "float", default: 0, min: 0, max: 1 },
    BLEND,
    { key: "shape", label: "Shape", type: "enum", options: opts("softCircle", "glow", "square", "texture") },
    TEXTURE(),
    { key: "facing", label: "Facing", type: "enum", options: opts("camera", "horizontal") },
    { key: "uvMode", label: "UV", type: "enum", options: opts("stretch", "tile") },
    { key: "uvTile", label: "Tile length", type: "float", default: 1, min: 0.01, showIf: { key: "uvMode", values: ["tile"] } },
    { key: "softness", label: "Softness", type: "float", default: 1, min: 0, step: 0.05 },
    ...FADES,
    SORT,
    SORT_ORDER,
  ],
  light: [
    { key: "ratio", label: "Ratio", type: "float", min: 0, max: 1, description: "Fraction of particles that carry a light." },
    { key: "maxLights", label: "Max lights", type: "int", min: 0, description: "Most lights one instance contributes." },
    { key: "intensity", label: "Intensity", type: "float", min: 0, step: 0.1 },
    { key: "range", label: "Range", type: "float", min: 0, step: 0.1 },
    { key: "useParticleColor", label: "Particle colour", type: "bool", default: true },
    { key: "color", label: "Colour", type: "color", default: "#ffffff", showIf: { key: "useParticleColor", values: [false] } },
    { key: "alphaAffectsIntensity", label: "Alpha → intensity", type: "bool", default: true },
    { key: "sizeAffectsRange", label: "Size → range", type: "bool", default: false },
  ],
};

export const RENDERER_LABELS: Record<RendererType, string> = { sprite: "Sprite", mesh: "Mesh", ribbon: "Ribbon", light: "Light" };

// ---------------------------------------------------------------------------
// nested access
// ---------------------------------------------------------------------------

const FLIPBOOK_DEFAULT = { cols: 4, rows: 4, mode: "overLife" as const };

/** Reads a (possibly dotted) field, falling back to its default. */
export function getField(obj: Record<string, unknown>, def: FieldDef): unknown {
  if (def.key === "flipbook") return !!obj.flipbook;
  const [head, tail] = def.key.split(".");
  const v = tail ? (obj[head] as Record<string, unknown> | undefined)?.[tail] : obj[head];
  return v ?? def.default;
}

/** The top-level patch that sets a (possibly dotted) field. */
export function fieldPatch(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  if (key === "flipbook") return { flipbook: value ? FLIPBOOK_DEFAULT : undefined };
  const [head, tail] = key.split(".");
  if (!tail) return { [head]: value === "" ? undefined : value };
  return { [head]: { ...((obj[head] as Record<string, unknown>) ?? {}), [tail]: value } };
}

/** showIf lookup that understands dotted and toggle keys. */
export function fieldGetter(obj: Record<string, unknown>, defs: FieldDef[]) {
  return (key: string) => {
    const def = defs.find((d) => d.key === key) ?? { key, label: key, type: "string" as const };
    return getField(obj, def);
  };
}
