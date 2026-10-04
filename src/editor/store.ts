import { createContext, createMemo, createSignal, flush, reconcile, snapshot, createStore } from "solid-js";
import { executeCommand, isReadOnly, validateEffect, type Command, type EffectDoc, type Issue, type PreviewSettings } from "elate-particles";
import { ui } from "./ui-state";

// The editor's state. The effect document lives in a store; every edit is a
// `Command` run through the runtime's executeCommand (the same API MCP tools
// and agents use), applied to a copy and reconciled back by id so unchanged
// emitters and modules keep their identity (and their open popovers, focus…).
// Undo stores a JSON snapshot per command; effects are small.

const MAX_HISTORY = 200;

export interface RunOptions {
  /**
   * Consecutive runs with the same key form one undo step: dragging a value,
   * typing a number, moving a curve key. `commit()` (pointer up, blur) ends it.
   */
  merge?: string;
  /** false: no undo entry (preview settings). */
  history?: boolean;
  /** Report errors as a toast (default true). */
  toast?: boolean;
  /** Rethrow errors instead (agent calls through the bridge). */
  throw?: boolean;
}

export type SaveState = "saved" | "unsaved" | "saving" | "error";

export function createEditor(initial: EffectDoc, opts: { save?: (doc: EffectDoc) => Promise<void> } = {}) {
  const persist = !!opts.save;
  const [state, setState] = createStore({
    doc: structuredClone(initial),
    /** Emitter shown in the stack (right panel). */
    selected: (initial.emitters[0]?.id ?? null) as string | null,
    /** Editor-only: preview just this emitter (and the sub-emitters it drives). */
    solo: null as string | null,
    /** Editor-only: live parameter values for the preview (defaults otherwise). */
    params: {} as Record<string, number>,
    /** Collapsed module cards and stack sections, by id. */
    collapsed: {} as Record<string, boolean>,
    saveState: "saved" as SaveState,
    canUndo: false,
    canRedo: false,
  });
  const [version, setVersion] = createSignal(0);

  let past: string[] = [];
  let future: string[] = [];
  let mergeKey: string | null = null;

  const serialize = () => JSON.stringify(snapshot(state.doc));
  const plainDoc = (): EffectDoc => structuredClone(snapshot(state.doc)) as EffectDoc;

  // ---- derived -------------------------------------------------------------
  const emitter = createMemo(() => state.doc.emitters.find((e) => e.id === state.selected) ?? state.doc.emitters[0]);
  const issues = createMemo<Issue[]>(() => {
    version();
    try {
      return validateEffect(plainDoc());
    } catch (err) {
      return [{ level: "error", message: `Validation crashed: ${err instanceof Error ? err.message : err}` }];
    }
  });

  // ---- history -------------------------------------------------------------
  function pushHistory(entry = serialize()) {
    past.push(entry);
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
    setState((s) => {
      s.canUndo = true;
      s.canRedo = false;
    });
  }

  function apply(next: EffectDoc) {
    setState((s) => {
      reconcile(next, "id")(s.doc);
      // keep a valid selection
      if (!s.doc.emitters.some((e) => e.id === s.selected)) s.selected = s.doc.emitters[0]?.id ?? null;
      if (s.solo && !s.doc.emitters.some((e) => e.id === s.solo)) s.solo = null;
    });
    flush();
    changed();
  }

  function restore(entry: string) {
    mergeKey = null;
    apply(JSON.parse(entry) as EffectDoc);
    setState((s) => {
      s.canUndo = past.length > 0;
      s.canRedo = future.length > 0;
    });
  }

  function undo() {
    const entry = past.pop();
    if (!entry) return;
    future.push(serialize());
    restore(entry);
  }

  function redo() {
    const entry = future.pop();
    if (!entry) return;
    past.push(serialize());
    restore(entry);
  }

  /** Current undo depth; `undoTo(mark)` reverts everything done since (an AI reply's changes). */
  const historyMark = () => past.length;
  function undoTo(mark: number) {
    if (past.length <= mark) return;
    const target = past[mark];
    future.push(serialize());
    past = past.slice(0, mark);
    restore(target);
  }

  /** Ends the current merged edit (see RunOptions.merge). */
  function commit() {
    mergeKey = null;
  }

  // ---- saving --------------------------------------------------------------
  let saveTimer: number | undefined;
  let saving = false;
  let saveAgain = false;

  function changed() {
    setVersion((v) => v + 1);
    scheduleSave();
  }

  function scheduleSave() {
    if (!persist) return;
    setState((s) => void (s.saveState = "unsaved"));
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 700);
  }

  async function save() {
    if (!persist) return;
    clearTimeout(saveTimer);
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    setState((s) => void (s.saveState = "saving"));
    try {
      await opts.save!(plainDoc());
      setState((s) => void (s.saveState = saveAgain ? "unsaved" : "saved"));
    } catch {
      setState((s) => void (s.saveState = "error"));
    } finally {
      saving = false;
      if (saveAgain) {
        saveAgain = false;
        void save();
      }
    }
  }

  // ---- mutation ------------------------------------------------------------

  /**
   * Runs a command. Returns its result, or undefined when it failed (the
   * document is then unchanged and the error is shown as a toast).
   */
  function run<T = unknown>(cmd: Command, o: RunOptions = {}): T | undefined {
    // widgets build values from store proxies: detach them (keeping undefined, which clears fields)
    cmd = plain(cmd);
    const before = serialize();
    const draft = JSON.parse(before) as EffectDoc;
    let result: unknown;
    try {
      result = executeCommand(draft, cmd);
    } catch (err) {
      if (o.throw) throw err;
      if (o.toast !== false) ui.toast(err instanceof Error ? err.message : String(err), "error");
      return undefined;
    }
    if (isReadOnly(cmd)) return result as T;
    if (o.history !== false && !(o.merge && o.merge === mergeKey)) pushHistory(before);
    mergeKey = o.merge ?? null;
    apply(draft);
    return result as T;
  }

  /** Edits outside the command set (preview settings), without undo. */
  function setPreview(patch: Partial<PreviewSettings>) {
    setState((s) => void (s.doc.preview = { ...s.doc.preview, ...patch }));
    flush();
    changed();
  }

  /** Stores a thumbnail (no undo, no preview reload). */
  function setThumbnail(dataUrl: string) {
    setState((s) => void (s.doc.thumbnail = dataUrl));
    scheduleSave();
  }

  /**
   * Replaces the whole document (load from JSON, or a reload after the file
   * changed on disk) as one undo step. `save: false` when it came from storage.
   */
  function replaceDoc(doc: EffectDoc, o: { save?: boolean } = {}) {
    pushHistory();
    mergeKey = null;
    // a loaded file keeps this effect's id, so saving overwrites this effect
    apply({ ...structuredClone(doc), id: state.doc.id });
    if (o.save === false) {
      clearTimeout(saveTimer);
      setState((s) => void (s.saveState = "saved"));
    }
  }

  function select(emitterId: string | null) {
    setState((s) => void (s.selected = emitterId));
  }

  function setSolo(emitterId: string | null) {
    setState((s) => void (s.solo = s.solo === emitterId ? null : emitterId));
  }

  function setParamValue(name: string, value: number) {
    setState((s) => void (s.params[name] = value));
  }

  function toggleCollapsed(id: string, value?: boolean) {
    setState((s) => void (s.collapsed[id] = value ?? !s.collapsed[id]));
  }

  return {
    state,
    setState,
    version,
    emitter,
    issues,
    run,
    commit,
    undo,
    redo,
    historyMark,
    undoTo,
    save,
    setPreview,
    setThumbnail,
    replaceDoc,
    select,
    setSolo,
    setParamValue,
    toggleCollapsed,
    plainDoc,
    persist,
  };
}

