// Golden path (c) — Phase 6, Tax Prep approve path: the assignee runs Tax Prep on a fresh IncomeTax
// job (FY 2025-26, Annual) → the computation workbook is in Working → submit → the reviewer approves
// (two-step confirm) → the file is byte-copied to Final. Nothing is filed: no e-filing action exists.
//
// Same shape as gst / roc / books / audit (tests/e2e-db/support): fresh JobTask per run, SOP pack from
// TAX_CHECKLIST only if none is active, synthetic inputs of fixtures/accuracy/tax/clean-salaried-new/input
// uploaded create-only.
//
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_CLIENT_CODE, MS_* (+ SP_PNP_*) here and on the app.
// ANTHROPIC_API_KEY on the app is REQUIRED for this spec: tax.match-ais (AIS ↔ books by name) is a
// model task, and without a model the run fails with "queued for a human" (PROGRESS Blocked).
import { expect, test } from "@playwright/test";
import {
  approvePack, blockFailures, closeDb, ensureSopPack, expectFinalMatchesWorking, expectJobState, fixtureFiles, freshJob, latestRun, openDb, runAgentFromList,
  signedInAll, submitForReview, uploadToClientDocs,
} from "./support";

const SPEC = "tax.spec.ts";
test.afterAll(closeDb);

test("Tax Prep: run → submit → approve → Final copy matches Working; figures as the fixture", async ({ browser }) => {
  const db = openDb();
  await ensureSopPack(db, "tax");
  const job = await freshJob(db, { service: "IncomeTax", fy: "2025-26", period: "Annual", title: "ITR computation", spec: SPEC });
  await uploadToClientDocs(job, fixtureFiles("tax", "clean-salaried-new"));
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const run = await runAgentFromList(s.assignee.page, "tax", job);
    await expect(s.assignee.page.locator("section[aria-labelledby='checklist']")).toBeVisible();
    await expect(s.assignee.page.locator("section[aria-labelledby='deliverables']")).toContainText("Tax-computation");
    await submitForReview(s.assignee.page);

    await s.reviewer.page.goto(run);
    await approvePack(s.reviewer.page);

    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest).toMatchObject({ agent: "tax", status: "APPROVED" });
    expect(blockFailures(latest)).toHaveLength(0);
    // Fixture figures: tax ₹1,05,300 = TDS credit ₹1,05,300 → nil payable; ITR-1.
    expect(latest.figures).toMatchObject({ taxLiabilityPaise: 10530000, tdsCreditPaise: 10530000, netPayablePaise: 0, itrForm: 1 });
    await expectFinalMatchesWorking(db, job.id, latest.id, { count: 1, finalFolderSuffix: "/IncomeTax/Annual/Final" });
  } finally {
    await s.closeAll();
  }
});
