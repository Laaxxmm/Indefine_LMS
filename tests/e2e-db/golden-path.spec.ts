// Golden path (Phase 8, orchestrator "E2E CHECKLIST"): onboard a client → the assignee runs the
// agent on one of its jobs → Submit for review → the reviewer approves → the Final file is in
// SharePoint → the assignee records "Mark filed" with the acknowledgement (ARN) → "Close in Turia"
// with the minutes → the close gate sets DONE. Negative case: filed but the Turia close skipped →
// the job stays CLOSING and DONE is refused. Firm OS never files anything: the person files on the
// portal and records it; the spec asserts there is no portal / submit / send action on the way.
//
// Runs under `npm run e2e:db` (playwright.db.config.ts, testDir tests/e2e-db), against staging.
// Required environment:
//   E2E_BASE_URL         the running app (staging or `next start` against the staging DB)
//   DATABASE_URL         the same staging database (job lookup and the DONE / CLOSING assertions)
//   E2E_PARTNER_STATE    Playwright storageState JSON of a signed-in PARTNER (onboards the client)
//   E2E_ASSIGNEE_STATE   storageState of the staff member named E2E_ASSIGNEE_NAME (runs the agent,
//                        marks filed, closes in Turia)
//   E2E_REVIEWER_STATE   storageState of the staff member named E2E_REVIEWER_NAME (approves)
//   E2E_ASSIGNEE_NAME    display name the onboarding sentence assigns (default "Priya")
//   E2E_REVIEWER_NAME    display name the onboarding sentence sets as reviewer (default "Ravi")
//   E2E_AGENT            agent route key (default "echo"). The gst agent is not registered on this
//                        branch yet, so the spec runs the framework's echo agent on a Books job and
//                        the app must run with FIRM_OS_ECHO_AGENT=1. SWITCH TO "gst" (GST job, GST
//                        ARN required) once src/lib/agents/registry.ts registers gst, and set:
//   E2E_INPUT_DIR        folder of the gst agent's input files, uploaded to the job's ClientDocs
//                        (echo needs none: the spec uploads a generated register.csv)
// SharePoint must be real on staging (SP_PNP_* and the Graph app registration, in the app AND in
// this process): onboarding creates CL-{code} and the FY tree, the spec uploads the inputs
// create-only into ClientDocs, the agent writes Working, approval copies to Final, and the close
// gate checks the Final file live. Turia runs through the MANUAL bridge (default): the person
// closes the task in Turia and types the task ref and minutes here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient, type FirmService } from "@prisma/client";
import { createDeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { defaultSharePointClient } from "@/lib/integrations/sharepoint/factory";
import { deliverablePath, type Period } from "@/lib/integrations/sharepoint/paths";

const AGENT = process.env.E2E_AGENT ?? "echo";
const SERVICE: FirmService = AGENT === "gst" ? "GST" : "Books";
const ACK_LABEL = SERVICE === "GST" ? "GST ARN (required)" : "Acknowledgement reference (optional)";
const ARN = "AA2711260012345"; // a GST ARN shape (AA + state 27 + MMYY + serial); stored, never checked against a portal
const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`; // fresh client code per run
const assignee = process.env.E2E_ASSIGNEE_NAME ?? "Priya";
const reviewer = process.env.E2E_REVIEWER_NAME ?? "Ravi";
const NO_PORTAL_ACTION = /submit to portal|file on portal|^send/i;

/** echo's input: a clean register (unique refs, weekday dates, non-round amounts → no block finding). */
const ECHO_REGISTER = ["ref,party,date,amount", "E2E-1,Fixture Traders,2026-11-03,15234.50", "E2E-2,Sample Supplies,2026-11-04,8999.99", "E2E-3,Demo Logistics,2026-11-05,23456.75"].join("\n");

const db = new PrismaClient();
let partner: BrowserContext;
let staff: BrowserContext;
let checker: BrowserContext;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  partner = await browser.newContext({ storageState: process.env.E2E_PARTNER_STATE });
  staff = await browser.newContext({ storageState: process.env.E2E_ASSIGNEE_STATE });
  checker = await browser.newContext({ storageState: process.env.E2E_REVIEWER_STATE });
  await onboard(await partner.newPage());
});

test.afterAll(async () => {
  await Promise.all([partner?.close(), staff?.close(), checker?.close()]);
  await db.$disconnect();
});

// ------------------------------------------------------------------ steps

async function onboard(page: Page) {
  await page.goto("/onboard");
  await expect(page.getByRole("heading", { name: "Onboard a client" })).toBeVisible();
  await page.getByLabel("Client in one sentence").fill(
    `Onboard E2E Golden Path Pvt Ltd — private limited, code ${code}, GST monthly + ROC + books monthly from Nov 2026, FY 2026-27, assign ${assignee}, reviewer ${reviewer}.`,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  const answers: Record<string, string> = {
    "q-clientCode": code,
    "q-fy": "2026-27",
    "q-pan": "AAACE1234F",
    "q-gstins": "29AAACE1234F1Z2",
    "q-cin": "U12345KA2020PTC123456",
    "q-firstPeriod": "2026-11",
    "q-contactName": "Fixture Contact",
    "q-contactEmail": "fixture@example.test",
    "q-contactPhone": "9876543210",
    "q-turnoverInr": "2.5 Cr",
    "q-billing": "Retainer ₹15,000 per month",
    "q-dscHolder": "Director",
  };
  for (let round = 0; round < 2; round++) {
    if (await page.getByRole("heading", { name: "What will be created" }).isVisible()) break;
    for (const [id, value] of Object.entries(answers)) {
      const el = page.locator(`#${id}`);
      if (await el.count()) await el.fill(value);
    }
    for (const id of ["q-booksSoftware", "q-entityType"]) {
      const el = page.locator(`#${id}`);
      if (await el.count()) await el.selectOption({ index: 1 });
    }
    for (const id of ["q-assigneeId", "q-reviewerId"]) {
      const el = page.locator(`#${id}`);
      if (await el.count()) await el.selectOption({ index: id === "q-assigneeId" ? 1 : 2 });
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByRole("region", { name: "What will be created" })).toContainText(code);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/Onboarded|Waiting on a person/)).toBeVisible({ timeout: 180_000 });
}

