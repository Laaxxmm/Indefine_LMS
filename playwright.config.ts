// Playwright e2e config. The smoke spec uses only the `request` fixture, so no browser
// download is needed to run it; specs that need a page will need `npx playwright install`.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000, // first hit on `next dev` compiles the route
  retries: 0, // a flaky e2e is a bug to fix, not to retry (orchestrator loop rule 4)
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: BASE_URL },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
