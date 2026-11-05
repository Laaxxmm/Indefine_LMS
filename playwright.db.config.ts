// Playwright config for DB-backed golden paths (tests/e2e-db). These need a staging
// database, a running app and a signed-in storageState, so they are kept out of the
// default `npm run e2e` smoke run. Run with `npm run e2e:db`; see tests/e2e-db/*.spec.ts
// for the env each spec reads (E2E_BASE_URL, E2E_PARTNER_STATE, DATABASE_URL).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e-db",
  timeout: 180_000,
  retries: 0, // flaky = bug (orchestrator loop rule 4); the QA gate runs each spec 3x
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: process.env.E2E_BASE_URL },
});
