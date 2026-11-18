// Golden path (e) — Phase 9 Daily Coach (merged 06 Nov 2026; selectors confirmed against src/app/coach,
// src/app/coach/CoachCard.tsx and src/components/ActivityPing.tsx):
//   · morning board: /dashboard shows the "My day" card for a person with open Firm OS jobs; /coach
//     lists them ranked — "Must today" (at most 5, the rest counted and listed under Everything else)
//     and "This week". Another person never sees them (coach data is personal).
//   · reminder cron fired three times at once → ONE escalation for an overdue job (one per job per IST
//     day, CoachEvent.dedupeKey), shown to the reviewer under Notices on /coach. The T−2h / T−30m
//     reminder slots depend on the clock (16:00 / 17:30 IST before an 18:00 internal due moment) and
//     are covered with a controlled clock in tests/chaos/coach-reminders-duplicate-cron.test.ts.
//   · break nudge (FIRM_OS_BREAK_NUDGE on): > 100 min of continuous activity → a gentle "Break
//     reminder" that never takes focus; Dismiss closes it; turned off, no heartbeat is even stored.
//
// The board subject is E2E_OTHER_STAFF (rbac.spec.ts seeds nothing for them, so their board holds only
// coach jobs); the assignee is the "someone else" for the privacy check. Runs under `npm run e2e:db`
// (--repeat-each=3): fresh JobTasks with unique titles per run.
// RUN WITHIN IST WORKING TIME (Mon–Sat 09:00–19:00): the reminder cron does nothing outside it.
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_OTHER_STAFF_STATE + E2E_OTHER_STAFF_EMAIL,
// E2E_ASSIGNEE_STATE, E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_CLIENT_CODE, CRON_SECRET (the
// app's). App: FIRM_OS_BREAK_NUDGE=1 on staging (break test).
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { closeDb, freshJob, need, openDb, signedInAll, userByEmail, type FreshJob } from "./support";

const SPEC = "coach.spec.ts";
const REMINDER_CRON = "/api/cron/firm-os/coach?job=reminders";
const HEARTBEAT = "/api/firm-os/coach/heartbeat";
const D = 24 * 3_600_000;
const subject = { assigneeEnv: "E2E_OTHER_STAFF_EMAIL" as const, spec: SPEC };

test.afterAll(closeDb);

test("morning board: My day on /dashboard, ranked Must today (≤ 5) and This week on /coach, private to the person", { tag: ["@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const now = Date.now();
  const jobs: FreshJob[] = [];
  // Six overdue jobs (more than Must today shows) and two due later this week.
  for (let i = 1; i <= 6; i++) {
    jobs.push(await freshJob(db, { ...subject, service: "GST", fy: "2026-27", period: "2026-10", title: `Coach overdue ${i}`, internalDueOn: new Date(now - (i + 2) * D), statutoryDueOn: new Date(now - i * D) }));
  }
  for (let i = 1; i <= 2; i++) {
    jobs.push(await freshJob(db, { ...subject, service: "GST", fy: "2026-27", period: "2026-10", title: `Coach week ${i}`, internalDueOn: new Date(now + (i + 2) * D), statutoryDueOn: new Date(now + (i + 4) * D) }));
  }
  const s = await signedInAll(browser, ["other", "assignee"] as const, SPEC);
  try {
    await s.other.page.goto("/dashboard");
    const card = s.other.page.getByRole("region", { name: "My day" });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Must today · \d+/);
    await expect(card.getByRole("link", { name: "Open My day" })).toBeVisible();

    await s.other.page.goto("/coach");
    await expect(s.other.page.getByRole("heading", { level: 1, name: "My day" })).toBeVisible();
    const must = s.other.page.getByRole("region", { name: "Must today" });
    await expect(must.locator("tbody tr")).toHaveCount(5); // capped …
    await expect(must).toContainText(/\d+ more must be done today, listed under Everything else\./); // … the rest counted
    const mustText = (await must.textContent()) ?? "";
    expect(jobs.slice(0, 6).some((j) => mustText.includes(j.title)), "an overdue coach job is in Must today").toBe(true);
    expect(jobs.slice(6).some((j) => mustText.includes(j.title)), "this-week jobs are not in Must today").toBe(false);
    await expect(s.other.page.getByRole("region", { name: "This week" })).toBeVisible();

    // Private: someone else's /coach never lists these jobs.
    await s.assignee.page.goto("/coach");
    const theirs = (await s.assignee.page.locator("body").textContent()) ?? "";
    for (const j of jobs) expect(theirs).not.toContain(j.title);
  } finally {
    await s.closeAll();
  }
});

