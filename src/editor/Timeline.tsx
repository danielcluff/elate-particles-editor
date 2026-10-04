import { For, Show, createEffect, createMemo, createSignal, onSettled, useContext } from "solid-js";
import type { EffectDoc, EmitterDoc } from "elate-particles";
import { ChevronDown, ChevronUp } from "lucide-static";
import { Icon } from "../ui";
import { PlaybackContext } from "./playback";
import { EditorContext } from "./store";

const NAME_W = 112;
const ROW_H = 22;
const SNAP = 0.05;

/** Seconds shown: every emitter's first cycle, plus a second cycle of looping ones. */
export function timelineRange(doc: EffectDoc): number {
  let end = 1;
  for (const e of doc.emitters) end = Math.max(end, e.startDelay + e.duration * (e.looping ? 2 : 1));
  const step = end > 10 ? 2 : end > 4 ? 1 : 0.5;
  return Math.ceil((end * 1.1) / step) * step;
}

function tickStep(range: number, width: number): number {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
  return steps.find((s) => (s / range) * width >= 48) ?? 60;
}

/** Burst times within one cycle (enabled spawn.burst modules). */
function burstTimes(e: EmitterDoc): number[] {
  const out: number[] = [];
  for (const m of e.spawn) {
    if (m.type !== "spawn.burst" || m.enabled === false) continue;
    const time = Number(m.params.time ?? 0);
    const cycles = Math.max(1, Number(m.params.cycles ?? 1));
    const interval = Number(m.params.interval ?? 0);
    for (let k = 0; k < Math.min(cycles, 64); k++) {
      const t = time + k * interval;
      if (t <= e.duration) out.push(t);
    }
  }
  return out;
}

