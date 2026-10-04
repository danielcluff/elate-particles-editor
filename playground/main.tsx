// Playground host app. Everything here is what a parent application provides:
// routing, the effect browser and storage (a REST API).
import { For, Show, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { createEffect as createEffectDoc, normalizeEffect, type EffectDoc } from "elate-particles";
import type { ProjectDoc } from "tsl-graph";
import { createParticleShader } from "tsl-graph/particle";
import { EffectEditor, type EffectHost, type EffectSummary, type ProviderId, type ShaderSummary } from "../src/editor";
import "./styles.css";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${method} ${url} failed`);
  return res.json() as Promise<T>;
}

const effects = {
  list: () => req<EffectSummary[]>("GET", "/api/effects"),
  load: (id: string) => req<EffectDoc>("GET", `/api/effects/${id}`),
  save: (doc: EffectDoc) => req<void>("PUT", `/api/effects/${doc.id}`, doc),
  create: (name: string, from?: Partial<EffectDoc>) => req<EffectDoc>("POST", "/api/effects", { name, from }),
  remove: (id: string) => req<void>("DELETE", `/api/effects/${id}`),
};

// the runtime's examples, as starting points
const EXAMPLES = Object.entries(import.meta.glob<{ default: unknown }>("../packages/elate-particles/examples/*.fx.json", { eager: true }))
  .map(([path, mod]) => {
    try {
      return { file: path.split("/").pop()!.replace(".fx.json", ""), doc: normalizeEffect(mod.default) };
    } catch {
      return null;
    }
  })
  .filter((x) => !!x)
  .sort((a, b) => a.doc.name.localeCompare(b.doc.name));

// ---- routing: #/ (effects) and #/e/:id (editor) ----------------------------
const [route, setRoute] = createSignal(location.hash);
window.addEventListener("hashchange", () => setRoute(location.hash));
const go = (hash: string) => (location.hash = hash);
const effectId = () => /^#\/e\/([\w-]+)/.exec(route())?.[1];

// Keys typed on the effects page; a real host would fetch them from its own
// account system or keep them server-side (createEffectServer's ai.getApiKey).
const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google"];
const keyName = (p: ProviderId) => `playground-ai-key-${p}`;

// tsl-graph's playground (`pnpm dev` in ../tsl-graph)
const TSL_GRAPH_URL = import.meta.env.VITE_TSL_GRAPH_URL ?? "http://localhost:5173";

const host: EffectHost = {
  projects: effects,
  openProject: (id) => go(`#/e/${id}`),
  exit: () => go("#/"),
  projectUrl: (id) => `${location.origin}/#/e/${id}`,
  server: { url: "/elate" },
  // particle shaders: tsl-graph projects, edited in tsl-graph's playground
  shaders: {
    list: () => req<ShaderSummary[]>("GET", "/api/shaders"),
    async load(id) {
      const { shader, diagnostics } = createParticleShader(await req<ProjectDoc>("GET", `/api/shaders/${id}`), (msg) => console.warn(msg));
      const errors = diagnostics.filter((d) => d.level === "error");
      if (errors.length) throw new Error(errors.map((d) => d.message).join("; "));
      return shader;
    },
    editUrl: (id) => `${TSL_GRAPH_URL}/#/p/${id}`,
    create: async (name) => (await req<{ id: string }>("POST", "/api/shaders", { name })).id,
  },
  ai: { getApiKey: (p) => sessionStorage.getItem(keyName(p)) },
};

function App() {
  return (
    <Show when={effectId()} keyed fallback={<EffectList />}>
      {(id) => (
        <div style={{ position: "fixed", inset: 0 }}>
          <EffectEditor host={host} projectId={id} />
        </div>
      )}
    </Show>
  );
}

function EffectList() {
  const [list, setList] = createSignal<EffectSummary[]>([]);
  const refresh = () => effects.list().then(setList);
  void refresh();

  const create = async (name: string, from?: EffectDoc) => go(`#/e/${(await effects.create(name, from)).id}`);
  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const doc = normalizeEffect(JSON.parse(await file.text()));
      await create(doc.name, doc);
    };
    input.click();
  };

  return (
    <div class="elate-root elate-dark min-h-full bg-background p-8 text-foreground">
      <div class="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 class="text-2xl font-bold">Elate Particles editor</h1>
          <p class="text-sm text-muted-foreground">A minimal host app: it owns the effect list and storage (data/effects/*.fx.json).</p>
        </div>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold">New effect</h2>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => create("New Effect", createEffectDoc("New Effect"))}>
              Blank
            </button>
            <For each={EXAMPLES}>
              {(ex) => (
                <button type="button" class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" title={`From examples/${ex.file}.fx.json`} onClick={() => create(ex.doc.name, ex.doc)}>
                  {ex.doc.name}
                </button>
              )}
            </For>
            <button type="button" class="rounded-md border border-dashed px-3 py-1.5 text-sm hover:bg-accent" onClick={importFile}>
              Import .fx.json…
            </button>
          </div>
        </section>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold">Effects</h2>
          <Show when={list().length} fallback={<p class="text-sm text-muted-foreground">No effects yet.</p>}>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
              <For each={list()}>
                {(p) => (
                  <div class="group overflow-hidden rounded-lg border bg-card">
                    <a href={`#/e/${p.id}`} class="block">
                      <div class="aspect-video bg-muted">
                        <Show when={p.thumbnail}>{(src) => <img src={src()} alt="" class="size-full object-cover" />}</Show>
                      </div>
                      <div class="px-3 py-2 text-sm font-medium">{p.name}</div>
                    </a>
                    <div class="flex justify-between px-3 pb-2 text-xs text-muted-foreground">
                      <span>
                        {p.emitterCount} emitter{p.emitterCount === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        class="hover:text-destructive"
                        onClick={async () => {
                          if (confirm(`Delete "${p.name}"?`)) await effects.remove(p.id).then(refresh);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold">AI keys (passed to the editor by this host)</h2>
          <p class="text-xs text-muted-foreground">Kept in this tab's sessionStorage. Leave empty to use the server's env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).</p>
          <For each={PROVIDERS}>
            {(p) => (
              <label class="flex items-center gap-2 text-sm">
                <span class="w-24 capitalize">{p}</span>
                <input
                  type="password"
                  autocomplete="off"
                  class="h-8 flex-1 rounded-md border bg-transparent px-2"
                  value={sessionStorage.getItem(keyName(p)) ?? ""}
                  onChange={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v) sessionStorage.setItem(keyName(p), v);
                    else sessionStorage.removeItem(keyName(p));
                  }}
                />
              </label>
            )}
          </For>
        </section>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