test("reminder cron fired three times at once: one escalation for an overdue job, shown to the reviewer", { tag: ["@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const reviewer = await userByEmail(db, "E2E_REVIEWER_EMAIL", SPEC);
  const job = await freshJob(db, { ...subject, service: "GST", fy: "2026-27", period: "2026-10", title: "Coach escalation", internalDueOn: new Date(Date.now() - 2 * D), statutoryDueOn: new Date(Date.now() + 5 * D) });
  const cron = await playwrightRequest.newContext({ baseURL: need("E2E_BASE_URL", SPEC), extraHTTPHeaders: { authorization: `Bearer ${need("CRON_SECRET", SPEC)}` } });
  try {
    const all = await Promise.all([cron.get(REMINDER_CRON), cron.get(REMINDER_CRON), cron.get(REMINDER_CRON)]);
    expect(all.map((r) => r.status())).toEqual([200, 200, 200]);
    const first = (await all[0].json()) as { skipped?: string };
    expect(first.skipped, "run e2e:db within IST working time (Mon–Sat 09:00–19:00)").toBeUndefined();
    const escalations = await db.coachEvent.findMany({ where: { jobTaskId: job.id, kind: "escalation" } });
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ userId: reviewer.id });
    expect(escalations[0].dedupeKey).toBeTruthy();
    expect((escalations[0].payload as { reason?: string }).reason).toBe("internal-overdue");
    expect(await db.auditEvent.count({ where: { entity: "JobTask", entityId: job.id, action: "escalate" } })).toBe(1);
  } finally {
    await cron.dispose();
  }
  const s = await signedInAll(browser, ["reviewer"] as const, SPEC);
  try {
    await s.reviewer.page.goto("/coach");
    await expect(s.reviewer.page.getByRole("region", { name: "Notices" })).toContainText(job.title);
  } finally {
    await s.closeAll();
  }
});

test("break nudge after > 100 min of continuous activity: gentle, dismissible; turned off, nothing is stored", { tag: ["@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const me = await userByEmail(db, "E2E_OTHER_STAFF_EMAIL", SPEC);
  await db.coachPreference.upsert({ where: { userId: me.id }, create: { userId: me.id, breakNudges: true }, update: { breakNudges: true, snoozeUntil: null } });
  // Heartbeats every 5 minutes for the last 105 minutes (no ≥ 10-minute gap).
  await db.activityHeartbeat.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ userId: me.id, at: new Date(Date.now() - (105 - i * 5) * 60_000), source: "lms" })) });
  const s = await signedInAll(browser, ["other"] as const, SPEC);
  const page = s.other.page;
  try {
    await page.goto("/dashboard");
    await page.mouse.move(200, 200); // recent input: ActivityPing sends a heartbeat while the tab is in use
    await page.keyboard.press("Shift");
    const nudge = page.getByRole("region", { name: "Break reminder" });
    await expect(nudge).toBeVisible({ timeout: 90_000 });
    await expect(nudge).not.toContainText(/manager|report/i); // never framed as reported to anyone
    await nudge.getByRole("button", { name: "Dismiss" }).click();
    await expect(nudge).toHaveCount(0);
    await expect.poll(async () => db.coachEvent.count({ where: { userId: me.id, kind: "break", dismissedAt: { not: null } } })).toBeGreaterThan(0);

    // Turned off: the heartbeat stores nothing and returns no nudge.
    await db.coachPreference.update({ where: { userId: me.id }, data: { breakNudges: false } });
    const before = await db.activityHeartbeat.count({ where: { userId: me.id } });
    const r = await s.other.post(HEARTBEAT);
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ recorded: false, nudge: null });
    expect(await db.activityHeartbeat.count({ where: { userId: me.id } })).toBe(before);
  } finally {
    await db.coachPreference.update({ where: { userId: me.id }, data: { breakNudges: true } }); // leave the account as found
    await s.closeAll();
  }
});
