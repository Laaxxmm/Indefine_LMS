// Golden path (d) — Phase 8 / Phase 12: close-loop NEGATIVE cases on staging, through the real
// routes, gate and live SharePoint check (ADR-005: a job is not done unless the Final file is in the
// right CL-{Code} folder AND the Turia task is closed with time logged):
//   1. Final file missing          → filed + Turia closed, still CLOSING; the gate names the Final file
//   2. Turia close not recorded    → filed with the Final file present, still CLOSING; DONE via /state
//                                    is 403; recording the Turia close then closes it (DONE once)
//   3. Final file at the wrong path → still CLOSING; the gate names the path
//   4. /state DONE                  → 403 gate-required for assignee, reviewer, manager and partner
// The positive UI path (run → approve → Mark filed → Record Turia close → DONE) is golden-path.spec.ts.
//
// These jobs are prepared by hand (IN_PREP → IN_REVIEW, no agent run) and driven through the job API
// as each person (their own signed-in request context) — the same routes the review screen calls.
// Runs under `npm run e2e:db` (--repeat-each=3): a fresh JobTask per test, Final files create-only.
//
// Environment: E2E_BASE_URL, DATABASE_URL, E2E_ASSIGNEE_STATE + E2E_ASSIGNEE_EMAIL,
// E2E_REVIEWER_STATE + E2E_REVIEWER_EMAIL, E2E_MANAGER_STATE, E2E_PARTNER_STATE, E2E_CLIENT_CODE,
// MS_* (+ SP_PNP_*) in this process and on the app (Final files are put in SharePoint and the gate
// checks them live).
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { closeDb, expectJobState, expectNotDone, freshJob, openDb, putFinalFile, runTag, signedInAll, type FreshJob, type Session } from "./support";

const SPEC = "close-loop.spec.ts";
const ARN = () => `AA2910260${runTag().slice(-6)}`;

test.afterAll(closeDb);

/** ASSIGNED → IN_PREP → IN_REVIEW (assignee, manual prep) → APPROVED (reviewer), through /state. */
async function approvedByHand(assignee: Session, reviewer: Session, job: FreshJob) {
  const step = async (who: Session, to: string, expectedState: string) => {
    const r = await who.post(`/api/firm-os/jobs/${job.id}/state`, { to, expectedState });
    expect(r.status(), `${who.role}: ${expectedState} → ${to} (${await r.text()})`).toBe(200);
  };
  await step(assignee, "IN_PREP", "ASSIGNED");
  await step(assignee, "IN_REVIEW", "IN_PREP");
  await step(reviewer, "APPROVED", "IN_REVIEW");
}

/** Record a Final file the way approval does: the bytes in SharePoint + a Deliverable row. */
async function recordFinal(db: PrismaClient, job: FreshJob, opts: { period?: string } = {}) {
  const bytes = Buffer.from(`e2e final pack ${job.title}`);
  const stored = await putFinalFile(job, `${job.clientCode}_E2E-pack_${job.period}_v1.xlsx`, bytes, opts);
  await db.deliverable.create({
    data: {
      jobTaskId: job.id, kind: "Final", name: stored.fileName, spPath: stored.spPath, driveId: stored.driveId, driveItemId: stored.item.id,
      sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, version: stored.version,
    },
  });
}

const gstJob = (db: PrismaClient, title: string) => freshJob(db, { service: "GST", fy: "2026-27", period: "2026-10", title, spec: SPEC });

test("Final file missing: filed and Turia closed, the job stays CLOSING and the gate names the missing Final file", async ({ browser }) => {
  const db = openDb();
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const job = await gstJob(db, "GSTR-3B no-final");
    await approvedByHand(s.assignee, s.reviewer, job); // no agent run → nothing copied to Final

    const filed = await s.assignee.post(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: ARN(), turiaTaskRef: `TT-${job.id.slice(-6)}`, minutes: 45 });
    expect(filed.status()).toBe(200);
    expect(await filed.json()).toMatchObject({ state: "CLOSING" });

    const again = await s.assignee.post(`/api/firm-os/jobs/${job.id}/turia-close`, { turiaTaskRef: `TT-${job.id.slice(-6)}`, minutes: 45 });
    expect(again.status()).toBe(200);
    const body = (await again.json()) as { close: { ok: boolean; missing?: Record<string, boolean>; reasons?: string[] } };
    expect(body.close.ok).toBe(false);
    expect(body.close.missing).toMatchObject({ finalFile: true, turiaClose: false });
    expect(JSON.stringify(body.close.reasons)).toMatch(/Final/);

    await expectJobState(db, job.id, "CLOSING");
    await expectNotDone(db, job.id);
    expect(await db.turiaSync.count({ where: { jobTaskId: job.id, operation: "closeTask", status: "CLOSED" } })).toBe(1); // Turia WAS recorded
    expect(await db.auditEvent.count({ where: { entity: "JobTask", entityId: job.id, action: "close-refused" } })).toBeGreaterThan(0);
  } finally {
    await s.closeAll();
  }
});

