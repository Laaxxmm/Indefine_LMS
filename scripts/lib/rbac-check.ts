// verify:rbac rules (Phase 11). Every Firm OS route handler must, somewhere on its call graph:
//   1. check who is calling: a NextAuth session (`auth()` from @/lib/auth) or the cron secret
//      (`cronUnauthorized` / `bearerUnauthorized` from @/lib/cron-auth); and
//   2. call a policy: a function declared in one of POLICY_FILES (src/lib/rbac/policy.ts and the
//      modules it composes), or the cron secret for system routes.
// Routes in EXPECTED_POLICIES must additionally reach every policy listed for them (the table says
// what the right check is, so a route that silently swapped `canDecideMistakes` for `canViewJob`
// fails). A route not in the table passes on (1) + (2) with a note asking for an entry. A table
// entry with no matching handler fails (a stale table hides nothing).
import type { CallGraph, Handler } from "./route-graph";

/** Files whose exported functions count as policy checks (internal helpers such as `has` do not). */
export const POLICY_FILES = ["src/lib/rbac/policy.ts", "src/lib/agents/access.ts", "src/lib/agents/core/state.ts"];
/** Policy functions in POLICY_FILES that are not access decisions (helpers, labels). */
const NOT_POLICY = new Set(["firmRolesOf", "actorOf", "actorRef", "isJobTaskState", "isLegalEdge", "nextStates", "transitionTable", "gateTokenProblem", "consumeCloseGateToken", "roleFromEntraGroups", "firmRole"]);

/** Session / secret checks, each matched by name AND by the file declaring it (AUTH_SOURCES). */
export const AUTH_CALLS = ["auth", "cronUnauthorized", "bearerUnauthorized"] as const;
const CRON_CALLS = new Set(["cronUnauthorized", "bearerUnauthorized"]);

export type ExpectedPolicy = {
  route: string;
  method: string;
  /** Policy function names that must all be reachable from the handler. */
  policies: string[];
  why: string;
};

const AGENT_RUN = "a run the person can see (assignee / reviewer; managers, partners, admins see all)";
const JOB_EDGE = "the JobTask state machine decides who may take the edge";

