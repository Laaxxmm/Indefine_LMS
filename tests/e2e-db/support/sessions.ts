// Signed-in browser contexts per role, from storageState files (support/env.ts storageStateFor).
// Each context carries its own cookies, so `ctx.request` calls the app's API as that person —
// how the RBAC and close-loop specs exercise route-level guards without a UI for every edge.
import type { APIResponse, Browser, BrowserContext, Page } from "@playwright/test";
import { need, storageStateFor, type E2EVar } from "./env";

export type Role = "partner" | "manager" | "assignee" | "reviewer" | "other";

export const ROLE_STATE: Record<Role, E2EVar> = {
  partner: "E2E_PARTNER_STATE",
  manager: "E2E_MANAGER_STATE",
  assignee: "E2E_ASSIGNEE_STATE",
  reviewer: "E2E_REVIEWER_STATE",
  other: "E2E_OTHER_STAFF_STATE",
};

export interface Session {
  role: Role;
  ctx: BrowserContext;
  page: Page;
  /** POST JSON to an app route as this person. */
  post(path: string, data?: unknown): Promise<APIResponse>;
  get(path: string): Promise<APIResponse>;
  close(): Promise<void>;
}

export async function signedIn(browser: Browser, role: Role, spec = "this spec"): Promise<Session> {
  const ctx = await browser.newContext({ storageState: storageStateFor(ROLE_STATE[role], spec), baseURL: need("E2E_BASE_URL", spec) });
  const page = await ctx.newPage();
  return {
    role,
    ctx,
    page,
    post: (path, data) => ctx.request.post(path, { data: data ?? {}, failOnStatusCode: false }),
    get: (path) => ctx.request.get(path, { failOnStatusCode: false, maxRedirects: 0 }),
    close: () => ctx.close(),
  };
}

/** Open several roles at once; close them all with closeAll(). */
export async function signedInAll<R extends Role>(browser: Browser, roles: readonly R[], spec?: string): Promise<Record<R, Session> & { closeAll(): Promise<void> }> {
  const out = {} as Record<R, Session>;
  for (const r of roles) out[r] = await signedIn(browser, r, spec);
  return Object.assign(out, { closeAll: async () => void (await Promise.all(Object.values<Session>(out).map((s) => s.close()))) });
}
