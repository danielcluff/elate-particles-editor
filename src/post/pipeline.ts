// A preview post-processing stack: HDR scene pass → bloom → grade → tone map
// and output colour space. Grading happens in linear HDR, before the tone map,
// so exposure, white balance and painted bands act on scene radiance. The
// renderer's own tone mapping is left alone (it's swapped only while the
// stack renders), so the direct, post-off path keeps its usual look.
import * as THREE from "three/webgpu";
import { exp2, float, floor, log2, luminance, max, mix, pass, pow, saturation, screenUV, smoothstep, step, uniform, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { PostSettings, PostStore, ToneMappingId } from "./settings";

const TONE_MAPPING: Record<ToneMappingId, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  none: THREE.NoToneMapping,
};

export class PreviewPost {
  #pipeline: THREE.RenderPipeline;
  #scene: ReturnType<typeof pass>;
  #bloom: ReturnType<typeof bloom>;
  #bloomBuilt: boolean | null = null;
  #enabled = false;
  #toneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping;
  #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | null = null;
  #u = {
    exposure: uniform(1),
    illuminant: uniform(new THREE.Vector3(1, 1, 1)),
    whiteBalance: uniform(0),
    saturation: uniform(1),
    contrast: uniform(1),
    bands: uniform(0),
    bandMix: uniform(0),
    vignette: uniform(0),
  };

  /** With a `store`, the stack follows its settings until disposed. */
  constructor(readonly renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, store?: PostStore) {
    this.#pipeline = new THREE.RenderPipeline(renderer);
    this.#scene = pass(scene, camera);
    this.#bloom = bloom(this.#scene, 0.5, 0.4, 0.9);
    if (store) this.#unsubscribe = store.subscribe((s) => this.apply(s));
  }

  /** Whether the stack should replace a direct render. */
  get enabled() {
    return this.#enabled;
  }

  /** Called after any settings change (e.g. to redraw an on-demand viewport). */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  apply(s: PostSettings) {
    this.#enabled = s.enabled;
    this.#toneMapping = TONE_MAPPING[s.toneMapping];
    const u = this.#u, g = s.grade;
    u.exposure.value = 2 ** s.exposure;
    u.whiteBalance.value = g.whiteBalance;
    u.saturation.value = g.saturation;
    u.contrast.value = g.contrast;
    u.bands.value = g.bands;
    u.bandMix.value = g.bandMix;
    u.vignette.value = g.vignette;
    this.#bloom.strength.value = s.bloom.strength;
    this.#bloom.radius.value = s.bloom.radius;
    this.#bloom.threshold.value = s.bloom.threshold;
    if (this.#bloomBuilt !== s.bloom.enabled) this.#build(s.bloom.enabled);
    for (const fn of this.#listeners) fn();
  }

  /** The light the scene is lit by (linear RGB), e.g. a star's colour; null is white. */
  setIlluminant(rgb: readonly [number, number, number] | null) {
    this.#u.illuminant.value.set(...(rgb ?? [1, 1, 1]));
    for (const fn of this.#listeners) fn();
  }

  render() {
    const r = this.renderer, previous = r.toneMapping;
    r.toneMapping = this.#toneMapping;
    try {
      this.#pipeline.render();
    } finally {
      r.toneMapping = previous;
    }
  }

  #build(withBloom: boolean) {
    const u = this.#u;
    let hdr = this.#scene.rgb.mul(u.exposure);
    if (withBloom) hdr = hdr.add(this.#bloom.rgb.mul(u.exposure));
    // White balance: scale each channel so the illuminant reads neutral at full strength.
    const illuminant = max(u.illuminant, vec3(1e-3));
    hdr = hdr.mul(mix(vec3(1), luminance(illuminant).div(illuminant).min(8), u.whiteBalance));
    hdr = saturation(hdr, u.saturation);
    // Contrast in log space around mid grey.
    hdr = pow(hdr.div(0.18).max(1e-6), vec3(u.contrast)).mul(0.18);
    // Painted bands: quantize luminance per stop, keeping the colour's chroma.
    const lum = luminance(hdr).max(1e-5);
    const banded = exp2(floor(log2(lum).mul(u.bands).add(0.5)).div(u.bands.max(1e-3)));
    hdr = mix(hdr, hdr.mul(banded.div(lum)), u.bandMix.mul(step(1e-3, u.bands)));
    // Vignette: 0 at the centre, full at the corners.
    const corner = screenUV.sub(0.5).length().mul(Math.SQRT2);
    hdr = hdr.mul(float(1).sub(u.vignette.mul(smoothstep(0.35, 1, corner))));
    // Keep the scene's alpha so transparent canvases stay transparent.
    this.#pipeline.outputNode = vec4(hdr, this.#scene.a);
    this.#pipeline.needsUpdate = true;
    this.#bloomBuilt = withBloom;
  }

  dispose() {
    this.#unsubscribe?.();
    this.#listeners.clear();
    this.#pipeline.dispose();
    this.#bloom.dispose();
    this.#scene.dispose();
  }
}
