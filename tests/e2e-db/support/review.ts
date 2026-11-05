// UI steps on the agent pages, written once for every golden path: run the agent from its list,
// submit, approve (two-step: "Approve pack" shows what approval does, "Confirm approval" sends it),
// request changes (note → "Request changes and re-run" → the new run), mark filed, record the Turia
// close — and the invariant every step re-checks: no portal / submit-to-portal / send action exists.
import { expect, type Page } from "@playwright/test";

/** Buttons or links that would file with a government portal or send something to a client. */
export const NO_PORTAL_ACTION = /submit to portal|file on portal|file return|e-file|submit to mca|issue opinion|sign report|^send\b|send to client|send email/i;

export const bar = (page: Page) => page.getByRole("region", { name: "Review actions" });
export const closeCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Filing and close" }) });
export const stateChip = (page: Page, state: string) => page.getByTitle(`Job state: ${state}`).first();

export async function expectNoPortalAction(page: Page) {
  await expect(page.getByRole("button", { name: NO_PORTAL_ACTION })).toHaveCount(0);
  await expect(page.getByRole("link", { name: NO_PORTAL_ACTION })).toHaveCount(0);
}

/** /agents/<agent> → "Run agent on <title> for <code>" → the run's review page. Returns its path. */
export async function runAgentFromList(page: Page, agent: string, job: { title: string; clientCode: string }): Promise<string> {
  await page.goto(`/agents/${agent}`);
  await page.getByRole("button", { name: `Run agent on ${job.title} for ${job.clientCode}` }).click();
  await page.waitForURL(new RegExp(`/agents/${agent}/runs/[^/]+$`), { timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expectNoPortalAction(page);
  return new URL(page.url()).pathname;
}

export const runIdOf = (runPath: string) => runPath.split("/").pop()!;

export async function submitForReview(page: Page) {
  await bar(page).getByRole("button", { name: "Submit for review" }).click();
  await expect(stateChip(page, "IN_REVIEW")).toBeVisible({ timeout: 60_000 });
}

/** Reviewer: "Approve pack" → (partner note when approving over block findings) → "Confirm approval". */
export async function approvePack(page: Page, opts: { partnerNote?: string } = {}) {
  await bar(page).getByRole("button", { name: "Approve pack" }).click();
  await expect(bar(page)).toContainText("Approving moves the job to APPROVED");
  if (opts.partnerNote) await bar(page).getByLabel(/Partner note/).fill(opts.partnerNote);
  await bar(page).getByRole("button", { name: "Confirm approval" }).click();
  await expect(stateChip(page, "APPROVED")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Pack approved and in Final/).first()).toBeVisible();
  await expectNoPortalAction(page);
}

/** Reviewer: "Request changes" → note → "Request changes and re-run" → lands on the new run. Returns its path. */
export async function requestChanges(page: Page, note: string): Promise<string> {
  const before = new URL(page.url()).pathname;
  await bar(page).getByRole("button", { name: "Request changes" }).click();
  await bar(page).getByLabel("What needs to change? The agent re-runs with this note.").fill(note);
  await bar(page).getByRole("button", { name: "Request changes and re-run" }).click();
  await page.waitForURL((u) => u.pathname !== before && /\/runs\/[^/]+$/.test(u.pathname), { timeout: 180_000 });
  await expectNoPortalAction(page);
  return new URL(page.url()).pathname;
}

export async function markFiled(page: Page, ack: { label: string; value: string }) {
  await expect(bar(page)).toContainText("Filed by you on the portal — record the acknowledgement here.");
  await bar(page).getByLabel(ack.label).fill(ack.value);
  await bar(page).getByRole("button", { name: "Mark filed" }).click();
  await expect(stateChip(page, "CLOSING")).toBeVisible({ timeout: 60_000 });
  await expectNoPortalAction(page);
}

export async function recordTuriaClose(page: Page, ref: string, minutes: number) {
  await bar(page).getByLabel("Turia task ref", { exact: true }).fill(ref);
  await bar(page).getByLabel("Minutes logged in Turia", { exact: true }).fill(String(minutes));
  await bar(page).getByRole("button", { name: "Record Turia close" }).click();
}

/** A GST ARN shape (AA + state 29 + MMYY + serial) — stored, never checked against a portal. */
export const arnFor = (tag: string) => `AA2910260${tag.replace(/[^0-9A-Z]/g, "").slice(-6).padStart(6, "0")}`;
