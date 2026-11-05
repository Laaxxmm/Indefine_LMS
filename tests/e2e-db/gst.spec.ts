// Golden path (Phase 5): the assignee opens a GST job → runs GST Prep → submits for review → the
// reviewer approves → the five draft files are byte-copied Working → Final. Needs a migrated
// staging database, signed-in sessions and a real CL- site (the mock Graph is not available in
// e2e-db), so it lives OUTSIDE playwright.config.ts testDir and runs with `npm run e2e:db`.
// No skip guards are allowed in this repo: with the environment missing the spec fails loudly.
//
// Required environment:
//   E2E_BASE_URL             the running app (staging, or `next start` against the staging DB)
//   DATABASE_URL             the same staging database (job seeding + assertions)
//   E2E_ASSIGNEE_STATE       Playwright storageState JSON of the signed-in ASSIGNEE (staff, Entra SSO)
//   E2E_REVIEWER_STATE       storageState JSON of the signed-in REVIEWER (a different person)
//   E2E_ASSIGNEE_EMAIL       the assignee's LMS user email (to set JobTask.assigneeId)
//   E2E_REVIEWER_EMAIL       the reviewer's LMS user email (JobTask.reviewerId)
//   E2E_GST_CLIENT_CODE      a FirmClient onboarded for e2e whose CL-{Code} site exists
//   SharePoint app-only + PnP env (MS_*, SP_PNP_*) for the running app, so it can read ClientDocs
//                            and write Working/Final.
// One-off staging (by a person, once): upload the files of
//   fixtures/accuracy/gst/01-clean-tally-csv/input/  (synthetic data, no real client)
// to CL-{E2E_GST_CLIENT_CODE}/Compliance/FY2026-27/GST/2026-10/ClientDocs/ with the same names.
// The spec seeds the GST SopPack (create-only) and a fresh JobTask per run (unique title), so
// repeated runs never collide; Working/Final files accumulate as _v{n} (nothing is ever deleted).
import { expect, test, type Browser } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedGstSopPack } from "../../src/lib/agents/gst/seed";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`gst.spec.ts needs ${k} (see the header of tests/e2e-db/gst.spec.ts)`);
  return v;
};

async function as(browser: Browser, stateEnv: string) {
  const ctx = await browser.newContext({ storageState: env(stateEnv), baseURL: env("E2E_BASE_URL") });
  return { ctx, page: await ctx.newPage() };
}

test("assignee runs GST Prep, reviewer approves, files land in Final", async ({ browser }) => {
  const db = new PrismaClient();
  const code = env("E2E_GST_CLIENT_CODE");
  const title = `GSTR-3B e2e ${Date.now().toString(36)}`;
  try {
    await seedGstSopPack(db);
    const fc = await db.firmClient.findUniqueOrThrow({ where: { clientCode: code } });
    const assignee = await db.user.findUniqueOrThrow({ where: { email: env("E2E_ASSIGNEE_EMAIL") } });
    const reviewer = await db.user.findUniqueOrThrow({ where: { email: env("E2E_REVIEWER_EMAIL") } });
    const job = await db.jobTask.create({
      data: { firmClientId: fc.id, service: "GST", fy: "2026-27", period: "2026-10", title, state: "ASSIGNED", assigneeId: assignee.id, reviewerId: reviewer.id, createdById: assignee.id },
    });

    // Assignee: open the GST agent, run it on the job, land on the review screen, submit.
    const a = await as(browser, "E2E_ASSIGNEE_STATE");
    await a.page.goto("/agents/gst");
    await expect(a.page.getByRole("heading", { name: "GST Prep" })).toBeVisible();
    await a.page.getByRole("button", { name: `Run agent on ${title} for ${code}` }).click();
    await a.page.waitForURL(/\/agents\/gst\/runs\/[^/]+$/, { timeout: 120_000 });
    const runUrl = a.page.url();
    await expect(a.page.getByText(`${code}_GSTR-1-draft_2026-10`, { exact: false }).first()).toBeVisible();
    await expect(a.page.getByRole("button", { name: /submit to portal|file on portal|file return/i })).toHaveCount(0);
    await a.page.getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(async () => (await db.jobTask.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("IN_REVIEW");
    await a.ctx.close();

    // Reviewer: approve the pack (the clean fixture has no block findings, so no partner note).
    const r = await as(browser, "E2E_REVIEWER_STATE");
    await r.page.goto(runUrl);
    await r.page.getByRole("region", { name: "Review actions" }).getByRole("button", { name: "Approve pack" }).click();
    await expect(r.page.getByText(/Pack approved and in Final/)).toBeVisible({ timeout: 120_000 });
    await r.ctx.close();

    // Data: APPROVED, five Working files and five Final byte copies (same sha256).
    const done = await db.jobTask.findUniqueOrThrow({ where: { id: job.id }, include: { deliverables: true } });
    expect(done.state).toBe("APPROVED");
    const working = done.deliverables.filter((d) => d.kind === "Working");
    const final = done.deliverables.filter((d) => d.kind === "Final");
    expect(working).toHaveLength(5);
    expect(final).toHaveLength(5);
    expect(final.map((d) => d.sha256).sort()).toEqual(working.map((d) => d.sha256).sort());
    expect(final.every((d) => d.spPath.endsWith("/GST/2026-10/Final"))).toBe(true);
    const run = await db.agentRun.findFirstOrThrow({ where: { jobTaskId: job.id }, orderBy: { attempt: "desc" } });
    expect(run.status).toBe("APPROVED");
  } finally {
    await db.$disconnect();
  }
});
