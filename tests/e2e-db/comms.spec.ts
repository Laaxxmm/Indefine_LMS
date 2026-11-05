// DEPENDS ON PHASE 10 MERGE (Client comms drafts + engagement-letter Outlook draft). Written against
// the orchestrator's Phase 10 brief and the owner decision of 2026-11-05 ("engagement-letter Send →
// create Outlook draft; no send path anywhere") before the pages exist: selectors marked "PHASE 10:"
// are to be confirmed after the merge (docs/qa/phase-12-runbook.md "after-merge e2e fix-ups").
//
// Golden path (f) — comms draft → "Open in Outlook draft" creates a draft, never sends:
//   · staff draft a document-request message for a client → plain wording, ≤ 180 words, one ask,
//     no full PAN / Aadhaar in the body → "Copy" and "Open in Outlook draft" → a draft is created in
//     the person's OWN mailbox (CommsDraft.outlookDraftId recorded) → no Send button exists anywhere
//   · /tools/office-tools/engagement-letter offers "Create Outlook draft" and no Send button
// Graph: the app creates the draft with the person's delegated token (Mail.ReadWrite) — staging only;
// the spec cannot observe Graph from the browser, so "never sends" is asserted on the UI (no send
// control), the recorded draft id and the audit trail; verify:no-send (Phase 10 guard) covers the code.
//
// Runs under `npm run e2e:db` (--repeat-each=3). Environment: E2E_BASE_URL, DATABASE_URL,
// E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL (signed in with the Mail.ReadWrite consent), E2E_CLIENT_CODE.
import { expect, test, type Locator } from "@playwright/test";
import { closeDb, e2eClient, openDb, signedInAll, userByEmail } from "./support";

const SPEC = "comms.spec.ts";
const SEND = /^send\b|send (now|email|to client)|send mail/i;
const FULL_PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
test.afterAll(closeDb);

/** Select the option whose text contains `text`. */
async function selectByText(select: Locator, text: string) {
  const options = await select.locator("option").allTextContents();
  const label = options.find((o) => o.includes(text));
  expect(label, `an option containing "${text}" (options: ${JSON.stringify(options)})`).toBeTruthy();
  await select.selectOption({ label: label! });
}

test("comms: draft a document request → Copy / Open in Outlook draft → a draft in the person's own mailbox, never sent", { tag: ["@after-merge", "@phase-10"] }, async ({ browser }) => {
  const db = openDb();
  const fc = await e2eClient(db, SPEC);
  const me = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  const page = s.assignee.page;
  try {
    await page.goto("/comms");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: SEND })).toHaveCount(0);

    // PHASE 10: form labels.
    await selectByText(page.getByLabel(/^Client/), fc.clientCode);
    await selectByText(page.getByLabel(/Kind|Message type/), "Document");
    await page.getByRole("button", { name: /^(Draft|Write draft|Prepare draft)$/ }).click();

    const draft = page.getByRole("region", { name: /Draft/ }); // PHASE 10: draft preview region
    await expect(draft).toBeVisible({ timeout: 120_000 });
    const body = (await draft.textContent()) ?? "";
    expect(body.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(220); // ≤ 180-word body plus subject/labels
    expect(body).not.toMatch(FULL_PAN); // PAN only masked (last 4) when client-requested
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();

    const before = await db.commsDraft.count({ where: { createdById: me.id, firmClientId: fc.id } });
    await page.getByRole("button", { name: "Open in Outlook draft" }).click();
    await expect(page.getByText(/Outlook draft|Drafts folder/i).first()).toBeVisible({ timeout: 60_000 });
    const drafts = await db.commsDraft.findMany({ where: { createdById: me.id, firmClientId: fc.id }, orderBy: { createdAt: "desc" } });
    expect(drafts.length).toBe(Math.max(before, 1));
    expect(drafts[0].outlookDraftId, "draft created in the person's own mailbox").toBeTruthy();
    expect(drafts[0].body).not.toMatch(FULL_PAN);

    // Nowhere on the page is there a way to send it.
    await expect(page.getByRole("button", { name: SEND })).toHaveCount(0);
    await expect(page.getByRole("link", { name: SEND })).toHaveCount(0);
  } finally {
    await s.closeAll();
  }
});

test("engagement letter: 'Create Outlook draft' replaces Send (owner decision 2026-11-05)", { tag: ["@after-merge", "@phase-10"] }, async ({ browser }) => {
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  try {
    await s.assignee.page.goto("/tools/office-tools/engagement-letter");
    await expect(s.assignee.page.getByRole("heading", { name: "Engagement letters" })).toBeVisible();
    await expect(s.assignee.page.getByRole("button", { name: SEND })).toHaveCount(0);
    await expect(s.assignee.page.getByRole("button", { name: /Create Outlook draft/ }).first()).toBeVisible(); // PHASE 10: label
  } finally {
    await s.closeAll();
  }
});
