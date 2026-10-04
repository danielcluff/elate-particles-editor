import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import {
  RENDERER_TYPES,
  getModuleDef,
  type EmitterDoc,
  type GraphMaterialRef,
  type Issue,
  type ModuleInstance,
  type RendererDoc,
  type RendererType,
  type SpriteRendererDoc,
  type Stage,
  type SubEmitterBinding,
} from "elate-particles";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, Copy, Ellipsis, ExternalLink, GripVertical, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-static";
import { Checkbox, Icon, MenuItem, MenuSeparator, NumberField, Popover, Select, Switch, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { EMITTER_FIELDS, LOD_FIELDS, RENDERER_FIELDS, RENDERER_LABELS, fieldGetter, fieldPatch, getField } from "./fields";
import { ModulePicker } from "./ModulePicker";
import { ShadersContext } from "./shaders";
import { EditorContext } from "./store";
import { FieldRow, ParamField, fieldVisible, type FieldDef } from "./widgets/ParamField";
import { summarizeFloat } from "./widgets/values";

const STAGE_INFO: Record<Stage, { title: string; hint: string; axis: string }> = {
  spawn: { title: "Spawn", hint: "how many, when", axis: "emitter cycle" },
  init: { title: "Initialize", hint: "once per particle", axis: "emitter cycle" },
  update: { title: "Update", hint: "every frame", axis: "particle life" },
  render: { title: "Render", hint: "over life, on the GPU", axis: "particle life" },
};

/** The selected emitter's module stack (right panel). */
export function StackPanel() {
  const ed = useContext(EditorContext);
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-sidebar shadow-lg" data-ui>
      <Show
        when={ed.emitter()}
        keyed
        fallback={<div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">Add an emitter to start</div>}
      >
        {(e) => <EmitterStack emitter={e} />}
      </Show>
    </div>
  );
}

function EmitterStack(props: { emitter: EmitterDoc }) {
  const ed = useContext(EditorContext);
  const e = () => props.emitter;
  const issues = createMemo(() => ed.issues().filter((i) => i.emitterId === e().id && !i.moduleId && !i.rendererId));
  return (
    <>
      <div class="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Checkbox
          checked={e().enabled !== false}
          label="Emitter enabled"
          onChange={(v) => ed.run({ op: "updateEmitter", emitterId: e().id, props: { enabled: v } })}
        />
        <input
          aria-label="Emitter name"
          class="h-7 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 text-sm font-semibold outline-none hover:bg-accent focus:bg-accent"
          value={e().name}
          onKeyDown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()}
          onBlur={(ev) => {
            const v = ev.currentTarget.value.trim();
            if (v && v !== e().name) ed.run({ op: "updateEmitter", emitterId: e().id, props: { name: v } });
            else ev.currentTarget.value = e().name;
          }}
        />
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{e().sim === "gpu" ? "GPU" : "CPU"}</span>
      </div>
      <div class="thin-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        <IssueList issues={issues()} class="mx-3 mt-3" />
        <EmitterSection emitter={e()} />
        <For each={["spawn", "init", "update", "render"] as Stage[]}>{(stage) => <StageSection emitter={e()} stage={stage} />}</For>
        <RendererSection emitter={e()} />
        <SubEmitterSection emitter={e()} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function IssueList(props: { issues: Issue[]; class?: string }) {
  return (
    <Show when={props.issues.length}>
      <div class={["flex flex-col gap-1", props.class]}>
        <For each={props.issues}>
          {(i) => (
            <div
              class={[
                "flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px] leading-snug",
                i.level === "error" ? "bg-red-500/15 text-red-400" : "bg-amber-500/10 text-amber-400",
              ]}
            >
              <Icon svg={i.level === "error" ? CircleAlert : TriangleAlert} class="mt-px size-3 shrink-0" />
              <span class="min-w-0 break-words">{i.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Collapsible stack section with a coloured stage marker. */
function Section(props: { id: string; stage: string; title: string; hint?: string; count?: number; action?: unknown; children: unknown; defaultCollapsed?: boolean }) {
  const ed = useContext(EditorContext);
  const collapsed = () => ed.state.collapsed[props.id] ?? !!props.defaultCollapsed;
  return (
    <section class={["border-b last:border-b-0", `stage-${props.stage}`]}>
      <div class="flex h-9 items-center gap-1.5 pr-2 pl-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => ed.toggleCollapsed(props.id, !collapsed())}
        >
          <Icon svg={collapsed() ? ChevronRight : ChevronDown} class="size-3.5 shrink-0 text-muted-foreground/70" />
          <span class="size-2 shrink-0 rounded-full bg-(--stage)" />
          <span class="text-[11px] font-semibold tracking-widest uppercase">{props.title}</span>
          <Show when={props.count}>
            <span class="rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground">{props.count}</span>
          </Show>
          <Show when={props.hint}>
            <span class="truncate text-[10px] text-muted-foreground/70">{props.hint}</span>
          </Show>
        </button>
        {props.action as never}
      </div>
      <Show when={!collapsed()}>
        <div class="flex flex-col gap-1.5 px-2 pb-3">{props.children as never}</div>
      </Show>
    </section>
  );
}

function AddButton(props: { label: string; onClick: (e: MouseEvent) => void; active?: boolean }) {
  return (
    <Tooltip content={props.label} side="left">
      <button
        type="button"
        aria-label={props.label}
        class={["flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", { "bg-accent text-foreground": !!props.active }]}
        onClick={(e) => props.onClick(e)}
      >
        <Icon svg={Plus} class="size-3.5" />
      </button>
    </Tooltip>
  );
}

/** Fields of a plain object (emitter, renderer), with showIf and dotted keys. */
function ObjectFields(props: { obj: Record<string, unknown>; defs: FieldDef[]; mergePrefix: string; onPatch: (patch: Record<string, unknown>, merge: string) => void }) {
  const ed = useContext(EditorContext);
  const get = () => fieldGetter(props.obj, props.defs);
  return (
    <For each={props.defs}>
      {(def) => (
        <Show when={fieldVisible(def, get())}>
          <ParamField
            def={def}
            value={getField(props.obj, def)}
            params={ed.state.doc.parameters}
            onChange={(v) => props.onPatch(fieldPatch(props.obj, def.key, v), `${props.mergePrefix}.${def.key}`)}
            onCommit={() => ed.commit()}
          />
        </Show>
      )}
    </For>
  );
}

// ---------------------------------------------------------------------------
// emitter settings
// ---------------------------------------------------------------------------

function EmitterSection(props: { emitter: EmitterDoc }) {
  const ed = useContext(EditorContext);
  const patch = (p: Record<string, unknown>, merge: string) =>
    ed.run({ op: "updateEmitter", emitterId: props.emitter.id, props: p as never }, { merge });
  return (
    <Section id={`${props.emitter.id}:emitter`} stage="emitter" title="Emitter" hint={`${props.emitter.duration}s${props.emitter.looping ? " loop" : ""}`}>
      <ObjectFields obj={props.emitter as never} defs={EMITTER_FIELDS} mergePrefix={props.emitter.id} onPatch={patch} />
      <div class="mt-1 border-t pt-2">
        <div class="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Level of detail</div>
        <div class="flex flex-col gap-1.5">
          <ObjectFields obj={props.emitter as never} defs={LOD_FIELDS} mergePrefix={props.emitter.id} onPatch={patch} />
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// module stages
// ---------------------------------------------------------------------------

function StageSection(props: { emitter: EmitterDoc; stage: Stage }) {
  const ed = useContext(EditorContext);
  const [picker, setPicker] = createSignal<PopoverAnchor | null>(null);
  const info = () => STAGE_INFO[props.stage];
  const list = () => props.emitter[props.stage];
  return (
    <Section
      id={`${props.emitter.id}:${props.stage}`}
      stage={props.stage}
      title={info().title}
      hint={info().hint}
      count={list().length}
      action={
        <>
          <AddButton label={`Add ${info().title.toLowerCase()} module`} active={!!picker()} onClick={(e) => togglePopover(picker(), setPicker, e)} />
          <Popover open={!!picker()} anchor={picker()?.rect} trigger={picker()?.el} side="left" align="start" onClose={() => setPicker(null)} class="p-0">
            <ModulePicker
              stage={props.stage}
              emitter={props.emitter}
              onPick={(def) => {
                setPicker(null);
                const r = ed.run<{ moduleId: string }>({ op: "addModule", emitterId: props.emitter.id, type: def.type });
                if (r) ed.toggleCollapsed(r.moduleId, false);
              }}
            />
          </Popover>
        </>
      }
    >
      <Show
        when={list().length}
        fallback={
          <Show when={props.stage === "spawn" && !props.emitter.eventDriven}>
            <p class="px-1 text-[11px] text-muted-foreground">No spawn modules: this emitter only spawns from sub-emitter events.</p>
          </Show>
        }
      >
        <For each={list()}>{(m, i) => <ModuleCard emitter={props.emitter} stage={props.stage} module={m} index={i()} count={list().length} />}</For>
      </Show>
    </Section>
  );
}

const DRAG_TYPE = "application/x-elate-module";

function moduleSummary(m: ModuleInstance): string {
  const def = getModuleDef(m.type);
  if (!def) return m.type;
  const p = m.params;
  switch (m.type) {
    case "spawn.burst":
      return `${summarizeFloat(p.count)} @ ${p.time}s${(p.cycles as number) > 1 ? ` ×${p.cycles}` : ""}`;
    case "init.shape":
      return String(p.shape ?? "");
  }
  const first = def.params[0];
  if (!first) return "";
  const v = p[first.key];
  if (first.type === "floatValue" || first.type === "float" || first.type === "int") return summarizeFloat(v) + (first.unit && typeof v === "number" ? ` ${first.unit}` : "");
  if (first.type === "enum" || first.type === "string") return String(v ?? "");
  if (first.type === "vec3" && Array.isArray(v)) return v.map((n) => Math.round(n * 100) / 100).join(", ");
  if (first.type === "colorValue") return typeof v === "string" ? v : (v as { kind: string })?.kind ?? "";
  return "";
}

function ModuleCard(props: { emitter: EmitterDoc; stage: Stage; module: ModuleInstance; index: number; count: number }) {
  const ed = useContext(EditorContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  const [renaming, setRenaming] = createSignal(false);
  const [dropSide, setDropSide] = createSignal<"above" | "below" | null>(null);
  const m = () => props.module;
  const def = createMemo(() => getModuleDef(props.module.type));
  const enabled = () => m().enabled !== false;
  const collapsed = () => !!ed.state.collapsed[m().id];
  const issues = createMemo(() => ed.issues().filter((i) => i.moduleId === props.module.id));
  const visible = createMemo(() => (def()?.params ?? []).filter((p) => fieldVisible(p, (k) => m().params[k])));
  const ids = () => ({ emitterId: props.emitter.id, moduleId: m().id });
  const move = (index: number) => ed.run({ op: "moveModule", ...ids(), index });

  return (
    <div
      class={[
        "relative rounded-lg border bg-card transition-opacity",
        { "opacity-55": !enabled(), "border-red-500/50": issues().some((i) => i.level === "error") },
      ]}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes(`${DRAG_TYPE}-${props.stage}`)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropSide(e.clientY < r.top + r.height / 2 ? "above" : "below");
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        const id = e.dataTransfer?.getData(DRAG_TYPE);
        const side = dropSide();
        setDropSide(null);
        if (!id || id === m().id) return;
        e.preventDefault();
        const from = props.emitter[props.stage].findIndex((x) => x.id === id);
        let to = props.index + (side === "below" ? 1 : 0);
        if (from < to) to--;
        ed.run({ op: "moveModule", emitterId: props.emitter.id, moduleId: id, index: to });
      }}
    >
      <Show when={dropSide()}>
        <div class={["pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-sky-400", dropSide() === "above" ? "-top-1" : "-bottom-1"]} />
      </Show>
      <div class="flex h-8 items-center gap-1 pr-1 pl-0.5">
        <span
          draggable="true"
          title="Drag to reorder"
          class="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 hover:text-muted-foreground"
          onDragStart={(e) => {
            e.dataTransfer!.setData(DRAG_TYPE, m().id);
            e.dataTransfer!.setData(`${DRAG_TYPE}-${props.stage}`, "");
            e.dataTransfer!.effectAllowed = "move";
            const card = e.currentTarget.closest("div.relative") as HTMLElement | null;
            if (card) e.dataTransfer!.setDragImage(card, 10, 10);
          }}
        >
          <Icon svg={GripVertical} class="size-3.5" />
        </span>
        <Checkbox checked={enabled()} label="Module enabled" onChange={(v) => ed.run({ op: "updateModule", ...ids(), enabled: v })} />
        <Show
          when={!renaming()}
          fallback={
            <input
              aria-label="Module label"
              class="h-6 min-w-0 flex-1 rounded-md bg-accent px-1.5 text-xs font-medium outline-none"
              value={m().label ?? def()?.label ?? m().type}
              ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={(e) => {
                setRenaming(false);
                const v = e.currentTarget.value.trim();
                ed.run({ op: "updateModule", ...ids(), label: v === def()?.label ? "" : v });
              }}
            />
          }
        >
          <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => ed.toggleCollapsed(m().id)} onDblClick={() => setRenaming(true)}>
            <span class="truncate text-xs font-medium">{m().label ?? def()?.label ?? m().type}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{moduleSummary(m())}</span>
            <Icon svg={collapsed() ? ChevronRight : ChevronDown} class="size-3 shrink-0 text-muted-foreground/60" />
          </button>
        </Show>
        <button
          type="button"
          aria-label="Module options"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(e) => togglePopover(menu(), setMenu, e)}
        >
          <Icon svg={Ellipsis} class="size-3.5" />
        </button>
        <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)} class="w-44">
          <MenuItem icon={Pencil} onSelect={() => (setMenu(null), setRenaming(true))}>
            Rename
          </MenuItem>
          <MenuItem
            icon={Copy}
            disabled={def()?.multiple === false}
            onSelect={() => {
              setMenu(null);
              ed.run({ op: "addModule", emitterId: props.emitter.id, type: m().type, params: structuredClone(m().params), label: m().label, index: props.index + 1 });
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem icon={ArrowUp} disabled={props.index === 0} onSelect={() => (setMenu(null), move(props.index - 1))}>
            Move up
          </MenuItem>
          <MenuItem icon={ArrowDown} disabled={props.index >= props.count - 1} onSelect={() => (setMenu(null), move(props.index + 1))}>
            Move down
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={Trash2} destructive onSelect={() => (setMenu(null), ed.run({ op: "removeModule", ...ids() }))}>
            Remove
          </MenuItem>
        </Popover>
      </div>
      <Show when={!collapsed()}>
        <div class="flex flex-col gap-1.5 border-t px-2 py-2">
          <Show when={def()} fallback={<p class="text-[11px] text-destructive">Unknown module type "{m().type}"; it is skipped.</p>}>
            <Show when={def()!.description}>
              <p class="text-[10px] leading-snug text-muted-foreground/80">{def()!.description}</p>
            </Show>
            <For each={visible()}>
              {(p) => (
                <ParamField
                  def={p}
                  value={m().params[p.key] ?? p.default}
                  params={ed.state.doc.parameters}
                  curveAxis={STAGE_INFO[props.stage].axis}
                  onChange={(v) => ed.run({ op: "updateModule", ...ids(), params: { [p.key]: v } }, { merge: `${m().id}.${p.key}` })}
                  onCommit={() => ed.commit()}
                />
              )}
            </For>
          </Show>
          <IssueList issues={issues()} />
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// renderers
// ---------------------------------------------------------------------------

function rendererSummary(r: RendererDoc): string {
  switch (r.type) {
    case "sprite":
      return `${r.material ? "graph" : r.shape} · ${r.blend}${r.facing !== "camera" ? ` · ${r.facing}` : ""}`;
    case "mesh":
      return `${r.mesh} · ${r.blend}`;
    case "ribbon":
      return `${r.mode ?? "emitter"} · ${r.blend}`;
    case "light":
      return `${Math.round(r.ratio * 100)}% · max ${r.maxLights}`;
  }
}

function RendererSection(props: { emitter: EmitterDoc }) {
  const ed = useContext(EditorContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  return (
    <Section
      id={`${props.emitter.id}:renderers`}
      stage="renderer"
      title="Renderers"
      hint="how particles draw"
      count={props.emitter.renderers.length}
      action={
        <>
          <AddButton label="Add renderer" active={!!menu()} onClick={(e) => togglePopover(menu(), setMenu, e)} />
          <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)} class="w-40">
            <For each={RENDERER_TYPES}>
              {(t) => (
                <MenuItem
                  onSelect={() => {
                    setMenu(null);
                    ed.run({ op: "addRenderer", emitterId: props.emitter.id, renderer: { type: t } });
                  }}
                >
                  {RENDERER_LABELS[t]}
                </MenuItem>
              )}
            </For>
          </Popover>
        </>
      }
    >
      <Show when={props.emitter.renderers.length} fallback={<p class="px-1 text-[11px] text-muted-foreground">No renderers: the emitter simulates (and can drive sub-emitters) but draws nothing.</p>}>
        <For each={props.emitter.renderers}>{(r, i) => <RendererCard emitter={props.emitter} renderer={r} index={i()} />}</For>
      </Show>
    </Section>
  );
}

function RendererCard(props: { emitter: EmitterDoc; renderer: RendererDoc; index: number }) {
  const ed = useContext(EditorContext);
  const shaders = useContext(ShadersContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  const r = () => props.renderer;
  const key = () => `${props.emitter.id}:r:${r().id}`;
  const collapsed = () => !!ed.state.collapsed[key()];
  const issues = createMemo(() => ed.issues().filter((i) => i.rendererId === props.renderer.id && i.emitterId === props.emitter.id));
  const set = (renderer: Partial<RendererDoc>, merge?: string) => ed.run({ op: "setRenderer", emitterId: props.emitter.id, rendererId: r().id, renderer }, { merge });
  return (
    <div class={["rounded-lg border bg-card", { "opacity-55": r().enabled === false }]}>
      <div class="flex h-8 items-center gap-1.5 pr-1 pl-2">
        <Checkbox checked={r().enabled !== false} label="Renderer enabled" onChange={(v) => set({ enabled: v })} />
        <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => ed.toggleCollapsed(key())}>
          <span class="text-xs font-medium">{RENDERER_LABELS[r().type]}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{rendererSummary(r())}</span>
          <Icon svg={collapsed() ? ChevronRight : ChevronDown} class="size-3 shrink-0 text-muted-foreground/60" />
        </button>
        <button
          type="button"
          aria-label="Renderer options"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(e) => togglePopover(menu(), setMenu, e)}
        >
          <Icon svg={Ellipsis} class="size-3.5" />
        </button>
        <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)} class="w-44">
          <MenuItem
            icon={Copy}
            onSelect={() => {
              setMenu(null);
              const { id: _id, ...copy } = structuredClone({ ...r() });
              ed.run({ op: "addRenderer", emitterId: props.emitter.id, renderer: copy as never, index: props.index + 1 });
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem icon={ArrowUp} disabled={props.index === 0} onSelect={() => (setMenu(null), ed.run({ op: "moveRenderer", emitterId: props.emitter.id, rendererId: r().id!, index: props.index - 1 }))}>
            Move up
          </MenuItem>
          <MenuItem
            icon={ArrowDown}
            disabled={props.index >= props.emitter.renderers.length - 1}
            onSelect={() => (setMenu(null), ed.run({ op: "moveRenderer", emitterId: props.emitter.id, rendererId: r().id!, index: props.index + 1 }))}
          >
            Move down
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={Trash2} destructive onSelect={() => (setMenu(null), ed.run({ op: "removeRenderer", emitterId: props.emitter.id, rendererId: r().id! }))}>
            Remove
          </MenuItem>
        </Popover>
      </div>
      <Show when={!collapsed()}>
        <div class="flex flex-col gap-1.5 border-t px-2 py-2">
          <FieldRow label="Type">
            <Select
              class="h-7 text-xs"
              value={r().type}
              options={RENDERER_TYPES.map((t) => ({ value: t, label: RENDERER_LABELS[t] }))}
              onChange={(t) => set({ type: t as RendererType })}
            />
          </FieldRow>
          <Show when={r().type === "sprite" && (shaders.available || (r() as SpriteRendererDoc).material)}>
            <MaterialField renderer={r() as SpriteRendererDoc} onChange={(material) => set({ material } as Partial<RendererDoc>)} />
          </Show>
          <ObjectFields obj={r() as never} defs={RENDERER_FIELDS[r().type]} mergePrefix={key()} onPatch={(p, merge) => set(p as Partial<RendererDoc>, merge)} />
          <IssueList issues={issues()} />
        </div>
      </Show>
    </div>
  );
}

/** Sprite look: built-in (colour × shape) or a shader graph from the host. */
function MaterialField(props: { renderer: SpriteRendererDoc; onChange: (m: GraphMaterialRef | undefined) => void }) {
  const shaders = useContext(ShadersContext);
  const id = () => (props.renderer.material?.kind === "graph" ? props.renderer.material.shaderId : "");
  const summary = () => shaders.state.list.find((s) => s.id === id());
  const options = () => [
    { value: "", label: "Built-in (colour × shape)" },
    ...shaders.state.list.map((s) => ({ value: s.id, label: s.name })),
    ...(id() && !summary() ? [{ value: id(), label: `${id()} (not found)` }] : []),
  ];
  const edit = (shaderId: string) => {
    const url = shaders.editUrl(shaderId);
    if (url) window.open(url, "_blank");
  };
  return (
    <>
      <FieldRow label="Material" title="Built-in look, or a particle shader graph (tsl-graph) that sets each particle's colour and opacity">
        <div class="flex w-full items-center gap-1" onPointerDown={() => void shaders.refreshList()}>
          <Select class="h-7 min-w-0 flex-1 text-xs" value={id()} options={options()} onChange={(v) => props.onChange(v ? { kind: "graph", shaderId: v } : undefined)} />
          <Show when={!id() && shaders.canCreate}>
            <Tooltip content="New particle shader" side="left">
              <button
                type="button"
                aria-label="New particle shader"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={async () => {
                  const shaderId = await shaders.create("Particle Shader");
                  await shaders.refreshList();
                  props.onChange({ kind: "graph", shaderId });
                  edit(shaderId);
                }}
              >
                <Icon svg={Plus} class="size-3.5" />
              </button>
            </Tooltip>
          </Show>
        </div>
      </FieldRow>
      <Show when={id()}>
        <div class="flex items-center gap-2 rounded-md border bg-background/40 p-1.5">
          <Show when={summary()?.thumbnail} fallback={<div class="checker h-9 w-14 shrink-0 rounded" />}>
            {(src) => <img src={src()} alt="" class="h-9 w-14 shrink-0 rounded object-cover" />}
          </Show>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[11px] font-medium">{summary()?.name ?? id()}</div>
            <Show
              when={shaders.state.failed[id()]}
              fallback={<div class="text-[10px] text-muted-foreground">Shader graph sets colour and opacity</div>}
            >
              {(msg) => <div class="truncate text-[10px] text-red-400" title={msg()}>{msg()}</div>}
            </Show>
          </div>
          <Show when={shaders.editUrl(id())}>
            <Tooltip content="Edit in shader graph (new tab); changes apply when you come back" side="left">
              <button
                type="button"
                class="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => edit(id())}
              >
                <Icon svg={ExternalLink} class="size-3" /> Edit
              </button>
            </Tooltip>
          </Show>
        </div>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// sub-emitters
// ---------------------------------------------------------------------------

function SubEmitterSection(props: { emitter: EmitterDoc }) {
  const ed = useContext(EditorContext);
  const list = () => props.emitter.subEmitters ?? [];
  const targets = () => ed.state.doc.emitters.filter((x) => x.id !== props.emitter.id);
  const write = (next: SubEmitterBinding[], merge?: string) => ed.run({ op: "setSubEmitters", emitterId: props.emitter.id, subEmitters: next }, { merge });
  const patch = (i: number, p: Partial<SubEmitterBinding>, merge?: string) => write(list().map((s, j) => (j === i ? { ...s, ...p } : s)), merge);
  return (
    <Section
      id={`${props.emitter.id}:sub`}
      stage="emitter"
      title="Sub-emitters"
      hint="spawn on birth / death"
      count={list().length}
      defaultCollapsed={!list().length}
      action={
        <AddButton
          label="Add sub-emitter"
          onClick={() => {
            const target = targets()[0];
            if (!target) return;
            ed.toggleCollapsed(`${props.emitter.id}:sub`, false);
            write([...list(), { trigger: "death", emitter: target.id, count: 10 }]);
          }}
        />
      }
    >
      <Show when={targets().length} fallback={<p class="px-1 text-[11px] text-muted-foreground">Add another emitter to use it as a sub-emitter.</p>}>
        <Show when={list().length} fallback={<p class="px-1 text-[11px] text-muted-foreground">Spawn particles in another emitter when this one's particles are born or die.</p>}>
          <For each={list()}>
            {(s, i) => (
              <div class="flex flex-col gap-1.5 rounded-lg border bg-card p-2">
                <div class="flex items-center gap-1">
                  <Select
                    class="h-7 w-20 shrink-0 text-xs"
                    value={s.trigger}
                    options={[
                      { value: "birth", label: "birth" },
                      { value: "death", label: "death" },
                    ]}
                    onChange={(v) => patch(i(), { trigger: v as "birth" | "death" })}
                  />
                  <span class="text-[11px] text-muted-foreground">→</span>
                  <Select class="h-7 min-w-0 flex-1 text-xs" value={s.emitter} options={targets().map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => patch(i(), { emitter: v })} />
                  <button
                    type="button"
                    aria-label="Remove sub-emitter"
                    class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    onClick={() => write(list().filter((_, j) => j !== i()))}
                  >
                    <Icon svg={X} class="size-3.5" />
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <NumberField label="count" integer min={0} value={s.count} onChange={(v) => patch(i(), { count: v }, `sub${i()}.count`)} onCommit={() => ed.commit()} />
                  <NumberField label="chance" min={0} max={1} step={0.01} value={s.probability ?? 1} onChange={(v) => patch(i(), { probability: v }, `sub${i()}.p`)} onCommit={() => ed.commit()} />
                  <NumberField label="inherit v" min={0} step={0.05} value={s.inheritVelocity ?? 0} onChange={(v) => patch(i(), { inheritVelocity: v }, `sub${i()}.v`)} onCommit={() => ed.commit()} />
                  <label class="flex h-7 items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    <Switch checked={!!s.inheritColor} label="Inherit colour" onChange={(v) => patch(i(), { inheritColor: v })} />
                    colour
                  </label>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </Section>
  );
}
