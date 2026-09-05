import assert from "node:assert/strict";
import {
  WIP_CAP, PICK_CAP, STALE_DAYS, AUTO_PAUSE_DAYS,
  trackerEmails, canUseWork, isWorkLead,
  istDayKey, istDayStart, istWeekday, isWeekend, istWeekStart, istMonthStart, parseDayKey, addDays,
  daysUntouched, isStale, shouldAutoPause,
  nextStatus, actionForMove, actionsFor, wipAllows, wipAllowsMany,
  taskLane, awaitsReview, autoDone, keptPromise, precheckTaskIds, gateStep, eventLine,
  createWorkZ, picksZ, planZ,
} from "../src/lib/work/core";

// Access: env order decides the lead, matching is case-insensitive.
const emails = trackerEmails("Lead@Indefine.in, info@indefine.in ,");
assert.deepEqual(emails, ["lead@indefine.in", "info@indefine.in"]);
assert.equal(canUseWork("LEAD@indefine.in", emails), true);
assert.equal(canUseWork("someone@indefine.in", emails), false);
assert.equal(canUseWork(null, emails), false);
assert.equal(isWorkLead("lead@indefine.in", emails), true);
assert.equal(isWorkLead("info@indefine.in", emails), false);
assert.deepEqual(trackerEmails(undefined), []);

// IST clock. 2026-09-04 is a Friday; 18:30 UTC is midnight IST.
const friEvening = new Date("2026-09-04T13:00:00Z"); // 18:30 IST Friday
assert.equal(istDayKey(friEvening), "2026-09-04");
assert.equal(istDayKey(new Date("2026-09-04T18:29:59Z")), "2026-09-04");
assert.equal(istDayKey(new Date("2026-09-04T18:30:00Z")), "2026-09-05");
assert.equal(istDayStart(friEvening).toISOString(), "2026-09-03T18:30:00.000Z");
assert.equal(istWeekday(friEvening), 5);
assert.equal(isWeekend(friEvening), false);
assert.equal(isWeekend(new Date("2026-09-05T03:00:00Z")), true); // Saturday IST
assert.equal(isWeekend(new Date("2026-09-06T03:00:00Z")), true); // Sunday IST
assert.equal(istWeekStart(friEvening).toISOString(), "2026-08-30T18:30:00.000Z"); // Mon 31 Aug 00:00 IST
assert.equal(istWeekStart(new Date("2026-08-30T18:30:00Z")).toISOString(), "2026-08-30T18:30:00.000Z"); // Monday itself
assert.equal(istWeekStart(new Date("2026-09-06T18:29:00Z")).toISOString(), "2026-08-30T18:30:00.000Z"); // Sunday 23:59 IST, same week
assert.equal(istMonthStart(friEvening).toISOString(), "2026-08-31T18:30:00.000Z");
assert.equal(parseDayKey("2026-09-04")?.toISOString(), "2026-09-03T18:30:00.000Z");
assert.equal(parseDayKey("junk"), null);
assert.equal(parseDayKey(undefined), null);
assert.equal(addDays(istDayStart(friEvening), 7).toISOString(), "2026-09-10T18:30:00.000Z");

// Stale.
const now = new Date("2026-09-04T04:00:00Z");
assert.equal(daysUntouched(addDays(now, -13.9), now), 13);
assert.equal(daysUntouched(addDays(now, 5), now), 0);
assert.equal(isStale("ACTIVE", addDays(now, -13), now), false);
assert.equal(isStale("ACTIVE", addDays(now, -14), now), true);
assert.equal(isStale("PARKED", addDays(now, -40), now), false);
assert.equal(shouldAutoPause("ACTIVE", addDays(now, -27), now), false);
assert.equal(shouldAutoPause("ACTIVE", addDays(now, -28), now), true);
assert.equal(STALE_DAYS < AUTO_PAUSE_DAYS, true);

