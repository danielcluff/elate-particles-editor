// One tool table shared by the MCP server and the in-editor AI chat agent.
// Every editing tool is a thin wrapper over a runtime Command, so agents get
// the same validation and undo granularity as the editor UI.
import { z } from "zod";
import {
  RENDERER_TYPES,
  STAGES,
  describeModuleType,
  executeCommand,
  isReadOnly,
  listModuleTypes,
  validateEffect,
  type Command,
  type EffectDoc,
  type EmitterDoc,
} from "elate-particles";
import type { EffectStore, ShaderSummary } from "../host";
import type { Bridge } from "./bridge";

export const INSTRUCTIONS = `Elate Particles is a data-driven particle system for three.js (WebGPU). These tools edit effect documents (*.fx.json).

Model: an effect is a list of emitters. Each emitter is a stack of modules grouped by stage:
  spawn   how many particles to create this frame (spawn.rate, spawn.burst, spawn.distance)
  init    runs once on each new particle (init.lifetime, init.shape, init.velocity, init.size, init.color, …)
  update  runs every frame on every particle (update.gravity, update.force, update.drag, update.turbulence, …)
  render  evaluated on the GPU over normalised age (render.sizeOverLife, render.colorOverLife)
plus renderers (sprite | mesh | ribbon | light; an emitter can have several, each its own draw call) and sub-emitters (spawn particles in another emitter when particles are born or die). Emitter fields: duration (s per cycle), looping, startDelay, prewarm, maxParticles, space (world|local), sim (cpu|gpu), eventDriven (spawns only from sub-emitter events).

Value shapes used by module params:
  FloatValue  number | {kind:"range",min,max} | {kind:"curve",curve,scale?} | {kind:"rangeCurve",min:curve,max:curve,scale?} | {kind:"param",name,scale?,offset?}
  curve       {keys:[{t,v},…], interp?:"linear"|"smooth"|"step"}, t in 0..1: the emitter cycle for spawn/init modules, the particle's age for update/render modules.
  ColorValue  "#rrggbb" | {kind:"constant",color,alpha?,intensity?} | {kind:"range",a,b,alphaA?,alphaB?,intensity?} | {kind:"gradient"|"randomGradient",gradient:{colors:[{t,color}],alphas:[{t,a}],intensity?}}
  intensity > 1 is HDR (drives bloom). "param" binds a value to an effect parameter (set at runtime, e.g. throttle): param*scale+offset.

Workflow:
1. list_effects / create_effect, or omit effectId to use the effect open in the browser editor.
2. get_effect (summary:true for an outline with ids) to see emitters, modules and renderers. list_module_types / get_module_type for module schemas.
3. Edit with add_emitter, add_module, update_module, set_renderer, … or apply_operations to do many steps as one undo step, using "ref" names ("$name") for objects created earlier in the same call.
4. validate_effect reports problems. When the effect is open in the editor, capture_preview returns a screenshot at a given time and get_stats returns live particle counts.

Tips: update_module merges params (only the keys you pass change). Emitters can be addressed by id or by name. Most effects layer several emitters (e.g. flash + fireball + sparks + smoke). Additive blending suits fire, sparks and glows; alpha (with sort "distance") suits smoke.`;

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** Tools that manage effects rather than editing the open one (hidden from the in-editor chat). */
  projectManagement?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
}

export interface ToolContext {
  store: EffectStore;
  bridge: Bridge;
  /** Link to an effect in the host app, included in tool results when given. */
  projectUrl?: (id: string) => string;
  /** Shader graphs sprites can use (enables list_shaders). */
  shaders?: { list(): Promise<ShaderSummary[]> };
}

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