export function Timeline() {
  const ed = useContext(EditorContext);
  const pb = useContext(PlaybackContext);
  const [open, setOpen] = createSignal(true);
  const [width, setWidth] = createSignal(400);
  const looping = createMemo(() => ed.state.doc.emitters.some((e) => e.looping && e.enabled !== false));
  // one-shots outlive their emitters by a particle lifetime: grow the range to what has been seen playing
  const [seen, setSeen] = createSignal(0);
  createEffect(
    () => [looping() ? 0 : pb.state.time, seen()] as const,
    ([t, max]) => {
      if (t > max) setSeen(t);
    },
  );
  const range = createMemo(() => {
    const docRange = timelineRange(ed.state.doc);
    return seen() > docRange ? Math.ceil(seen() * 1.05 * 2) / 2 : docRange;
  });
  const x = (t: number) => (t / range()) * width();
  const ticks = createMemo(() => {
    const step = tickStep(range(), width());
    return Array.from({ length: Math.floor(range() / step + 1e-6) + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
  });
  // a looping effect's playhead wraps around the shown range
  const head = () => (looping() ? pb.state.time % range() : Math.min(pb.state.time, range()));

  let track!: HTMLDivElement;
  onSettled(() => {
    const ro = new ResizeObserver(() => setWidth(Math.max(50, track.clientWidth)));
    ro.observe(track);
    return () => ro.disconnect();
  });

  const timeAt = (clientX: number) => Math.max(0, Math.min(range(), ((clientX - track.getBoundingClientRect().left) / width()) * range()));
  const scrub = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pb.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => pb.seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div class="pointer-events-auto flex flex-col overflow-hidden rounded-xl border bg-card/90 shadow-lg backdrop-blur-sm" data-ui>
      <div class="flex h-7 shrink-0 items-center border-b">
        <button
          type="button"
          class="flex h-full shrink-0 items-center gap-1 px-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase hover:text-foreground"
          style={{ width: `${NAME_W}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon svg={open() ? ChevronDown : ChevronUp} class="size-3" />
          Timeline
        </button>
        {/* ruler: drag to scrub */}
        <div ref={track} class="relative h-full min-w-0 flex-1 cursor-ew-resize select-none" onPointerDown={scrub}>
          <For each={ticks()}>
            {(t) => (
              <div class="absolute inset-y-0 flex items-end pb-1" style={{ left: `${x(t)}px` }}>
                <div class="absolute bottom-0 h-1.5 w-px bg-muted-foreground/40" />
                <span class="ml-1 font-mono text-[9px] text-muted-foreground tabular-nums">{t}s</span>
              </div>
            )}
          </For>
          <Playhead x={x(head())} label />
        </div>
        <div class="w-2 shrink-0" />
      </div>
      <Show when={open()}>
        <div class="thin-scroll max-h-44 overflow-y-auto py-1">
          <For each={ed.state.doc.emitters}>{(e) => <TimelineRow emitter={e} x={x} range={range()} width={width()} head={head()} onScrub={scrub} />}</For>
        </div>
      </Show>
    </div>
  );
}

function Playhead(props: { x: number; label?: boolean }) {
  return (
    <div class="pointer-events-none absolute inset-y-0 z-10 w-px bg-sky-400" style={{ left: `${props.x}px` }}>
      <Show when={props.label}>
        <div class="absolute -top-px -left-1 size-2 rotate-45 bg-sky-400" />
      </Show>
    </div>
  );
}

function TimelineRow(props: { emitter: EmitterDoc; x: (t: number) => number; range: number; width: number; head: number; onScrub: (e: PointerEvent) => void }) {
  const ed = useContext(EditorContext);
  const e = () => props.emitter;
  const selected = () => ed.emitter()?.id === e().id;
  const off = () => e().enabled === false || (!!ed.state.solo && ed.state.solo !== e().id);
  const bursts = createMemo(() => burstTimes(props.emitter));
  /** Cycle start times after the first, while they fit in the range. */
  const repeats = createMemo(() => {
    if (!e().looping) return [];
    const out: number[] = [];
    for (let t = e().startDelay + e().duration; t < props.range && out.length < 200; t += e().duration) out.push(t);
    return out;
  });
  const targets = createMemo(() =>
    (e().subEmitters ?? []).map((s) => ({ ...s, name: ed.state.doc.emitters.find((x) => x.id === s.emitter)?.name ?? "?" })),
  );

  const drag = (kind: "move" | "resize", ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    ed.select(e().id);
    const startX = ev.clientX;
    const start = kind === "move" ? e().startDelay : e().duration;
    const perPx = props.range / props.width;
    const merge = `timeline.${e().id}.${kind}`;
    const move = (m: PointerEvent) => {
      const raw = start + (m.clientX - startX) * perPx;
      const v = Math.max(kind === "move" ? 0 : SNAP, m.shiftKey ? Math.round(raw * 1000) / 1000 : Math.round(raw / SNAP) * SNAP);
      const value = Math.round(v * 1000) / 1000;
      ed.run({ op: "updateEmitter", emitterId: e().id, props: kind === "move" ? { startDelay: value } : { duration: value } }, { merge });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ed.commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div class="flex items-center" style={{ height: `${ROW_H}px` }}>
      <button
        type="button"
        class={["shrink-0 truncate px-2 text-left text-[11px]", selected() ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground", { "opacity-50": off() }]}
        style={{ width: `${NAME_W}px` }}
        onClick={() => ed.select(e().id)}
      >
        {e().name}
      </button>
      <div class={["relative h-full min-w-0 flex-1", { "opacity-40": off() }]} onPointerDown={(ev) => props.onScrub(ev)}>
        <div class={["absolute inset-x-0 top-1/2 h-px", selected() ? "bg-foreground/15" : "bg-foreground/5"]} />
        <For each={repeats()}>
          {(t) => (
            <div
              class="pointer-events-none absolute top-1 bottom-1 rounded-[3px] border border-dashed border-sky-400/30 bg-sky-400/5"
              style={{ left: `${props.x(t)}px`, width: `${Math.max(2, props.x(e().duration))}px` }}
            />
          )}
        </For>
        <div
          title={`Start ${e().startDelay}s · duration ${e().duration}s${e().looping ? " · loops" : ""} (drag to move, drag the right edge to resize)`}
          class={[
            "absolute top-1 bottom-1 cursor-grab rounded-[3px] border",
            selected() ? "border-sky-300 bg-sky-500/45" : "border-sky-400/50 bg-sky-500/25 hover:bg-sky-500/35",
            { "border-dashed": !!e().eventDriven },
          ]}
          style={{ left: `${props.x(e().startDelay)}px`, width: `${Math.max(4, props.x(e().duration))}px` }}
          onPointerDown={(ev) => drag("move", ev)}
        >
          <For each={bursts()}>
            {(t) => <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-300" style={{ left: `${Math.min(props.x(t), props.x(e().duration) - 2)}px` }} />}
          </For>
          <div class="absolute inset-y-0 -right-1 w-2 cursor-ew-resize" onPointerDown={(ev) => drag("resize", ev)} />
        </div>
        <Show when={targets().length}>
          <div
            class="pointer-events-none absolute top-1/2 flex -translate-y-1/2 gap-1.5 pl-1.5 font-mono text-[9px] whitespace-nowrap text-violet-300"
            style={{ left: `${props.x(e().startDelay + e().duration)}px` }}
          >
            <For each={targets()}>{(s) => <span>↳ {s.name} ({s.trigger})</span>}</For>
          </div>
        </Show>
        <Playhead x={props.x(props.head)} />
      </div>
      <div class="w-2 shrink-0" />
    </div>
  );
}
