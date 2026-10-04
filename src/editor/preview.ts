// The live viewport: a WebGPU renderer, an orbit camera, a ground grid and a
// ParticleWorld playing the effect being edited. Framework-free; the Solid
// side drives it through setDoc / play / pause / seek and reads `onFrame`.
//
// Simulations are seeded, so the preview is deterministic: seeking to time t
// (scrubbing, or re-registering after an edit) re-simulates from 0 at a fixed
// step and lands on the same frame every time.

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EffectDoc, PreviewSettings } from "elate-particles";
import { ParticleWorld, type ParticleEffect, type ParticleShader, type ParticleWorldStats } from "elate-particles/three";

export const BACKGROUNDS: { label: string; value: string }[] = [
  { label: "Night", value: "#05070c" },
  { label: "Black", value: "#000000" },
  { label: "Slate", value: "#2a2f38" },
  { label: "Grey", value: "#6b7078" },
  { label: "Day", value: "#b9c3cf" },
];

export const DEFAULT_PREVIEW: Required<PreviewSettings> = { background: "#05070c", showGrid: true, motion: "none", motionSpeed: 4 };

/** Fixed step for seeking and re-simulating. */
const STEP = 1 / 60;
/** GPU emitters re-simulate through the whole world (compute dispatches): a coarser step keeps edits cheap. */
const GPU_STEP = 1 / 20;
/** Looping effects re-simulate at most this many seconds (they look the same a few cycles in; keeps edits cheap). */
const MAX_SEEK = 5;
/** Pause between the end of a one-shot and its replay. */
const REPLAY_GAP = 0.6;
const SEED = 7;
const CIRCLE_RADIUS = 3;
const LINE_LENGTH = 12;
const MOTION_HEIGHT = 1;

export interface FrameInfo {
  time: number;
  playing: boolean;
  stats: ParticleWorldStats;
  /** CPU time of world.update this frame (ms). */
  updateMs: number;
  fps: number;
  /** The effect has finished (one-shot, all particles dead). */
  finished: boolean;
}

export class EffectPreview {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
  readonly controls: OrbitControls;
  readonly world: ParticleWorld;
  readonly ready: Promise<void>;
  backend = "";

  /** Called after every rendered frame. */
  onFrame: ((info: FrameInfo) => void) | null = null;

  #container: HTMLElement;
  #grid: THREE.GridHelper;
  #ground: THREE.Mesh;
  #groundMat: THREE.MeshStandardNodeMaterial;
  #resize: ResizeObserver;
  #doc: EffectDoc | null = null;
  #handle: ParticleEffect | null = null;
  #params: Record<string, number> = {};
  #settings: Required<PreviewSettings> = { ...DEFAULT_PREVIEW };
  #insets = { left: 0, right: 0, top: 0, bottom: 0 };
  #time = 0;
  #playing = true;
  #timeScale = 1;
  #loop = true;
  #finishedFor = 0;
  #last = 0;
  #fps = 60;
  #updateMs = 0;
  #disposed = false;
  #lineLap = 0;