const effectIdSchema = z.string().optional().describe("Effect id. Omit to use the effect currently open in the browser editor.");
const emitterId = z.string().describe("Emitter id (or name)");
const moduleId = z.string().describe("Module instance id");
const rendererId = z.string().describe("Renderer id within the emitter");
const ref = z.string().optional().describe('Name for the new object; later operations in the same apply_operations call can use "$name" as its id');
const emitterProps = z
  .record(z.string(), z.any())
  .describe("Emitter fields: name, enabled, duration, looping, startDelay, prewarm, maxParticles, space, sim, eventDriven, seed, lod {maxDistance, minQuality, scaleSpawn}");
const rendererFields = z
  .record(z.string(), z.any())
  .describe(
    'Renderer fields. All: type, enabled, sort ("none"|"distance"|"oldestOnTop"|"newestOnTop"), sortOrder. sprite: material {kind:"graph", shaderId} (a particle shader graph from list_shaders; omit for the built-in look), blend, shape (softCircle|circle|glow|spark|ring|square|texture), texture, flipbook {cols,rows,mode,fps}, facing (camera|velocity|horizontal), stretch, softness, depthFade, cameraFade, sortGroup. mesh: blend, mesh (box|sphere|icosahedron|…), orientation (random|velocity|fixed), lit, roughness, metalness, texture. ribbon: mode (emitter|particle), trail {points,minDistance,lifetime}, taper, fade, blend, shape, facing, uvMode, uvTile. light: ratio, maxLights, intensity, range, useParticleColor, color, alphaAffectsIntensity, sizeAffectsRange. blend: additive|alpha|premultiplied|opaque.',
  );
const subEmitter = z.object({
  trigger: z.enum(["birth", "death"]),
  emitter: z.string().describe("Target emitter id or name"),
  count: z.number(),
  probability: z.number().optional(),
  inheritVelocity: z.number().optional(),
  inheritColor: z.boolean().optional(),
});

type A = Record<string, unknown>;
const eid = (a: A) => a.effectId as string | undefined;
/** Command fields = tool args minus effectId. */
const cmd = <T extends Command["op"]>(op: T, a: A) => {
  const { effectId: _e, ...rest } = a;
  return { op, ...rest } as unknown as Extract<Command, { op: T }>;
};

// ---------------------------------------------------------------------------
// outlines
// ---------------------------------------------------------------------------

function short(v: unknown): unknown {
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v && typeof v === "object" && "kind" in v) {
    const o = v as Record<string, unknown>;
    if (o.kind === "range") return `${o.min}..${o.max}`;
    if (o.kind === "param") return `@${o.name}`;
    if (o.kind === "constant") return o.color;
    return o.kind;
  }
  if (Array.isArray(v)) return v.length <= 4 ? v : `[${v.length}]`;
  return v && typeof v === "object" ? "{…}" : v;
}

/** Compact outline of an emitter: ids, module types with short param values, renderers, sub-emitters. */
function outlineEmitter(e: EmitterDoc) {
  const mods = Object.fromEntries(
    STAGES.map((s) => [
      s,
      e[s].map((m) => ({
        id: m.id,
        type: m.type,
        ...(m.label ? { label: m.label } : {}),
        ...(m.enabled === false ? { enabled: false } : {}),
        params: Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, short(v)])),
      })),
    ]),
  );
  return {
    id: e.id,
    name: e.name,
    ...(e.enabled === false ? { enabled: false } : {}),
    duration: e.duration,
    looping: e.looping,
    startDelay: e.startDelay,
    maxParticles: e.maxParticles,
    space: e.space,
    sim: e.sim ?? "cpu",
    ...(e.eventDriven ? { eventDriven: true } : {}),
    ...mods,
    renderers: e.renderers.map((r) => ({ id: r.id, type: r.type, ...("blend" in r ? { blend: r.blend } : {}), ...("shape" in r ? { shape: r.shape } : {}), ...(r.enabled === false ? { enabled: false } : {}) })),
    ...(e.subEmitters?.length ? { subEmitters: e.subEmitters } : {}),
  };
}

