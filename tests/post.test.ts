import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POST, createPostStore } from "../src/post/settings";

const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };

describe("post settings store", () => {
  afterEach(() => {
    memory.clear();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("notifies subscribers and reads back writes immediately", () => {
    const store = createPostStore("test-post");
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.exposure));
    store.update((s) => ({ ...s, exposure: 1 }));
    store.update((s) => ({ ...s, exposure: s.exposure + 1 }));
    expect(seen).toEqual([DEFAULT_POST.exposure, 1, 2]);
    store.reset();
    expect(seen.at(-1)).toBe(DEFAULT_POST.exposure);
  });

  it("restores saved settings over the defaults, ignoring unknown tone maps", () => {
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    memory.set("test-post", JSON.stringify({ toneMapping: "bogus", bloom: { strength: 2 }, grade: { bands: 1 } }));
    let restored = DEFAULT_POST;
    createPostStore("test-post").subscribe((s) => (restored = s));
    expect(restored.toneMapping).toBe(DEFAULT_POST.toneMapping);
    expect(restored.bloom).toEqual({ ...DEFAULT_POST.bloom, strength: 2 });
    expect(restored.grade.bands).toBe(1);
    expect(restored.grade.saturation).toBe(DEFAULT_POST.grade.saturation);
  });

  it("saves each change under its key", () => {
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    createPostStore("test-post").update((s) => ({ ...s, enabled: false }));
    expect(JSON.parse(memory.get("test-post")!).enabled).toBe(false);
  });
});