  constructor(container: HTMLElement, opts: { shaders?: (id: string) => ParticleShader | undefined } = {}) {
    this.#container = container;
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.outline = "none";
    container.appendChild(canvas);

    this.camera.position.set(5, 3.5, 7);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // opaque ground for soft particles and collision planes to read against
    this.#groundMat = new THREE.MeshStandardNodeMaterial({ color: 0x0c111a, roughness: 1 });
    this.#ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.#groundMat);
    this.scene.add(this.#ground);
    this.#grid = new THREE.GridHelper(60, 60, 0x2a3a52, 0x161e2b);
    this.#grid.position.y = 0.002;
    this.scene.add(this.#grid);
    // for lit mesh particles
    this.scene.add(new THREE.HemisphereLight(0xb0c4ff, 0x302010, 1.2));
    const sun = new THREE.DirectionalLight(0xffeedd, 2.5);
    sun.position.set(5, 10, 4);
    this.scene.add(sun);

    this.world = new ParticleWorld({ renderer: this.renderer, lights: { max: 8 }, silent: true, shaders: opts.shaders });
    this.scene.add(this.world.object);

    this.#resize = new ResizeObserver(() => this.#applySize());
    this.#resize.observe(container);
    this.ready = this.renderer.init().then(() => {
      if (this.#disposed) return;
      const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
      this.backend = backend?.isWebGPUBackend ? "WebGPU" : "WebGL2";
      this.#applySize();
      this.applySettings(this.#settings);
      this.#last = performance.now();
      this.renderer.setAnimationLoop(() => this.#tick());
    });
  }

  // ---- document ----------------------------------------------------------------

  /**
   * Shows `doc` (registering it recompiles in well under a millisecond) and
   * re-simulates to the current time, so editing a looping effect doesn't
   * empty the viewport.
   */
  setDoc(doc: EffectDoc): void {
    const prev = this.#doc;
    if (prev && prev.id !== doc.id) {
      this.#handle?.release();
      this.#handle = null;
      this.world.unregister(prev.id);
    }
    this.#doc = doc;
    this.world.register(doc);
    this.#seekTo(this.#time);
  }

  /** A shader graph finished loading or changed: rebuild the materials that use it, keep the current time. */
  refreshShader(id: string): void {
    if (!this.#doc) return;
    this.world.invalidateShader(id);
    this.#seekTo(this.#time);
  }

  // ---- playback ----------------------------------------------------------------

  get time(): number {
    return this.#time;
  }

  get playing(): boolean {
    return this.#playing;
  }

  play(): void {
    if (this.#finished()) this.#seekTo(0);
    this.#playing = true;
  }

  pause(): void {
    this.#playing = false;
  }

  restart(): void {
    this.#seekTo(0);
    this.#playing = true;
  }

  /** Jump to `t` seconds (pauses; scrubbing). */
  seek(t: number): void {
    this.#playing = false;
    this.#seekTo(Math.max(0, t));
  }

  /** Advance one fixed step while paused. */
  stepFrame(): void {
    this.#playing = false;
    this.#advance(STEP);
  }

  setTimeScale(s: number): void {
    this.#timeScale = s;
  }

  /** Replay one-shot effects when they finish. */
  setLoop(loop: boolean): void {
    this.#loop = loop;
  }

  setParams(values: Record<string, number>): void {
    this.#params = { ...values };
    const h = this.#handle;
    if (h) for (const [k, v] of Object.entries(values)) h.setParam(k, v);
  }

  // ---- view --------------------------------------------------------------------

  applySettings(s: PreviewSettings): void {
    const prevMotion = this.#settings.motion;
    this.#settings = { ...DEFAULT_PREVIEW, ...s };
    const bg = new THREE.Color(this.#settings.background);
    this.scene.background = bg;
    // the ground is a slightly lifted background, so light and dark presets both read
    const hsl = { h: 0, s: 0, l: 0 };
    bg.getHSL(hsl);
    this.#groundMat.color.setHSL(hsl.h, hsl.s * 0.8, Math.min(1, hsl.l * 1.15 + 0.02));
    this.#ground.visible = this.#settings.showGrid;
    this.#grid.visible = this.#settings.showGrid;
    if (prevMotion !== this.#settings.motion && this.#doc) this.#seekTo(this.#time);
  }

  /**
   * Screen space covered by the editor's floating panels: the camera's centre
   * moves into the free area so the effect isn't hidden behind them.
   */
  setInsets(insets: { left: number; right: number; top: number; bottom: number }): void {
    this.#insets = insets;
    this.#applySize();
  }

  /** Point the camera at the effect's live particles (CPU emitters) or its origin. */
  frame(): void {
    const b = new Float32Array(6);
    const sim = this.#handle?.sim;
    const center = new THREE.Vector3(0, 1, 0);
    let radius = 2.5;
    if (sim?.worldBounds(b) && Number.isFinite(b[0])) {
      center.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      radius = Math.max(0.5, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
    }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
  }

  /**
   * A JPEG of the current view, cropped from the area between the panels (see
   * setInsets) to `width` × `height`'s aspect.
   */
  async capture(width = 480, height = 270): Promise<string> {
    await this.renderer.renderAsync(this.scene, this.camera);
    const src = this.renderer.domElement;
    const k = src.width / Math.max(1, this.#container.clientWidth);
    const { left, right, top, bottom } = this.#insets;
    const free = { x: left * k, y: top * k, w: Math.max(1, src.width - (left + right) * k), h: Math.max(1, src.height - (top + bottom) * k) };
    const aspect = width / height;
    let sw = free.w;
    let sh = sw / aspect;
    if (sh > free.h) {
      sh = free.h;
      sw = sh * aspect;
    }
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d")!.drawImage(src, free.x + (free.w - sw) / 2, free.y + (free.h - sh) / 2, sw, sh, 0, 0, width, height);
    return out.toDataURL("image/jpeg", 0.85);
  }

  /** Live counts for agents: per emitter (CPU emitters exact, GPU emitters an upper bound). */
  emitterStats(): { name: string; id: string; particles: number; sim: "cpu" | "gpu" }[] {
    const sim = this.#handle?.sim;
    if (!sim) return [];
    return sim.emitters.map((e) => ({ name: e.template.doc.name, id: e.template.doc.id, particles: e.particleCount, sim: e.template.doc.sim === "gpu" ? "gpu" : "cpu" }));
  }

  dispose(): void {
    this.#disposed = true;
    this.renderer.setAnimationLoop(null);
    this.#resize.disconnect();
    this.controls.dispose();
    this.#handle?.release();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---- internals -----------------------------------------------------------------

  #applySize(): void {
    const w = Math.max(1, this.#container.clientWidth);
    const h = Math.max(1, this.#container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const { left, right, top, bottom } = this.#insets;
    // shift the principal point to the centre of the area between the panels
    this.camera.setViewOffset(w, h, -(left - right) / 2, -(top - bottom) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  #finished(): boolean {
    return !!this.#handle && !this.#handle.alive;
  }

  #spawn(): void {
    this.#handle?.release();
    this.#handle = null;
    if (!this.#doc) return;
    this.#lineLap = 0;
    const p = this.#motionAt(0);
    this.#handle = this.world.spawn(this.#doc.id, {
      autoRelease: false,
      seed: SEED,
      params: this.#params,
      position: p.position,
      rotation: p.rotation,
    });
  }

  /** Re-simulate from 0 to `t` at a fixed step. */
  #seekTo(t: number): void {
    this.#spawn();
    this.#time = 0;
    this.#finishedFor = 0;
    const h = this.#handle;
    if (!h?.sim || !this.#doc) return;
    // a long-running looping effect looks the same a few cycles in: don't replay hours
    const start = t > MAX_SEEK && this.#looping() ? t - MAX_SEEK : 0;
    const gpu = this.#doc.emitters.some((e) => e.sim === "gpu" && e.enabled !== false);
    const step = gpu ? GPU_STEP : STEP;
    const n = Math.floor((t - start) / step + 1e-6);
    this.#time = start;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      if (gpu || last) this.#advance(step);
      else {
        // CPU emitters: step the simulation alone; the world packs once at the end
        this.#time += step;
        this.#place(h);
        h.sim.step(step);
      }
    }
    // the remainder, so seeking lands exactly on t
    const rest = t - this.#time;
    if (n > 0 && rest > 1e-6) this.#advance(rest);
    if (n === 0) {
      // draw the first frame
      this.#place(h);
      this.world.update(1e-4, this.camera);
    }
    this.#time = t;
  }

  #looping(): boolean {
    return !!this.#doc?.emitters.some((e) => e.looping && e.enabled !== false);
  }

  #advance(dt: number): void {
    const h = this.#handle;
    if (!h) return;
    this.#time += dt;
    this.#place(h);
    const t0 = performance.now();
    this.world.update(dt, this.camera);
    this.#updateMs = performance.now() - t0;
  }

  #place(h: ParticleEffect): void {
    if (this.#settings.motion === "none") return;
    const p = this.#motionAt(this.#time);
    h.setTransform(p.position, p.rotation);
    if (p.lap !== this.#lineLap) {
      // the line motion jumps back to its start: no trail across the scene
      this.#lineLap = p.lap;
      h.teleport();
    }
  }

  #motionAt(t: number): { position: THREE.Vector3; rotation: THREE.Quaternion; lap: number } {
    const speed = this.#settings.motionSpeed;
    const position = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);
    let lap = 0;
    if (this.#settings.motion === "circle") {
      const a = (t * speed) / CIRCLE_RADIUS;
      position.set(Math.cos(a) * CIRCLE_RADIUS, MOTION_HEIGHT, Math.sin(a) * CIRCLE_RADIUS);
      forward.set(-Math.sin(a), 0, Math.cos(a));
    } else if (this.#settings.motion === "line") {
      const d = t * speed;
      lap = Math.floor(d / LINE_LENGTH);
      position.set(d - lap * LINE_LENGTH - LINE_LENGTH / 2, MOTION_HEIGHT, 0);
      forward.set(1, 0, 0);
    }
    // effects face +Z along their path (thrusters exhaust out the back)
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
    return { position, rotation, lap };
  }

  #tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;
    if (dt > 0) this.#fps += (1 / dt - this.#fps) * 0.05;
    this.controls.update();

    if (this.#playing && this.#handle) {
      if (this.#finished()) {
        // one-shot done: replay after a short gap, or stop at the end
        this.#finishedFor += dt;
        if (!this.#loop) this.#playing = false;
        else if (this.#finishedFor >= REPLAY_GAP) this.#seekTo(0);
      } else this.#advance(dt * this.#timeScale);
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.({
      time: this.#time,
      playing: this.#playing,
      stats: this.world.stats,
      updateMs: this.#updateMs,
      fps: this.#fps,
      finished: this.#finished(),
    });
  }
}
