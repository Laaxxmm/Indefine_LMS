// Golden path (Phase 7, Books Close): a partner runs the Books Close agent on a prepared October
// job → reviews the month-end pack → Submit for review → Approve pack → the pack is copied
// Working → Final. Needs a migrated staging database, a running app with SharePoint configured
// (the inputs are read from the job's ClientDocs folder and the pack is written to Working/Final)
// and a signed-in partner session, so it lives OUTSIDE playwright.config.ts testDir (tests/e2e)
// and runs with `npm run e2e:db` (playwright.db.config.ts, --repeat-each=3; no skip guards in
// this repo).
//
// Required environment:
//   E2E_BASE_URL         the running app (staging, or `next start` against the staging DB)
//   E2E_PARTNER_STATE    path to a Playwright storageState JSON of a signed-in PARTNER (Entra SSO)
//   DATABASE_URL         the same staging database, for setup and the assertions
//   E2E_BOOKS_JOB_ID     a Books JobTask (period 2026-10) in ASSIGNED or IN_PREP whose
//                        CL-{Code}/Compliance/FY2026-27/Books/2026-10/ClientDocs folder holds the
//                        input files of fixtures/accuracy/books/clean-month/input (trial-balance.csv,
//                        bank-statement.csv, bank-ledger.csv, tds-*.csv, gst-*.csv, schedules.csv,
//                        trial-balance-prior.csv). That fixture raises no flags, so no partner
//                        note is needed to approve and no model call is made (no ANTHROPIC_API_KEY).
// Setup: the SOP pack "books" v1.0.0 is published from BOOKS_CHECKLIST if no active pack exists
// (production seeding of SOP packs is not wired yet — PROGRESS "Known gaps").
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BOOKS_CHECKLIST } from "../../src/lib/agents/books/rules";

const jobId = process.env.E2E_BOOKS_JOB_ID ?? "";

test.use({ storageState: process.env.E2E_PARTNER_STATE });

test("partner runs Books Close → reviews the month-end pack → approves → pack copied to Final", async ({ page }) => {
  const db = new PrismaClient();
  try {
    expect(jobId, "E2E_BOOKS_JOB_ID must name a prepared Books JobTask").not.toBe("");
    const job = await db.jobTask.findUniqueOrThrow({ where: { id: jobId }, include: { firmClient: true } });
    expect(job.service).toBe("Books");
    expect(["ASSIGNED", "IN_PREP"]).toContain(job.state);
    if (!(await db.sopPack.findFirst({ where: { key: "books", active: true } }))) {
      await db.sopPack.create({ data: { key: "books", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Books Close", checklist: JSON.parse(JSON.stringify(BOOKS_CHECKLIST)), active: true } });
    }

    await page.goto("/agents/books");
    await page.getByRole("button", { name: `Run agent on ${job.title} for ${job.firmClient.clientCode}` }).click();
    await page.waitForURL(/\/agents\/books\/runs\/[^/]+$/, { timeout: 120_000 });
    const runId = page.url().split("/").pop()!;

    // Review screen: checklist with evidence on the left, the pack preview on the right, no portal action.
    await expect(page.getByText("Trial balance: debits = credits")).toBeVisible();
    await expect(page.getByRole("region", { name: /Preview of sheet/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /submit to portal|file|send to client/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("button", { name: "Approve pack" }).click();
    await expect(page.getByText(/Pack approved and in Final/)).toBeVisible({ timeout: 120_000 });

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { deliverables: true, checklist: true } });
    expect(run.status).toBe("APPROVED");
    expect(run.agent).toBe("books");
    expect(run.checklist.filter((c) => c.status === "fail" && c.severity === "block")).toHaveLength(0);
    const working = run.deliverables.find((d) => d.kind === "Working" && d.name.includes("_Month-end-pack_2026-10_"));
    const final = run.deliverables.find((d) => d.kind === "Final" && d.name.includes("_Month-end-pack_2026-10_"));
    expect(working).toBeTruthy();
    expect(final?.sha256).toBe(working?.sha256); // byte copy Working → Final
    expect((run.figures as Record<string, number>).tbDifferencePaise).toBe(0);
    const after = await db.jobTask.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.state).toBe("APPROVED");
  } finally {
    await db.$disconnect();
  }
});
