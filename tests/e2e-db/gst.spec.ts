// Golden path (b) — Phase 5 / Phase 12: GST Prep run → review → request changes → re-run → approve →
// Final. The assignee runs GST Prep on a fresh GST job (October 2026) → the reviewer asks for changes
// with a note → the agent re-runs with that note (attempt 2, same inputs) → the assignee submits the
// new pack → the reviewer approves (two-step confirm) → the five draft files of attempt 2 are
// byte-copied Working → Final. A second test is the straight approve path. Nothing is filed: no page
// on the way offers a portal or send action.
//
// Runs under `npm run e2e:db` (playwright.db.config.ts, --repeat-each=3). Each run seeds a fresh
// JobTask (unique title) and the GST SopPack (create-only), and uploads the synthetic inputs of
// fixtures/accuracy/gst/01-clean-tally-csv/input to the job's ClientDocs (create-only: identical
// files already there are reused). Working / Final files accumulate as _v{n}; nothing is deleted.
//
// Environment (tests/e2e-db/support/env.ts):
//   E2E_BASE_URL, DATABASE_URL
//   E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL   the preparer (staff)
//   E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL   the reviewer (a different person)
//   E2E_CLIENT_CODE                           e2e FirmClient with its CL- site (onboarded once)
//   MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET (+ SP_PNP_* for site checks) in this process and on
//   the app: the spec uploads the inputs; the app reads ClientDocs and writes Working / Final.
// The clean fixture raises no block finding, so no partner note is needed to approve. The model is
// used for ledger classification and HSN reading (ADR-008 tasks); without ANTHROPIC_API_KEY on the
// app those come back for a person and the pack still builds from the parsed registers.
import { expect, test } from "@playwright/test";
import {
  approvePack, blockFailures, closeDb, ensureSopPack, expectFinalMatchesWorking, expectJobState, expectNoPortalAction, fixtureFiles, freshJob,
  latestRun, openDb, requestChanges, runAgentFromList, runIdOf, signedInAll, submitForReview, uploadToClientDocs,
} from "./support";

const SPEC = "gst.spec.ts";
const PERIOD = { service: "GST" as const, fy: "2026-27", period: "2026-10" };
const NOTE = "Re-check the October purchase register against 2B before approval";

test.afterAll(closeDb);

async function preparedJob(title: string) {
  const db = openDb();
  await ensureSopPack(db, "gst");
  const job = await freshJob(db, { ...PERIOD, title, spec: SPEC });
  await uploadToClientDocs(job, fixtureFiles("gst", "01-clean-tally-csv"));
  return { db, job };
}

test("GST Prep: run → reviewer requests changes → agent re-runs with the note → submit → approve → Final holds the second pack", async ({ browser }) => {
  const { db, job } = await preparedJob("GSTR-3B change-request");
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    // Assignee: run, check the pack is there, submit.
    const run1 = await runAgentFromList(s.assignee.page, "gst", job);
    await expect(s.assignee.page.getByText(`${job.clientCode}_GSTR-1-draft_2026-10`, { exact: false }).first()).toBeVisible();
    await submitForReview(s.assignee.page);

    // Reviewer: request changes with a note → the agent re-runs (attempt 2) and the reviewer lands on it.
    await s.reviewer.page.goto(run1);
    const run2 = await requestChanges(s.reviewer.page, NOTE);
    expect(run2).not.toBe(run1);
    await expect(s.reviewer.page.getByText(/attempt 2/)).toBeVisible();
    await expect(s.reviewer.page.getByText(NOTE)).toBeVisible(); // the note travels with the re-run
    await expectJobState(db, job.id, "AGENT_DONE", 180_000);
    const changeEvent = await db.jobTaskEvent.findFirst({ where: { jobTaskId: job.id, fromState: "IN_REVIEW", toState: "IN_PREP" } });
    expect(changeEvent?.note).toContain(NOTE);

    // The first run is kept for the record and says a newer one exists.
    await s.reviewer.page.goto(run1);
    await expect(s.reviewer.page.getByText("A newer run exists for this job.")).toBeVisible();
    await expect(s.reviewer.page.getByRole("region", { name: "Review actions" }).getByRole("button", { name: "Approve pack" })).toHaveCount(0);

    // Assignee submits the new pack; reviewer approves it.
    await s.assignee.page.goto(run2);
    await submitForReview(s.assignee.page);
    await s.reviewer.page.goto(run2);
    await approvePack(s.reviewer.page);
    await expectNoPortalAction(s.reviewer.page);

    // Data: APPROVED; Final = byte copies of attempt 2's five Working files; attempt 1 still recorded.
    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest).toMatchObject({ id: runIdOf(run2), attempt: 2, status: "APPROVED", reviewNotes: expect.stringContaining(NOTE) });
    expect(blockFailures(latest)).toHaveLength(0);
    await expectFinalMatchesWorking(db, job.id, latest.id, { count: 5, finalFolderSuffix: "/GST/2026-10/Final" });
    expect(await db.agentRun.count({ where: { jobTaskId: job.id } })).toBe(2);
  } finally {
    await s.closeAll();
  }
});

test("GST Prep: run → submit → approve → the five draft files land in Final", async ({ browser }) => {
  const { db, job } = await preparedJob("GSTR-3B approve");
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    await expect(async () => {
      await s.assignee.page.goto("/agents/gst");
      await expect(s.assignee.page.getByRole("heading", { name: "GST Prep" })).toBeVisible();
    }).toPass();
    const run = await runAgentFromList(s.assignee.page, "gst", job);
    await submitForReview(s.assignee.page);
    await expectJobState(db, job.id, "IN_REVIEW");
    await s.reviewer.page.goto(run);
    await approvePack(s.reviewer.page);
    await expectJobState(db, job.id, "APPROVED");
    const latest = await latestRun(db, job.id);
    expect(latest.status).toBe("APPROVED");
    await expectFinalMatchesWorking(db, job.id, latest.id, { count: 5, finalFolderSuffix: "/GST/2026-10/Final" });
  } finally {
    await s.closeAll();
  }
});
