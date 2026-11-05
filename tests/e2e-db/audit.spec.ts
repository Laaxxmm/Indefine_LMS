// Golden path (Phase 7, Audit Assist): a partner runs Audit Assist on a prepared FY 2025-26
// statutory-audit job → reviews the working papers ("Draft for engagement partner") → Submit for
// review → Approve pack → the workbook is copied Working → Final. Needs a migrated staging
// database, a running app with SharePoint configured (inputs are read from the job's ClientDocs
// folder; the pack is written to Working/Final) and a signed-in partner session, so it lives
// OUTSIDE playwright.config.ts testDir (tests/e2e) and runs with `npm run e2e:db`
// (playwright.db.config.ts, --repeat-each=3; no skip guards in this repo).
//
// Required environment:
//   E2E_BASE_URL         the running app (staging, or `next start` against the staging DB)
//   E2E_PARTNER_STATE    path to a Playwright storageState JSON of a signed-in PARTNER (Entra SSO)
//   DATABASE_URL         the same staging database, for setup and the assertions
//   E2E_AUDIT_JOB_ID     an Audit JobTask (fy 2025-26, period Annual) in ASSIGNED or IN_PREP whose
//                        CL-{Code}/Compliance/FY2025-26/Audit/Annual/ClientDocs folder holds the
//                        input files of fixtures/accuracy/audit/clean-private-small-company/input
//                        (trial-balance.csv, trial-balance-prior.csv, entity.json, sampling.json,
//                        population-*.csv, explanations.csv, notes.txt). That fixture raises no
//                        flags, so no partner note is needed to approve.
//   ANTHROPIC_API_KEY    on the app: the related-party LLM rule calls the router (judgement tier,
//                        anonymised). Without it the rule is recorded "na" (llm-error) — still
//                        approvable, and the spec does not depend on the verdict.
// Setup: the SOP pack "audit" v1.0.0 is published from AUDIT_CHECKLIST if no active pack exists
// (production seeding of SOP packs is not wired yet).
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { AUDIT_CHECKLIST } from "../../src/lib/agents/audit/rules";

const jobId = process.env.E2E_AUDIT_JOB_ID ?? "";
const OPINION = /true and fair|in our opinion|we report that|we certify|presents fairly/i;

test.use({ storageState: process.env.E2E_PARTNER_STATE });

test("partner runs Audit Assist → reviews the draft working papers → approves → copied to Final", async ({ page }) => {
  const db = new PrismaClient();
  try {
    expect(jobId, "E2E_AUDIT_JOB_ID must name a prepared Audit JobTask").not.toBe("");
    const job = await db.jobTask.findUniqueOrThrow({ where: { id: jobId }, include: { firmClient: true } });
    expect(job.service).toBe("Audit");
    expect(["ASSIGNED", "IN_PREP"]).toContain(job.state);
    if (!(await db.sopPack.findFirst({ where: { key: "audit", active: true } }))) {
      await db.sopPack.create({ data: { key: "audit", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Audit Assist", checklist: JSON.parse(JSON.stringify(AUDIT_CHECKLIST)), active: true } });
    }

    await page.goto("/agents/audit");
    await page.getByRole("button", { name: `Run agent on ${job.title} for ${job.firmClient.clientCode}` }).click();
    await page.waitForURL(/\/agents\/audit\/runs\/[^/]+$/, { timeout: 120_000 });
    const runId = page.url().split("/").pop()!;

    // Review screen: checklist on the left, the working-paper preview on the right; no portal / report action.
    await expect(page.getByText("Lead schedules tie to the trial balance")).toBeVisible();
    const preview = page.getByRole("region", { name: /Preview of sheet/ });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Draft for engagement partner");
    await expect(preview).not.toContainText(OPINION);
    await expect(page.getByRole("button", { name: /submit to portal|sign report|issue opinion|send to client/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("button", { name: "Approve pack" }).click();
    await expect(page.getByText(/Pack approved and in Final/)).toBeVisible({ timeout: 120_000 });

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { deliverables: true, checklist: true } });
    expect(run.status).toBe("APPROVED");
    expect(run.agent).toBe("audit");
    expect(run.checklist.filter((c) => c.status === "fail" && c.severity === "block")).toHaveLength(0);
    const working = run.deliverables.find((d) => d.kind === "Working" && d.name.includes("_Audit-working-papers_Annual_"));
    const final = run.deliverables.find((d) => d.kind === "Final" && d.name.includes("_Audit-working-papers_Annual_"));
    expect(working).toBeTruthy();
    expect(final?.sha256).toBe(working?.sha256); // byte copy Working → Final
    const figures = run.figures as Record<string, number>;
    expect(figures.tbDifferencePaise).toBe(0);
    expect(figures["sample.sales.selected"]).toBe(25); // seed recorded in the Sampling plan sheet; selection reproducible
    const after = await db.jobTask.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.state).toBe("APPROVED");
  } finally {
    await db.$disconnect();
  }
});
