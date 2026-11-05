// Golden path (Phase 6, ROC Prep): the assignee runs the ROC agent on an ASSIGNED ROC job â†’ draft
// pack in Working â†’ submits for review â†’ the reviewer approves â†’ the files are byte-copied to
// Final. Nothing is filed: the page offers no portal action. Needs a migrated staging database,
// SharePoint Path A and two signed-in sessions, so it lives OUTSIDE playwright.config.ts testDir
// (tests/e2e) and runs with `npm run e2e:db` (playwright.db.config.ts, 3 repeats).
//
// Required environment:
//   E2E_BASE_URL          the running app (staging, or `next start` against the staging DB)
//   E2E_ASSIGNEE_STATE    Playwright storageState JSON of the job's ASSIGNEE (Entra SSO)
//   E2E_REVIEWER_STATE    storageState JSON of the job's reviewer, a manager or a partner (not the assignee)
//   DATABASE_URL          the same staging database, for the setup and the assertions
//   E2E_ROC_JOB_ID        an ASSIGNED JobTask with service ROC, period Annual, FY 2025-26, whose
//                         CL-{Code}/Compliance/FY2025-26/ROC/Annual/ClientDocs folder holds the files of
//                         fixtures/accuracy/roc/clean-small-private/input (synthetic; uploaded by a person)
// Setup done here: if no active SopPack "roc" exists, version 1.0.0 is created from ROC_CHECKLIST.
// The model is called only for the AOC-2 related-party rule (the fixture's financials are a
// summary, so no ledger mapping); with no model key the run still finishes and that rule is "na".
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ROC_CHECKLIST } from "@/lib/agents/roc/rules";

const jobId = process.env.E2E_ROC_JOB_ID ?? "";

test("ROC Prep: run â†’ submit â†’ approve â†’ Final copies match Working", async ({ browser }) => {
  expect(jobId, "set E2E_ROC_JOB_ID to an ASSIGNED ROC job (see the header)").not.toBe("");
  const db = new PrismaClient();
  try {
    const job = await db.jobTask.findUniqueOrThrow({ where: { id: jobId }, include: { firmClient: true } });
    expect(job.service).toBe("ROC");
    expect(job.state).toBe("ASSIGNED");
    if (!(await db.sopPack.findFirst({ where: { key: "roc", active: true } }))) {
      await db.sopPack.create({ data: { key: "roc", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "ROC Prep", checklist: JSON.parse(JSON.stringify(ROC_CHECKLIST)), active: true } });
    }

    // Assignee: run the agent from /agents/roc.
    const prep = await browser.newContext({ storageState: process.env.E2E_ASSIGNEE_STATE });
    const page = await prep.newPage();
    await page.goto("/agents/roc");
    await expect(page.getByRole("heading", { name: "ROC Prep" })).toBeVisible();
    await page.getByRole("button", { name: `Run agent on ${job.title} for ${job.firmClient.clientCode}` }).click();
    await page.waitForURL(/\/agents\/roc\/runs\/[^/]+$/, { timeout: 180_000 });
    const runUrl = page.url();
    await expect(page.locator("section[aria-labelledby='checklist']")).toBeVisible();
    const files = page.locator("section[aria-labelledby='deliverables']");
    await expect(files).toContainText("ROC-data-sheets");
    await expect(files).toContainText("Board-and-AGM-resolutions");
    await expect(page.getByRole("button", { name: /portal|file with|submit to mca/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("region", { name: "Review actions" })).toContainText(/No action for you|Approve pack/);
    await prep.close();

    // Reviewer: approve (the clean fixture has no block findings, so no partner note is needed).
    const rev = await browser.newContext({ storageState: process.env.E2E_REVIEWER_STATE });
    const rp = await rev.newPage();
    await rp.goto(runUrl);
    await rp.getByRole("button", { name: "Approve pack" }).click();
    await expect(rp.getByRole("region", { name: "Review actions" })).toContainText("Pack approved and in Final", { timeout: 120_000 });
    await rev.close();

    // Data: job APPROVED, run APPROVED, two Final files byte-identical to their Working originals.
    const after = await db.jobTask.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.state).toBe("APPROVED");
    const run = await db.agentRun.findFirstOrThrow({ where: { jobTaskId: jobId }, orderBy: { attempt: "desc" } });
    expect(run.status).toBe("APPROVED");
    const blocks = await db.checklistResult.count({ where: { agentRunId: run.id, severity: "block", status: "fail" } });
    expect(blocks).toBe(0);
    const deliverables = await db.deliverable.findMany({ where: { jobTaskId: jobId } });
    const working = deliverables.filter((d) => d.kind === "Working" && d.agentRunId === run.id);
    const final = deliverables.filter((d) => d.kind === "Final");
    expect(working).toHaveLength(2);
    expect(final.map((d) => d.sha256).sort()).toEqual(working.map((d) => d.sha256).sort());
  } finally {
    await db.$disconnect();
  }
});