export function outlineEffect(doc: EffectDoc) {
  return { id: doc.id, name: doc.name, parameters: doc.parameters, emitters: doc.emitters.map(outlineEmitter) };
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

export function createTools(ctx: ToolContext): ToolSpec[] {
  const { store, bridge } = ctx;
  const url = (id: string) => (ctx.projectUrl ? { url: ctx.projectUrl(id) } : {});

  async function resolveEffectId(effectId?: string): Promise<string> {
    if (effectId) return effectId;
    const editors = bridge.openEditors().filter((e) => e.effectId);
    const visible = editors.find((e) => e.visible) ?? editors[0];
    if (visible?.effectId) return visible.effectId;
    throw new Error("No effectId given and no effect is open in the editor. Use list_effects or create_effect.");
  }

  /** Runs a command on the live editor when one has the effect open (undo, live preview), else on the stored file. */
  async function runCommand(effectIdArg: string | undefined, command: Command): Promise<unknown> {
    const effectId = await resolveEffectId(effectIdArg);
    const live = bridge.liveEditorFor(effectId);
    if (live) return bridge.call(live, "command", { effectId, command });
    const doc = await store.get(effectId);
    if (!doc) throw new Error(`Effect "${effectId}" not found`);
    const result = executeCommand(doc, command);
    if (!isReadOnly(command)) {
      await store.save(doc);
      bridge.broadcast(effectId, { type: "reload", effectId });
    }
    return result;
  }

  async function getDoc(effectIdArg?: string): Promise<EffectDoc> {
    return (await runCommand(effectIdArg, { op: "getEffect" })) as EffectDoc;
  }

  function navigateEditor(effectId: string): boolean {
    const editors = bridge.openEditors();
    const target = editors.find((e) => e.visible) ?? editors[0];
    if (!target) return false;
    return bridge.navigate(target.clientId, effectId);
  }

  async function liveEditor(effectIdArg?: string) {
    const id = await resolveEffectId(effectIdArg);
    const live = bridge.liveEditorFor(id);
    if (!live) throw new Error("The effect is not open in the editor; call open_effect first (or ask the user to open it).");
    return live;
  }

  return [
    // ---- effects ---------------------------------------------------------------
    {
      name: "list_effects",
      description: "List saved effects (most recently edited first) and which are open in the editor.",
      shape: {},
      projectManagement: true,
      run: async () => {
        const list = await store.list();
        const open = new Set(bridge.openEditors().map((e) => e.effectId));
        return ok(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            emitters: p.emitterCount,
            updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
            openInEditor: open.has(p.id),
            ...url(p.id),
          })),
        );
      },
    },
    {
      name: "create_effect",
      description:
        "Create a new effect: one default emitter (spawn rate, lifetime, shape, size, colour, drag, size/colour over life, an additive sprite), or none with empty:true. Set open=true to show it in a connected editor tab.",
      shape: { name: z.string().optional(), empty: z.boolean().optional(), open: z.boolean().optional() },
      projectManagement: true,
      run: async (a) => {
        const doc = await store.create((a.name as string | undefined) ?? "New Effect");
        if (a.empty) {
          doc.emitters = [];
          await store.save(doc);
        }
        const opened = a.open ? navigateEditor(doc.id) : false;
        return ok({ effectId: doc.id, name: doc.name, emitters: doc.emitters.map((e) => ({ id: e.id, name: e.name })), ...url(doc.id), openedInEditor: opened });
      },
    },
    {
      name: "open_effect",
      description: "Navigate the connected browser editor to an effect so changes appear live (and capture_preview / get_stats work).",
      shape: { effectId: z.string() },
      projectManagement: true,
      run: async (a) => {
        const effectId = a.effectId as string;
        if (!(await store.get(effectId))) throw new Error(`Effect "${effectId}" not found`);
        const opened = navigateEditor(effectId);
        return ok({ ...url(effectId), openedInEditor: opened, ...(opened ? {} : { note: "No editor tab is connected; ask the user to open the effect." }) });
      },
    },
    {
      name: "get_effect",
      description:
        "The effect document. summary:true returns a compact outline (ids, module types, short param values) that is usually enough to plan edits; emitterId returns one emitter in full.",
      shape: { effectId: effectIdSchema, summary: z.boolean().optional(), emitterId: z.string().optional().describe("Return only this emitter (id or name)") },
      run: async (a) => {
        const doc = await getDoc(eid(a));
        if (a.emitterId) {
          const e = doc.emitters.find((x) => x.id === a.emitterId) ?? doc.emitters.find((x) => x.name === a.emitterId);
          if (!e) throw new Error(`Emitter "${a.emitterId}" not found`);
          return ok(a.summary ? outlineEmitter(e) : e);
        }
        return ok(a.summary ? outlineEffect(doc) : doc);
      },
    },
    {
      name: "rename_effect",
      description: "Rename the effect.",
      shape: { effectId: effectIdSchema, name: z.string() },
      run: async (a) => ok(await runCommand(eid(a), cmd("rename", a))),
    },

    // ---- module catalogue --------------------------------------------------------
    {
      name: "list_module_types",
      description: "List module types (type, stage, label, category, description). Filter by stage (spawn|init|update|render) or free-text search.",
      shape: { stage: z.enum(["spawn", "init", "update", "render"]).optional(), search: z.string().optional() },
      run: async (a) => {
        const q = ((a.search as string | undefined) ?? "").toLowerCase();
        const list = listModuleTypes().filter(
          (m) => (!a.stage || m.stage === a.stage) && (!q || `${m.type} ${m.label} ${m.category} ${m.description}`.toLowerCase().includes(q)),
        );
        return ok(list.length ? list : "No matching module types.");
      },
    },
    {
      name: "get_module_type",
      description: "Full schema of a module type: params (key, type, default, min/max, unit, options, showIf) and whether several instances are allowed.",
      shape: { type: z.string().describe('e.g. "init.shape"') },
      run: async (a) => ok(describeModuleType(a.type as string)),
    },

    // ---- emitters ------------------------------------------------------------------
    {
      name: "add_emitter",
      description:
        'Add an emitter. template "default" (spawn rate, lifetime, shape, size, colour, drag, size/colour over life, an additive sprite) or "empty" (no modules, one sprite renderer). props sets emitter fields.',
      shape: { effectId: effectIdSchema, name: z.string().optional(), template: z.enum(["default", "empty"]).optional(), props: emitterProps.optional(), index: z.number().int().optional(), ref },
      run: async (a) => ok(await runCommand(eid(a), cmd("addEmitter", a))),
    },
    {
      name: "update_emitter",
      description: "Set emitter fields (only those given change).",
      shape: { effectId: effectIdSchema, emitterId, props: emitterProps },
      run: async (a) => ok(await runCommand(eid(a), cmd("updateEmitter", a))),
    },
    {
      name: "remove_emitter",
      description: "Remove an emitter (and sub-emitter bindings that target it).",
      shape: { effectId: effectIdSchema, emitterId },
      run: async (a) => ok(await runCommand(eid(a), cmd("removeEmitter", a))),
    },
    {
      name: "duplicate_emitter",
      description: "Copy an emitter (new ids), placed after the original.",
      shape: { effectId: effectIdSchema, emitterId, name: z.string().optional(), ref },
      run: async (a) => ok(await runCommand(eid(a), cmd("duplicateEmitter", a))),
    },
    {
      name: "move_emitter",
      description: "Move an emitter to another index in the list.",
      shape: { effectId: effectIdSchema, emitterId, index: z.number().int() },
      run: async (a) => ok(await runCommand(eid(a), cmd("moveEmitter", a))),
    },

    // ---- modules ---------------------------------------------------------------------
    {
      name: "add_module",
      description: "Add a module to an emitter; its stage comes from the type. Params not given take their defaults (see get_module_type).",
      shape: {
        effectId: effectIdSchema,
        emitterId,
        type: z.string().describe('Module type, e.g. "update.turbulence"'),
        params: z.record(z.string(), z.any()).optional(),
        index: z.number().int().optional().describe("Position within its stage (default: last)"),
        label: z.string().optional(),
        ref,
      },
      run: async (a) => ok(await runCommand(eid(a), cmd("addModule", a))),
    },
    {
      name: "update_module",
      description: "Change a module: params are merged (only the keys given change), enabled toggles it, label renames it.",
      shape: { effectId: effectIdSchema, emitterId, moduleId, params: z.record(z.string(), z.any()).optional(), enabled: z.boolean().optional(), label: z.string().optional() },
      run: async (a) => ok(await runCommand(eid(a), cmd("updateModule", a))),
    },
    {
      name: "remove_module",
      description: "Remove a module.",
      shape: { effectId: effectIdSchema, emitterId, moduleId },
      run: async (a) => ok(await runCommand(eid(a), cmd("removeModule", a))),
    },
    {
      name: "move_module",
      description: "Reorder a module within its stage (modules run top to bottom).",
      shape: { effectId: effectIdSchema, emitterId, moduleId, index: z.number().int() },
      run: async (a) => ok(await runCommand(eid(a), cmd("moveModule", a))),
    },

    // ---- renderers -------------------------------------------------------------------
    {
      name: "add_renderer",
      description: `Add a renderer (${RENDERER_TYPES.join(" | ")}) to an emitter. Unset fields take the type's defaults.`,
      shape: { effectId: effectIdSchema, emitterId, renderer: rendererFields, index: z.number().int().optional(), ref },
      run: async (a) => ok(await runCommand(eid(a), cmd("addRenderer", a))),
    },
    {
      name: "set_renderer",
      description: "Change renderer fields (only those given change). Without rendererId, the emitter's first renderer. Changing `type` starts from that type's defaults.",
      shape: { effectId: effectIdSchema, emitterId, rendererId: rendererId.optional(), renderer: rendererFields },
      run: async (a) => ok(await runCommand(eid(a), cmd("setRenderer", a))),
    },
    {
      name: "remove_renderer",
      description: "Remove a renderer. An emitter without renderers still simulates (and can drive sub-emitters) but draws nothing.",
      shape: { effectId: effectIdSchema, emitterId, rendererId },
      run: async (a) => ok(await runCommand(eid(a), cmd("removeRenderer", a))),
    },

    // ---- wiring and parameters ------------------------------------------------------------
    {
      name: "set_sub_emitters",
      description:
        "Replace an emitter's sub-emitter bindings: when its particles are born or die, spawn `count` particles in the target emitter (usually eventDriven: true), optionally inheriting velocity and colour.",
      shape: { effectId: effectIdSchema, emitterId, subEmitters: z.array(subEmitter) },
      run: async (a) => ok(await runCommand(eid(a), cmd("setSubEmitters", a))),
    },
    {
      name: "set_parameter",
      description: 'Add or replace an effect parameter (a runtime knob such as "throttle"). Bind values to it with {kind:"param", name}.',
      shape: {
        effectId: effectIdSchema,
        parameter: z.object({ name: z.string(), default: z.number(), min: z.number().optional(), max: z.number().optional(), description: z.string().optional() }),
      },
      run: async (a) => ok(await runCommand(eid(a), { op: "setParameter", parameter: { ...(a.parameter as object), type: "float" } as never })),
    },
    {
      name: "remove_parameter",
      description: "Remove an effect parameter.",
      shape: { effectId: effectIdSchema, name: z.string() },
      run: async (a) => ok(await runCommand(eid(a), cmd("removeParameter", a))),
    },
    {
      name: "apply_operations",
      description: `Apply many operations atomically (all or nothing; one undo step in the editor). Each op is an object with "op" plus the fields of the matching tool:
  - {op:"addEmitter", name?, template?, props?, index?, ref?}   (later ops can use "$ref" as the id)
  - {op:"updateEmitter", emitterId, props} / {op:"removeEmitter", emitterId} / {op:"duplicateEmitter", emitterId, name?, ref?} / {op:"moveEmitter", emitterId, index}
  - {op:"addModule", emitterId, type, params?, index?, label?, ref?}
  - {op:"updateModule", emitterId, moduleId, params?, enabled?, label?} / {op:"removeModule", emitterId, moduleId} / {op:"moveModule", emitterId, moduleId, index}
  - {op:"addRenderer", emitterId, renderer, index?, ref?} / {op:"setRenderer", emitterId, rendererId?, renderer} / {op:"removeRenderer", emitterId, rendererId}
  - {op:"setSubEmitters", emitterId, subEmitters}
  - {op:"setParameter", parameter} / {op:"removeParameter", name}
  - {op:"rename", name}
Returns one result per op.`,
      shape: { effectId: effectIdSchema, operations: z.array(z.record(z.string(), z.any())) },
      run: async (a) => ok(await runCommand(eid(a), { op: "batch", ops: a.operations as unknown as Command[] })),
    },

    // ---- shaders -------------------------------------------------------------------------
    ...(ctx.shaders
      ? [
          {
            name: "list_shaders",
            description:
              'Particle shader graphs (tsl-graph) a sprite renderer can use: set_renderer with renderer {material: {kind: "graph", shaderId}}. The graph sets each particle\'s colour and opacity from its age, seed, colour, sprite UV and shape; the renderer\'s shape and colour over life still feed it.',
            shape: {},
            run: async () => {
              const list = await ctx.shaders!.list();
              return ok(list.length ? list.map((s) => ({ shaderId: s.id, name: s.name })) : "No shaders yet.");
            },
          } satisfies ToolSpec,
        ]
      : []),

    // ---- checking ------------------------------------------------------------------------
    {
      name: "validate_effect",
      description: "Problems in the effect (errors and warnings, with emitter / module / renderer ids). An empty list means it is valid.",
      shape: { effectId: effectIdSchema },
      run: async (a) => {
        const issues = validateEffect(await getDoc(eid(a)));
        return ok(issues.length ? issues : "No issues.");
      },
    },
    {
      name: "capture_preview",
      description:
        "Screenshot of the live preview (the effect must be open in the editor). `time` (seconds since the effect started) re-simulates to that moment and pauses there; omit it for the current frame. Simulations are seeded, so the same time gives the same frame.",
      shape: {
        effectId: effectIdSchema,
        time: z.number().min(0).optional(),
        width: z.number().int().min(64).max(2048).optional(),
        height: z.number().int().min(64).max(2048).optional(),
        frame: z.boolean().optional().describe("Point the camera at the particles first"),
      },
      run: async (a) => {
        const live = await liveEditor(eid(a));
        const dataUrl = await bridge.call<string>(live, "capturePreview", {
          time: a.time,
          width: (a.width as number | undefined) ?? 640,
          height: (a.height as number | undefined) ?? 400,
          frame: a.frame,
        });
        const [, mime, b64] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
        if (!b64) throw new Error("Editor returned no image");
        return { content: [{ type: "image", data: b64, mimeType: mime }] };
      },
    },
    {
      name: "get_stats",
      description: "Live preview statistics (the effect must be open in the editor): time, simulated particles per emitter, draw calls, lights, CPU update time.",
      shape: { effectId: effectIdSchema },
      run: async (a) => ok(await bridge.call(await liveEditor(eid(a)), "getStats", {})),
    },
  ];
}

/** Run a tool by name, turning thrown errors into error results. */
export async function runTool(spec: ToolSpec, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return await spec.run(args);
  } catch (err) {
    return fail(err);
  }
}

