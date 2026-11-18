// Golden path (a) — Phase 3 / Phase 12: a partner onboards a client in one plain-English sentence →
// answers at most two rounds of questions → the plan preview names the CL-{Code} site, the Turia
// steps and the jobs → Create → the saga runs: LMS client, Turia through the MANUAL bridge (numbered
// checklists with prefilled values, one per operation, confirmed with "Done in Turia"), the CL- site
// and FY tree, JobTasks with statutory due dates assigned to the assignee — who sees them on /agents.
//
// Runs under `npm run e2e:db` (playwright.db.config.ts, --repeat-each=3) against staging; a fresh
// client code per run, so repeats never collide. Firm OS files nothing and sends nothing.
//
// Environment (tests/e2e-db/support/env.ts, docs/qa/phase-12-runbook.md):
//   E2E_BASE_URL, DATABASE_URL
//   E2E_PARTNER_STATE      storageState of a signed-in PARTNER (onboards)
//   E2E_ASSIGNEE_STATE     storageState of the staff member the sentence assigns
//   E2E_ASSIGNEE_EMAIL     that person's LMS email;  E2E_ASSIGNEE_NAME their display name (default "Priya")
//   E2E_REVIEWER_NAME      display name of the reviewer (default "Ravi")
// SharePoint: with SP_PNP_* set on the app, the CL- site and FY tree are created; without them the
// SharePoint step is BLOCKED with the exact action (accepted below, reported in PROGRESS).
// The app needs ANTHROPIC_API_KEY for the sentence to be read; without it the clarifier asks every
// field (the answers cover them), so the spec passes either way.
import { expect, test } from "@playwright/test";
import { closeDb, createFromPlan, onboardToPlan, openDb, runTag, signedIn, userByEmail } from "./support";

const SPEC = "onboard.spec.ts";

test.afterAll(closeDb);

test("partner onboards a client: sentence → ≤ 2 rounds → plan → Create → Turia manual checklists + CL-{Code} + jobs for the assignee", async ({ browser }) => {
  const db = openDb();
  const code = `E2E${runTag().slice(-6)}`; // 3–10 A–Z0–9, fresh per run
  const legalName = `E2E Fixture Widgets ${code} Pvt Ltd`;
  const partner = await signedIn(browser, "partner", SPEC);
  const page = partner.page;

  const plan = await onboardToPlan(page, code, legalName);
  await expect(plan).toContainText(code);
  await expect(plan).toContainText(`https://srcaassociate.sharepoint.com/sites/CL-${code}`);
  await expect(plan).toContainText("GSTR-3B");
  await expect(page.getByRole("button", { name: /submit to portal|^send/i })).toHaveCount(0);
  await createFromPlan(page);

  // Turia, MANUAL bridge: a checklist per operation, nothing written to Turia by Firm OS.
  const turia = page.getByRole("region", { name: /^Turia — / });
  await expect(turia).toContainText(`Create client ${code} in Turia`);
  await expect(turia).toContainText("checklists to complete");

  const fc = await db.firmClient.findUniqueOrThrow({ where: { clientCode: code } });
  const syncs = await db.turiaSync.findMany({ where: { firmClientId: fc.id } });
  expect(syncs.filter((s) => s.operation === "createClient")).toHaveLength(1);
  expect(syncs.filter((s) => s.operation === "addService")).toHaveLength(3); // GST, ROC, Books
  expect(syncs.every((s) => s.mode === "MANUAL" && s.status === "CHECKLIST_ISSUED")).toBe(true);
  const createClient = syncs.find((s) => s.operation === "createClient")!;
  expect(JSON.stringify(createClient.evidence)).toContain(code); // prefilled values in the checklist

  // A person completes the "Create client" checklist in Turia and confirms it here.
  const card = page.getByRole("article").filter({ hasText: `Create client ${code} in Turia` });
  await card.getByLabel("Turia client ref").fill(`TUR-${code}`);
  await card.getByRole("button", { name: "Done in Turia" }).click();
  await expect(card).toContainText(`Done in Turia · TUR-${code}`);
  await expect.poll(async () => (await db.turiaSync.findUniqueOrThrow({ where: { id: createClient.id } })).status).toBe("CONFIRMED");
  expect((await db.turiaSync.findUniqueOrThrow({ where: { id: createClient.id } })).turiaRef).toBe(`TUR-${code}`);

  // SharePoint: the CL- site + FY tree (or BLOCKED with the exact action when PnP is not configured).
  const run = await db.onboardingRun.findFirstOrThrow({ where: { firmClientId: fc.id }, orderBy: { createdAt: "desc" } });
  const sp = (run.steps as { key: string; status: string; action?: string }[]).find((s) => s.key === "sharepoint")!;
  if (sp.status === "done") expect((await db.firmClient.findUniqueOrThrow({ where: { id: fc.id } })).clSiteUrl).toBe(`https://srcaassociate.sharepoint.com/sites/CL-${code}`);
  else expect(sp, "SharePoint step BLOCKED with the human action (no PnP certificate on this app)").toMatchObject({ status: "blocked", action: expect.stringMatching(/SP_PNP|consent|hub/i) });

  // Jobs: assigned to the assignee, ASSIGNED, created with an event, statutory dates from the calendar.
  const assignee = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  const tasks = await db.jobTask.findMany({ where: { firmClientId: fc.id }, include: { events: true } });
  expect(tasks.length).toBeGreaterThan(10);
  expect(tasks.every((t) => t.assigneeId === assignee.id && t.state === "ASSIGNED")).toBe(true);
  expect(tasks.every((t) => t.events.some((e) => e.fromState === null && e.toState === "ASSIGNED"))).toBe(true);
  const g1 = tasks.find((t) => t.title === "GSTR-1" && t.period === "2026-11");
  expect(g1?.statutoryDueOn?.toISOString()).toBe(new Date("2026-12-11T00:00:00+05:30").toISOString());
  expect(await db.turiaSync.count({ where: { firmClientId: fc.id, operation: "createTask" } })).toBeGreaterThan(0); // first period of each series
  await partner.close();

  // The assignee sees the jobs on /agents ("Waiting for you"), with Run agent where an agent exists.
  const staff = await signedIn(browser, "assignee", SPEC);
  await staff.page.goto("/agents");
  await expect(staff.page.getByRole("heading", { name: "Waiting for you" })).toBeVisible();
  await expect(staff.page.getByRole("row").filter({ hasText: code }).first()).toBeVisible();
  await expect(staff.page.getByRole("button", { name: new RegExp(`^Run agent on .* for ${code}$`) }).first()).toBeVisible();
  await staff.close();
});
