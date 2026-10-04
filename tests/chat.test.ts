import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createEffect, type EffectDoc } from "elate-particles";
import { createChat, PROVIDERS } from "../src/server/ai/index";
import type { ChatEvent, ProviderAdapter, StepOptions, ToolCall } from "../src/server/ai/types";
import { Bridge } from "../src/server/bridge";
import { createTools } from "../src/server/tools";
import type { EffectStore } from "../src/host";

/** A provider that replays a script: each step returns the next list of tool calls, then a final answer. */
function scripted(script: ToolCall[][]): ProviderAdapter & { seen: StepOptions[] } {
  const seen: StepOptions[] = [];
  return {
    id: "anthropic",
    label: "Fake",
    defaultModel: "fake",
    preferredModels: [],
    envKeyNames: [],
    seen,
    listModels: async () => [],
    userTurn: (_h, text, context) => [{ role: "user", text, context }],
    async step(o) {
      seen.push({ ...o, history: [...o.history] });
      const calls = script[seen.length - 1] ?? [];
      if (!calls.length) {
        o.emit({ type: "text", delta: "Done." });
        return { messages: [{ role: "assistant", text: "Done." }], toolCalls: [], stopReason: "end_turn" };
      }
      for (const c of calls) o.emit({ type: "tool_start", id: c.id, name: c.name });
      return { messages: [{ role: "assistant", calls }], toolCalls: calls, stopReason: "tool_use" };
    },
    toolResults: (results) => [{ role: "user", results: results.map((r) => ({ id: r.call.id, error: !!r.result.isError })) }],
    describeError: () => null,
  };
}

function fakeRes() {
  const events: ChatEvent[] = [];
  const res = {
    writableEnded: false,
    headersSent: false,
    writeHead() {
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    write(chunk: string) {
      for (const line of chunk.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    on() {},
  };
  return { res: res as unknown as ServerResponse, events };
}

describe("AI chat loop", () => {
  it("runs tool calls against the open effect and streams progress", async () => {
    const doc: EffectDoc = createEffect("Test", { emitter: false });
    const store: EffectStore = {
      list: async () => [],
      get: async (id) => (id === doc.id ? structuredClone(doc) : null),
      save: async (d) => void Object.assign(doc, structuredClone(d)),
      create: async () => doc,
    };
    const tools = createTools({ store, bridge: new Bridge() });
    const fake = scripted([
      [{ id: "t1", name: "apply_operations", input: { operations: [{ op: "addEmitter", name: "core", ref: "c" }, { op: "addModule", emitterId: "$c", type: "update.gravity" }] } }],
      // malformed input is rejected by the schema, not run
      [{ id: "t2", name: "update_emitter", input: { emitterId: "core" } }, { id: "t3", name: "validate_effect", input: {} }],
    ]);
    const original = PROVIDERS.anthropic;
    PROVIDERS.anthropic = fake;
    try {
      const chat = createChat({ tools, getApiKey: () => "test-key" });
      const { res, events } = fakeRes();
      await chat.chat({} as IncomingMessage, res, { provider: "anthropic", effectId: doc.id, history: [], prompt: "add a core", context: "<editor_state/>" });

      expect(doc.emitters.map((e) => e.name)).toEqual(["core"]);
      expect(doc.emitters[0].update.map((m) => m.type)).toContain("update.gravity");
      const results = events.filter((e) => e.type === "tool_result") as Extract<ChatEvent, { type: "tool_result" }>[];
      expect(results.map((r) => [r.name, r.isError])).toEqual([
        ["apply_operations", false],
        ["update_emitter", true],
        ["validate_effect", false],
      ]);
      expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
      // chat tools never expose effect management or effectId
      const names = fake.seen[0].tools.map((t) => t.name);
      expect(names).not.toContain("list_effects");
      expect(names).not.toContain("create_effect");
      expect(JSON.stringify(fake.seen[0].tools)).not.toContain("effectId");
      expect(fake.seen[0].system).toContain("Elate Particles effect editor");
    } finally {
      PROVIDERS.anthropic = original;
    }
  });

  it("reports a missing key instead of calling the provider", async () => {
    const chat = createChat({ tools: [], getApiKey: () => undefined });
    const { res, events } = fakeRes();
    await chat.chat({} as IncomingMessage, res, { provider: "anthropic", effectId: "x", history: [], prompt: "hi" });
    expect(events[0].type).toBe("error");
  });
});
