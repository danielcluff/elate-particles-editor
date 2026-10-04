import { createContext } from "solid-js";
import type { EffectHost } from "../host";

export const HostContext = createContext<EffectHost>();

/** Absolute URL of an effect-server route, or null when the host runs the editor without a server. */
export function serverUrl(host: EffectHost, route: string, protocol: "http" | "ws" = "http"): string | null {
  if (!host.server) return null;
  const url = new URL(`${host.server.url.replace(/\/+$/, "")}${route}`, location.href);
  if (protocol === "ws") url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function serverHeaders(host: EffectHost): Promise<Record<string, string>> {
  return { "content-type": "application/json", ...(await host.server?.headers?.()) };
}

/** The effect server's own MCP endpoint, or null when there is none (no server, or the host's MCP serves the tools). */
export function effectMcpUrl(host: EffectHost): string | null {
  return host.mcp === "parent" ? null : serverUrl(host, "/mcp");
}
