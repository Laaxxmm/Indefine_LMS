// Vitest config for the visual render only (not part of `npm test`):
//   npx vitest run --config tests/regression/visual.vitest.config.ts
// Output: test-results/visual/index.html (git-ignored). See tests/regression/visual-render.ts.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["tests/regression/visual-render.ts"], testTimeout: 300_000, restoreMocks: true },
});
