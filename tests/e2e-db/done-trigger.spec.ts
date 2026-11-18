// ADR-005 database backstop against a real Postgres: the "JobTask_done_guard" trigger
// (prisma/migrations/20261106000000_firm_os_done_trigger) refuses an UPDATE into DONE unless the
// transaction armed firm_os.close_gate for that job, as src/lib/agents/core/state-db.ts does for the
// close gate. Unit tests cover the hook with fakes; this spec is the only check of the trigger itself.
//
// Needs only DATABASE_URL pointing at a database with all migrations applied (no app, no session):
//   DATABASE_URL=… npx playwright test --config playwright.db.config.ts done-trigger
// Everything it creates is inside one transaction that is rolled back at the end: it leaves no rows,
// so it is safe on staging (nothing to clean up, nothing deleted).
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

class Rollback extends Error {}

test("a direct UPDATE to DONE is refused, a gate armed for another job is refused, the gate's set_config for this job is accepted", async () => {
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const outcome: { direct?: string; otherJob?: string; gated?: string; notDone?: string } = {};
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "allowed";
    } catch (e) {
      return (e as Error).message;
    }
  };
  try {
    await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({ data: { email: `e2e-done-trigger-${tag}@example.invalid`, name: "E2E DONE trigger", active: false } });
        const client = await tx.client.create({
          data: {
            name: `E2E DONE trigger ${tag}`,
            folderName: `E2E DONE trigger ${tag}`,
            entityType: "PROPRIETORSHIP",
            turnover: 0,
            turnoverBand: "UNDER_40L",
            growthGoal: "EXPORT",
            onboardedOn: new Date(),
            primaryHandlerId: user.id,
            createdById: user.id,
            active: false,
          },
        });
        const fc = await tx.firmClient.create({ data: { lmsClientId: client.id, clientCode: `E2ET${tag}`.slice(0, 10) } });
        const job = await tx.jobTask.create({ data: { firmClientId: fc.id, service: "GST", fy: "2026-27", period: "2026-10", title: "E2E DONE trigger", state: "CLOSING" } });
        const toDone = () => tx.jobTask.update({ where: { id: job.id }, data: { state: "DONE", doneAt: new Date() } });

        // 1. Not armed: refused. (A failed statement aborts the transaction, hence the savepoints.)
        await tx.$executeRawUnsafe("SAVEPOINT direct");
        outcome.direct = await attempt(toDone);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT direct");

        // 2. Armed for another job: refused.
        await tx.$executeRawUnsafe("SAVEPOINT other");
        await tx.$queryRaw`SELECT set_config('firm_os.close_gate', ${"some-other-job"}, true)`;
        outcome.otherJob = await attempt(toDone);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT other");

        // 3. A non-DONE state change needs nothing.
        outcome.notDone = await attempt(() => tx.jobTask.update({ where: { id: job.id }, data: { state: "APPROVED" } }));
        await tx.jobTask.update({ where: { id: job.id }, data: { state: "CLOSING" } });

        // 4. Armed for this job, as state-db.ts does inside the gate's transaction: accepted.
        await tx.$queryRaw`SELECT set_config('firm_os.close_gate', ${job.id}, true)`;
        outcome.gated = (await toDone()).state;

        throw new Rollback(); // leave nothing behind
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  expect(outcome.direct).toMatch(/may enter DONE only through the close-loop gate/);
  expect(outcome.otherJob).toMatch(/may enter DONE only through the close-loop gate/);
  expect(outcome.notDone).toBe("allowed");
  expect(outcome.gated).toBe("DONE");
});
