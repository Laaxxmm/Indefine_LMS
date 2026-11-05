// Golden path (Phase 6, Tax Prep): the assignee runs the Tax agent on an ASSIGNED IncomeTax job â†’
// computation workbook in Working â†’ submits for review â†’ the reviewer approves â†’ the file is
// byte-copied to Final. Nothing is filed: the page offers no portal action. Needs a migrated
// staging database, SharePoint Path A and two signed-in sessions, so it lives OUTSIDE
// playwright.config.ts testDir (tests/e2e) and runs with `npm run e2e:db` (3 repeats).
//
// Required environment:
//   E2E_BASE_URL          the running app (staging, or `next start` against the staging DB)
//   E2E_ASSIGNEE_STATE    Playwright storageState JSON of the job's ASSIGNEE (Entra SSO)
//   E2E_REVIEWER_STATE    storageState JSON of the job's reviewer, a manager or a partner (not the assignee)
//   DATABASE_URL          the same staging database, for the setup and the assertions
//   E2E_TAX_JOB_ID        an ASSIGNED JobTask with service IncomeTax, period Annual, FY 2025-26, whose
//                         CL-{Code}/Compliance/FY2025-26/IncomeTax/Annual/ClientDocs folder holds the files of
//                         fixtures/accuracy/tax/clean-salaried-new/input (synthetic; uploaded by a person)
// Setup done here: if no active SopPack "tax" exists, version 1.0.0 is created from TAX_CHECKLIST.
// Model calls: tax.match-ais (AIS â†” books by name) and the foreign-asset LLM rule. Without a model
// key the AIS match is queued for a person and the run FAILS with that reason â€” this spec then
// needs ANTHROPIC_API_KEY on the app (Blocked / needs human in PROGRESS until it is set).
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { TAX_CHECKLIST } from "@/lib/agents/tax/rules";

const jobId = process.env.E2E_TAX_JOB_ID ?? "";

test("Tax Prep: run â†’ submit â†’ approve â†’ Final copy matches Working", async ({ browser }) => {
  expect(jobId, "set E2E_TAX_JOB_ID to an ASSIGNED IncomeTax job (see the header)").not.toBe("");
  const db = new PrismaClient();
  try {
    const job = await db.jobTask.findUniqueOrThrow({ where: { id: jobId }, include: { firmClient: true } });
    expect(job.service).toBe("IncomeTax");
    expect(job.state).toBe("ASSIGNED");
    if (!(await db.sopPack.findFirst({ where: { key: "tax", active: true } }))) {
      await db.sopPack.create({ data: { key: "tax", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Tax Prep", checklist: JSON.parse(JSON.stringify(TAX_CHECKLIST)), active: true } });
    }

    // Assignee: run the agent from /agents/tax.
    const prep = await browser.newContext({ storageState: process.env.E2E_ASSIGNEE_STATE });
    const page = await prep.newPage();
    await page.goto("/agents/tax");
    await expect(page.getByRole("heading", { name: "Tax Prep" })).toBeVisible();
    await page.getByRole("button", { name: `Run agent on ${job.title} for ${job.firmClient.clientCode}` }).click();
    await page.waitForURL(/\/agents\/tax\/runs\/[^/]+$/, { timeout: 180_000 });
    const runUrl = page.url();
    await expect(page.locator("section[aria-labelledby='checklist']")).toBeVisible();
    await expect(page.locator("section[aria-labelledby='deliverables']")).toContainText("Tax-computation");
    await expect(page.getByRole("button", { name: /portal|e-file|file return/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("region", { name: "Review actions" })).toContainText(/No action for you|Approve pack/);
    await prep.close();

    // Reviewer: approve (the clean fixture has no block findings).
    const rev = await browser.newContext({ storageState: process.env.E2E_REVIEWER_STATE });
    const rp = await rev.newPage();
    await rp.goto(runUrl);
    await rp.getByRole("button", { name: "Approve pack" }).click();
    await expect(rp.getByRole("region", { name: "Review actions" })).toContainText("Pack approved and in Final", { timeout: 120_000 });
    await rev.close();

    // Data: job and run APPROVED; figures as the fixture (tax â‚¹1,05,300, TDS credit â‚¹1,05,300, nil payable);
    // the Final file is byte-identical to the Working one.
    const after = await db.jobTask.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.state).toBe("APPROVED");
    const run = await db.agentRun.findFirstOrThrow({ where: { jobTaskId: jobId }, orderBy: { attempt: "desc" } });
    expect(run.status).toBe("APPROVED");
    expect(run.figures).toMatchObject({ taxLiabilityPaise: 10530000, tdsCreditPaise: 10530000, netPayablePaise: 0, itrForm: 1 });
    const deliverables = await db.deliverable.findMany({ where: { jobTaskId: jobId } });
    const working = deliverables.filter((d) => d.kind === "Working" && d.agentRunId === run.id);
    const final = deliverables.filter((d) => d.kind === "Final");
    expect(working).toHaveLength(1);
    expect(final.map((d) => d.sha256)).toEqual(working.map((d) => d.sha256));
  } finally {
    await db.$disconnect();
  }
});
