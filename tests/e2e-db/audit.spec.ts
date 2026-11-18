// Golden path (c) — Phase 7, Audit Assist approve path: the assignee runs Audit Assist on a fresh
// statutory-audit job (FY 2025-26, Annual) → the working papers are labelled "Draft for engagement
// partner" and never express an opinion → submit → the engagement PARTNER approves (two-step
// confirm) → the workbook is byte-copied to Final. The sample is reproducible (seed recorded).
//
// Same shape as gst / roc / tax / books (tests/e2e-db/support): fresh JobTask per run, SOP pack from
// AUDIT_CHECKLIST only if none is active, synthetic inputs of
// fixtures/accuracy/audit/clean-private-small-company/input uploaded create-only.
//
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL, E2E_REVIEWER_EMAIL,
// E2E_PARTNER_STATE (approves), E2E_CLIENT_CODE, MS_* (+ SP_PNP_*) here and on the app. The related-party
// LLM rule calls the router; without ANTHROPIC_API_KEY on the app it is "check by hand" (na) —
// still approvable, and the spec does not depend on the verdict.
import { expect, test } from "@playwright/test";
import {
  approvePack, blockFailures, closeDb, ensureSopPack, expectFinalMatchesWorking, expectJobState, fixtureFiles, freshJob, latestRun, openDb, runAgentFromList,
  signedInAll, submitForReview, uploadToClientDocs,
} from "./support";

const SPEC = "audit.spec.ts";
const OPINION = /true and fair|in our opinion|we report that|we certify|presents fairly/i;
test.afterAll(closeDb);

test("Audit Assist: run → draft working papers (no opinion) → submit → partner approves → copied to Final", async ({ browser }) => {
  const db = openDb();
  await ensureSopPack(db, "audit");
  const job = await freshJob(db, { service: "Audit", fy: "2025-26", period: "Annual", title: "Statutory audit WP", spec: SPEC });
  await uploadToClientDocs(job, fixtureFiles("audit", "clean-private-small-company"));
  const s = await signedInAll(browser, ["assignee", "partner"] as const, SPEC);
  try {
    const run = await runAgentFromList(s.assignee.page, "audit", job);
    await expect(s.assignee.page.getByText("Lead schedules tie to the trial balance")).toBeVisible();
    const preview = s.assignee.page.getByRole("region", { name: /Preview of sheet/ });
    await expect(preview).toContainText("Draft for engagement partner");
    await expect(preview).not.toContainText(OPINION);
    await submitForReview(s.assignee.page);

    await s.partner.page.goto(run);
    await approvePack(s.partner.page);

    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest).toMatchObject({ agent: "audit", status: "APPROVED" });
    expect(blockFailures(latest)).toHaveLength(0);
    const figures = latest.figures as Record<string, number>;
    expect(figures.tbDifferencePaise).toBe(0);
    expect(figures["sample.sales.selected"]).toBe(25); // seed recorded in the Sampling plan sheet; reproducible
    const finals = await expectFinalMatchesWorking(db, job.id, latest.id, { finalFolderSuffix: "/Audit/Annual/Final" });
    expect(finals.some((d) => d.name.includes("_Audit-working-papers_Annual_"))).toBe(true);
  } finally {
    await s.closeAll();
  }
});
