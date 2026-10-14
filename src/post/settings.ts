// Preview post-processing settings and the store that shares them. A store is
// remembered per browser (a viewer convenience, not part of any document).
// Hosts that want one look across several previews create one store and hand
// it to each (EffectHost.post, or their own viewports).
import { createSignal } from "solid-js";

export const TONE_MAPPINGS = ["aces", "agx", "neutral", "reinhard", "none"] as const;
export type ToneMappingId = (typeof TONE_MAPPINGS)[number];

export interface PostSettings {
  /** Off: the preview renders straight to the canvas with its usual tone mapping. */
  enabled: boolean;
  /** Exposure in stops, applied before tone mapping. */
  exposure: number;
  toneMapping: ToneMappingId;
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  grade: {
    /** 0 leaves the scene's light colour cast; 1 renders the illuminant as white. */
    whiteBalance: number;
    saturation: number;
    /** Log-space contrast around mid grey; 1 is neutral. */
    contrast: number;
    /** Luminance bands per stop for a painted, cel-shaded look; 0 is off. */
    bands: number;
    /** How much of the banded luminance to use, 0–1. */
    bandMix: number;
    vignette: number;
  };
}

/** Particle-friendly defaults: bloom for emissive sprites, an otherwise neutral grade. */
export const DEFAULT_POST: PostSettings = {
  enabled: true,
  exposure: 0,
  toneMapping: "aces",
  bloom: { enabled: true, strength: 0.5, radius: 0.4, threshold: 0.9 },
  grade: { whiteBalance: 0, saturation: 1, contrast: 1, bands: 0, bandMix: 0.6, vignette: 0.15 },
};

export interface PostStore {
  /** Current settings (reactive in Solid). */
  settings(): PostSettings;
  update(patch: (s: PostSettings) => PostSettings): void;
  reset(): void;
  /** For non-Solid code (viewports). Calls `fn` now and on each change; returns an unsubscribe. */
  subscribe(fn: (s: PostSettings) => void): () => void;
}

function merge(defaults: PostSettings, raw: Partial<PostSettings> | null): PostSettings {
  if (!raw) return structuredClone(defaults);
  return {
    ...defaults,
    ...raw,
    toneMapping: TONE_MAPPINGS.includes(raw.toneMapping as ToneMappingId) ? (raw.toneMapping as ToneMappingId) : defaults.toneMapping,
    bloom: { ...defaults.bloom, ...raw.bloom },
    grade: { ...defaults.grade, ...raw.grade },
  };
}

/** A settings store remembered in localStorage under `key` (when storage is available). */
export function createPostStore(key: string, defaults: PostSettings = DEFAULT_POST): PostStore {
  let current: PostSettings;
  try {
    current = merge(defaults, JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    current = structuredClone(defaults);
  }
  // `current` is the source of truth: Solid batches signal writes, so a read
  // straight after a write could see the previous value.
  const [settings, setSettings] = createSignal<PostSettings>(current);
  const listeners = new Set<(s: PostSettings) => void>();
  const update = (patch: (s: PostSettings) => PostSettings) => {
    const next = (current = patch(current));
    setSettings(() => next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // storage blocked: the change still applies for this session
    }
    for (const fn of listeners) fn(next);
  };
  return {
    settings,
    update,
    reset: () => update(() => structuredClone(defaults)),
    subscribe(fn) {
      listeners.add(fn);
      fn(current);
      return () => listeners.delete(fn);
    },
  };
}

let fallback: PostStore | undefined;
/** The editor's own store, used when the host provides none. */
export const defaultPostStore = () => (fallback ??= createPostStore("elate-particles-preview-post"));
