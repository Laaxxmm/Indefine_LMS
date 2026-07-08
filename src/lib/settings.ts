// App-wide settings, stored as a single row (id = 1). Currently holds the
// default quiz timing/pass applied to newly auto-generated quizzes so admins
// don't have to configure each of dozens of quizzes by hand.

import { prisma } from "@/lib/prisma";

export async function getSettings() {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: 1 } });
}

// The fields a freshly-created Quiz should inherit from the global defaults.
export async function getQuizDefaults(): Promise<{
  timeLimitSec: number;
  passPercent: number;
  unlockAtPercent: number;
}> {
  const s = await getSettings();
  return {
    timeLimitSec: s.quizTimeLimitSec,
    passPercent: s.quizPassPercent,
    unlockAtPercent: s.quizUnlockAtPercent,
  };
}
