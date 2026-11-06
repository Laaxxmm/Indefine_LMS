// verify:rbac rules (Phase 11). Every Firm OS route handler must, somewhere on its call graph:
//   1. check who is calling: a NextAuth session (`auth()` from @/lib/auth), the cron secret
//      (`cronUnauthorized` / `bearerUnauthorized` from @/lib/cron-auth), or a Companion pairing
//      token (`verifyPairing` from @/lib/companion/tokens: sha256 lookup, constant-time compare,
//      revoked / expired refused — the extension's bearer credential, never a cookie); and
//   2. call a policy: a function declared in one of POLICY_FILES (src/lib/rbac/policy.ts and the
//      modules it composes), or the cron secret for system routes.
// Routes in EXPECTED_POLICIES must additionally reach every policy listed for them (the table says
// what the right check is, so a route that silently swapped `canDecideMistakes` for `canViewJob`
// fails). A route not in the table passes on (1) + (2) with a note asking for an entry. A table
// entry with no matching handler fails (a stale table hides nothing).
//
// The one exception to (1) + (2) is a CORS preflight listed in PREFLIGHT_ROUTES: method OPTIONS
// only, and only while nothing on its call graph touches the database or a data provider (see
// PREFLIGHT_ROUTES). There is no blanket allow: an unlisted OPTIONS handler is checked like any other.
import type { CallGraph, CallSite, Handler } from "./route-graph";

/** Files whose exported functions count as policy checks (internal helpers such as `has` do not). */
export const POLICY_FILES = ["src/lib/rbac/policy.ts", "src/lib/agents/access.ts", "src/lib/agents/core/state.ts"];
/** Policy functions in POLICY_FILES that are not access decisions (helpers, labels). */
const NOT_POLICY = new Set(["firmRolesOf", "actorOf", "actorRef", "isJobTaskState", "isLegalEdge", "nextStates", "transitionTable", "gateTokenProblem", "consumeCloseGateToken", "roleFromEntraGroups", "firmRole"]);

/** Session / secret / token checks, each matched by name AND by the file declaring it (AUTH_SOURCES). */
export const AUTH_CALLS = ["auth", "cronUnauthorized", "bearerUnauthorized", "verifyPairing"] as const;
const CRON_CALLS = new Set(["cronUnauthorized", "bearerUnauthorized"]);

/**
 * CORS preflights that may answer without auth or policy. A browser sends OPTIONS before a
 * cross-origin call with no Authorization header and no cookie, so a preflight cannot be
 * authenticated; it may only say which origin, methods and headers are allowed. A listed handler
 * passes only if (a) its method is OPTIONS and (b) nothing reachable from it makes a database call
 * (PREFLIGHT_DATA_CALLS on a dotted receiver, or a raw query / transaction) or calls a function
 * named like a data provider (PREFLIGHT_DATA_NAMES) — so the row can never cover a handler that
 * returns data. The handler's no-body response is unit-tested next to it
 * (src/lib/companion/__tests__/http.test.ts, "preflight returns no body").
 */
export const PREFLIGHT_ROUTES: { route: string; why: string }[] = [
  { route: "/api/firm-os/companion/next-task", why: "Companion extension preflight: CORS grant for the extension origin only (403 otherwise), no body; the GET it precedes checks the pairing token and canPairCompanion" },
];
const PREFLIGHT_DATA_CALLS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const PREFLIGHT_RAW_CALLS = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe", "$transaction"]);
const PREFLIGHT_DATA_NAMES = /^(nextTask|getNextTask|load[A-Z]\w*|fetch)$/;

/** Why a call makes a preflight unsafe (it reads or writes data), or null. */
export function preflightDataCall(c: CallSite): string | null {
  if (PREFLIGHT_RAW_CALLS.has(c.name)) return `${c.text} (database)`;
  if (PREFLIGHT_DATA_CALLS.has(c.name) && !!c.receiver && /^[\w$]+(\.[\w$]+)+$/.test(c.receiver)) return `${c.text} (database)`;
  if (PREFLIGHT_DATA_NAMES.test(c.name)) return `${c.text} (data provider)`;
  return null;
}

export type ExpectedPolicy = {
  route: string;
  method: string;
  /** Policy function names that must all be reachable from the handler. */
  policies: string[];
  why: string;
};

