// Production dependencies for the privacy and breach services: Prisma, the real clock and the
// shared identifier-search limiter (the database one) for the default locator
// (identifierPrincipalLocator over findByIdentifier). Routes call these; tests pass their own fake
// database, clock and limiter.
import type { BreachDeps } from "./breach";
import type { PrivacyDeps } from "./register";
import type { CorrectionDeps } from "@/lib/corrections/service";

export async function privacyDeps(): Promise<PrivacyDeps> {
  const [{ prisma }, { identifierRateLimiter }] = await Promise.all([import("@/lib/prisma"), import("@/lib/search/rate-limit")]);
  return { db: prisma, now: () => new Date(), searchLimiter: identifierRateLimiter() };
}

export async function breachDeps(): Promise<BreachDeps> {
  const { prisma } = await import("@/lib/prisma");
  return { db: prisma, now: () => new Date() };
}

export async function privacyCorrectionDeps(): Promise<PrivacyDeps & { corrections: CorrectionDeps }> {
  const { defaultCorrectionDeps } = await import("@/lib/corrections/service");
  return { ...(await privacyDeps()), corrections: await defaultCorrectionDeps() };
}
