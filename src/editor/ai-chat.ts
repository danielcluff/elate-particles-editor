import { createContext, createStore, flush, snapshot, untrack } from "solid-js";
import { getModuleDef } from "elate-particles";
import type { EffectHost, ProviderId } from "../host";
import { serverHeaders, serverUrl } from "./host";
import type { Editor } from "./store";

export type { ProviderId };
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  preferredModels: string[];
  /** The effect server has a key for this provider. */
  serverKey: boolean;
}

/** Per-device chat preferences (localStorage). API keys are never stored here: the host supplies them. */
export interface AISettings {
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  effort: Effort;
}

/** Progress labels for the tool list in the transcript. */
export const TOOL_LABELS: Record<string, string> = {
  get_effect: "Reading effect",
  rename_effect: "Renaming effect",
  list_module_types: "Listing module types",
  get_module_type: "Reading module schema",
  add_emitter: "Adding emitter",
  update_emitter: "Editing emitter",
  remove_emitter: "Removing emitter",
  duplicate_emitter: "Duplicating emitter",
  move_emitter: "Moving emitter",
  add_module: "Adding module",
  update_module: "Editing module",
  remove_module: "Removing module",
  move_module: "Moving module",
  add_renderer: "Adding renderer",
  set_renderer: "Editing renderer",
  remove_renderer: "Removing renderer",
  set_sub_emitters: "Wiring sub-emitters",
  set_parameter: "Setting parameter",
  remove_parameter: "Removing parameter",
  apply_operations: "Applying changes",
  list_shaders: "Listing shaders",
  validate_effect: "Validating effect",
  capture_preview: "Capturing preview",
  get_stats: "Reading stats",
};

const READ_ONLY_TOOLS = new Set(["get_effect", "list_module_types", "get_module_type", "list_shaders", "validate_effect", "capture_preview", "get_stats"]);

export type ChatItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "error"; key: string; text: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "changes"; key: string; count: number; mark: number };

export const PROVIDER_LABELS: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

// shared with tsl-graph: one provider / model choice for both editors on this device
const SETTINGS_KEY = "tsl-ai-settings";
const conversationKey = (effectId: string) => `elate-ai-chat-${effectId}`;

interface Conversation {
  provider: ProviderId;
  /** Provider-native messages, append-only, replayed verbatim on each request. */
  history: unknown[];
  items: ChatItem[];
}

function loadSettings(): AISettings {
  const base: AISettings = { provider: "anthropic", models: {}, effort: "high" };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    // settings written before multi-provider support stored a single Anthropic model
    if (typeof s.model === "string" && s.model) base.models.anthropic = s.model;
    return {
      provider: s.provider ?? base.provider,
      models: { ...base.models, ...s.models },
      effort: s.effort ?? base.effort,
    };
  } catch {
    return base;
  }
}

function loadConversation(effectId: string, provider: ProviderId): Conversation {
  try {
    const c = JSON.parse(localStorage.getItem(conversationKey(effectId)) ?? "null");
    // older saves were a bare Anthropic history array without display items: start fresh
    if (c && !Array.isArray(c) && Array.isArray(c.history) && Array.isArray(c.items)) return c;
  } catch {
    // ignore
  }
  return { provider, history: [], items: [] };
}

let seq = 0;
const key = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

