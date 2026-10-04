// Playground host: shows how a parent app embeds the effect editor. The parent
// owns effects (here: *.fx.json files + a tiny REST API) and routing; the
// effect server adds the MCP endpoint and the bridge to open editor tabs.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { EffectDoc } from "elate-particles";
import { createProject, type ProjectDoc } from "tsl-graph";
import { createEffectServer, createFileStore } from "../src/server";

const PORT = Number(process.env.PORT ?? 5190);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROD = process.env.NODE_ENV === "production";
const ROOT = resolve(import.meta.dirname, "..");

const store = createFileStore(join(process.env.ELATE_DATA_DIR ?? join(ROOT, "data"), "effects"));

// Particle shaders are tsl-graph projects of kind "particle". The playground
// reads tsl-graph's own playground store (run `pnpm dev` in ../tsl-graph to
// edit them); a real host would share one asset store between both tools.
const TSL_GRAPH_DIR = resolve(process.env.TSL_GRAPH_DIR ?? join(ROOT, "..", "tsl-graph"));
const SHADER_DIR = join(process.env.TSL_DATA_DIR ?? join(TSL_GRAPH_DIR, "data"), "projects");

async function readShaders(): Promise<ProjectDoc[]> {
  const out: ProjectDoc[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(SHADER_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const doc = JSON.parse(await readFile(join(SHADER_DIR, f), "utf8")) as ProjectDoc;
      if (doc.kind === "particle") out.push(doc);
    } catch {
      // skip unreadable files
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function handleShaders(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "shaders", id?]
  if (parts[0] !== "api" || parts[1] !== "shaders") return false;
  try {
    const id = parts[2];
    if (!id && req.method === "GET")
      return json(res, 200, (await readShaders()).map((d) => ({ id: d.id, name: d.name, thumbnail: d.thumbnail, updatedAt: d.updatedAt }))), true;
    if (id && req.method === "GET") {
      const doc = (await readShaders()).find((d) => d.id === id);
      return doc ? json(res, 200, doc) : json(res, 404, { error: "Not found" }), true;
    }
    if (!id && req.method === "POST") {
      const body = ((await readBody(req)) ?? {}) as { name?: string };
      const doc = createProject(body.name || "Particle Shader", "particle");
      await mkdir(SHADER_DIR, { recursive: true });
      await writeFile(join(SHADER_DIR, `${doc.id}.json`), JSON.stringify(doc));
      return json(res, 201, { id: doc.id }), true;
    }
    json(res, 404, { error: "Unknown endpoint" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

const fx = createEffectServer({
  store,
  shaders: { list: async () => (await readShaders()).map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt })) },
  basePath: "/elate",
  projectUrl: (id) => `http://localhost:${PORT}/#/e/${id}`,
});

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** The host app's own effect API (not part of the package). */
async function handleEffects(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "effects", id?]
  if (parts[0] !== "api" || parts[1] !== "effects") return false;
  try {
    const id = parts[2];
    if (!id && req.method === "GET") return json(res, 200, await store.list()), true;
    if (!id && req.method === "POST") {
      const body = ((await readBody(req)) ?? {}) as { name?: string; from?: Partial<EffectDoc> };
      return json(res, 201, await store.create(body.name, body.from)), true;
    }
    if (id && req.method === "GET") {
      const doc = await store.get(id);
      return doc ? json(res, 200, doc) : json(res, 404, { error: "Not found" }), true;
    }
    if (id && req.method === "PUT") {
      const doc = (await readBody(req)) as EffectDoc;
      if (!doc || doc.id !== id) return json(res, 400, { error: "Body id mismatch" }), true;
      await store.save(doc);
      fx.notifyProjectChanged(id);
      return json(res, 200, { ok: true }), true;
    }
    if (id && req.method === "DELETE") return await store.remove(id), json(res, 200, { ok: true }), true;
    json(res, 404, { error: "Unknown endpoint" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

async function serveStatic(res: ServerResponse, url: URL) {
  const dist = join(ROOT, "dist");
  let file = join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(dist, "index.html");
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

const server = createServer();
fx.attach(server);

let vite: import("vite").ViteDevServer | undefined;
if (!PROD) {
  const { createServer: createVite } = await import("vite");
  vite = await createVite({ configFile: join(ROOT, "vite.config.ts"), server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
}

server.on("request", async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (await fx.handle(req, res)) return;
  if (await handleEffects(req, res, url)) return;
  if (await handleShaders(req, res, url)) return;
  if (vite) vite.middlewares(req, res);
  else await serveStatic(res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Elate Particles editor playground  →  http://localhost:${PORT}`);
  console.log(`  MCP (HTTP)                         →  http://localhost:${PORT}/elate/mcp\n`);
});
