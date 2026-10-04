import { createContext, createStore } from "solid-js";
import type { EffectDoc } from "elate-particles";
import type { ParticleShader } from "elate-particles/three";
import type { EffectHost, ShaderSummary } from "../host";

// Shader graphs used by sprite materials (`material: { kind: "graph", shaderId }`).
// The host's ShaderSource lists and builds them; this cache feeds the preview's
// ParticleWorld and reloads a shader when it was edited (checked on window
// focus, i.e. when coming back from the shader editor).

/** Shader ids an effect's sprite renderers reference. */
export function shaderIds(doc: EffectDoc): string[] {
  const ids = new Set<string>();
  for (const e of doc.emitters) for (const r of e.renderers) if (r.type === "sprite" && r.material?.kind === "graph" && r.material.shaderId) ids.add(r.material.shaderId);
  return [...ids];
}

export function createShaders(host: EffectHost) {
  const source = host.shaders;
  const [state, setState] = createStore({
    list: [] as ShaderSummary[],
    /** Ids that failed to load (shown on the renderer card). */
    failed: {} as Record<string, string>,
  });
  const loaded = new Map<string, { shader: ParticleShader; updatedAt?: number }>();
  const loading = new Set<string>();
  /** Set by the viewport: rebuild materials that use `id`. */
  let onChange: (id: string) => void = () => {};

  async function refreshList() {
    if (!source) return [];
    try {
      const list = await source.list();
      setState((s) => void (s.list = list));
      return list;
    } catch {
      return state.list;
    }
  }

  async function load(id: string) {
    if (!source || loading.has(id)) return;
    loading.add(id);
    try {
      const shader = await source.load(id);
      if (!shader) throw new Error("Shader not found");
      loaded.set(id, { shader, updatedAt: state.list.find((s) => s.id === id)?.updatedAt });
      setState((s) => void delete s.failed[id]);
    } catch (err) {
      loaded.delete(id);
      setState((s) => void (s.failed[id] = err instanceof Error ? err.message : String(err)));
    } finally {
      loading.delete(id);
      onChange(id);
    }
  }

  /** Make sure every shader `doc` uses is loaded (or loading). */
  function ensure(doc: EffectDoc) {
    for (const id of shaderIds(doc)) if (!loaded.has(id) && !loading.has(id) && !(id in state.failed)) void load(id);
  }

  /** Reload shaders edited since they were loaded. */
  async function checkForEdits() {
    const list = await refreshList();
    for (const [id, entry] of loaded) {
      const now = list.find((s) => s.id === id)?.updatedAt;
      if (now !== undefined && now !== entry.updatedAt) void load(id);
    }
    // retry ones that failed (e.g. created after the effect referenced them)
    for (const id of Object.keys(state.failed)) if (list.some((s) => s.id === id)) void load(id);
  }

  return {
    available: !!source,
    state,
    resolve: (id: string) => loaded.get(id)?.shader,
    ensure,
    refreshList,
    checkForEdits,
    editUrl: (id: string) => source?.editUrl?.(id),
    canCreate: !!source?.create,
    create: (name: string) => source!.create!(name),
    setOnChange(fn: (id: string) => void) {
      onChange = fn;
    },
  };
}

export type Shaders = ReturnType<typeof createShaders>;
export const ShadersContext = createContext<Shaders>();