export function createChat(ed: Editor, host: EffectHost) {
  const effectId = untrack(() => ed.state.doc.id);
  const settings = loadSettings();
  const conversation = loadConversation(effectId, settings.provider);
  const [state, setState] = createStore({
    open: false,
    minimized: false,
    settingsOpen: false,
    settings,
    providers: [] as ProviderInfo[],
    /** models listed per provider (live from the provider API where possible) */
    models: {} as Partial<Record<ProviderId, { id: string; label: string }[]>>,
    modelErrors: {} as Partial<Record<ProviderId, string | undefined>>,
    /** The host page supplies a key for these providers (EffectHost.ai.getApiKey). */
    hostKeys: {} as Partial<Record<ProviderId, boolean>>,
    conversation,
    streaming: false,
  });
  let controller: AbortController | null = null;

  /** Chat needs an effect server (it runs the tool loop). */
  const available = !!host.server;
  const hostKey = async (id: ProviderId) => (await host.ai?.getApiKey?.(id)) || undefined;

  if (available) {
    void (async () => {
      const res = await fetch(serverUrl(host, "/ai/status")!, { headers: await serverHeaders(host) });
      if (!res.ok) return;
      const s = (await res.json()) as { providers: ProviderInfo[] };
      const keys = await Promise.all(s.providers.map(async (p) => [p.id, !!(await hostKey(p.id))] as const));
      setState((d) => {
        d.providers = s.providers;
        for (const [id, has] of keys) d.hostKeys[id] = has;
        // the saved provider may not be offered by this host
        if (s.providers.length && !s.providers.some((p) => p.id === d.settings.provider)) d.settings.provider = s.providers[0].id;
      });
      void refreshModels(state.settings.provider);
    })().catch(() => {});
  }

  const provider = () => state.providers.find((p) => p.id === state.settings.provider);

  /** Model for the active provider: the saved pick, else the best listed/default one. */
  function activeModel(): string {
    const id = state.settings.provider;
    const picked = state.settings.models[id];
    if (picked) return picked;
    const info = provider();
    const listed = state.models[id] ?? [];
    for (const pref of info?.preferredModels ?? []) if (listed.some((m) => m.id === pref)) return pref;
    return listed[0]?.id ?? info?.defaultModel ?? "";
  }

  async function refreshModels(id: ProviderId) {
    try {
      const res = await fetch(serverUrl(host, "/ai/models")!, {
        method: "POST",
        headers: await serverHeaders(host),
        body: JSON.stringify({ provider: id, apiKey: await hostKey(id) }),
      });
      const data = (await res.json()) as { models: { id: string; label: string }[]; error?: string };
      setState((d) => {
        d.models[id] = data.models;
        d.modelErrors[id] = data.error;
      });
    } catch (err) {
      setState((d) => void (d.modelErrors[id] = err instanceof Error ? err.message : String(err)));
    }
  }

  const persist = () => {
    try {
      localStorage.setItem(conversationKey(effectId), JSON.stringify(snapshot(state.conversation)));
    } catch {
      // quota (screenshots are large): keep the conversation in memory only
    }
  };

  /** Update settings; `update` runs on the store draft and on a plain copy for storage. */
  function saveSettings(update: (s: AISettings) => void) {
    setState((d) => update(d.settings as AISettings));
    try {
      const next = JSON.parse(JSON.stringify(snapshot(state.settings))) as AISettings;
      update(next);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  /** What the user is looking at, sent with each prompt. */
  function editorState(): string {
    const doc = ed.state.doc;
    const sel = ed.emitter();
    const issues = ed.issues().map((i) => {
      const where = doc.emitters.find((e) => e.id === i.emitterId)?.name;
      return `${i.level}${where ? ` (${where})` : ""}: ${i.message}`;
    });
    const emitters = doc.emitters.map((e) => {
      const n = ["spawn", "init", "update", "render"].reduce((k, s) => k + (e as unknown as Record<string, unknown[]>)[s].length, 0);
      const flags = [e.enabled === false ? "disabled" : "", e.looping ? "loop" : "once", e.sim === "gpu" ? "gpu" : "", e.eventDriven ? "event-driven" : ""].filter(Boolean);
      return `  ${e.name} (${e.id}): ${n} modules, ${e.renderers.map((r) => r.type).join("+") || "no renderers"}, ${e.duration}s ${flags.join(" ")}`;
    });
    const modules = sel
      ? (["spawn", "init", "update", "render"] as const).flatMap((s) => sel[s].map((m) => `${getModuleDef(m.type)?.label ?? m.type} (${m.id})`))
      : [];
    return [
      "<editor_state>",
      `effect: ${doc.name}`,
      `emitters:\n${emitters.join("\n") || "  none"}`,
      sel ? `selected emitter: ${sel.name} (${sel.id}); modules: ${modules.join(", ") || "none"}` : "selected emitter: none",
      ed.state.solo ? `soloed in the preview: ${doc.emitters.find((e) => e.id === ed.state.solo)?.name}` : "",
      doc.parameters.length ? `parameters: ${doc.parameters.map((p) => `${p.name}=${ed.state.params[p.name] ?? p.default}`).join(", ")}` : "parameters: none",
      issues.length ? `problems:\n${issues.slice(0, 8).join("\n")}` : "problems: none",
      "</editor_state>",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ---- transcript updates from stream events ------------------------------
  const pushItem = (item: ChatItem) => setState((d) => void d.conversation.items.push(item));

  /** Append streamed text to the trailing item of the same kind, or start one. */
  const appendDelta = (kind: "text" | "thinking", delta: string, liveKeys: Set<string>) =>
    setState((d) => {
      const items = d.conversation.items;
      const last = items[items.length - 1];
      if (last && last.kind === kind && liveKeys.has(last.key)) last.text += delta;
      else {
        const k = key(kind);
        liveKeys.add(k);
        items.push({ kind, key: k, text: delta });
      }
    });

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || state.streaming) return;
    const providerId = state.settings.provider;
    const model = activeModel();
    if (!available) return;
    // A conversation is bound to its provider's message format.
    const switching = state.conversation.provider !== providerId && state.conversation.history.length > 0;
    const history = switching ? [] : (snapshot(state.conversation.history) as unknown[]);
    setState((d) => {
      if (switching) {
        d.conversation = { provider: providerId, history: [], items: [] };
        d.conversation.items.push({
          kind: "notice",
          key: key("n"),
          text: `Switched to ${PROVIDER_LABELS[providerId]} — started a new conversation.`,
        });
      }
      d.conversation.provider = providerId;
      d.conversation.items.push({ kind: "user", key: key("u"), text: prompt });
      d.streaming = true;
    });
    const mark = ed.historyMark();
    let changes = 0;
    const liveKeys = new Set<string>();
    controller = new AbortController();
    try {
      const apiKey = await hostKey(providerId);
      const res = await fetch(serverUrl(host, "/ai/chat")!, {
        method: "POST",
        headers: await serverHeaders(host),
        signal: controller.signal,
        body: JSON.stringify({ provider: providerId, effectId, history, prompt, context: editorState(), apiKey, model, effort: state.settings.effort }),
      });
      if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
          switch (ev.type) {
            case "text":
            case "thinking":
              appendDelta(ev.type, ev.delta as string, liveKeys);
              break;
            case "tool_start":
              liveKeys.clear();
              pushItem({ kind: "tool", key: ev.id as string, name: ev.name as string, status: "running" });
              break;
            case "tool_result":
              if (!ev.isError && !READ_ONLY_TOOLS.has(ev.name as string)) changes++;
              setState((d) => {
                const t = d.conversation.items.find((i) => i.kind === "tool" && i.key === ev.id);
                if (t && t.kind === "tool") {
                  t.status = ev.isError ? "error" : "ok";
                  t.summary = ev.summary as string;
                }
              });
              break;
            case "append":
              setState((d) => void d.conversation.history.push(...(ev.messages as unknown[])));
              break;
            case "fallback":
              pushItem({ kind: "notice", key: key("f"), text: `${ev.from} declined part of this; continued on ${ev.to}.` });
              break;
            case "notice":
              pushItem({ kind: "notice", key: key("n"), text: ev.message as string });
              break;
            case "error":
              pushItem({ kind: "error", key: key("e"), text: ev.message as string });
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        pushItem({ kind: "error", key: key("e"), text: err instanceof Error ? err.message : String(err) });
    } finally {
      controller = null;
      setState((d) => {
        d.streaming = false;
        // tools interrupted by Stop never report back
        for (const i of d.conversation.items) if (i.kind === "tool" && i.status === "running") i.status = "error";
      });
      if (changes > 0) pushItem({ kind: "changes", key: key("c"), count: changes, mark });
      // make the queued writes readable before serialising
      flush();
      persist();
    }
  }

  function stop() {
    controller?.abort();
  }

  function clear() {
    stop();
    setState((d) => {
      d.conversation = { provider: d.settings.provider, history: [], items: [] };
    });
    try {
      localStorage.removeItem(conversationKey(effectId));
    } catch {
      // ignore
    }
  }

  return {
    available,
    state,
    setState,
    send,
    stop,
    clear,
    saveSettings,
    refreshModels,
    activeModel,
    provider,
    undoChanges: (mark: number) => ed.undoTo(mark),
  };
}

export type Chat = ReturnType<typeof createChat>;
export const ChatContext = createContext<Chat>();
