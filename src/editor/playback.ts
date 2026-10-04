import { createContext, createStore } from "solid-js";
import type { EffectPreview, FrameInfo } from "./preview";

// Reactive mirror of the preview's playback state for the top bar, timeline
// and stats overlay. Commands go straight to the EffectPreview.

const STATS_INTERVAL = 250;

export function createPlayback() {
  const [state, setState] = createStore({
    ready: false,
    error: null as string | null,
    backend: "",
    time: 0,
    playing: true,
    finished: false,
    timeScale: 1,
    loop: true,
    particles: 0,
    drawCalls: 0,
    lights: 0,
    updateMs: 0,
    fps: 60,
  });
  let preview: EffectPreview | null = null;
  let lastStats = 0;

  const onFrame = (f: FrameInfo) => {
    const now = performance.now();
    const stats = now - lastStats > STATS_INTERVAL;
    if (stats) lastStats = now;
    setState((s) => {
      s.time = f.time;
      s.playing = f.playing;
      s.finished = f.finished;
      if (stats) {
        s.particles = f.stats.particles;
        s.drawCalls = f.stats.drawCalls;
        s.lights = f.stats.lights;
        s.updateMs = f.updateMs;
        s.fps = f.fps;
      }
    });
  };

  return {
    state,
    get preview() {
      return preview;
    },
    attach(p: EffectPreview) {
      preview = p;
      p.onFrame = onFrame;
      p.setTimeScale(state.timeScale);
      p.setLoop(state.loop);
      setState((s) => {
        s.ready = true;
        s.backend = p.backend;
      });
    },
    fail(message: string) {
      setState((s) => void (s.error = message));
    },
    detach() {
      preview = null;
    },
    play: () => preview?.play(),
    pause: () => preview?.pause(),
    toggle: () => (preview?.playing ? preview.pause() : preview?.play()),
    restart: () => preview?.restart(),
    seek: (t: number) => preview?.seek(t),
    step: () => preview?.stepFrame(),
    frame: () => preview?.frame(),
    setTimeScale(s: number) {
      setState((st) => void (st.timeScale = s));
      preview?.setTimeScale(s);
    },
    setLoop(loop: boolean) {
      setState((st) => void (st.loop = loop));
      preview?.setLoop(loop);
    },
  };
}

export type Playback = ReturnType<typeof createPlayback>;
export const PlaybackContext = createContext<Playback>();
