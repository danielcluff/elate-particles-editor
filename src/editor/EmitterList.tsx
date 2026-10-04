import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import type { EffectDoc, EffectParameter, EmitterDoc } from "elate-particles";
import { ArrowDown, ArrowUp, CircleAlert, Copy, CornerDownRight, Crosshair, Ellipsis, Pencil, Plus, SlidersHorizontal, Trash2, TriangleAlert, X } from "lucide-static";
import { Icon, MenuItem, MenuSeparator, NumberField, Popover, Slider, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { EditorContext, previewDoc } from "./store";

interface Row {
  emitter: EmitterDoc;
  depth: number;
  /** Shown under another emitter that spawns it. */
  child: boolean;
}

/** Emitters in document order, with sub-emitter targets indented under their (first) source. */
function emitterTree(doc: EffectDoc): Row[] {
  const byId = new Map(doc.emitters.map((e) => [e.id, e]));
  const parentOf = new Map<string, string>();
  for (const e of doc.emitters) for (const s of e.subEmitters ?? []) if (s.emitter !== e.id && !parentOf.has(s.emitter) && byId.has(s.emitter)) parentOf.set(s.emitter, e.id);
  // break cycles: a chain that leads back to itself is shown flat
  for (const id of [...parentOf.keys()]) {
    const seen = new Set([id]);
    let p = parentOf.get(id);
    while (p && !seen.has(p)) {
      seen.add(p);
      p = parentOf.get(p);
    }
    if (p) parentOf.delete(id);
  }
  const rows: Row[] = [];
  const visit = (e: EmitterDoc, depth: number) => {
    rows.push({ emitter: e, depth, child: depth > 0 });
    for (const c of doc.emitters) if (parentOf.get(c.id) === e.id) visit(c, depth + 1);
  };
  for (const e of doc.emitters) if (!parentOf.has(e.id)) visit(e, 0);
  return rows;
}

export function EmitterList() {
  const ed = useContext(EditorContext);
  const [addMenu, setAddMenu] = createSignal<PopoverAnchor | null>(null);
  const rows = createMemo(() => emitterTree(ed.state.doc));
  const effectIssues = createMemo(() => ed.issues().filter((i) => !i.emitterId));
  const add = (template: "default" | "empty") => {
    setAddMenu(null);
    const r = ed.run<{ emitterId: string }>({ op: "addEmitter", template });
    if (r) ed.select(r.emitterId);
  };
  return (
    <aside class="flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-xl border bg-sidebar shadow-lg" data-ui>
      <div class="flex h-10 shrink-0 items-center justify-between border-b pr-2 pl-3">
        <h2 class="text-sm font-semibold">Emitters</h2>
        <Tooltip content="Add emitter" side="right">
          <button
            type="button"
            aria-label="Add emitter"
            class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => togglePopover(addMenu(), setAddMenu, e)}
          >
            <Icon svg={Plus} class="size-4" />
          </button>
        </Tooltip>
        <Popover open={!!addMenu()} anchor={addMenu()?.rect} trigger={addMenu()?.el} align="end" onClose={() => setAddMenu(null)} class="w-52">
          <MenuItem onSelect={() => add("default")}>Default emitter</MenuItem>
          <MenuItem onSelect={() => add("empty")}>Empty emitter</MenuItem>
        </Popover>
      </div>
      <div class="thin-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <Show when={rows().length} fallback={<p class="p-3 text-xs text-muted-foreground">No emitters yet.</p>}>
          <For each={rows()}>{(row) => <EmitterRow row={row} />}</For>
        </Show>
        <Show when={effectIssues().length}>
          <div class="mt-2 flex flex-col gap-1 px-1">
            <For each={effectIssues()}>
              {(i) => (
                <div class={["flex items-start gap-1.5 text-[11px] leading-snug", i.level === "error" ? "text-red-400" : "text-amber-400"]}>
                  <Icon svg={i.level === "error" ? CircleAlert : TriangleAlert} class="mt-px size-3 shrink-0" />
                  {i.message}
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Parameters />
    </aside>
  );
}

function EmitterRow(props: { row: Row }) {
  const ed = useContext(EditorContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  const [renaming, setRenaming] = createSignal(false);
  const e = () => props.row.emitter;
  const index = () => ed.state.doc.emitters.findIndex((x) => x.id === e().id);
  const selected = () => ed.emitter()?.id === e().id;
  const soloed = () => ed.state.solo === e().id;
  // while soloing, emitters that don't draw are dimmed (previewDoc returns the shown ones untouched)
  const dimmed = () =>
    e().enabled === false || (!!ed.state.solo && previewDoc(ed.state.doc, ed.state.solo).emitters.find((x) => x.id === e().id) !== e());
  const level = createMemo(() => {
    const issues = ed.issues().filter((i) => i.emitterId === e().id);
    return issues.some((i) => i.level === "error") ? "error" : issues.length ? "warning" : null;
  });
  return (
    <div
      class={[
        "group flex h-8 items-center gap-1 rounded-md pr-1 text-xs",
        selected() ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
      ]}
      style={{ "padding-left": `${6 + props.row.depth * 14}px` }}
    >
      <Show when={props.row.child}>
        <Icon svg={CornerDownRight} class="size-3 shrink-0 text-muted-foreground/60" />
      </Show>
      <button
        type="button"
        aria-label={e().enabled === false ? "Enable emitter" : "Disable emitter"}
        title={e().enabled === false ? "Disabled (click to enable)" : "Enabled (click to disable)"}
        class={["size-2.5 shrink-0 rounded-full border", e().enabled === false ? "border-muted-foreground/60" : "border-emerald-400 bg-emerald-400"]}
        onClick={() => ed.run({ op: "updateEmitter", emitterId: e().id, props: { enabled: e().enabled === false } })}
      />
      <Show
        when={!renaming()}
        fallback={
          <input
            aria-label="Emitter name"
            class="h-6 min-w-0 flex-1 rounded bg-background px-1 text-xs outline-none"
            value={e().name}
            ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") ev.currentTarget.blur();
              if (ev.key === "Escape") setRenaming(false);
            }}
            onBlur={(ev) => {
              setRenaming(false);
              const v = ev.currentTarget.value.trim();
              if (v && v !== e().name) ed.run({ op: "updateEmitter", emitterId: e().id, props: { name: v } });
            }}
          />
        }
      >
        <button
          type="button"
          class={["min-w-0 flex-1 truncate py-1 pl-0.5 text-left", { "opacity-50": dimmed(), "font-medium": selected() }]}
          onClick={() => ed.select(e().id)}
          onDblClick={() => setRenaming(true)}
        >
          {e().name}
        </button>
      </Show>
      <Show when={level()}>
        <Icon svg={level() === "error" ? CircleAlert : TriangleAlert} class={["size-3 shrink-0", level() === "error" ? "text-red-400" : "text-amber-400"]} />
      </Show>
      <Tooltip content={soloed() ? "Stop soloing" : "Solo (preview only this emitter)"} side="right">
        <button
          type="button"
          aria-label="Solo emitter"
          aria-pressed={soloed() ? "true" : "false"}
          class={[
            "flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-background/60",
            soloed() ? "text-amber-400" : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          ]}
          onClick={() => ed.setSolo(e().id)}
        >
          <Icon svg={Crosshair} class="size-3.5" />
        </button>
      </Tooltip>
      <button
        type="button"
        aria-label="Emitter options"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background/60 hover:text-foreground focus-visible:opacity-100"
        onClick={(ev) => togglePopover(menu(), setMenu, ev)}
      >
        <Icon svg={Ellipsis} class="size-3.5" />
      </button>
      <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="start" side="right" onClose={() => setMenu(null)} class="w-44">
        <MenuItem icon={Pencil} onSelect={() => (setMenu(null), setRenaming(true))}>
          Rename
        </MenuItem>
        <MenuItem
          icon={Copy}
          onSelect={() => {
            setMenu(null);
            const r = ed.run<{ emitterId: string }>({ op: "duplicateEmitter", emitterId: e().id });
            if (r) ed.select(r.emitterId);
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem icon={ArrowUp} disabled={index() === 0} onSelect={() => (setMenu(null), ed.run({ op: "moveEmitter", emitterId: e().id, index: index() - 1 }))}>
          Move up
        </MenuItem>
        <MenuItem
          icon={ArrowDown}
          disabled={index() >= ed.state.doc.emitters.length - 1}
          onSelect={() => (setMenu(null), ed.run({ op: "moveEmitter", emitterId: e().id, index: index() + 1 }))}
        >
          Move down
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} destructive onSelect={() => (setMenu(null), ed.run({ op: "removeEmitter", emitterId: e().id }))}>
          Delete
        </MenuItem>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// parameters
// ---------------------------------------------------------------------------

function Parameters() {
  const ed = useContext(EditorContext);
  const add = () => {
    const names = new Set(ed.state.doc.parameters.map((p) => p.name));
    let n = 1;
    while (names.has(`param${n}`)) n++;
    ed.run({ op: "setParameter", parameter: { name: `param${n}`, type: "float", default: 1, min: 0, max: 1 } });
  };
  return (
    <div class="flex max-h-[45%] shrink-0 flex-col border-t">
      <div class="flex h-9 shrink-0 items-center justify-between pr-2 pl-3">
        <h2 class="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Parameters</h2>
        <Tooltip content="Add parameter" side="right">
          <button type="button" aria-label="Add parameter" class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={add}>
            <Icon svg={Plus} class="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div class="thin-scroll min-h-0 overflow-y-auto px-3 pb-3">
        <Show
          when={ed.state.doc.parameters.length}
          fallback={<p class="text-[11px] leading-relaxed text-muted-foreground">Knobs the game sets at runtime (throttle, size). Bind a value to one with its Parameter mode.</p>}
        >
          <div class="flex flex-col gap-3">
            <For each={ed.state.doc.parameters}>{(p) => <ParameterRow param={p} />}</For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ParameterRow(props: { param: EffectParameter }) {
  const ed = useContext(EditorContext);
  const [open, setOpen] = createSignal<PopoverAnchor | null>(null);
  const p = () => props.param;
  const value = () => ed.state.params[p().name] ?? p().default;
  const lo = () => p().min ?? Math.min(0, p().default);
  const hi = () => p().max ?? Math.max(1, p().default * 2);
  const update = (patch: Partial<EffectParameter>, merge?: string) => ed.run({ op: "setParameter", parameter: { ...p(), ...patch } }, { merge });
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate font-mono text-[11px]" title={p().description ?? p().name}>
          {p().name}
        </span>
        <span class="font-mono text-[10px] text-muted-foreground tabular-nums">{Math.round(value() * 100) / 100}</span>
        <button
          type="button"
          aria-label="Parameter settings"
          class="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(e) => togglePopover(open(), setOpen, e)}
        >
          <Icon svg={SlidersHorizontal} class="size-3" />
        </button>
      </div>
      <Slider value={value()} min={lo()} max={hi()} step={(hi() - lo()) / 200} onChange={(v) => ed.setParamValue(p().name, v)} />
      <Popover open={!!open()} anchor={open()?.rect} trigger={open()?.el} side="right" align="start" onClose={() => setOpen(null)} class="w-60 p-3">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <input
              aria-label="Parameter name"
              class="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={p().name}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (!name || name === p().name) return void (e.currentTarget.value = p().name);
                if (ed.state.doc.parameters.some((x) => x.name === name)) {
                  e.currentTarget.value = p().name;
                  return;
                }
                ed.run({ op: "batch", ops: [{ op: "removeParameter", name: p().name }, { op: "setParameter", parameter: { ...p(), name } }] });
              }}
            />
            <button
              type="button"
              aria-label="Delete parameter"
              class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
              onClick={() => {
                setOpen(null);
                ed.run({ op: "removeParameter", name: p().name });
              }}
            >
              <Icon svg={Trash2} class="size-3.5" />
            </button>
          </div>
          <NumberField label="default" value={p().default} onChange={(v) => update({ default: v }, `${p().name}.default`)} onCommit={() => ed.commit()} />
          <div class="grid grid-cols-2 gap-1">
            <NumberField label="min" value={p().min ?? 0} onChange={(v) => update({ min: v }, `${p().name}.min`)} onCommit={() => ed.commit()} />
            <NumberField label="max" value={p().max ?? 1} onChange={(v) => update({ max: v }, `${p().name}.max`)} onCommit={() => ed.commit()} />
          </div>
          <input
            aria-label="Parameter description"
            placeholder="Description"
            class="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={p().description ?? ""}
            onBlur={(e) => {
              const description = e.currentTarget.value.trim() || undefined;
              if (description !== p().description) update({ description });
            }}
          />
          <button
            type="button"
            class="flex h-7 items-center justify-center gap-1.5 rounded-md border text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => ed.setParamValue(p().name, p().default)}
          >
            <Icon svg={X} class="size-3" /> Reset preview value
          </button>
        </div>
      </Popover>
    </div>
  );
}