/** Deep copy into plain objects (reads through store proxies; unlike JSON, keeps `undefined`). */
export function plain<T>(v: T): T {
  if (Array.isArray(v)) return v.map(plain) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = plain((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

export type Editor = ReturnType<typeof createEditor>;
export const EditorContext = createContext<Editor>();

/**
 * The document the preview plays. With an emitter soloed, only it and the
 * sub-emitters it drives (directly or through others) draw; the emitters that
 * drive *it* keep simulating, invisibly, so a soloed sub-emitter still gets its
 * events. Everything else is disabled.
 */
export function previewDoc(doc: EffectDoc, solo: string | null): EffectDoc {
  if (!solo || !doc.emitters.some((e) => e.id === solo)) return doc;
  const drives = (id: string) => doc.emitters.find((x) => x.id === id)?.subEmitters?.map((s) => s.emitter) ?? [];
  const closure = (start: string[], next: (id: string) => string[]) => {
    const out = new Set(start);
    const queue = [...start];
    while (queue.length) for (const n of next(queue.pop()!)) if (!out.has(n)) out.add(n), queue.push(n);
    return out;
  };
  const shown = closure([solo], drives);
  const sources = closure([solo], (id) => doc.emitters.filter((e) => e.subEmitters?.some((s) => s.emitter === id)).map((e) => e.id));
  return {
    ...doc,
    emitters: doc.emitters.map((e) => {
      if (shown.has(e.id)) return e;
      if (sources.has(e.id)) return { ...e, renderers: e.renderers.map((r) => ({ ...r, enabled: false })) };
      return { ...e, enabled: false };
    }),
  };
}
