// Golden path (c) — Phase 6, ROC Prep approve path: the assignee runs ROC Prep on a fresh ROC job
// (FY 2025-26, Annual) → the draft pack is in Working (ROC data sheets + board / AGM resolutions) →
// submit → the reviewer approves (two-step confirm) → both files are byte-copied to Final. Nothing is
// filed: the page offers no portal (MCA) action.
//
// Same shape as gst / tax / books / audit (tests/e2e-db/support): fresh JobTask per run (unique title,
// so --repeat-each=3 never collides), SOP pack created from ROC_CHECKLIST only if none is active,
// synthetic inputs of fixtures/accuracy/roc/clean-small-private/input uploaded create-only.
//
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_CLIENT_CODE, MS_* (+ SP_PNP_*) in this process and on
// the app. The model is called only for the AOC-2 related-party rule; without ANTHROPIC_API_KEY on
// the app that rule is "check by hand" (na) and the pack is still approvable.
import { expect, test } from "@playwright/test";
import {
  approvePack, blockFailures, closeDb, ensureSopPack, expectFinalMatchesWorking, expectJobState, fixtureFiles, freshJob, latestRun, openDb, runAgentFromList,
  signedInAll, submitForReview, uploadToClientDocs,
} from "./support";

const SPEC = "roc.spec.ts";
test.afterAll(closeDb);

test("ROC Prep: run → submit → approve → Final copies match Working", async ({ browser }) => {
  const db = openDb();
  await ensureSopPack(db, "roc");
  const job = await freshJob(db, { service: "ROC", fy: "2025-26", period: "Annual", title: "AOC-4 / MGT-7", spec: SPEC });
  await uploadToClientDocs(job, fixtureFiles("roc", "clean-small-private"));
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const run = await runAgentFromList(s.assignee.page, "roc", job);
    await expect(s.assignee.page.locator("section[aria-labelledby='checklist']")).toBeVisible();
    const files = s.assignee.page.locator("section[aria-labelledby='deliverables']");
    await expect(files).toContainText("ROC-data-sheets");
    await expect(files).toContainText("Board-and-AGM-resolutions");
    await submitForReview(s.assignee.page);

    await s.reviewer.page.goto(run);
    await approvePack(s.reviewer.page);

    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest).toMatchObject({ agent: "roc", status: "APPROVED" });
    expect(blockFailures(latest)).toHaveLength(0);
    await expectFinalMatchesWorking(db, job.id, latest.id, { count: 2, finalFolderSuffix: "/ROC/Annual/Final" });
  } finally {
    await s.closeAll();
  }
});
