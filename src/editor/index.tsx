// Browser entry: the effect editor as a Solid component, or mounted into any
// DOM element for hosts that don't use Solid.
import { render } from "@solidjs/web";
import { EffectEditor, type EffectEditorProps } from "./EffectEditor";

export { EffectEditor, type EffectEditorProps } from "./EffectEditor";
export { EffectPreview, type FrameInfo } from "./preview";
export type { EffectHost, EffectSource, EffectSummary, McpMode, ProviderId } from "../host";
export type { Theme } from "../ui/theme";

export interface MountedEffectEditor {
  dispose(): void;
}

/**
 * Mount the editor into `el` (it fills the element). To switch effects,
 * dispose and mount again with the new `projectId`.
 */
export function mountEffectEditor(el: HTMLElement, props: EffectEditorProps): MountedEffectEditor {
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  const dispose = render(() => <EffectEditor {...props} />, el);
  return { dispose };
}
