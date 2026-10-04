# elate-particles-editor

The effect editor for [elate-particles](https://github.com/danielcluff/elate-particles) (Phase 2 of its
[design doc](packages/elate-particles/docs/DESIGN.md)): a module-stack particle tool with a live WebGPU viewport,
a timeline, and curve and gradient editors, plus an **MCP server** so agents can build effects in an open editor, an
in-editor **AI chat** that uses the same tools, and sprite materials from **tsl-graph particle shaders**. Same stack and
look as tsl-graph: Solid 2, Tailwind v4, Geist, lucide icons and tsl-graph's UI kit and tokens.

The runtime is a git submodule at `packages/elate-particles` (a pnpm workspace package), so the editor always
builds against the exact runtime commit it was tested with.

```bash
git clone --recurse-submodules https://github.com/danielcluff/elate-particles-editor.git
pnpm install
pnpm dev            # playground at http://localhost:5190, MCP at http://localhost:5190/elate/mcp
```

For particle shaders, also run tsl-graph's playground next to it (`pnpm dev` in `../tsl-graph`, port 5173): the editor
playground lists its `kind: "particle"` projects and links to it for editing.

(In an existing clone: `git submodule update --init`.)

## What's in it

| Area | |
| --- | --- |
| **Emitters** (left) | Sub-emitter targets indented under their source. Enable, solo (sources keep simulating, hidden), rename, duplicate, reorder, delete. Validation issues show as markers |
| **Parameters** (left) | Effect parameters with live preview sliders; name, default, min/max, description |
| **Stack** (right) | Emitter settings and LOD, then Spawn / Initialize / Update / Render sections of module cards: enable, drag to reorder, rename, duplicate, a one-line summary when collapsed. The picker is searchable and grouped by category. Cards are built from the module schema (`ParamDef`, `showIf`), so custom modules get a UI for free |
| **Renderers, sub-emitters** | Several renderers per emitter (sprite, mesh, ribbon, light) with every option; sub-emitter bindings |
| **Value widgets** | `FloatValue`: constant · random between · curve · random between curves · parameter. `ColorValue`: colour · random between · gradient · random from gradient, with alpha and HDR intensity. Curve editor (drag, double-click to add, right-click to remove, presets) and a Unity-style gradient editor |
| **Viewport** | Full-bleed behind the panels, centred on the space between them. Play / pause / step / restart, speed, replay of one-shots, motion preview (circle, line), backgrounds, ground and grid, frame, stats |
| **Timeline** | One row per emitter: start delay, duration, loop repeats, burst ticks, sub-emitter links. Drag a bar to move it, its right edge to resize. Drag the ruler to scrub |
| **Store** | Every edit is a runtime `Command` through `executeCommand`, the same API the MCP tools and the AI chat use. Undo and redo per command; drags and typing merge into one step. Autosave through the host, thumbnails for the host's list |
| **Materials** | Sprite renderers can use a particle shader graph (`material: { kind: "graph", shaderId }`) from the host's `ShaderSource`: picker with thumbnail, "Edit in shader graph", and edited shaders reload when the editor regains focus |
| **MCP** | 26 tools (DESIGN.md's list plus `rename_effect`, `move_emitter`, `remove_parameter`, `list_shaders`). With the effect open in an editor tab, calls run through it (live, undoable, `capture_preview` at any time, `get_stats`); otherwise they edit the stored file. "Connect agent (MCP)" in the ⋯ menu shows the setup |
| **AI chat** | ⌘I. A provider-agnostic tool loop (Anthropic, OpenAI, Google) over the same tools, streaming into a side panel; each reply's changes can be undone in one click. Keys come from the host (`EffectHost.ai.getApiKey`) or the server's env vars |

Seeking is exact because simulations are seeded: the preview re-simulates from 0 at a fixed step. Edits re-register
the effect and re-simulate to the current time, so tweaking a looping effect doesn't empty the viewport.

## Embedding

```tsx
import { EffectEditor, type EffectHost } from "elate-particles-editor/editor";
import "elate-particles-editor/styles.css"; // or editor.css with your own Tailwind v4 build

const host: EffectHost = {
  projects: { load, save, create }, // your storage
  openProject: (id) => router.go(`/fx/${id}`),
  exit: () => router.go("/"),
};

<EffectEditor host={host} projectId={id} />;
// or, without Solid: mountEffectEditor(el, { host, projectId })
```

`EffectHost` mirrors tsl-graph's `GraphHost` (`server`, `mcp` and `ai` work the same way), plus `shaders`: a
`ShaderSource` for sprite materials. With tsl-graph it is a few lines (see `playground/main.tsx`):

```ts
import { createParticleShader } from "tsl-graph/particle";
shaders: {
  list: () => fetchParticleProjects(),
  load: async (id) => createParticleShader(await fetchProject(id)).shader,
  editUrl: (id) => `${tslGraphUrl}/#/p/${id}`,
}
```

On the server, mount `createEffectServer` (MCP, the bridge to editor tabs, AI chat) like tsl-graph's
`createGraphServer`:

```ts
import { createEffectServer, createFileStore } from "elate-particles-editor/server";

const fx = createEffectServer({ store: createFileStore("data/effects"), basePath: "/elate" });
server.on("request", async (req, res) => { if (await fx.handle(req, res)) return; /* …your app… */ });
fx.attach(server); // editor-tab WebSocket bridge
```

`createFileStore(dir)` keeps one `<id>.fx.json` per effect. `mcp: "parent"` and `registerMcpTools(server, { prefix })`
let a host's own MCP server carry the tools; `scripts/mcp-stdio.mjs` (`elate-particles-mcp`) proxies stdio-only
clients.

## Not yet

- A shape gizmo for `init.shape` in the viewport (DESIGN.md mentions it).
- Effect-level scalability settings: the runtime has no command for them yet, so the editor doesn't show them.
- The playground links tsl-graph with `link:../tsl-graph` (a dev dependency); Phase 3's monorepo replaces that.

## Scripts

| | |
| --- | --- |
| `pnpm dev` | Playground (Node server + Vite middleware) |
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Unit tests (value conversions, solo, MCP tools, AI chat loop) |
| `pnpm build` | Static playground build into `dist/` |
