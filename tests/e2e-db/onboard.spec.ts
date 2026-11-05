// Golden path (Phase 3): a partner onboards a fixture client in plain English → plan → Create
// → JobTasks exist for the assignee. Needs a migrated staging database and a signed-in partner
// session, so it lives OUTSIDE playwright.config.ts testDir (tests/e2e) and is wired into its own
// Playwright project by the human (no skip guards allowed in this repo).
//
// Required environment for that project:
//   E2E_BASE_URL            the running app (staging or `next start` against the staging DB)
//   E2E_PARTNER_STATE       path to a Playwright storageState JSON of a signed-in PARTNER (Entra SSO)
//   DATABASE_URL            the same staging database, for the assignee assertions
//   E2E_ASSIGNEE_NAME       an active staff member's display name (default "Priya")
//   E2E_REVIEWER_NAME       an active staff member's display name (default "Ravi")
// SharePoint and Turia: SP_PNP_* unset on staging makes the SharePoint step BLOCKED (asserted
// as an accepted outcome below); the Turia bridge is MANUAL (default), so Turia steps wait.
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`; // fresh client code per run, 3–10 A–Z0–9
const assignee = process.env.E2E_ASSIGNEE_NAME ?? "Priya";
const reviewer = process.env.E2E_REVIEWER_NAME ?? "Ravi";

test.use({ storageState: process.env.E2E_PARTNER_STATE });

test("partner onboards a client: sentence → questions → plan → Create → JobTasks assigned", async ({ page }) => {
  await page.goto("/onboard");
  await expect(page.getByRole("heading", { name: "Onboard a client" })).toBeVisible();

  await page.getByLabel("Client in one sentence").fill(
    `Onboard E2E Fixture Widgets Pvt Ltd — private limited, code ${code}, GST monthly + ROC + books monthly from Nov 2026, FY 2026-27, assign ${assignee}, reviewer ${reviewer}.`,
  );
  await page.getByRole("button", { name: "Continue" }).click();

  // At most two rounds of questions (orchestrator E2E checklist). Fill whatever is asked.
  const answers: Record<string, string> = {
    "q-clientCode": code,
    "q-fy": "2026-27",
    "q-pan": "AAACE1234F",
    "q-gstins": "29AAACE1234F1Z2", // checksum-valid for PAN AAACE1234F
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

  const plan = page.getByRole("region", { name: "What will be created" });
  await expect(plan).toBeVisible();
  await expect(plan).toContainText(code);
  await expect(plan).toContainText(`https://srcaassociate.sharepoint.com/sites/CL-${code}`);
  await expect(plan).toContainText("GSTR-3B");
  await expect(page.getByRole("button", { name: /submit to portal/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/Onboarded|Waiting on a person/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("region", { name: /Turia/ })).toContainText("Create client");

  // JobTasks are visible to the assignee: assigned to them, ASSIGNED, with the creation event.
  // (No staff-facing JobTask page exists yet — /agents (Phase 4) and the morning board (Phase 9)
  // will show them; until then the assertion is on the data the assignee's views read.)
  const db = new PrismaClient();
  try {
    const fc = await db.firmClient.findUniqueOrThrow({ where: { clientCode: code } });
    const tasks = await db.jobTask.findMany({ where: { firmClientId: fc.id }, include: { events: true } });
    expect(tasks.length).toBeGreaterThan(10);
    expect(new Set(tasks.map((t) => t.assigneeId)).size).toBe(1);
    expect(tasks.every((t) => t.state === "ASSIGNED" && t.events.some((e) => e.fromState === null && e.toState === "ASSIGNED"))).toBe(true);
    const g1 = tasks.find((t) => t.title === "GSTR-1" && t.period === "2026-11");
    expect(g1?.statutoryDueOn?.toISOString()).toBe(new Date("2026-12-11T00:00:00+05:30").toISOString());
  } finally {
    await db.$disconnect();
  }
});