/** The n-th (0-based) ASSIGNED job of the agent's service for the onboarded client, earliest due first. */
async function jobFor(n: number) {
  const fc = await db.firmClient.findUniqueOrThrow({ where: { clientCode: code } });
  const jobs = await db.jobTask.findMany({
    where: { firmClientId: fc.id, service: SERVICE, state: "ASSIGNED" },
    orderBy: [{ statutoryDueOn: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, period: true, fy: true },
  });
  expect(jobs.length, `ASSIGNED ${SERVICE} jobs for ${code}`).toBeGreaterThan(n);
  return jobs[n];
}

/** The agent's inputs, uploaded create-only into the job's ClientDocs folder (never overwrites). */
async function uploadInputs(job: { fy: string; period: string }) {
  const store = createDeliverableStore(defaultSharePointClient());
  const driveId = await store.complianceDrive(code);
  const folder = deliverablePath(code, job.fy, SERVICE, job.period as Period, "ClientDocs").path;
  const dir = process.env.E2E_INPUT_DIR;
  if (AGENT !== "echo" && !dir) throw new Error(`E2E_INPUT_DIR must name the ${AGENT} agent's input files`);
  const files = AGENT === "echo" ? [{ name: "register.csv", bytes: Buffer.from(ECHO_REGISTER) }] : readdirSync(dir!).map((name) => ({ name, bytes: readFileSync(join(dir!, name)) }));
  expect(files.length, "agent input files").toBeGreaterThan(0);
  for (const f of files) await store.putNew(driveId, folder, f.name, f.bytes);
}

async function expectNoPortalAction(page: Page) {
  await expect(page.getByRole("button", { name: NO_PORTAL_ACTION })).toHaveCount(0);
  await expect(page.getByRole("link", { name: NO_PORTAL_ACTION })).toHaveCount(0);
}

const bar = (page: Page) => page.getByRole("region", { name: "Review actions" });
const closeCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Filing and close" }) });

/** Assignee runs the agent and submits; reviewer approves; the Final file is recorded. Returns the run URL. */
async function prepareApproved(job: { id: string; title: string; period: string; fy: string }): Promise<string> {
  await uploadInputs(job);

  const page = await staff.newPage();
  await page.goto(`/agents/${AGENT}`);
  const row = page.getByRole("row").filter({ hasText: code }).filter({ hasText: job.period });
  await row.getByRole("button", { name: `Run agent on ${job.title} for ${code}` }).click();
  await page.waitForURL(new RegExp(`/agents/${AGENT}/runs/`), { timeout: 180_000 });
  const runUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expectNoPortalAction(page);
  await bar(page).getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByTitle("Job state: IN_REVIEW")).toBeVisible();
  await page.close();

  const review = await checker.newPage();
  await review.goto(runUrl);
  await expect(bar(review).getByRole("button", { name: "Approve pack" })).toBeVisible();
  await expectNoPortalAction(review);
  await bar(review).getByRole("button", { name: "Approve pack" }).click();
  await expect(review.getByTitle("Job state: APPROVED")).toBeVisible({ timeout: 120_000 });
  await expect(closeCard(review)).toContainText("In the Final folder");
  await review.close();

  // Final file present: a Final Deliverable row in the Path A Final folder (the gate re-checks it live in SharePoint).
  const finals = await db.deliverable.findMany({ where: { jobTaskId: job.id, kind: "Final" } });
  expect(finals.length).toBeGreaterThan(0);
  const finalFolder = deliverablePath(code, job.fy, SERVICE, job.period as Period, "Final").serverRelativeUrl;
  expect(finals.every((f) => f.spPath === finalFolder && !!f.driveItemId && f.sizeBytes > 0)).toBe(true);
  return runUrl;
}

