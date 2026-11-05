// Vitest config for Firm OS (and any LMS module that adopts unit tests).
// The older modules keep their assert-based scripts/verify-*.ts; new modules test here.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig says jsx: "preserve" (Next compiles it); tests import .tsx pages, so compile here.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "tests/chaos/**/*.test.ts",
      "tests/regression/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    restoreMocks: true,
    // Several suites scan the whole repository (guards, ui-links, the DONE-gate minter scan) or run
    // the full accuracy harness. They take 0.5–3 s on a quiet machine but timed out at the 5 s
    // default when the suite ran beside parallel builds. These are work, not races: a 20 s default
    // keeps a genuinely hung test visible while not failing on CPU contention.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Firm OS modules only: the >= 80% line bar applies to new code (orchestrator rule 4).
      include: [
        "src/lib/ai/**",
        "src/lib/agents/**",
        "src/lib/integrations/**",
        "src/lib/close-loop/**",
        "src/lib/audit/**",
        "src/lib/rbac/**",
        "src/lib/companion/**",
        "src/lib/search/**",
        "src/lib/workspace/**",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: { lines: 80 },
    },
  },
});