const AGENT_RUN = "a run the person can see (assignee / reviewer; managers, partners, admins see all)";
const JOB_EDGE = "the JobTask state machine decides who may take the edge";
const COACH_OWN = "every active person, for their own coach data only";
const COMPANION = "active admins and partners, or someone an admin switched the Companion on for";
const PRIVACY = "DPDP request register: active admins and partners";
const SEARCH = "every active person; each result type scoped by the rule of the page that opens it";
const ONBOARD_RUN = "partners, managers, admins; an existing run only by the person who started it or a partner";

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
  { route: "/api/firm-os/onboard/answer", method: "POST", policies: ["canOnboard", "canOpenOnboardingRun"], why: ONBOARD_RUN },
  { route: "/api/firm-os/onboard/create", method: "POST", policies: ["canOnboard", "canOpenOnboardingRun"], why: ONBOARD_RUN },
  { route: "/api/firm-os/onboard/plan", method: "POST", policies: ["canOnboard", "canOpenOnboardingRun"], why: ONBOARD_RUN },
  { route: "/api/firm-os/onboard/resume", method: "POST", policies: ["canOnboard", "canOpenOnboardingRun"], why: ONBOARD_RUN },
  { route: "/api/firm-os/onboard/start", method: "POST", policies: ["canOnboard"], why: "partners, managers, admins" },
  { route: "/api/firm-os/onboard/turia-confirm", method: "POST", policies: ["canOnboard", "canOpenOnboardingRun"], why: ONBOARD_RUN },
  { route: "/api/firm-os/spot-checks/[id]", method: "POST", policies: ["canSpotCheck"], why: "Turia spot checks: partner only" },
  // Daily Coach (Phase 9): personal data, the person's own only (ADR-006).
  { route: "/api/firm-os/coach/heartbeat", method: "POST", policies: ["canUseCoach"], why: `${COACH_OWN}; the heartbeat is stored against the session's own id` },
  { route: "/api/firm-os/coach/preferences", method: "POST", policies: ["canManageOwnCoachPrefs"], why: `${COACH_OWN}; only the person changes their own preferences` },
  { route: "/api/firm-os/coach/events/[id]/dismiss", method: "POST", policies: ["canUseCoach", "canDismissCoachEvent"], why: `${COACH_OWN}; only the person a notice was raised for dismisses it (others get not-found)` },
  // Client comms drafts (Phase 10).
  { route: "/api/firm-os/comms/drafts", method: "POST", policies: ["canUseAgents", "canViewJob"], why: "draft only for a job the person may see, or a client whose jobs they prepare or review" },
  { route: "/api/firm-os/comms/drafts/[id]/outlook", method: "POST", policies: ["canUseAgents", "canViewCommsDraft"], why: "Outlook draft only of a draft the person may open (author, job people, the client's primary handler, managers, partners, admins)" },
  // Companion extension (Phase 17): pairing is a session action; next-task authenticates by pairing token.
  { route: "/api/firm-os/companion/tokens", method: "POST", policies: ["canPairCompanion"], why: COMPANION },
  { route: "/api/firm-os/companion/tokens/[id]/revoke", method: "POST", policies: ["canRevokePairing"], why: "the pairing's owner, while active (even after companion access was switched off)" },
  { route: "/api/firm-os/companion/next-task", method: "GET", policies: ["canPairCompanion"], why: `${COMPANION}; re-checked on every call (pairing token from verifyPairing is the caller's identity)` },
  // Corrections (Phase 15).
  { route: "/api/firm-os/corrections", method: "POST", policies: ["canCorrect"], why: "allow-listed fields only, by the rule each field names (management / job manager / creator)" },
  { route: "/api/firm-os/corrections/history", method: "GET", policies: ["canViewCorrectionHistory"], why: "whoever may see the record" },
  // DPDP request register and breach register (Phase 15).
  { route: "/api/firm-os/privacy/requests", method: "POST", policies: ["canHandlePrivacyRequests"], why: PRIVACY },
  { route: "/api/firm-os/privacy/requests/[id]/verify", method: "POST", policies: ["canHandlePrivacyRequests"], why: PRIVACY },
  { route: "/api/firm-os/privacy/requests/[id]/close", method: "POST", policies: ["canHandlePrivacyRequests"], why: PRIVACY },
  { route: "/api/firm-os/privacy/requests/[id]/nomination", method: "POST", policies: ["canHandlePrivacyRequests"], why: PRIVACY },
  { route: "/api/firm-os/privacy/requests/[id]/consent-withdrawal", method: "POST", policies: ["canHandlePrivacyRequests"], why: PRIVACY },
  { route: "/api/firm-os/privacy/requests/[id]/resolve", method: "POST", policies: ["canHandlePrivacyRequests"], why: `${PRIVACY}; links the request to exactly one of the records found` },
  { route: "/api/firm-os/privacy/requests/[id]/lift-restriction", method: "POST", policies: ["canHandlePrivacyRequests", "canLiftRestriction"], why: "lifting a DPDP processing restriction resumes AI processing and drafting: partner only, with a reason" },
  { route: "/api/firm-os/privacy/requests/[id]/export", method: "GET", policies: ["canHandlePrivacyRequests"], why: `${PRIVACY}; the export holds the person's data` },
  { route: "/api/firm-os/privacy/requests/[id]/correction", method: "POST", policies: ["canHandlePrivacyRequests", "canCorrect"], why: `${PRIVACY}; the field itself goes through the corrections rule` },
  { route: "/api/firm-os/privacy/requests/[id]/erasure", method: "GET", policies: ["canHandlePrivacyRequests"], why: `${PRIVACY}; the plan lists the person's records` },
  { route: "/api/firm-os/privacy/requests/[id]/erasure", method: "POST", policies: ["canHandlePrivacyRequests", "canDecideErasure"], why: "erasure decisions: active admins and partners" },
  { route: "/api/firm-os/privacy/breaches", method: "POST", policies: ["canManageBreaches"], why: "breach register: active admins and partners" },
  { route: "/api/firm-os/privacy/breaches/[id]", method: "POST", policies: ["canManageBreaches"], why: "breach register: active admins and partners" },
  // Search (Phase 15) and workspace settings (Phase 16).
  { route: "/api/firm-os/search", method: "GET", policies: ["canSearch"], why: SEARCH },
  { route: "/api/firm-os/search", method: "POST", policies: ["canSearch"], why: `${SEARCH}; identifier lookups exact, masked, audited` },
  { route: "/api/firm-os/workspace/roles/[role]", method: "POST", policies: ["canManageWorkspace"], why: "workspace settings: active admins only" },
  { route: "/api/firm-os/workspace/users/[userId]", method: "POST", policies: ["canManageWorkspace"], why: "workspace settings: active admins only" },
  { route: "/api/firm-os/workspace/next-task", method: "GET", policies: ["canUseAgents"], why: "the person's own next task, same visibility as /agents" },
  { route: "/api/cron/firm-os/close-loop", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
  { route: "/api/cron/firm-os/retention", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
  { route: "/api/cron/firm-os/coach", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
  // Turia read-only pull (ADR-003 amendment 2026-11-06).
  { route: "/api/cron/firm-os/turia-pull", method: "GET", policies: ["cronUnauthorized"], why: "system cron: CRON_SECRET" },
  { route: "/api/firm-os/turia-sync/run", method: "POST", policies: ["canManageTuriaSync"], why: "Turia sync now: active admins and partners" },
  { route: "/api/firm-os/turia-sync/people", method: "POST", policies: ["canManageTuriaSync"], why: "Turia people mapping: active admins and partners" },
  { route: "/api/firm-os/turia-sync/clients", method: "POST", policies: ["canManageTuriaSync"], why: "Turia client mapping: active admins and partners" },
  { route: "/api/firm-os/turia-sync/rules", method: "POST", policies: ["canManageTuriaSync"], why: "Turia task rules: active admins and partners" },
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
  verifyPairing: "src/lib/companion/tokens.ts",
};

export function checkRbac(
  graph: CallGraph,
  routeFiles: string[],
  table: ExpectedPolicy[] = EXPECTED_POLICIES,
  preflights: { route: string; why: string }[] = PREFLIGHT_ROUTES,
): RbacReport {
  const results: RbacResult[] = [];
  const violations: string[] = [];
  const notes: string[] = [];
  const byKey = new Map(table.map((e) => [key(e.route, e.method), e]));
  const matched = new Set<string>();
  const preflightRoutes = new Set(preflights.map((p) => p.route));
  const matchedPreflights = new Set<string>();

  for (const file of routeFiles) {
    const handlers = graph.handlers(file);
    if (!handlers.length) {
      violations.push(`${file}: no exported HTTP handler could be read (export async function GET/POST/...)`);
      continue;
    }
    for (const h of handlers) {
      const auth = new Set<string>();
      const policies = new Set<string>();
      const dataCalls: string[] = [];
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
          const data = preflightDataCall(c);
          if (data) dataCalls.push(`${fn.file}:${c.line} ${data}`);
        }
      }
      const k = key(h.route, h.method);
      const expected = byKey.get(k) ?? null;
      if (expected) matched.add(k);
      const problems: string[] = [];
      // A listed CORS preflight answers from request headers only: no auth or policy needed, and
      // nothing on its graph may touch data. Any other method on that route is checked as usual.
      if (h.method === "OPTIONS" && preflightRoutes.has(h.route) && !expected) {
        matchedPreflights.add(h.route);
        for (const d of dataCalls) problems.push(`CORS preflight must not read or write data, but reaches ${d}`);
        for (const p of problems) violations.push(`${k}  ${h.file}: ${p}`);
        results.push({ handler: h, auth: [...auth].sort(), policies: ["(cors-preflight)"], expected, problems });
        continue;
      }
      if (!auth.size) problems.push("no auth guard (auth() session check, cronUnauthorized or a Companion pairing token) on its call graph");
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
  for (const p of preflights) if (!matchedPreflights.has(p.route)) violations.push(`OPTIONS ${p.route}: in PREFLIGHT_ROUTES but no such OPTIONS handler exists (remove or fix the row)`);
  return { results, stale, violations, notes };
}