async function markFiled(page: Page, runUrl: string) {
  await page.goto(runUrl);
  await expect(bar(page)).toContainText("Filed by you on the portal — record the acknowledgement here.");
  await bar(page).getByLabel(ACK_LABEL).fill(ARN);
  await bar(page).getByRole("button", { name: "Mark filed" }).click();
  await expect(page.getByTitle("Job state: CLOSING")).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Close in Turia" })).toBeVisible();
  await expect(closeCard(page)).toContainText(ARN);
  await expectNoPortalAction(page);
}

// ------------------------------------------------------------------ tests

test("golden path: run agent → submit → approve → Final file → Mark filed (ARN) → Close in Turia (minutes) → DONE", async () => {
  const job = await jobFor(0);
  const runUrl = await prepareApproved(job);
  const page = await staff.newPage();
  await markFiled(page, runUrl);

  await bar(page).getByLabel("Turia task ref").fill(`TT-${code}`);
  await bar(page).getByLabel("Minutes logged in Turia").fill("75");
  await bar(page).getByRole("button", { name: "Close in Turia" }).click();
  await expect(page.getByTitle("Job state: DONE").first()).toBeVisible({ timeout: 60_000 });
  await expect(closeCard(page)).toContainText(/Closed \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} IST · cycle time/);
  await expect(bar(page).getByRole("button")).toHaveCount(0);
  await expectNoPortalAction(page);

  const row = await db.jobTask.findUniqueOrThrow({ where: { id: job.id }, select: { state: true, ackRef: true, doneAt: true } });
  expect(row).toMatchObject({ state: "DONE", ackRef: ARN });
  expect(row.doneAt).not.toBeNull();
  const doneEvent = await db.jobTaskEvent.findFirst({ where: { jobTaskId: job.id, toState: "DONE" } });
  expect(doneEvent).toMatchObject({ fromState: "CLOSING", actorId: "system:close-gate" });
  const sync = await db.turiaSync.findFirst({ where: { jobTaskId: job.id, operation: "closeTask", status: "CLOSED" } });
  expect(sync).toMatchObject({ turiaRef: `TT-${code}`, minutesLogged: 75 });
  await page.close();
});

test("negative: marked filed but the Turia close skipped → stays CLOSING, DONE refused", async () => {
  const job = await jobFor(0); // the first job is DONE now, so this is the next ASSIGNED one
  const runUrl = await prepareApproved(job);
  const page = await staff.newPage();
  await markFiled(page, runUrl);

  // No Turia close recorded: the card says so, and DONE cannot be set through the API.
  await expect(closeCard(page)).toContainText("Not recorded yet");
  const refused = await page.request.post(`/api/firm-os/jobs/${job.id}/state`, { data: { to: "DONE", expectedState: "CLOSING" } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "gate-required" });

  await page.reload();
  await expect(page.getByTitle("Job state: CLOSING")).toBeVisible();
  await expect(page.getByTitle("Job state: DONE")).toHaveCount(0);
  const row = await db.jobTask.findUniqueOrThrow({ where: { id: job.id }, select: { state: true, doneAt: true } });
  expect(row).toEqual({ state: "CLOSING", doneAt: null });
  expect(await db.jobTaskEvent.count({ where: { jobTaskId: job.id, toState: "DONE" } })).toBe(0);
  expect(await db.turiaSync.count({ where: { jobTaskId: job.id, operation: "closeTask", status: "CLOSED" } })).toBe(0);
  await page.close();
});
