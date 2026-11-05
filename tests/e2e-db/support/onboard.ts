// The /onboard conversation as a partner types it: one sentence, then at most two rounds of the
// clarifier's questions (orchestrator E2E checklist), ending on the plan preview. Shared by
// onboard.spec.ts and golden-path.spec.ts.
import { expect, type Locator, type Page } from "@playwright/test";
import { optional } from "./env";

export const assigneeName = () => optional("E2E_ASSIGNEE_NAME", "Priya");
export const reviewerName = () => optional("E2E_REVIEWER_NAME", "Ravi");

/** Synthetic identifiers only (checksum-valid GSTIN for the PAN; no real client). */
const ANSWERS = (code: string): Record<string, string> => ({
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
});

/** Pick the option whose text contains `name` (the people selects list each person once). */
async function choosePerson(page: Page, id: string, name: string) {
  const el = page.locator(`#${id}`);
  if (!(await el.count())) return;
  const options = await el.locator("option").allTextContents();
  const label = options.find((o) => o.toLowerCase().includes(name.toLowerCase()));
  expect(label, `${id} lists ${name} (options: ${JSON.stringify(options)})`).toBeTruthy();
  await el.selectOption({ label: label! });
}

/** Sentence → questions → the plan preview region ("What will be created"). */
export async function onboardToPlan(page: Page, code: string, legalName: string): Promise<Locator> {
  await page.goto("/onboard");
  await expect(page.getByRole("heading", { name: "Onboard a client" })).toBeVisible();
  await page.getByLabel("Client in one sentence").fill(
    `Onboard ${legalName} — private limited, code ${code}, GST monthly + ROC + books monthly from Nov 2026, FY 2026-27, assign ${assigneeName()}, reviewer ${reviewerName()}.`,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  const answers = ANSWERS(code);
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
    await choosePerson(page, "q-assigneeId", assigneeName());
    await choosePerson(page, "q-reviewerId", reviewerName());
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
  }
  const plan = page.getByRole("region", { name: "What will be created" });
  await expect(plan, "plan preview after at most two rounds of questions").toBeVisible();
  return plan;
}

/** Plan → Create → the saga finished (DONE with Turia checklists waiting, or BLOCKED on a human step). */
export async function createFromPlan(page: Page) {
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/^(Onboarded|Waiting on a person)$/)).toBeVisible({ timeout: 180_000 });
}