// Transitions.
assert.equal(nextStatus("activate", "INBOX"), "ACTIVE");
assert.equal(nextStatus("activate", "PARKED"), "ACTIVE");
assert.equal(nextStatus("activate", "DONE"), null);
assert.equal(nextStatus("pause", "ACTIVE"), "PARKED");
assert.equal(nextStatus("pause", "INBOX"), null);
assert.equal(nextStatus("finish", "ACTIVE"), "DONE");
assert.equal(nextStatus("finish", "INBOX"), null);
assert.equal(nextStatus("obsolete", "INBOX"), "OBSOLETE");
assert.equal(nextStatus("obsolete", "OBSOLETE"), null);
assert.equal(nextStatus("reopen", "DONE"), "ACTIVE");
assert.equal(nextStatus("reopen", "OBSOLETE"), "INBOX");
assert.equal(nextStatus("reopen", "ACTIVE"), null);
assert.equal(actionForMove("INBOX", "ACTIVE"), "activate");
assert.equal(actionForMove("ACTIVE", "DONE"), "finish");
assert.equal(actionForMove("DONE", "ACTIVE"), "reopen");
assert.equal(actionForMove("INBOX", "DONE"), null);
assert.equal(actionForMove("ACTIVE", "ACTIVE"), null);
assert.deepEqual(actionsFor("INBOX").map(([a]) => a), ["activate", "obsolete"]);
assert.deepEqual(actionsFor("PARKED")[0], ["activate", "Resume"]);
assert.deepEqual(actionsFor("INBOX")[0], ["activate", "Start"]);
assert.deepEqual(actionsFor("ACTIVE").map(([a]) => a), ["pause", "finish", "obsolete"]);
assert.deepEqual(actionsFor("DONE").map(([a]) => a), ["obsolete", "reopen"]);
assert.deepEqual(actionsFor("OBSOLETE").map(([a]) => a), ["reopen"]);
assert.equal(wipAllows(WIP_CAP - 1), true);
assert.equal(wipAllows(WIP_CAP), false);
assert.equal(wipAllowsMany(1, 2), true);
assert.equal(wipAllowsMany(1, 3), false);
assert.equal(wipAllowsMany(0, WIP_CAP), true);

// Task lanes and auto-done.
assert.equal(taskLane("TODO", false), "TODO");
assert.equal(taskLane("TODO", true), "TODAY");
assert.equal(taskLane("DONE", true), "DONE");
assert.equal(taskLane("DROPPED", false), "DONE");
const t = (status: "TODO" | "DONE" | "DROPPED", reviewed: boolean) => ({ status, reviewedAt: reviewed ? now : null });
assert.equal(awaitsReview(t("DONE", false)), true);
assert.equal(awaitsReview(t("DONE", true)), false);
assert.equal(awaitsReview(t("TODO", false)), false);
assert.equal(autoDone([]), false);
assert.equal(autoDone([t("DONE", true)]), true);
assert.equal(autoDone([t("DONE", true), t("TODO", false)]), false);
assert.equal(autoDone([t("DONE", false)]), false); // finished by Amit, lead has not reviewed
assert.equal(autoDone([t("DROPPED", false)]), false); // nothing actually done
assert.equal(autoDone([t("DONE", true), t("DROPPED", false)]), true);

// Score.
assert.equal(keptPromise([]), null);
assert.equal(keptPromise([{ outcome: null }]), null);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: "CARRIED" }, { outcome: "CARRIED" }, { outcome: "CARRIED" }]), 25);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: null }]), 100);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: "DONE" }, { outcome: "CARRIED" }]), 67);
assert.deepEqual(
  precheckTaskIds([
    { taskId: "a", outcome: "CARRIED", taskStatus: "TODO" },
    { taskId: "b", outcome: "CARRIED", taskStatus: "DONE" },
    { taskId: "c", outcome: "DONE", taskStatus: "TODO" },
  ]),
  ["a"],
);

// Gate.
assert.equal(gateStep({ weekend: true, hasOpenTasks: true, planned: false, picked: false, hasCandidates: true }), "today");
assert.equal(gateStep({ weekend: false, hasOpenTasks: false, planned: false, picked: false, hasCandidates: false }), "today");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: false, picked: false, hasCandidates: false }), "plan");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: false, hasCandidates: true }), "pick");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: false, hasCandidates: false }), "today"); // plan has no task for me
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: true, hasCandidates: true }), "today");

// Timeline lines.
assert.equal(eventLine({ kind: "TASK_DONE", detail: "Enable MFA", actor: "Amit" }), 'Amit finished "Enable MFA"');
assert.equal(eventLine({ kind: "AUTO_PAUSED", detail: "Untouched 28 days", actor: null }), "Paused automatically, untouched 28 days");
assert.equal(eventLine({ kind: "WORK_STATUS", detail: "Ideas → Working", actor: "Lakshmanan" }), "Lakshmanan moved it Ideas → Working");
assert.equal(eventLine({ kind: "CARRIED", detail: "Enable MFA", actor: null }), '"Enable MFA" carried over');

// Request bodies.
assert.equal(createWorkZ.safeParse({ title: "  " }).success, false);
assert.equal(createWorkZ.safeParse({ title: " XBRL " }).data?.title, "XBRL");
assert.equal(picksZ.safeParse({ taskIds: ["a", "b", "c", "d"] }).success, false);
assert.equal(picksZ.safeParse({ taskIds: [] }).success, false);
assert.equal(PICK_CAP, 3);
assert.equal(planZ.safeParse({ workIds: [] }).success, true);
assert.equal(planZ.safeParse({ workIds: ["a", "b", "c", "d"] }).success, false);

console.log("verify-work: all checks passed");
