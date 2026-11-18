// Golden path (f) — Phase 10 client comms drafts (merged 06 Nov 2026; selectors confirmed against
// src/app/comms/** and the engagement-letter Outlook-draft change, owner decision 2026-11-05):
//   · staff draft a "Documents needed" message for one of their jobs → the draft page shows subject
//     and body, no full PAN in it → "Open in Outlook draft" creates a draft in the person's OWN
//     mailbox (CommsDraft.outlookDraftId recorded) → no Send control anywhere; "Copy" is there.
//   · engagement letters: the old send route is gone (404/405) and the page has no Send button; the
//     emails are "Create Outlook draft" (unit-tested in tests/unit/routes/el-outlook-draft.test.ts).
// "Never sends" is asserted on the UI (no send control), the recorded draft id and the routes; the
// code has no send path at all (tests/unit/no-send.test.ts, repo scan).
//
// Runs under `npm run e2e:db` (--repeat-each=3): a fresh job per run.
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL, E2E_REVIEWER_EMAIL,
// E2E_CLIENT_CODE. The Outlook step needs the delegated Mail.ReadWrite consent on the Entra app and
// the assignee signed in after it (PROGRESS Blocked: "Outlook drafts Blocked on Mail.ReadWrite consent").
import { expect, test } from "@playwright/test";
import { closeDb, freshJob, openDb, signedInAll, userByEmail } from "./support";

const SPEC = "comms.spec.ts";
const SEND = /^send\b|send (now|email|to client)|send mail/i;
const FULL_PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
test.afterAll(closeDb);

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3_600_000).toISOString().slice(0, 10);

test("comms: Documents needed for a job → draft → Open in Outlook draft → a draft in the person's own mailbox, never sent", { tag: ["@phase-10"] }, async ({ browser }) => {
  const db = openDb();
  const me = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  const job = await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B comms", spec: SPEC });
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  const page = s.assignee.page;
  try {
    await page.goto("/comms");
    await expect(page.getByRole("heading", { level: 1, name: "Client messages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: SEND })).toHaveCount(0);

    await page.goto(`/comms/new?job=${job.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "New client message" })).toBeVisible();
    await page.getByRole("radio", { name: /Documents needed/ }).check();
    await page.getByLabel("Another document").fill("Bank statement for October 2026");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Reply needed by").fill(inAWeek());
    await page.getByRole("button", { name: "Prepare draft" }).click();
    await page.waitForURL(/\/comms\/[A-Za-z0-9_-]+$/, { timeout: 120_000 });
    const draftId = new URL(page.url()).pathname.split("/").pop()!;

    const subject = page.getByRole("region", { name: "Subject" });
    await expect(subject).toBeVisible();
    const pageText = (await page.locator("body").textContent()) ?? "";
    expect(pageText).toContain("Bank statement for October 2026");
    expect(pageText).not.toMatch(FULL_PAN); // PAN only when the client asked, and then masked to the last 4
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(page.getByRole("button", { name: SEND })).toHaveCount(0);
    await expect(page.getByRole("link", { name: SEND })).toHaveCount(0);

    await page.getByRole("button", { name: "Open in Outlook draft" }).click();
    await expect(page.getByRole("status")).toContainText("The draft is in the Drafts folder of your Outlook mailbox", { timeout: 60_000 });
    const row = await db.commsDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(row).toMatchObject({ createdById: me.id, jobTaskId: job.id, kind: "doc-chase" });
    expect(row.outlookDraftId, "draft created in the person's own mailbox").toBeTruthy();
    expect(row.body).not.toMatch(FULL_PAN);
    await expect(page.getByRole("button", { name: SEND })).toHaveCount(0);
  } finally {
    await s.closeAll();
  }
});

test("engagement letters: the send route is gone and the page has no Send button (Outlook drafts only)", { tag: ["@phase-10"] }, async ({ browser }) => {
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  try {
    await s.assignee.page.goto("/tools/office-tools/engagement-letter");
    await expect(s.assignee.page.getByRole("heading", { name: "Engagement letters" })).toBeVisible();
    await expect(s.assignee.page.getByRole("button", { name: SEND })).toHaveCount(0);
    const old = await s.assignee.post("/api/tools/engagement-letters/e2e-probe/send", { kind: "draft" });
    expect([404, 405]).toContain(old.status());
  } finally {
    await s.closeAll();
  }
});
