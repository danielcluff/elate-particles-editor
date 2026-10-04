import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { dedupe: ["solid-js", "@solidjs/web", "three"] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