test("Turia close not recorded: CLOSING with the Final file in place, DONE through /state is 403; recording the close then sets DONE once", async ({ browser }) => {
  const db = openDb();
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const job = await gstJob(db, "GSTR-3B no-turia");
    await approvedByHand(s.assignee, s.reviewer, job);
    await recordFinal(db, job);

    const filed = await s.assignee.post(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: ARN() });
    expect(filed.status()).toBe(200);
    await expectJobState(db, job.id, "CLOSING");

    const refused = await s.assignee.post(`/api/firm-os/jobs/${job.id}/state`, { to: "DONE", expectedState: "CLOSING" });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "gate-required" });
    await expectNotDone(db, job.id);

    const closed = await s.assignee.post(`/api/firm-os/jobs/${job.id}/turia-close`, { turiaTaskRef: `TT-${job.id.slice(-6)}`, minutes: 60 });
    expect(closed.status()).toBe(200);
    expect(await closed.json()).toMatchObject({ close: { ok: true } });
    await expectJobState(db, job.id, "DONE");
    expect(await db.jobTaskEvent.count({ where: { jobTaskId: job.id, toState: "DONE" } })).toBe(1);
    expect(await db.jobTaskEvent.findFirst({ where: { jobTaskId: job.id, toState: "DONE" } })).toMatchObject({ fromState: "CLOSING", actorId: "system:close-gate" });
  } finally {
    await s.closeAll();
  }
});

test("Final file at the wrong path (another period's Final folder): stays CLOSING; the gate names the path", async ({ browser }) => {
  const db = openDb();
  const s = await signedInAll(browser, ["assignee", "reviewer"] as const, SPEC);
  try {
    const job = await gstJob(db, "GSTR-3B wrong-path");
    await approvedByHand(s.assignee, s.reviewer, job);
    await recordFinal(db, job, { period: "2026-09" });

    await s.assignee.post(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: ARN() });
    const r = await s.assignee.post(`/api/firm-os/jobs/${job.id}/turia-close`, { turiaTaskRef: `TT-${job.id.slice(-6)}`, minutes: 30 });
    const body = (await r.json()) as { close: { ok: boolean; missing?: Record<string, boolean>; reasons?: string[] } };
    expect(body.close.ok).toBe(false);
    expect(body.close.missing?.finalFile).toBe(true);
    expect(JSON.stringify(body.close.reasons)).toMatch(/path|folder|2026-10/i);
    await expectJobState(db, job.id, "CLOSING");
    await expectNotDone(db, job.id);
  } finally {
    await s.closeAll();
  }
});

test("DONE through /state is refused (403 gate-required) for the assignee, reviewer, manager and partner — and audited", async ({ browser }) => {
  const db = openDb();
  const s = await signedInAll(browser, ["assignee", "reviewer", "manager", "partner"] as const, SPEC);
  try {
    const job = await gstJob(db, "GSTR-3B done-refused");
    await approvedByHand(s.assignee, s.reviewer, job);
    await recordFinal(db, job);
    await s.assignee.post(`/api/firm-os/jobs/${job.id}/filed`, { ackRef: ARN() });
    await expectJobState(db, job.id, "CLOSING");
    for (const who of [s.assignee, s.reviewer, s.manager, s.partner]) {
      const r = await who.post(`/api/firm-os/jobs/${job.id}/state`, { to: "DONE", expectedState: "CLOSING" });
      expect(r.status(), `${who.role}`).toBe(403);
      expect(await r.json()).toMatchObject({ code: "gate-required" });
    }
    await expectNotDone(db, job.id);
    expect(await db.auditEvent.count({ where: { entity: "JobTask", entityId: job.id, action: "done-refused" } })).toBe(4);
  } finally {
    await s.closeAll();
  }
});