/** What each Firm OS route must check. New routes: add a row here (verify-rbac prints a note until you do). */
export const EXPECTED_POLICIES: ExpectedPolicy[] = [
  { route: "/api/firm-os/agents/[agent]/jobs/[jobId]/run", method: "POST", policies: ["canViewJob", "reviewActions"], why: "assignee, manager or partner on a job the person can see" },
  { route: "/api/firm-os/agents/deliverables/[id]", method: "GET", policies: ["canViewJob"], why: "download only a file of a job the person can see" },
  { route: "/api/firm-os/agents/deliverables/[id]/preview", method: "GET", policies: ["canViewJob"], why: "preview only a file of a job the person can see" },
  { route: "/api/firm-os/agents/mistakes/[id]/decide", method: "POST", policies: ["canDecideMistakes"], why: "SOP rule changes: partner only" },
  { route: "/api/firm-os/agents/runs/[id]/approve", method: "POST", policies: ["canViewJob", "canTransition"], why: `${AGENT_RUN}; ${JOB_EDGE}` },
  { route: "/api/firm-os/agents/runs/[id]/comments", method: "POST", policies: ["canViewJob"], why: AGENT_RUN },
  { route: "/api/firm-os/agents/runs/[id]/finalize", method: "POST", policies: ["canViewJob"], why: AGENT_RUN },
  { route: "/api/firm-os/agents/runs/[id]/mistakes", method: "POST", policies: ["canViewJob"], why: AGENT_RUN },
  { route: "/api/firm-os/agents/runs/[id]/request-changes", method: "POST", policies: ["canViewJob", "canTransition"], why: `${AGENT_RUN}; ${JOB_EDGE}` },
  { route: "/api/firm-os/agents/runs/[id]/rerun", method: "POST", policies: ["canViewJob", "canTransition"], why: `${AGENT_RUN}; ${JOB_EDGE}` },
  { route: "/api/firm-os/agents/runs/[id]/submit", method: "POST", policies: ["canViewJob", "canTransition"], why: `${AGENT_RUN}; ${JOB_EDGE}` },
  { route: "/api/firm-os/jobs/[id]/filed", method: "POST", policies: ["canActOnJob", "canTransition"], why: `the job's people, managers, partners; ${JOB_EDGE}` },
  { route: "/api/firm-os/jobs/[id]/state", method: "POST", policies: ["canActOnJob", "canTransition"], why: `the job's people, managers, partners; DONE refused; ${JOB_EDGE}` },
  { route: "/api/firm-os/jobs/[id]/turia-close", method: "POST", policies: ["canActOnJob"], why: "the job's people, managers, partners" },
  { route: "/api/firm-os/onboard/answer", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/create", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/plan", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/resume", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/start", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/turia-confirm", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/cron/firm-os/close-loop", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
  { route: "/api/cron/firm-os/retention", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
];

export type RbacResult = {
  handler: Handler;
  auth: string[];
  policies: string[];
  expected: ExpectedPolicy | null;
  problems: string[];
};

export type RbacReport = { results: RbacResult[]; stale: ExpectedPolicy[]; violations: string[]; notes: string[] };

const key = (route: string, method: string) => `${method} ${route}`;

/** Where each guard must be declared: a local function that happens to be called `auth` is not a session check. */
export const AUTH_SOURCES: Record<(typeof AUTH_CALLS)[number], string> = {
  auth: "src/lib/auth.ts",
  cronUnauthorized: "src/lib/cron-auth.ts",
  bearerUnauthorized: "src/lib/cron-auth.ts",
};

export function checkRbac(graph: CallGraph, routeFiles: string[], table: ExpectedPolicy[] = EXPECTED_POLICIES): RbacReport {
  const results: RbacResult[] = [];
  const violations: string[] = [];
  const notes: string[] = [];
  const byKey = new Map(table.map((e) => [key(e.route, e.method), e]));
  const matched = new Set<string>();

  for (const file of routeFiles) {
    const handlers = graph.handlers(file);
    if (!handlers.length) {
      violations.push(`${file}: no exported HTTP handler could be read (export async function GET/POST/...)`);
      continue;
    }
    for (const h of handlers) {
      const auth = new Set<string>();
      const policies = new Set<string>();
      for (const fn of graph.reachable(h.fn)) {
        for (const c of graph.callsOf(fn)) {
          if ((AUTH_CALLS as readonly string[]).includes(c.name) && c.declFiles.includes(AUTH_SOURCES[c.name as (typeof AUTH_CALLS)[number]])) {
            auth.add(c.name);
            if (CRON_CALLS.has(c.name)) policies.add(c.name);
          }
          for (const t of c.targets) {
            const base = t.name.split(".").pop() ?? t.name;
            if (POLICY_FILES.includes(t.file) && !NOT_POLICY.has(base) && graph.isExported(t)) policies.add(base);
          }
        }
      }
      const k = key(h.route, h.method);
      const expected = byKey.get(k) ?? null;
      if (expected) matched.add(k);
      const problems: string[] = [];
      if (!auth.size) problems.push("no auth guard (auth() session check or cronUnauthorized) on its call graph");
      if (!policies.size) problems.push(`no policy check (a function from ${POLICY_FILES.join(", ")}, or the cron secret)`);
      if (expected) {
        const missing = expected.policies.filter((p) => !policies.has(p));
        if (missing.length) problems.push(`expected policy not reached: ${missing.join(", ")} (${expected.why})`);
      } else if (!problems.length) {
        notes.push(`${k} (${h.file}) is not in EXPECTED_POLICIES (scripts/lib/rbac-check.ts); it reaches ${[...policies].sort().join(", ")} — add a row`);
      }
      for (const p of problems) violations.push(`${k}  ${h.file}: ${p}`);
      results.push({ handler: h, auth: [...auth].sort(), policies: [...policies].sort(), expected, problems });
    }
  }
  const stale = table.filter((e) => !matched.has(key(e.route, e.method)));
  for (const e of stale) violations.push(`${key(e.route, e.method)}: in EXPECTED_POLICIES but no such route handler exists (remove or fix the row)`);
  return { results, stale, violations, notes };
}
