import { untrack } from "solid-js";
import { normalizeEffect, validateEffect, type Command } from "elate-particles";
import type { EffectHost } from "../host";
import { serverUrl } from "./host";
import type { Playback } from "./playback";
import type { Editor } from "./store";
import { ui } from "./ui-state";

// Connects the open editor to the effect server so MCP tool calls act on the
// live document (undo history, live preview, screenshots, stats).

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function connectBridge(ed: Editor, pb: Playback, host: EffectHost): () => void {
  const url = serverUrl(host, "/bridge", "ws");
  if (!url) return () => {};
  const effectId = untrack(() => ed.state.doc.id);
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  let timer: number | undefined;

  const send = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const preview = () => {
    if (!pb.preview || !pb.state.ready) throw new Error(pb.state.error ?? "The preview is not ready (WebGPU still initialising)");
    return pb.preview;
  };

  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown> = {
    command: (params) => {
      if (params.effectId && params.effectId !== ed.state.doc.id) throw new Error("Editor has a different effect open");
      const command = params.command as Command;
      const result = ed.run(command, { throw: true });
      if (command.op !== "getEffect" && command.op !== "validate") ui.toast(`Agent: ${describe(command)}`);
      return result;
    },
    validate: () => validateEffect(ed.plainDoc()),
    capturePreview: async (params) => {
      const p = preview();
      pb.applyNow();
      if (typeof params.time === "number") p.seek(params.time);
      if (params.frame) p.frame();
      // let the camera settle and the frame render
      await nextFrame();
      await nextFrame();
      return p.capture(Number(params.width) || 640, Number(params.height) || 400);
    },
    getStats: () => {
      const p = preview();
      pb.applyNow();
      const s = p.world.stats;
      return {
        time: Math.round(p.time * 1000) / 1000,
        playing: p.playing,
        particles: s.particles,
        drawCalls: s.drawCalls,
        lights: s.lights,
        updateMs: Math.round(pb.state.updateMs * 100) / 100,
        fps: Math.round(pb.state.fps),
        emitters: p.emitterStats(),
        solo: ed.state.solo,
      };
    },
  };

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 500;
      send({ type: "hello", effectId });
      send({ type: "active", visible: document.visibilityState === "visible" });
    };
    ws.onmessage = async (ev) => {
      let msg: { type: string; id?: string; method?: string; params?: Record<string, unknown>; effectId?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "call" && msg.id && msg.method) {
        try {
          const fn = handlers[msg.method];
          if (!fn) throw new Error(`Unknown method ${msg.method}`);
          const result = await fn(msg.params ?? {});
          send({ type: "result", id: msg.id, ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) });
        } catch (err) {
          send({ type: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      } else if (msg.type === "navigate" && msg.effectId) {
        host.openProject(msg.effectId);
      } else if ((msg.type === "reload" || msg.type === "saved") && msg.effectId === ed.state.doc.id) {
        // changed on disk (an agent without this tab, or another tab): take it unless we have unsaved edits
        if (ed.state.saveState !== "saved") return;
        const doc = normalizeEffect(await host.projects.load(ed.state.doc.id));
        const strip = (d: object) => JSON.stringify({ ...d, updatedAt: 0, thumbnail: "" });
        if (strip(doc) !== strip(ed.plainDoc())) ed.replaceDoc(doc, { save: false });
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      timer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  connect();

  const onVis = () => send({ type: "active", visible: document.visibilityState === "visible" });
  const onFocus = () => send({ type: "active", visible: true });
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onFocus);
  return () => {
    closed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("focus", onFocus);
    ws?.close();
  };
}

function describe(cmd: Command): string {
  switch (cmd.op) {
    case "addEmitter":
      return `added emitter${cmd.name ? ` "${cmd.name}"` : ""}`;
    case "addModule":
      return `added ${cmd.type}`;
    case "updateModule":
      return "updated a module";
    case "updateEmitter":
      return "updated an emitter";
    case "batch":
      return `applied ${cmd.ops.length} operation${cmd.ops.length === 1 ? "" : "s"}`;
    default:
      return cmd.op.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
  }
}
