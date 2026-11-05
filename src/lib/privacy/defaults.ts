// Production dependencies for the privacy and breach services: Prisma and the real clock. Routes
// call these; tests pass their own fake database and clock.
import type { BreachDeps } from "./breach";
import type { PrivacyDeps } from "./register";
import type { CorrectionDeps } from "@/lib/corrections/service";

export async function privacyDeps(): Promise<PrivacyDeps> {
  const { prisma } = await import("@/lib/prisma");
  return { db: prisma, now: () => new Date() };
}

export async function breachDeps(): Promise<BreachDeps> {
  const { prisma } = await import("@/lib/prisma");
  return { db: prisma, now: () => new Date() };
}

export async function privacyCorrectionDeps(): Promise<PrivacyDeps & { corrections: CorrectionDeps }> {
  const { defaultCorrectionDeps } = await import("@/lib/corrections/service");
  return { ...(await privacyDeps()), corrections: await defaultCorrectionDeps() };
}
