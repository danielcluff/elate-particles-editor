import { createContext } from "solid-js";
import type { EffectHost } from "../host";

export const HostContext = createContext<EffectHost>();
