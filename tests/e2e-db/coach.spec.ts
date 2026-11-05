// DEPENDS ON PHASE 9 MERGE (Daily Coach). Written against the orchestrator's Phase 9 brief before the
// pages exist: the selectors and the two route paths marked "PHASE 9:" below are to be confirmed
// after the merge (docs/qa/phase-12-runbook.md "after-merge e2e fix-ups"); the assertions are the
// acceptance criteria and should not need to change.
//
// Golden path (e) — morning board + reminder + break nudge:
//   · /dashboard shows the morning board card for the signed-in person: their open JobTasks ranked by
//     deadline proximity (statutory before internal, overdue first) — top 5 under "Must today", the
//     rest under "This week"; /coach shows the same board. Another person never sees these jobs.
//   · the reminder cron (T−2h before the internal due time, and T−30m) fired twice creates ONE
//     reminder for the assignee (CoachEvent.dedupeKey), shown on their dashboard.
//   · continuous activity > 100 min (heartbeats without a ≥ 10-min gap) → a gentle, dismissible break
//     nudge; dismiss hides it; opting out (CoachPreference.breakNudges = false) means none.
//
// Runs under `npm run e2e:db` (--repeat-each=3): fresh JobTasks per run (unique titles).
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_EMAIL, E2E_OTHER_STAFF_STATE, E2E_CLIENT_CODE, CRON_SECRET (the app's, to fire the cron).
// The app needs the Phase 9 flag on for these people (docs/go-live.md flag plan).
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { closeDb, freshJob, need, openDb, signedInAll, userByEmail, type FreshJob } from "./support";

const SPEC = "coach.spec.ts";
const COACH_REMINDER_CRON = "/api/cron/firm-os/coach?job=reminders"; // PHASE 9: confirm the cron route
const HEARTBEAT = "/api/firm-os/coach/heartbeat"; // PHASE 9: from the brief
const H = 3_600_000;
const D = 24 * H;

test.afterAll(closeDb);

const board = (page: import("@playwright/test").Page) => page.getByRole("region", { name: /Must today|Morning board/ }); // PHASE 9: card label

test("morning board: the assignee's open jobs, ranked, top 5 under Must today, the rest this week — on /dashboard and /coach, private to them", { tag: ["@after-merge", "@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const now = Date.now();
  const due = (ms: number) => new Date(now + ms);
  // Seven open jobs: two overdue, two due today, three later this week (statutory dates drive the rank).
  const plan: [string, number][] = [["Overdue A", -2 * D], ["Overdue B", -1 * D], ["Today A", 3 * H], ["Today B", 6 * H], ["Week A", 2 * D], ["Week B", 3 * D], ["Week C", 4 * D]];
  const jobs: FreshJob[] = [];
  for (const [label, offset] of plan) {
    jobs.push(await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: `Coach ${label}`, internalDueOn: due(offset - 2 * D), statutoryDueOn: due(offset), spec: SPEC }));
  }
  const s = await signedInAll(browser, ["assignee", "other"] as const, SPEC);
  try {
    await s.assignee.page.goto("/dashboard");
    const card = board(s.assignee.page);
    await expect(card).toBeVisible();
    const must = card.getByRole("list").first().getByRole("listitem");
    await expect(must).toHaveCount(5);
    const texts = await must.allTextContents();
    expect(texts.findIndex((t) => t.includes(jobs[0].title))).toBeLessThan(texts.findIndex((t) => t.includes(jobs[2].title))); // overdue before today
    expect(texts.join(" ")).not.toContain(jobs[6].title); // the furthest one is under "This week"
    await expect(card.getByText(/This week/)).toBeVisible();

    await s.assignee.page.goto("/coach");
    await expect(s.assignee.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(s.assignee.page.getByText(jobs[0].title)).toBeVisible();

    // Private: another staff member's board never lists these jobs.
    await s.other.page.goto("/coach");
    for (const j of jobs) await expect(s.other.page.getByText(j.title)).toHaveCount(0);
  } finally {
    await s.closeAll();
  }
});

test("reminder: the cron fired twice before T−2h creates one reminder for the assignee, shown on their dashboard", { tag: ["@after-merge", "@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const assignee = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  const job = await freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title: "Coach reminder", internalDueOn: new Date(Date.now() + 2 * H - 5 * 60_000), statutoryDueOn: new Date(Date.now() + 3 * D), spec: SPEC });
  const cron = await playwrightRequest.newContext({ baseURL: need("E2E_BASE_URL", SPEC), extraHTTPHeaders: { authorization: `Bearer ${need("CRON_SECRET", SPEC)}` } });
  try {
    const [a, b] = await Promise.all([cron.get(COACH_REMINDER_CRON), cron.get(COACH_REMINDER_CRON)]); // duplicate firing, same instant
    expect([a.status(), b.status()]).toEqual([200, 200]);
    expect((await cron.get(COACH_REMINDER_CRON)).status()).toBe(200); // and once more, later
    const reminders = await db.coachEvent.findMany({ where: { userId: assignee.id, jobTaskId: job.id, kind: "reminder" } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].dedupeKey).toBeTruthy();
    expect(await db.coachEvent.count({ where: { jobTaskId: job.id, kind: "escalation" } })).toBe(0); // not overdue → no escalation
  } finally {
    await cron.dispose();
  }
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  try {
    await s.assignee.page.goto("/dashboard");
    await expect(s.assignee.page.getByText(job.title).first()).toBeVisible();
  } finally {
    await s.closeAll();
  }
});

test("break nudge after > 100 min of continuous activity: gentle, dismissible; none once the person opts out", { tag: ["@after-merge", "@phase-9"] }, async ({ browser }) => {
  const db = openDb();
  const assignee = await userByEmail(db, "E2E_ASSIGNEE_EMAIL", SPEC);
  // Heartbeats every 5 minutes for the last 105 minutes (no ≥ 10-min gap).
  await db.activityHeartbeat.createMany({ data: Array.from({ length: 22 }, (_, i) => ({ userId: assignee.id, at: new Date(Date.now() - (105 - i * 5) * 60_000), source: "lms" })) });
  await db.coachPreference.upsert({ where: { userId: assignee.id }, create: { userId: assignee.id, breakNudges: true }, update: { breakNudges: true, snoozeUntil: null } });
  const s = await signedInAll(browser, ["assignee"] as const, SPEC);
  try {
    expect((await s.assignee.post(HEARTBEAT, {})).status()).toBeLessThan(300);
    await s.assignee.page.goto("/dashboard");
    const nudge = s.assignee.page.getByRole("status").filter({ hasText: /break/i }); // PHASE 9: nudge element
    await expect(nudge).toBeVisible();
    await expect(nudge).not.toContainText(/manager|report/i); // never framed as reported
    await nudge.getByRole("button", { name: /Dismiss|Not now|Close/ }).click();
    await expect(nudge).toHaveCount(0);
    expect(await db.coachEvent.count({ where: { userId: assignee.id, kind: "break", dismissedAt: { not: null } } })).toBeGreaterThan(0);

    // Opt out: no break nudge however long the activity runs.
    await db.coachPreference.update({ where: { userId: assignee.id }, data: { breakNudges: false } });
    await s.assignee.post(HEARTBEAT, {});
    await s.assignee.page.reload();
    await expect(s.assignee.page.getByRole("status").filter({ hasText: /break/i })).toHaveCount(0);
  } finally {
    await db.coachPreference.update({ where: { userId: assignee.id }, data: { breakNudges: true } }); // leave the account as found
    await s.closeAll();
  }
});
