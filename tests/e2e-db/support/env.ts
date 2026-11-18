// Environment for the DB-backed golden paths (npm run e2e:db → playwright.db.config.ts, 3 repeats).
// Nothing here runs at import time: `npx playwright test --config playwright.db.config.ts --list`
// must load every spec with no environment at all. A spec that runs without what it needs fails
// loudly with the variable's name and what to put in it — there are no skip guards in this repo.
//
// The full list, and how to make each value, is in docs/qa/phase-12-runbook.md ("e2e:db on staging").
import { existsSync, readFileSync } from "node:fs";

export const E2E_ENV = {
  E2E_BASE_URL: "the running app (staging, or `next start` against the staging DB)",
  DATABASE_URL: "the same staging database the app uses (setup + assertions)",
  E2E_PARTNER_STATE: "Playwright storageState JSON of a signed-in PARTNER (level PARTNER, not an LMS admin)",
  E2E_MANAGER_STATE: "storageState of a signed-in MANAGER (level MANAGER or SENIOR_MANAGER)",
  E2E_ASSIGNEE_STATE: "storageState of the staff member who prepares jobs (E2E_ASSIGNEE_EMAIL)",
  E2E_REVIEWER_STATE: "storageState of a second staff member who reviews jobs (E2E_REVIEWER_EMAIL)",
  E2E_OTHER_STAFF_STATE: "storageState of a third staff member who is neither assignee nor reviewer (E2E_OTHER_STAFF_EMAIL)",
  E2E_ASSIGNEE_EMAIL: "LMS user email of the assignee",
  E2E_REVIEWER_EMAIL: "LMS user email of the reviewer",
  E2E_OTHER_STAFF_EMAIL: "LMS user email of the unrelated staff member",
  E2E_ASSIGNEE_NAME: "display name the onboarding sentence assigns (default Priya)",
  E2E_REVIEWER_NAME: "display name the onboarding sentence sets as reviewer (default Ravi)",
  E2E_CLIENT_CODE: "a FirmClient onboarded once for e2e whose CL-{Code} site and Compliance library exist (e.g. E2EQA)",
  CRON_SECRET: "the app's CRON_SECRET, to fire the close-loop / coach crons the way GitHub Actions does",
} as const;

export type E2EVar = keyof typeof E2E_ENV;

/** The value, or a loud failure naming the variable and what it should hold. */
export function need(name: E2EVar | string, spec = "this spec"): string {
  const v = process.env[name]?.trim();
  if (!v) {
    const what = (E2E_ENV as Record<string, string>)[name] ?? "see docs/qa/phase-12-runbook.md";
    throw new Error(`${spec} needs ${name}: ${what}. Set it in the environment of \`npm run e2e:db\` (docs/qa/phase-12-runbook.md).`);
  }
  return v;
}

export function optional(name: E2EVar | string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** Auth.js session cookie names (database sessions): plain on http, __Secure- on https. */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Path of a storageState file after checking it is usable: it exists, parses, and holds an
 * unexpired Auth.js session cookie. The states are made by a person (Microsoft sign-in + MFA is
 * never automated): `npx playwright open --save-storage=.auth/<role>.json "$E2E_BASE_URL"`, sign
 * in with Microsoft, close the window. Sessions expire — re-save when this check fails.
 */
export function storageStateFor(envName: E2EVar, spec = "this spec"): string {
  const path = need(envName, spec);
  if (!existsSync(path)) throw new Error(`${envName}=${path} does not exist. Save it with: npx playwright open --save-storage=${path} "$E2E_BASE_URL"`);
  let state: { cookies?: { name: string; expires?: number }[] };
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${envName}=${path} is not a Playwright storageState JSON file`);
  }
  const cookie = (state.cookies ?? []).find((c) => SESSION_COOKIES.includes(c.name));
  if (!cookie) throw new Error(`${envName}=${path} has no Auth.js session cookie — sign in with Microsoft in the window, then close it`);
  if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires * 1000 < Date.now()) {
    throw new Error(`${envName}=${path}: the session expired on ${new Date(cookie.expires * 1000).toISOString()} — re-save it (npx playwright open --save-storage=${path} "$E2E_BASE_URL")`);
  }
  return path;
}

/** A short unique suffix for titles / codes, so `--repeat-each=3` never collides with an earlier run. */
export const runTag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
