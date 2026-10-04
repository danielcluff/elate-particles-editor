import { For, Show, createSignal, useContext } from "solid-js";
import {
  Check,
  Download,
  Ellipsis,
  FolderOpen,
  Grid3x3,
  Keyboard,
  Link2,
  Pause,
  Plug,
  Play,
  Redo2,
  Repeat,
  Braces,
  RotateCcw,
  Scan,
  Sparkles,
  StepForward,
  Undo2,
} from "lucide-static";
import { Icon, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { ChatContext } from "./ai-chat";
import { HostContext, effectMcpUrl } from "./host";
import { PlaybackContext } from "./playback";
import { BACKGROUNDS, DEFAULT_PREVIEW } from "./preview";
import { EditorContext } from "./store";
import { ui } from "./ui-state";

const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
const MOTIONS = [
  { value: "none", label: "Still" },
  { value: "circle", label: "Circle" },
  { value: "line", label: "Line" },
] as const;

export function Logo() {
  return (
    <div class="flex select-none flex-col items-center leading-none">
      <span class="text-sm font-black tracking-tighter">ELATE</span>
      <span class="text-[7px] font-bold tracking-widest text-muted-foreground">PARTICLES</span>
    </div>
  );
}

function BarButton(props: { icon: string; label: string; active?: boolean; disabled?: boolean; onClick: (e: MouseEvent) => void }) {
  return (
    <Tooltip content={props.label} side="bottom">
      <button
        type="button"
        aria-label={props.label}
        aria-pressed={props.active === undefined ? undefined : props.active ? "true" : "false"}
        disabled={props.disabled}
        class={[
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-35",
          props.active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        ]}
        onClick={(e) => props.onClick(e)}
      >
        <Icon svg={props.icon} class="size-3.5" />
      </button>
    </Tooltip>
  );
}

const Divider = () => <div class="mx-0.5 h-4 w-px shrink-0 bg-border" />;

export function TopBar(props: { onSaveJson: () => void; onLoadJson: () => void }) {
  const ed = useContext(EditorContext);
  const pb = useContext(PlaybackContext);
  const host = useContext(HostContext);
  const chat = useContext(ChatContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  const [bgMenu, setBgMenu] = createSignal<PopoverAnchor | null>(null);
  const settings = () => ({ ...DEFAULT_PREVIEW, ...ed.state.doc.preview });

  return (
    <div class="@container flex h-10 items-center gap-1 rounded-xl border bg-card px-3 shadow-lg" data-ui>
      <button type="button" aria-label="Exit editor" class="shrink-0" disabled={!host.exit} onClick={() => host.exit?.()}>
        <Logo />
      </button>
      <Divider />
      <input
        aria-label="Effect name"
        class="w-32 shrink-0 truncate rounded-md bg-transparent px-1.5 py-1 text-xs font-medium outline-none hover:bg-accent focus:bg-accent"
        value={ed.state.doc.name}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim() || "Untitled";
          if (v !== ed.state.doc.name) ed.run({ op: "rename", name: v });
          e.currentTarget.value = v;
        }}
      />
      <div class="flex-1" />

      {/* playback */}
      <BarButton icon={RotateCcw} label="Restart (R)" onClick={() => pb.restart()} />
      <BarButton icon={pb.state.playing ? Pause : Play} label={pb.state.playing ? "Pause (Space)" : "Play (Space)"} onClick={() => pb.toggle()} />
      <BarButton icon={StepForward} label="Step one frame (.)" onClick={() => pb.step()} />
      <span class="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{pb.state.time.toFixed(2)}s</span>
      <select
        aria-label="Playback speed"
        title="Playback speed"
        class="h-7 shrink-0 rounded-md bg-transparent px-1 font-mono text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground [&>option]:bg-popover"
        value={String(pb.state.timeScale)}
        onChange={(e) => pb.setTimeScale(Number(e.currentTarget.value))}
      >
        <For each={SPEEDS}>{(s) => <option value={String(s)}>{s}×</option>}</For>
      </select>
      <BarButton icon={Repeat} label={pb.state.loop ? "Replay one-shots: on" : "Replay one-shots: off"} active={pb.state.loop} onClick={() => pb.setLoop(!pb.state.loop)} />
      <Divider />

      {/* view */}
      <select
        aria-label="Motion preview"
        title="Motion preview: move the effect along a path to see trails and inherited velocity"
        class="h-7 shrink-0 rounded-md bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground [&>option]:bg-popover"
        value={settings().motion}
        onChange={(e) => ed.setPreview({ motion: e.currentTarget.value as "none" | "circle" | "line" })}
      >
        <For each={MOTIONS}>{(m) => <option value={m.value}>{m.label}</option>}</For>
      </select>
      <Tooltip content="Background" side="bottom">
        <button
          type="button"
          aria-label="Background"
          class="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
          onClick={(e) => togglePopover(bgMenu(), setBgMenu, e)}
        >
          <span class="size-3.5 rounded-full border border-foreground/30" style={{ background: settings().background }} />
        </button>
      </Tooltip>
      <Popover open={!!bgMenu()} anchor={bgMenu()?.rect} trigger={bgMenu()?.el} align="end" onClose={() => setBgMenu(null)} class="w-40">
        <MenuLabel>Background</MenuLabel>
        <For each={BACKGROUNDS}>
          {(b) => (
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                setBgMenu(null);
                ed.setPreview({ background: b.value });
              }}
            >
              <span class="size-3.5 rounded-full border border-foreground/30" style={{ background: b.value }} />
              <span class="flex-1">{b.label}</span>
              <Show when={settings().background === b.value}>
                <Icon svg={Check} class="size-3.5" />
              </Show>
            </button>
          )}
        </For>
      </Popover>
      <BarButton icon={Grid3x3} label="Ground and grid" active={settings().showGrid} onClick={() => ed.setPreview({ showGrid: !settings().showGrid })} />
      <BarButton icon={Scan} label="Frame effect (F)" onClick={() => pb.frame()} />
      <Divider />

      <SaveBadge />
      <Show when={chat.available}>
        <BarButton
          icon={Sparkles}
          label="AI assistant (⌘I)"
          active={chat.state.open && !chat.state.minimized}
          onClick={() =>
            chat.setState((d) => {
              d.open = !(d.open && !d.minimized);
              d.minimized = false;
            })
          }
        />
      </Show>
      <BarButton icon={Undo2} label="Undo (⌘Z)" disabled={!ed.state.canUndo} onClick={() => ed.undo()} />
      <BarButton icon={Redo2} label="Redo (⇧⌘Z)" disabled={!ed.state.canRedo} onClick={() => ed.redo()} />
      <BarButton icon={Ellipsis} label="More" active={!!menu()} onClick={(e) => togglePopover(menu(), setMenu, e)} />
      <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)} class="w-56">
        <MenuLabel>File</MenuLabel>
        <MenuItem icon={Download} onSelect={() => (setMenu(null), props.onSaveJson())}>
          Download .fx.json
        </MenuItem>
        <MenuItem icon={FolderOpen} onSelect={() => (setMenu(null), props.onLoadJson())}>
          Load from JSON…
        </MenuItem>
        <MenuItem icon={Braces} onSelect={() => (setMenu(null), ui.openDialog("json"))}>
          View JSON
        </MenuItem>
        <Show when={host.projectUrl}>
          <MenuItem
            icon={Link2}
            onSelect={() => {
              setMenu(null);
              void navigator.clipboard.writeText(host.projectUrl!(ed.state.doc.id)).then(() => ui.toast("Link copied", "success"));
            }}
          >
            Copy link
          </MenuItem>
        </Show>
        <MenuSeparator />
        <Show when={effectMcpUrl(host)}>
          <MenuItem icon={Plug} onSelect={() => (setMenu(null), ui.openDialog("mcp"))}>
            Connect agent (MCP)
          </MenuItem>
        </Show>
        <MenuItem icon={Keyboard} onSelect={() => (setMenu(null), ui.openDialog("shortcuts"))}>
          Keyboard shortcuts
        </MenuItem>
      </Popover>
    </div>
  );
}

function SaveBadge() {
  const ed = useContext(EditorContext);
  const label = () => ({ saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Save failed" })[ed.state.saveState];
  return (
    <Show when={ed.persist}>
      <span
        class={[
          "mr-1 hidden shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap @2xl:inline",
          ed.state.saveState === "saved"
            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
            : ed.state.saveState === "error"
              ? "border-red-500/30 bg-red-500/15 text-red-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400",
        ]}
      >
        {label()}
      </span>
    </Show>
  );
}
