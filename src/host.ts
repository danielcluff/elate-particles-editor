// The contract between the effect editor and the application embedding it.
// It mirrors tsl-graph's GraphHost so the two tools can share a host (Phase 3).
//
// The parent application owns effects (storage, listing, routing) and AI
// credentials. The editor owns its per-device settings and the preview.
//
// Two halves:
//  - EffectHost   (browser) is passed to the editor when it is mounted.
//  - EffectStore  (Node) persists effects for the server (MCP tools, the playground).

import type { EffectDoc } from "elate-particles";
import type { ParticleShader } from "elate-particles/three";

export type ProviderId = "anthropic" | "openai" | "google";
export type McpMode = "graph" | "parent";

/** What a project list shows for one effect. */
export interface EffectSummary {
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
  thumbnail?: string;
  emitterCount: number;
}

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

/** Effect persistence as seen from the editor. */
export interface EffectSource {
  load(id: string): Promise<EffectDoc>;
  save(doc: EffectDoc): Promise<void>;
  /** Create a new effect (duplicate, "new from example"). Return the stored document with its id. */
  create(name: string, from?: Partial<EffectDoc>): Promise<EffectDoc>;
}

/** A shader graph sprites can use (`material: { kind: "graph", shaderId }`), e.g. a tsl-graph particle shader. */
export interface ShaderSummary {
  id: string;
  name: string;
  thumbnail?: string;
  /** Changes when the shader is edited, so open editors reload it. */
  updatedAt?: number;
}

/** Particle shaders the host provides (e.g. tsl-graph projects of kind "particle"). */
export interface ShaderSource {
  list(): Promise<ShaderSummary[]>;
  /** The shader as the runtime calls it (tsl-graph: createParticleShader(project).shader); undefined when it can't be built. */
  load(id: string): Promise<ParticleShader | undefined>;
  /** Where "Edit in shader graph" goes (opened in a new tab). Omit to hide the button. */
  editUrl?(id: string): string;
  /** "New shader" in the material picker: create one and return its id. Omit to hide it. */
  create?(name: string): Promise<string>;
}

export interface EffectHost {
  projects: EffectSource;
  /**
   * Shader graphs for sprite materials. Omit and sprites can only use their
   * built-in look (a `material` in a loaded effect is kept but not drawn).
   */
  shaders?: ShaderSource;
  /** Show another effect. The host owns routing, so it decides how. */
  openProject(id: string): void;
  /** Called by the logo in the top bar. Omit to make the logo inert. */
  exit?(): void;
  /** Shareable link for an effect. Omit to hide "Copy link". */
  projectUrl?(id: string): string;
  /**
   * Effect server (see createEffectServer) that provides the MCP bridge and
   * the AI chat loop. `url` is its base path, absolute or relative to the page
   * (e.g. "/elate"). Omit to run the editor without MCP and AI chat.
   */
  server?: {
    url: string;
    /** Extra headers for chat requests (auth). The bridge WebSocket relies on cookies. */
    headers?: () => Record<string, string> | Promise<Record<string, string>>;
  };
  /**
   * Who serves MCP to agents. Must match createEffectServer's `mcp` option.
   *  - "graph" (default): the effect server's own `<server.url>/mcp`; the
   *    editor shows how to connect an agent to it.
   *  - "parent": the host's MCP server passes the effect tools through
   *    (EffectServer.registerMcpTools); the editor shows no connect-agent UI.
   */
  mcp?: McpMode;
  /**
   * AI chat credentials. A key returned here is sent with each chat request
   * to the effect server; when it returns nothing the server's own
   * `ai.getApiKey` is used instead.
   */
  ai?: {
    getApiKey?(provider: ProviderId): string | undefined | null | Promise<string | undefined | null>;
  };
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

/** Effect persistence on the server side. */
export interface EffectStore {
  list(): Promise<EffectSummary[]>;
  get(id: string): Promise<EffectDoc | null>;
  save(doc: EffectDoc): Promise<void>;
  create(name?: string, from?: Partial<EffectDoc>): Promise<EffectDoc>;
}
