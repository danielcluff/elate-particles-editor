import { For, Show, createMemo, createSignal } from "solid-js";
import { moduleDefsForStage, type EmitterDoc, type ModuleDef, type Stage } from "elate-particles";
import { Search } from "lucide-static";
import { Icon } from "../ui";

/** Searchable list of a stage's module types, grouped by category (like tsl-graph's node picker). */
export function ModulePicker(props: { stage: Stage; emitter: EmitterDoc; onPick: (def: ModuleDef) => void }) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const present = createMemo(() => new Set(props.emitter[props.stage].map((m) => m.type)));
  const defs = createMemo(() => {
    const q = query().toLowerCase().trim();
    return moduleDefsForStage(props.stage).filter(
      (d) => !q || d.label.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.description.toLowerCase().includes(q),
    );
  });
  const groups = createMemo(() => {
    const out = new Map<string, ModuleDef[]>();
    for (const d of defs()) out.set(d.category, [...(out.get(d.category) ?? []), d]);
    return [...out.entries()];
  });
  const blocked = (d: ModuleDef) => d.multiple === false && present().has(d.type);
  const pickable = () => defs().filter((d) => !blocked(d));

  return (
    <div class="flex w-72 flex-col">
      <div class="relative p-1">
        <Icon svg={Search} class="pointer-events-none absolute top-3.5 left-3 size-3.5 text-muted-foreground/70" />
        <input
          class="h-8 w-full rounded-md border border-input bg-transparent pr-3 pl-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
          placeholder="Search modules..."
          value={query()}
          ref={(el) => requestAnimationFrame(() => el.focus())}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            const list = pickable();
            if (e.key === "ArrowDown") setActive((i) => Math.min(list.length - 1, i + 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
            else if (e.key === "Enter" && list[active()]) props.onPick(list[active()]);
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <div class="thin-scroll max-h-80 overflow-y-auto pb-1">
        <Show when={groups().length} fallback={<p class="px-3 py-4 text-center text-xs text-muted-foreground">No modules match.</p>}>
          <For each={groups()}>
            {([category, list]) => (
              <div>
                <div class="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{category}</div>
                <For each={list}>
                  {(d) => (
                    <button
                      type="button"
                      disabled={blocked(d)}
                      title={blocked(d) ? `${d.label} is already in this emitter` : d.description}
                      class={[
                        "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent disabled:opacity-40",
                        { "bg-accent": pickable()[active()] === d },
                      ]}
                      onClick={() => props.onPick(d)}
                    >
                      <span class="text-xs font-medium">{d.label}</span>
                      <span class="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{d.description}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
