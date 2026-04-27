// Snapshot freezing — preserves per-quarter scores and tiers so historical
// trends survive when targets / weights change later in the cycle.
//
// Workflow:
//   admin closes Q1 → freezeQuarter(cycle.id, 1) writes TrackSnapshot +
//   TierAssignment rows for every active user.
//   admin closes the cycle → closeCycle() runs freezeQuarter for all 4
//   quarters and marks the cycle inactive.

import { prisma } from "@/lib/prisma";
import { computeTrajectory } from "@/lib/trajectory";

export interface FreezeResult {
  users: number;
  snapshotsWritten: number;
  tiersWritten: number;
}

export async function freezeQuarter(
  cycleId: string,
  quarter: number
): Promise<FreezeResult> {
  if (quarter < 1 || quarter > 4) throw new Error("Quarter must be 1-4");

  const cycle = await prisma.performanceCycle.findUnique({
    where: { id: cycleId },
  });
  if (!cycle) throw new Error("Cycle not found");

  // Only snapshot active users — inactive users keep whatever they had.
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true },
  });

  let snapshotsWritten = 0;
  let tiersWritten = 0;

  for (const u of users) {
    const t = await computeTrajectory(u.id);

    for (const tr of t.tracks) {
      await prisma.trackSnapshot.upsert({
        where: {
          userId_cycleId_quarter_trackKind: {
            userId: u.id,
            cycleId,
            quarter,
            trackKind: tr.kind,
          },
        },
        create: {
          userId: u.id,
          cycleId,
          quarter,
          trackKind: tr.kind,
          actual: tr.actual,
          scorePct: tr.scorePct,
          weighted: tr.weighted,
        },
        update: {
          actual: tr.actual,
          scorePct: tr.scorePct,
          weighted: tr.weighted,
        },
      });
      snapshotsWritten++;
    }

    await prisma.tierAssignment.upsert({
      where: {
        userId_cycleId_quarter: {
          userId: u.id,
          cycleId,
          quarter,
        },
      },
      create: {
        userId: u.id,
        cycleId,
        quarter,
        tier: t.tier,
        totalScore: t.totalScore,
      },
      update: {
        tier: t.tier,
        totalScore: t.totalScore,
      },
    });
    tiersWritten++;
  }

  return { users: users.length, snapshotsWritten, tiersWritten };
}

export async function closeCycle(cycleId: string) {
  // Freeze all 4 quarters then deactivate the cycle.
  for (let q = 1; q <= 4; q++) {
    await freezeQuarter(cycleId, q);
  }
  await prisma.performanceCycle.update({
    where: { id: cycleId },
    data: { isActive: false },
  });
}
