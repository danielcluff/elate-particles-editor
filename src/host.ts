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

export interface EffectHost {
  projects: EffectSource;
  /** Show another effect. The host owns routing, so it decides how. */
  openProject(id: string): void;
  /** Called by the logo in the top bar. Omit to make the logo inert. */
  exit?(): void;
  /** Shareable link for an effect. Omit to hide "Copy link". */
  projectUrl?(id: string): string;
  /**
   * Effect server (MCP bridge, AI chat). Reserved: the editor runs without
   * one today; the server lands with the MCP tools.
   */
  server?: {
    url: string;
    headers?: () => Record<string, string> | Promise<Record<string, string>>;
  };
  /** Who serves MCP to agents (see `server`). */
  mcp?: McpMode;
  /** AI chat credentials (see `server`). */
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
