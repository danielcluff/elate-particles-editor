# elate-particles-editor

The effect editor for [elate-particles](https://github.com/danielcluff/elate-particles) (Phase 2 of its
[design doc](packages/elate-particles/docs/DESIGN.md)): a module-stack particle tool with a live WebGPU viewport,
a timeline, and curve and gradient editors. Same stack and look as tsl-graph: Solid 2, Tailwind v4, Geist, lucide
icons and tsl-graph's UI kit and tokens.

The runtime is a git submodule at `packages/elate-particles` (a pnpm workspace package), so the editor always
builds against the exact runtime commit it was tested with.

```bash
git clone --recurse-submodules https://github.com/danielcluff/elate-particles-editor.git
pnpm install
pnpm dev            # playground at http://localhost:5190
```

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
| **Store** | Every edit is a runtime `Command` through `executeCommand`, the API MCP tools and agents will use. Undo and redo per command; drags and typing merge into one step. Autosave through the host, thumbnails for the host's list |

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

`EffectHost` mirrors tsl-graph's `GraphHost`. `elate-particles-editor/server` has `createFileStore(dir)`, which keeps
one `<id>.fx.json` per effect (the playground uses it, under `data/effects/`).

## Not yet

From DESIGN.md's Phase 2: the MCP server, the editor bridge and AI chat (`EffectHost.server` / `mcp` / `ai` are
reserved for them), the `particle` graph kind in tsl-graph, and a shape gizmo for `init.shape`. Effect-level
scalability settings have no command in the runtime yet, so the editor doesn't show them.

## Scripts

| | |
| --- | --- |
| `pnpm dev` | Playground (Node server + Vite middleware) |
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Unit tests (value conversions, solo, …) |
| `pnpm build` | Static playground build into `dist/` |
