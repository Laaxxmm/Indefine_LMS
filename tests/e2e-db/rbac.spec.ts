// Golden path (g) — Phase 11 / Phase 12: staff RBAC denials on staging, as real signed-in people.
//   · a staff member cannot open another person's run (404, so hidden runs do not leak), cannot act
//     on that job through any route, and does not see it in their queue
//   · the assignee cannot approve their own pack (403 SELF_APPROVAL), and the screen offers no Approve
//   · staff cannot open partner / manager / admin pages (/onboard, /agents/mistakes, /admin/firm-os/*)
//     or call the onboarding API
//   · staff cannot decide a proposed mistake rule (403); the rule stays PROPOSED
// Comms drafts, spot checks and the partner-only rule decision are in rbac-phase-10-11.spec.ts
// (depends on the Phase 10 and 11 merges).
//
// Runs under `npm run e2e:db` (--repeat-each=3): a fresh JobTask, AgentRun and MistakeLog per run.
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_OTHER_STAFF_STATE (a staff member who is neither),
// E2E_CLIENT_CODE. All three are plain staff (level EXECUTIVE / SENIOR_EXECUTIVE, not LMS admins).
import { expect, test } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { closeDb, freshJob, jobState, openDb, runTag, signedInAll, userByEmail, type FreshJob } from "./support";

const SPEC = "rbac.spec.ts";
test.afterAll(closeDb);

/** A fresh GST job in AGENT_DONE with one agent run (as if the assignee ran GST Prep), seeded in the DB. */
async function jobWithRun(db: PrismaClient): Promise<{ job: FreshJob; runId: string }> {
  const job = await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-1 rbac", spec: SPEC });
  const run = await db.agentRun.create({
    data: { jobTaskId: job.id, agent: "gst", sopPackVersion: "1.0.0", status: "AGENT_DONE", attempt: 1, finishedAt: new Date(), figures: {} },
  });
  await db.jobTask.update({
    where: { id: job.id },
    data: {
      state: "AGENT_DONE",
      events: { create: [{ fromState: "ASSIGNED", toState: "IN_PREP", actorId: `agent:${run.id}` }, { fromState: "IN_PREP", toState: "AGENT_DONE", actorId: `agent:${run.id}` }] },
    },
  });
  return { job, runId: run.id };
}

test("another staff member cannot see or act on someone else's run and job (404 / 403), and it is not in their queue", async ({ browser }) => {
  const db = openDb();
  const { job, runId } = await jobWithRun(db);
  const s = await signedInAll(browser, ["assignee", "other"] as const, SPEC);
  try {
    // Control: the assignee opens the run.
    const own = await s.assignee.page.goto(`/agents/gst/runs/${runId}`);
    expect(own?.status()).toBe(200);

    // The outsider: the page is a 404, every route is 404 (run / job hidden) or 403 (job edges).
    const page = await s.other.page.goto(`/agents/gst/runs/${runId}`);
    expect(page?.status()).toBe(404);
    for (const path of [`/api/firm-os/agents/runs/${runId}/submit`, `/api/firm-os/agents/runs/${runId}/approve`, `/api/firm-os/agents/runs/${runId}/request-changes`]) {
      const r = await s.other.post(path, path.endsWith("approve") ? { note: null } : path.endsWith("request-changes") ? { note: "not mine to judge" } : {});
      expect(r.status(), path).toBe(404);
    }
    expect((await s.other.post(`/api/firm-os/agents/gst/jobs/${job.id}/run`)).status()).toBe(404);
    expect((await s.other.post(`/api/firm-os/jobs/${job.id}/state`, { to: "IN_REVIEW", expectedState: "AGENT_DONE" })).status()).toBe(403);
    expect((await s.other.post(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: "AA2910260000001" })).status()).toBe(403);

    await s.other.page.goto("/agents");
    await expect(s.other.page.getByText(job.title)).toHaveCount(0);
    expect(await jobState(db, job.id)).toBe("AGENT_DONE"); // nothing moved
  } finally {
    await s.closeAll();
  }
});

test("the assignee cannot approve their own pack: no Approve button, and the route answers 403", async ({ browser }) => {
  const db = openDb();
  const { job, runId } = await jobWithRun(db);
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  try {
    expect((await s.assignee.post(`/api/firm-os/agents/runs/${runId}/submit`)).status()).toBe(200);
    expect(await jobState(db, job.id)).toBe("IN_REVIEW");
    await s.assignee.page.goto(`/agents/gst/runs/${runId}`);
    await expect(s.assignee.page.getByRole("region", { name: "Review actions" }).getByRole("button", { name: "Approve pack" })).toHaveCount(0);
    const r = await s.assignee.post(`/api/firm-os/agents/runs/${runId}/approve`, { note: null });
    expect(r.status()).toBe(403);
    expect(await jobState(db, job.id)).toBe("IN_REVIEW");
  } finally {
    await s.closeAll();
  }
});

test("staff cannot open partner / manager / admin pages or start an onboarding", async ({ browser }) => {
  const s = await signedInAll(browser, ["other"] as const, SPEC);
  try {
    for (const [path, to] of [
      ["/onboard", "/dashboard"],
      ["/agents/mistakes", "/agents"],
      ["/admin/firm-os/models", "/dashboard"],
      ["/admin/firm-os/mistakes", "/dashboard"],
      ["/admin/firm-os/cycle-time", "/dashboard"],
    ] as const) {
      const r = await s.other.get(path);
      expect([302, 303, 307, 308], `${path} redirects`).toContain(r.status());
      expect(new URL(r.headers()["location"] ?? "", "http://x").pathname, `${path} → ${to}`).toBe(to);
    }
    const start = await s.other.post("/api/firm-os/onboard/start", { prompt: "Onboard Not Allowed Pvt Ltd — GST monthly" });
    expect(start.status()).toBe(403);
  } finally {
    await s.closeAll();
  }
});

test("staff cannot decide a proposed mistake rule; it stays PROPOSED", async ({ browser }) => {
  const db = openDb();
  const reviewer = await userByEmail(db, "E2E_REVIEWER_EMAIL", SPEC);
  const id = `gst.e2e-rbac-${runTag().toLowerCase()}`;
  const proposal = await db.mistakeLog.create({
    data: {
      agent: "gst",
      pattern: "e2e RBAC probe — reviewer flagged a missed finding",
      ruleProposal: { id, title: "E2E RBAC probe rule", severity: "warn", kind: "llm", check: "Is there an e2e probe marker in the register?", evidence: "row of the register" },
      createdById: reviewer.id,
    },
  });
  const s = await signedInAll(browser, ["reviewer", "other"] as const, SPEC);
  try {
    for (const who of [s.reviewer, s.other]) {
      const r = await who.post(`/api/firm-os/agents/mistakes/${proposal.id}/decide`, { decision: "approve" });
      expect(r.status(), who.role).toBe(403);
    }
    expect((await db.mistakeLog.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PROPOSED");
    expect(await db.sopPack.count({ where: { changeNote: { contains: proposal.id } } })).toBe(0); // no rule promoted
  } finally {
    await s.closeAll();
  }
});
