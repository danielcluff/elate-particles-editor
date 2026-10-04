import { describe, expect, it } from "vitest";
import { createEffect, type EffectDoc } from "elate-particles";
import { createEffectServer, runTool, type EffectStore } from "../src/server";

/** An EffectStore in memory (no editor tabs are connected in these tests, so tools edit the stored copy). */
function memoryStore(): EffectStore & { docs: Map<string, EffectDoc> } {
  const docs = new Map<string, EffectDoc>();
  return {
    docs,
    list: async () => [...docs.values()].map((d) => ({ id: d.id, name: d.name, emitterCount: d.emitters.length, updatedAt: d.updatedAt })),
    get: async (id) => (docs.has(id) ? structuredClone(docs.get(id)!) : null),
    save: async (d) => void docs.set(d.id, structuredClone(d)),
    create: async (name) => {
      const d = createEffect(name ?? "New Effect");
      docs.set(d.id, d);
      return structuredClone(d);
    },
  };
}

function setup() {
  const store = memoryStore();
  const server = createEffectServer({ store });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = server.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const r = await runTool(tool, args);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    return { error: !!r.isError, text, json: () => JSON.parse(text) };
  };
  return { store, server, call };
}

describe("effect tools", () => {
  it("has the tools DESIGN.md lists", () => {
    const names = setup().server.tools.map((t) => t.name);
    for (const n of ["list_effects", "create_effect", "open_effect", "get_effect", "list_module_types", "get_module_type", "add_emitter", "update_emitter", "remove_emitter", "duplicate_emitter", "add_module", "update_module", "remove_module", "move_module", "add_renderer", "set_renderer", "remove_renderer", "set_sub_emitters", "set_parameter", "apply_operations", "validate_effect", "capture_preview", "get_stats"])
      expect(names).toContain(n);
  });

  it("creates and edits an effect in the store when no editor is open", async () => {
    const { store, call } = setup();
    const { effectId } = (await call("create_effect", { name: "Burst", empty: true })).json();
    const ops = await call("apply_operations", {
      effectId,
      operations: [
        { op: "addEmitter", name: "flash", template: "empty", ref: "f" },
        { op: "addModule", emitterId: "$f", type: "spawn.burst", params: { count: 1 } },
        { op: "addModule", emitterId: "$f", type: "init.lifetime" },
        { op: "addEmitter", name: "sparks", props: { eventDriven: true }, ref: "s" },
        { op: "setSubEmitters", emitterId: "$f", subEmitters: [{ trigger: "death", emitter: "$s", count: 20 }] },
      ],
    });
    expect(ops.error).toBe(false);
    const doc = store.docs.get(effectId)!;
    expect(doc.emitters.map((e) => e.name)).toEqual(["flash", "sparks"]);
    expect(doc.emitters[0].subEmitters?.[0].emitter).toBe(doc.emitters[1].id);
    // emitters by name
    expect((await call("update_emitter", { effectId, emitterId: "sparks", props: { maxParticles: 64 } })).error).toBe(false);
    expect(store.docs.get(effectId)!.emitters[1].maxParticles).toBe(64);
  });

  it("is atomic: a failing batch changes nothing", async () => {
    const { store, call } = setup();
    const { effectId } = (await call("create_effect", {})).json();
    const before = JSON.stringify(store.docs.get(effectId)!.emitters);
    const r = await call("apply_operations", { effectId, operations: [{ op: "addEmitter", name: "x" }, { op: "addModule", emitterId: "x", type: "update.nope" }] });
    expect(r.error).toBe(true);
    expect(JSON.stringify(store.docs.get(effectId)!.emitters)).toBe(before);
  });

  it("rejects invalid params with the module's message", async () => {
    const { call } = setup();
    const { effectId, emitters } = (await call("create_effect", {})).json();
    const r = await call("add_module", { effectId, emitterId: emitters[0].id, type: "update.drag", params: { drag: "lots" } });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/drag/i);
  });

  it("summarises and validates", async () => {
    const { call } = setup();
    const { effectId } = (await call("create_effect", { name: "S" })).json();
    const outline = (await call("get_effect", { effectId, summary: true })).json();
    expect(outline.emitters[0].spawn[0].type).toBe("spawn.rate");
    expect((await call("validate_effect", { effectId })).text).toBe("No issues.");
    expect((await call("list_module_types", { stage: "render" })).json().every((m: { stage: string }) => m.stage === "render")).toBe(true);
  });

  it("needs an open editor for live tools, and an effect id without one", async () => {
    const { call } = setup();
    expect((await call("get_effect")).text).toMatch(/no effect is open/i);
    const { effectId } = (await call("create_effect", {})).json();
    expect((await call("capture_preview", { effectId })).text).toMatch(/not open in the editor/);
  });
});
