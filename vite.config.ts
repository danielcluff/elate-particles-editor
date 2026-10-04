import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// Builds the playground app (playground/server.ts serves it in dev).
export default defineConfig({
  root: "playground",
  plugins: [solid(), tailwindcss()],
  // elate-particles is a workspace package (packages/elate-particles): one three and one Solid for both
  resolve: { dedupe: ["solid-js", "@solidjs/web", "three"] },
  build: { target: "esnext", chunkSizeWarningLimit: 4000, outDir: "../dist", emptyOutDir: true },
});
