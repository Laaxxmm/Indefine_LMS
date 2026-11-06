// Golden path (c) — Phase 7, Books Close approve path: the assignee runs Books Close on a fresh Books
// job (October 2026) → the month-end pack is in Working → submit → the reviewer approves (two-step
// confirm) → the pack is byte-copied to Final. The fixture raises no flags and makes no model call.
//
// Same shape as gst / roc / tax / audit (tests/e2e-db/support): fresh JobTask per run, SOP pack from
// BOOKS_CHECKLIST only if none is active, synthetic inputs of fixtures/accuracy/books/clean-month/input
// uploaded create-only.
//
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_CLIENT_CODE, MS_* (+ SP_PNP_*) here and on the app.
import { expect, test } from "@playwright/test";
import {
  approvePack, blockFailures, closeDb, ensureSopPack, expectFinalMatchesWorking, expectJobState, expectNoPortalAction, fixtureFiles, freshJob, latestRun, openDb,
  runAgentFromList, signedInAll, submitForReview, uploadToClientDocs,
} from "./support";

const SPEC = "books.spec.ts";
test.afterAll(closeDb);

test("Books Close: run → submit → approve → month-end pack copied to Final", async ({ browser }) => {
  const db = openDb();
  await ensureSopPack(db, "books");
  const job = await freshJob(db, { service: "Books", fy: "2026-27", period: "2026-10", title: "Month-end close", spec: SPEC });
  await uploadToClientDocs(job, fixtureFiles("books", "clean-month"));
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const run = await runAgentFromList(s.assignee.page, "books", job);
    await expect(s.assignee.page.getByText("Trial balance: debits = credits")).toBeVisible();
    await expect(s.assignee.page.getByRole("region", { name: /Preview of sheet/ })).toBeVisible();
    await submitForReview(s.assignee.page);

    await s.reviewer.page.goto(run);
    await expectNoPortalAction(s.reviewer.page);
    await approvePack(s.reviewer.page);

    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest).toMatchObject({ agent: "books", status: "APPROVED" });
    expect(blockFailures(latest)).toHaveLength(0);
    expect((latest.figures as Record<string, number>).tbDifferencePaise).toBe(0);
    const finals = await expectFinalMatchesWorking(db, job.id, latest.id, { finalFolderSuffix: "/Books/2026-10/Final" });
    expect(finals.some((d) => d.name.includes("_Month-end-pack_2026-10_"))).toBe(true);
  } finally {
    await s.closeAll();
  }
});
