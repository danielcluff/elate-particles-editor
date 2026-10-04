import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createEffect, normalizeEffect, slugify, uniqueSlug, type EffectDoc } from "elate-particles";
import type { EffectStore, EffectSummary } from "../host";

// An EffectStore that keeps one `<id>.fx.json` file per effect in a
// directory: the same files the runtime loads. Handy for local tools and the
// playground; host apps usually bring their own.

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export interface FileStore extends EffectStore {
  remove(id: string): Promise<void>;
}

export function createFileStore(dir: string): FileStore {
  const root = resolve(dir);
  const file = (id: string) => {
    if (!ID.test(id)) throw new Error(`Invalid effect id "${id}"`);
    return join(root, `${id}.fx.json`);
  };
  const ensure = () => mkdir(root, { recursive: true });

  async function save(doc: EffectDoc) {
    await ensure();
    const target = file(doc.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2));
    await rename(tmp, target);
  }

  return {
    async list(): Promise<EffectSummary[]> {
      await ensure();
      const out: EffectSummary[] = [];
      for (const f of (await readdir(root)).filter((f) => f.endsWith(".fx.json"))) {
        try {
          const doc = JSON.parse(await readFile(join(root, f), "utf8")) as EffectDoc;
          out.push({ id: f.slice(0, -".fx.json".length), name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: doc.thumbnail, emitterCount: doc.emitters?.length ?? 0 });
        } catch {
          // skip unreadable files
        }
      }
      return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    },
    async get(id) {
      try {
        return normalizeEffect(JSON.parse(await readFile(file(id), "utf8")), { id });
      } catch {
        return null;
      }
    },
    save,
    async create(name, from) {
      // the slug comes from the name and is unique among the files, so "new from example" never overwrites
      await ensure();
      const taken = (await readdir(root)).filter((f) => f.endsWith(".fx.json")).map((f) => f.slice(0, -".fx.json".length));
      const id = uniqueSlug(slugify(name || from?.name || "untitled", "effect"), taken);
      const base = from?.emitters ? normalizeEffect({ ...from, id: undefined }, { id }) : createEffect(name || "Untitled", { id });
      const now = Date.now();
      const doc: EffectDoc = { ...base, name: name || base.name, createdAt: now, updatedAt: now };
      await save(doc);
      return doc;
    },
    async remove(id) {
      await rm(file(id), { force: true });
    },
  };
}
