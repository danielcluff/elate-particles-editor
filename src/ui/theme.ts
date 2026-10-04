import { createSignal } from "solid-js";

// The editor's colour scheme. Applied as classes on the editor root and on
// every portal (dialogs, menus, toasts), so it never touches the host page.
// Same tokens as tsl-graph's UI kit, so the two tools read as one product.

export type Theme = "dark" | "light";

// written by EffectEditor while rendering (from its `theme` prop)
const [theme, setTheme] = createSignal<Theme>("dark", { ownedWrite: true });
export { theme, setTheme };

/** Classes for any element that hosts editor UI outside the editor root. */
export const rootClass = () => `elate-root${theme() === "dark" ? " elate-dark" : ""}`;
